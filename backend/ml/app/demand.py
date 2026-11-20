"""
Rule-based expected demand ("routine max").

For every transport-card holder and every date:
  * incoming trip: the latest morning slot on their route that reaches DSC at
    least ARRIVAL_BUFFER minutes before their first class;
  * outgoing trip: the first afternoon slot that leaves at least WALK_BUFFER
    minutes after their last class.

This is the most people who *could* ride. The forecast model then estimates
how many actually do.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as Date

from .schemas import CalendarDay, Rider, Session, Slot

ARRIVAL_BUFFER = 10
WALK_BUFFER = 5


def weekday_js(iso: str) -> int:
    """0 = Sunday ... 6 = Saturday, like JavaScript and the API."""
    return (Date.fromisoformat(iso).weekday() + 1) % 7


# DIU departments: code, website slug, name. Keep in step with shared/src/departments.ts.
DEPARTMENTS: list[tuple[str, str, str]] = [
    ("CSE", "cse", "Computer Science and Engineering"), ("SWE", "swe", "Software Engineering"),
    ("ICE", "ice", "Information and Communication Engineering"), ("EEE", "eee", "Electrical and Electronic Engineering"),
    ("CE", "ce", "Civil Engineering"), ("TE", "te", "Textile Engineering"), ("ARCH", "architecture", "Architecture"),
    ("RME", "rme", "Robotics and Mechatronics Engineering"), ("AIDE", "aide", "Artificial Intelligence and Data Engineering"),
    ("MCT", "mct", "Multimedia and Creative Technology"), ("CIS", "cis", "Computing and Information System"),
    ("ITM", "itm", "Information Technology and Management"), ("ESDM", "esdm", "Environmental Science and Disaster Management"),
    ("PESS", "pess", "Physical Education and Sports Science"), ("BBA", "bba", "Business Administration"),
    ("MGT", "mgt", "Management"), ("ACC", "accounting", "Accounting"), ("FIN", "finance", "Finance and Banking"),
    ("MKT", "mkt", "Marketing"), ("BRE", "bre", "Real Estate"), ("THM", "thm", "Tourism and Hospitality Management"),
    ("IE", "de", "Innovation and Entrepreneurship"), ("ENG", "english", "English"), ("LAW", "law", "Law"),
    ("JMC", "jmc", "Journalism, Media and Communication"), ("DS", "ds", "Development Studies"),
    ("ISLM", "islm", "Information Science and Library Management"), ("ICTE", "icted", "ICT Education"),
    ("PHAR", "pharmacy", "Pharmacy"), ("PH", "ph", "Public Health"), ("NFE", "nfe", "Nutrition and Food Engineering"),
    ("GEB", "geb", "Genetic Engineering and Biotechnology"), ("AGS", "ags", "Agricultural Science"), ("FISH", "fisheries", "Fisheries"),
]


def _dept_words(value: str) -> str:
    v = re.sub(r"[^a-z ]", " ", value.lower())
    v = re.sub(r"\b(department|dept|of|and|the|bsc|msc|in)\b", " ", v)
    return " ".join(v.split())


_DEPT_ALIASES: dict[str, str] = {"se": "SWE", "computer science": "CSE", "pharm": "PHAR"}
for _code, _slug, _name in DEPARTMENTS:
    _DEPT_ALIASES[_dept_words(_name)] = _code
    _DEPT_ALIASES[_code.lower()] = _code
    _DEPT_ALIASES[_slug] = _code


def norm_dept(value: str | None) -> str:
    """'Dept. of Software Engineering' / 'SWE' / 'software engineering' -> 'SWE'; same for every DIU department."""
    if not value:
        return ""
    v = _dept_words(value)
    return _DEPT_ALIASES.get(v, v.upper().replace(" ", "_"))


def norm_batch(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def norm_section(value: str | None) -> str:
    return (value or "").strip().upper()[:2]


@dataclass
class DayDemand:
    counts: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))  # (date, slotId) -> riders
    unserved_in: int = 0
    unserved_out: int = 0


def _session_index(sessions: list[Session]):
    by_group: dict[tuple[str, str, str, int], list[Session]] = defaultdict(list)
    by_teacher: dict[tuple[str, int], list[Session]] = defaultdict(list)
    for s in sessions:
        if s.batch and s.section:
            by_group[(norm_dept(s.department), norm_batch(s.batch), norm_section(s.section), s.weekday)].append(s)
        if s.teacher_initial:
            by_teacher[(s.teacher_initial.strip().upper(), s.weekday)].append(s)
    return by_group, by_teacher


def expected_demand(dates: list[str], riders: list[Rider], sessions: list[Session], slots: list[Slot], calendar: list[CalendarDay]) -> DayDemand:
    closed = {c.date for c in calendar if c.cancels_service}
    by_group, by_teacher = _session_index(sessions)
    slots_by_route: dict[tuple[str, str, str], list[Slot]] = defaultdict(list)
    for s in slots:
        slots_by_route[(s.route_id, s.audience, s.direction)].append(s)
    for lst in slots_by_route.values():
        lst.sort(key=lambda s: s.departure_minutes)

    out = DayDemand()
    for d in dates:
        if d in closed:
            continue
        wd = weekday_js(d)
        for r in riders:
            if r.audience == "student":
                mine = by_group.get((norm_dept(r.department), norm_batch(r.batch), norm_section(r.section), wd), [])
            else:
                mine = by_teacher.get(((r.teacher_initial or "").strip().upper(), wd), [])
            if not mine:
                continue
            first = min(s.start_minutes for s in mine)
            last = max(s.end_minutes for s in mine)

            def trips(direction: str) -> list[Slot]:
                # Staff ride the regular buses as well as staff-only trips (such as DIU's
                # 4:20 PM "only for employees" bus); students ride the regular buses only.
                kinds = [r.audience] if r.audience == "student" else [r.audience, "student"]
                found = [s for a in kinds for s in slots_by_route.get((r.route_id, a, direction), []) if wd in s.weekdays]
                return sorted(found, key=lambda s: s.departure_minutes)

            incoming = trips("to_campus")
            if incoming:
                on_time = [s for s in incoming if s.departure_minutes + s.duration_minutes <= first - ARRIVAL_BUFFER]
                pick = on_time[-1] if on_time else incoming[0]  # nothing early enough: they take the first bus
                out.counts[(d, pick.time_slot_id)] += 1
            else:
                out.unserved_in += 1

            outgoing = trips("from_campus")
            after = [s for s in outgoing if s.departure_minutes >= last + WALK_BUFFER]
            if after:
                out.counts[(d, after[0].time_slot_id)] += 1
            else:
                out.unserved_out += 1  # class ends after the last bus: a real gap to report
    return out
