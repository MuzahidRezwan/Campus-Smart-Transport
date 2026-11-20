"""Following a department's notice page to its class routine file, and reading Word routines."""
import io
import zipfile

import httpx

from app import fetcher
from app.demand import norm_dept
from app.fetcher import _extension, direct_link, fetch_routine_file
from app.routine_parser import parse_file

BASE = "https://webbackend.daffodilvarsity.edu.bd/department/swe"

NOTICE_LIST = f"""<html><body>
<nav><a href="/flipbook/brochure">Brochure</a><a href="/photos/pdf/Report-on-traffic-mgt.pdf">Traffic report</a></nav>
<a href="{BASE}/notice-detail/4057">Fees Payment Schedule of Fall'2026 Final Examination</a>
<a href="{BASE}/notice-detail/4052">[B.Sc. in SWE] Midterm Overlap and Missed Examination Schedule - Fall 2026</a>
<a href="{BASE}/notice-detail/4040">[B.Sc. in SWE] Class Routine, Fall-2026 (V3)</a>
<a href="{BASE}/notice-detail/3990">[B.Sc. in SWE] Class Routine, Fall-2026 (V1)</a>
</body></html>""".encode()

NOTICE_PAGE = f"""<html><body>
<h1>[B.Sc. in SWE] Class Routine, Fall-2026 (V3)</h1>
<a href="https://daffodilvarsity.edu.bd/download-file/4100">Download</a>
<aside><a href="{BASE}/notice-detail/3990">[B.Sc. in SWE] Class Routine, Fall-2026 (V1)</a></aside>
</body></html>""".encode()

TEMPLATE = [
    ["department", "batch", "section", "teacher_initial", "day", "start_time", "end_time", "course_code", "room"],
    ["SWE", "41", "G", "RI", "Sunday", "08:30", "10:00", "SE331", "AB4-601"],
    ["SWE", "41", "G", "MRH", "Monday", "10:00", "11:30", "SE332", "AB4-602"],
]


def make_docx(rows: list[list[str]]) -> bytes:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    cell = lambda t: f'<w:tc><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:tc>'
    body = "".join("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>" for r in rows)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{w}"><w:body><w:tbl>{body}</w:tbl></w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def test_follows_the_newest_class_routine_notice_to_its_file(monkeypatch):
    docx = make_docx(TEMPLATE)
    pages = {
        f"{BASE}/notice": ("routine.html", NOTICE_LIST),
        f"{BASE}/notice-detail/4040": ("routine.html", NOTICE_PAGE),
        "https://daffodilvarsity.edu.bd/download-file/4100": ("routine.docx", docx),
    }
    calls = []
    monkeypatch.setattr(fetcher, "fetch", lambda url: (calls.append(url), pages[url])[1])
    name, data, found = fetch_routine_file(f"{BASE}/notice")
    assert found == "https://daffodilvarsity.edu.bd/download-file/4100"
    assert name == "routine.docx"
    assert calls == [f"{BASE}/notice", f"{BASE}/notice-detail/4040", found]  # skipped exam notices and the brochure
    parsed = parse_file(name, data, "Software Engineering")
    assert len(parsed.sessions) == 2
    assert {s.teacher_initial for s in parsed.sessions} == {"RI", "MRH"}


def test_a_direct_file_link_is_used_as_is(monkeypatch):
    monkeypatch.setattr(fetcher, "fetch", lambda url: ("routine.pdf", b"%PDF-1.4"))
    assert fetch_routine_file("https://daffodilvarsity.edu.bd/download-file/1")[2] == "https://daffodilvarsity.edu.bd/download-file/1"


def test_a_page_with_no_routine_link_is_read_itself(monkeypatch):
    page = b"<html><table><tr><td>department</td></tr></table><a href='/about'>About</a></html>"
    monkeypatch.setattr(fetcher, "fetch", lambda url: ("routine.html", page))
    assert fetch_routine_file("https://cse.daffodilvarsity.edu.bd/routine")[0] == "routine.html"


def test_google_share_links_become_download_links():
    assert direct_link("https://drive.google.com/file/d/AbC_12-x/view?usp=sharing") == "https://drive.google.com/uc?export=download&id=AbC_12-x"
    assert direct_link("https://docs.google.com/spreadsheets/d/Sheet1x/edit#gid=0") == "https://docs.google.com/spreadsheets/d/Sheet1x/export?format=xlsx"
    assert direct_link("https://docs.google.com/document/d/Doc9/edit") == "https://docs.google.com/document/d/Doc9/export?format=docx"
    assert direct_link("https://daffodilvarsity.edu.bd/x.pdf") == "https://daffodilvarsity.edu.bd/x.pdf"


def test_file_type_comes_from_the_download_headers():
    h = httpx.Headers({"content-disposition": 'attachment; filename="SWE Class Routine Fall 2026.docx"', "content-type": "application/octet-stream"})
    assert _extension("https://daffodilvarsity.edu.bd/download-file/4100", h) == ".docx"
    assert _extension("https://x.daffodilvarsity.edu.bd/download-file/1", httpx.Headers({"content-type": "application/pdf"})) == ".pdf"
    assert _extension("https://x.daffodilvarsity.edu.bd/notice", httpx.Headers({"content-type": "text/html"})) == ".html"


def test_every_department_name_matches_its_code():
    assert norm_dept("Department of Civil Engineering") == norm_dept("CE") == "CE"
    assert norm_dept("Tourism & Hospitality Management") == "THM"
    assert norm_dept("Software Engineering") == norm_dept("swe") == "SWE"
