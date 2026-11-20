"""
Safe download of routine files from department websites.

Guards against SSRF: HTTPS only, host must be on the allow-list, every
resolved address must be public, redirects are re-checked, size and time limited.

A department source can be the routine file itself, or a page that links to it
(DIU's notice list: newest "Class Routine" notice -> notice page -> file).
`fetch_routine_file` follows such links, at most two pages deep.
"""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx

MAX_BYTES = 10 * 1024 * 1024
# DIU's own sites, and Google Drive / Docs, where some departments share routines.
DEFAULT_ALLOWED = "daffodilvarsity.edu.bd,diu.edu.bd,drive.google.com,docs.google.com,drive.usercontent.google.com"
MAX_DEPTH = 2

EXTENSIONS = (".pdf", ".xlsx", ".csv", ".docx", ".html", ".htm")
CONTENT_TYPES = {
    "pdf": ".pdf",
    "spreadsheetml": ".xlsx",
    "csv": ".csv",
    "wordprocessingml": ".docx",
}
# "Class Routine Spring-2026", "Updated routine (V3)"; not exam routines or results.
ROUTINE_TEXT = re.compile(r"routine|time\s*table|class\s*schedule", re.I)
NOT_CLASS_ROUTINE = re.compile(r"exam|final|mid[\s-]*term|overlap|improvement|make[\s-]*up|result|retake|defen[cs]e", re.I)
FILE_HREF = re.compile(r"download-file|noticeFile|\.(pdf|xlsx|csv|docx)(\?|$)|drive\.google\.com/(file|uc)|docs\.google\.com/(spreadsheets|document)", re.I)


class FetchError(ValueError):
    pass


def allowed_hosts() -> list[str]:
    return [h.strip().lower() for h in os.environ.get("ALLOWED_FETCH_HOSTS", DEFAULT_ALLOWED).split(",") if h.strip()]


def check_url(url: str, resolve=socket.getaddrinfo) -> str:
    p = urlparse(url)
    if p.scheme != "https":
        raise FetchError("Only https:// links are allowed")
    host = (p.hostname or "").lower()
    if not host or not any(host == a or host.endswith("." + a) for a in allowed_hosts()):
        raise FetchError(f"Host {host!r} is not on the allowed list")
    try:
        infos = resolve(host, p.port or 443)
    except OSError as e:
        raise FetchError(f"Cannot resolve {host}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise FetchError("Link points to a private address")
    return url


def direct_link(url: str) -> str:
    """Google Drive / Docs share links -> their download links. Other links unchanged."""
    p = urlparse(url)
    host = (p.hostname or "").lower()
    m = re.match(r"/file/d/([\w-]+)", p.path)
    if host == "drive.google.com" and m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    if host == "drive.google.com" and p.path == "/open" and "id" in parse_qs(p.query):
        return f"https://drive.google.com/uc?export=download&id={parse_qs(p.query)['id'][0]}"
    m = re.match(r"/spreadsheets/d/([\w-]+)", p.path)
    if host == "docs.google.com" and m:
        return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"
    m = re.match(r"/document/d/([\w-]+)", p.path)
    if host == "docs.google.com" and m:
        return f"https://docs.google.com/document/d/{m.group(1)}/export?format=docx"
    return url


def _extension(url: str, headers: httpx.Headers) -> str:
    disposition = headers.get("content-disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", disposition, re.I)
    for candidate in ([unquote(m.group(1)).lower()] if m else []) + [urlparse(url).path.lower()]:
        ext = next((e for e in EXTENSIONS if candidate.endswith(e)), None)
        if ext:
            return ".html" if ext == ".htm" else ext
    ctype = headers.get("content-type", "").lower()
    return next((ext for key, ext in CONTENT_TYPES.items() if key in ctype), ".html")


def fetch(url: str) -> tuple[str, bytes]:
    """Returns (file name with extension, bytes)."""
    current = check_url(url)
    with httpx.Client(timeout=20.0, follow_redirects=False, headers={"user-agent": "DIU-Transport-RoutineSync/1.0"}) as client:
        for _ in range(4):
            with client.stream("GET", current) as resp:
                if resp.status_code in (301, 302, 303, 307, 308):
                    current = check_url(urljoin(current, resp.headers.get("location", "")))
                    continue
                if resp.status_code != 200:
                    raise FetchError(f"Download failed with HTTP {resp.status_code}")
                chunks, size = [], 0
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise FetchError("File is larger than 10 MB")
                    chunks.append(chunk)
                return f"routine{_extension(current, resp.headers)}", b"".join(chunks)
    raise FetchError("Too many redirects")


def _links(base: str, html: bytes) -> list[tuple[str, str]]:
    """(absolute href, visible text) for every link, in page order (DIU lists the newest notice first)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    out: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = urljoin(base, a["href"].strip())
        if href.startswith("https://"):
            out.append((href, " ".join(a.get_text(" ", strip=True).split()) or a.get("title", "")))
    return out


def _pick(base: str, html: bytes, depth: int) -> str | None:
    """The link to follow from this page, or None if the page itself is the routine."""
    links = _links(base, html)
    is_routine = lambda text, href: bool(ROUTINE_TEXT.search(text) or ROUTINE_TEXT.search(unquote(href))) and not (NOT_CLASS_ROUTINE.search(text) or NOT_CLASS_ROUTINE.search(unquote(href)))
    files = [(h, t) for h, t in links if FILE_HREF.search(h)]
    pages = [(h, t) for h, t in links if not FILE_HREF.search(h) and h.split("#")[0] != base.split("#")[0]]
    routine_files = [h for h, t in files if is_routine(t, h)]
    if routine_files:
        return routine_files[0]
    # On a notice page (we got here by following a routine notice), its file is the routine.
    if depth >= 1 and files:
        return files[0][0]
    routine_pages = [h for h, t in pages if is_routine(t, h)]
    if routine_pages and depth < MAX_DEPTH:
        return routine_pages[0]
    return None


def fetch_routine_file(url: str) -> tuple[str, bytes, str]:
    """
    Follows a department page to its newest class routine file.
    Returns (file name, bytes, the URL the file came from).
    """
    current = direct_link(url)
    seen: set[str] = set()
    for depth in range(MAX_DEPTH + 1):
        name, data = fetch(current)
        if not name.endswith(".html"):
            return name, data, current
        nxt = _pick(current, data, depth)
        if not nxt or nxt in seen:
            return name, data, current
        seen.add(current)
        current = direct_link(nxt)
    name, data = fetch(current)
    return name, data, current
