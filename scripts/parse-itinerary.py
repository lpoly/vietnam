#!/usr/bin/env python3
"""
Parse the itinerary markdown into structured data for the static site.

    python scripts/parse-itinerary.py

Reads   vietnam-itinerary-12-21-dec.md   (path set in scripts/parse-config.json)
Writes  data/trip.json                   structured itinerary (the site's only content source)
        data/trip.js                     same data as `window.TRIP = ...` so index.html works from file://
        data/places.json                 every detected place; `coords` are preserved across runs
        data/photos.json                 photo slots; `file`/`credit` are preserved across runs
        data/extraction-report.md        what was extracted, what was not, and every warning
        asset-manifest.js                list of files the service worker caches for offline use

Rules this script follows:
  * Every string it emits is copied verbatim from the markdown (inline **bold** and *italic*
    markers are kept and rendered by the site). It never rewrites, rounds or converts.
  * Every markdown block must be claimed by some extractor; anything left over is listed in
    the report under "Unrepresented text" so nothing disappears silently.
  * Standard library only.
"""
import datetime
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "scripts" / "parse-config.json").read_text("utf-8"))
# Another version of the trip: `python scripts/parse-itinerary.py halong` reads scripts/parse-config.halong.json
# on top of the main config (lists are extended, everything else replaced) and writes data/*-halong.* files.
VARIANT = sys.argv[1] if len(sys.argv) > 1 else None
if VARIANT:
    VCFG = json.loads((ROOT / "scripts" / f"parse-config.{VARIANT}.json").read_text("utf-8"))
    for k, v in VCFG.items():
        if k != "remove":
            CFG[k] = CFG.get(k, []) + v if isinstance(v, list) and k != "versions" else v
    # Entries of the main lists that don't apply to this version, by subject, place or plain string.
    for k, names in VCFG.get("remove", {}).items():
        CFG[k] = [x for x in CFG[k] if (x.get("subject") or x.get("place") if isinstance(x, dict) else x) not in names]
SUFFIX = f"-{VARIANT}" if VARIANT else ""
SRC = ROOT / CFG["source"]
DATA = ROOT / "data"

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


# ---------------------------------------------------------------- inline helpers

TIME = r"\d{1,2}:\d{2}"
TIME_RANGE = rf"{TIME}(?:\s*[–-]\s*{TIME})?"
BOLD = re.compile(r"\*\*(.+?)\*\*")
ITAL = re.compile(r"(?<![*\w])\*(?!\*)(.+?)(?<!\*)\*(?![*\w])")
LINK = re.compile(r"\[([^\]]+)\]\((https://[^\s)]+)\)")
HEDGE = re.compile(
    r"\bsources?\b|\blistings?\b|listed as|can't (?:confirm|verify|vouch)|cannot confirm|"
    r"reconfirm|disagree|inconsistent|\bvary\b|\bvaries\b|re-addressed|may be defunct|unsure",
    re.I,
)
HOURS = re.compile(rf"{TIME}\s*[–-]\s*{TIME}|{TIME} onwards|\bOpens?\b|\bopen\b|\bcloses?\s+\d", re.I)
PRICE = re.compile(r"VND|\$\d|^free\b", re.I)
# Text after a place name counts as "where it is" only if it reads like a location.
WHERE_OK = re.compile(
    r"^(?:\d+[A-Z]?(?:[–-]\d+)?\s+[A-ZĐ]|[A-ZĐ]|(?:in|on|near|off|by|just|both (?:in|on)|central|west|east|north|south)\b"
    r"|~?\d+(?:\.\d+)?\s*k?m\s+(?:from|out|south|north|east|west)\b)")
# ...and goes into the maps search only if it is a street address or a proper-noun locality.
ADDRESS_LIKE = re.compile(r"^(?:\d+[A-Z]?(?:[–-]\d+)?\s+[A-ZĐ]|[A-ZĐ])")
MONTHS = {m: i for i, m in enumerate(
    "January February March April May June July August September October November December".split(), 1)}


def plain(s):
    s = LINK.sub(r"\1", s)
    s = BOLD.sub(r"\1", s)
    s = ITAL.sub(r"\1", s)
    return s


def slug(s, n=60):
    s = plain(s).replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:n].strip("-")


def tmin(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def is_uncertain(text):
    text = LINK.sub(r"\1", text)  # a source URL in parentheses is not a hedge
    for m in ITAL.finditer(text):
        if HEDGE.search(m.group(1)):
            return True
    for m in re.finditer(r"\(([^()]*)\)", text):
        if HEDGE.search(m.group(1)):
            return True
    if re.search(r"—[^—]*\bsources\b", text):
        return True
    return False


class Masked:
    """Hide bold, italic and parenthesised spans so punctuation inside them is not mistaken
    for sentence or clause boundaries. unmask() restores the exact original text."""

    def __init__(self, s):
        self.tokens = []

        def rep(m):
            self.tokens.append(m.group(0))
            tail = "\x01" if re.search(r"[.!?]\**\)?$", m.group(0)) else ""
            return f"\x00{len(self.tokens) - 1}\x00{tail}"

        s = BOLD.sub(lambda m: rep(m), s)
        s = ITAL.sub(lambda m: rep(m), s)
        s = re.sub(r"\([^()]*\)", lambda m: rep(m), s)
        self.s = s

    def unmask(self, s):
        prev = None
        while prev != s:
            prev = s
            s = re.sub(r"\x00(\d+)\x00", lambda m: self.tokens[int(m.group(1))], s)
        return s.replace("\x01", "")


def sentences(text):
    """Split prose into sentences, verbatim, without breaking inside bold/italic/parens."""
    mk = Masked(text)
    parts = re.split(r"(?<=[.!?\x01])\s+(?=\S)", mk.s)
    return [mk.unmask(p).strip() for p in parts if mk.unmask(p).strip()]


def first_clause(text):
    """Leading clause of a sentence, used as a short title. Verbatim prefix of `text`."""
    mk = Masked(text)
    m = re.search(r"(?:[.!?\x01](?=\s)|\s—\s|:\s|;\s)", mk.s)
    head = mk.unmask(mk.s[: m.start()] + ("\x01" if m and m.group(0) == "\x01" else "")) if m else text
    head = head.strip()
    if head.endswith(".") and not head.endswith("**"):
        head = head[:-1]
    return head


# ---------------------------------------------------------------- markdown blocks

class Block:
    def __init__(self, kind, line, **kw):
        self.kind = kind
        self.line = line + 1  # 1-based for humans
        self.used = False
        self.__dict__.update(kw)

    def use(self):
        self.used = True
        return self


def split_row(r):
    return [c.strip() for c in r.strip().strip("|").split("|")]


LIST_RE = re.compile(r"^(-|\d+\.)\s+(.*)$")


def parse_blocks(lines):
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.strip() == "---":
            blocks.append(Block("hr", i))
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            blocks.append(Block("h", i, level=len(m.group(1)), text=m.group(2).strip()))
            i += 1
            continue
        if line.startswith("|"):
            j, rows = i, []
            while j < len(lines) and lines[j].startswith("|"):
                rows.append(lines[j].rstrip())
                j += 1
            blocks.append(Block("table", i, header=split_row(rows[0]),
                                rows=[split_row(r) for r in rows[2:]], lines=list(range(i + 3, j + 1))))
            i = j
            continue
        m = LIST_RE.match(line)
        if m:
            ordered = m.group(1) != "-"
            items, j = [], i
            while j < len(lines):
                mm = LIST_RE.match(lines[j].rstrip())
                if mm and ((mm.group(1) != "-") == ordered):
                    items.append({"line": j + 1, "text": mm.group(2).strip()})
                    j += 1
                elif items and lines[j].startswith("  ") and lines[j].strip():
                    items[-1]["text"] += " " + lines[j].strip()
                    j += 1
                else:
                    break
            blocks.append(Block("list", i, ordered=ordered, items=items))
            i = j
            continue
        j, buf = i, []
        while j < len(lines) and lines[j].strip() and not re.match(r"^(#|\||-\s|\d+\.\s|---)", lines[j]):
            buf.append(lines[j].strip())
            j += 1
        blocks.append(Block("p", i, text=" ".join(buf)))
        i = j
    return blocks


def sectionize(blocks):
    doc = {"title": None, "pre": [], "sections": []}
    cur = sub = None
    for b in blocks:
        if b.kind == "h":
            b.use()
            if b.level == 1:
                doc["title"] = b.text
            elif b.level == 2:
                cur = {"title": b.text, "line": b.line, "blocks": [], "subs": []}
                doc["sections"].append(cur)
                sub = None
            else:
                sub = {"title": b.text, "line": b.line, "blocks": []}
                cur["subs"].append(sub)
            continue
        if b.kind == "hr":
            b.use()
            continue
        (sub["blocks"] if sub else cur["blocks"] if cur else doc["pre"]).append(b)
    return doc


def find_section(doc, prefix):
    for s in doc["sections"]:
        if s["title"].startswith(prefix):
            return s
    warn(f"Section starting '{prefix}' not found")
    return {"title": prefix, "line": 0, "blocks": [], "subs": []}


def find_sub(sec, prefix):
    for s in sec["subs"]:
        if s["title"].startswith(prefix):
            return s
    warn(f"Subsection '{prefix}' not found in '{sec['title']}'")
    return {"title": prefix, "line": 0, "blocks": []}


def lead(text):
    """Split '**Lead.** rest' into (lead-without-trailing-punct, rest). Lead is None if absent."""
    m = re.match(r"^\*\*(.+?)\*\*\s*(.*)$", text)
    if not m:
        return None, text
    return m.group(1).rstrip(":.").strip(), m.group(2)


def generic(blocks):
    """Paragraphs, lists and tables as verbatim structured nodes."""
    out = []
    for b in blocks:
        b.use()
        if b.kind == "p":
            ld, rest = lead(b.text)
            out.append({"kind": "p", "text": b.text, "lead": ld, "rest": rest, "line": b.line,
                        "uncertain": is_uncertain(b.text)})
        elif b.kind == "list":
            out.append({"kind": "list", "ordered": b.ordered, "line": b.line, "items": [
                {"text": it["text"], "lead": lead(it["text"])[0], "rest": lead(it["text"])[1],
                 "line": it["line"], "uncertain": is_uncertain(it["text"])} for it in b.items]})
        elif b.kind == "table":
            out.append({"kind": "table", "header": b.header, "rows": b.rows, "line": b.line})
    return out


# ---------------------------------------------------------------- places

PLACES = {}  # id -> place
EXCL = set(CFG["place_exclude"])
EXCL_PRE = tuple(CFG["place_exclude_prefixes"])
INCL = set(CFG["place_include"])


def is_place_name(n):
    if n in INCL:
        return True
    if n in EXCL or n.startswith(EXCL_PRE):
        return False
    if not n or not n[0].isupper() or n.endswith(":"):
        return False
    if re.search(r"VND|\$|\d{1,2}:\d{2}|%|[?!]", n):
        return False
    return len(n.split()) <= 8


def locator(text, end):
    """Text right after a place's bold name that says where/when it is.
    Returns (span_end, where, hours, price) — all verbatim fragments — or None."""
    after = text[end:]
    if after.startswith(" — "):
        start, stops = end + 3, (r"[.!?\x01](?=\s|$)", r";\s")
    elif after.startswith(", "):
        start, stops = end + 2, (r"[.!?\x01](?=\s|$)", r"\s—\s", r";\s", r",? or\b")
    elif after.startswith(" ("):
        close = text.find(")", end)
        inner = text[end + 2:close]
        parts = re.split(r";\s|,\s", inner)
        return (close + 1,) + classify_parts(parts)
    elif re.match(r" at \d", after):
        start, stops = end + 4, (r"[.!?\x01](?=\s|$)", r"\s—\s")
    else:
        return None
    seg = text[start:]
    nxt = seg.find("**")
    if nxt >= 0:
        seg = seg[:nxt]
    mk = Masked(seg)
    cut = len(mk.s)
    for st in stops:
        m = re.search(st, mk.s)
        if m:
            cut = min(cut, m.start())
    frag = mk.unmask(mk.s[:cut])
    mk2 = Masked(frag)
    parts = [mk2.unmask(p) for p in re.split(r",\s", mk2.s)]
    # '**Bún Bò Huế Bà Tuyết**, 47 Nguyen Cong Tru St, Phu Hoi — ~50,000 VND.' : the dash-price belongs to this place.
    tail = re.match(r"\s—\s(~?[\d,]+(?:[–-][\d,]+)?\s*VND[^.;—]*)", text[start + len(frag):])
    if tail:
        parts.append(tail.group(1))
        frag = text[start:start + len(frag) + tail.end()]
    return (start + len(frag),) + classify_parts(parts)


def classify_parts(parts):
    where, hours, price = [], [], []
    for p in parts:
        p = p.strip().rstrip(".")
        if not p or p in ("or", "and"):
            continue
        if HOURS.search(p) and not PRICE.search(p):
            hours.append(p)
        elif PRICE.search(p):
            price.append(p)
        else:
            where.append(p)
    w = ", ".join(where) or None
    if w and not WHERE_OK.match(w):
        w = None
    return (w, ", ".join(hours) or None, ", ".join(price) or None)


def place_id(name, base):
    core = re.sub(r"\s*\(.*?\)\s*", " ", plain(name)).strip()
    return slug(core) + "--" + slug(base)


def register_place(name, base, day, section, where=None, hours=None, price=None):
    name = name.strip().rstrip(".")
    pid = place_id(name, base)
    p = PLACES.get(pid)
    if not p:
        p = PLACES[pid] = {"id": pid, "name": name, "base": base, "days": [], "sections": [],
                           "where": None, "hours": None, "price": None}
    if day not in p["days"]:
        p["days"].append(day)
    if section not in p["sections"]:
        p["sections"].append(section)
    p["where"] = p["where"] or where
    p["hours"] = p["hours"] or hours
    p["price"] = p["price"] or price
    return pid


def maps_query(p):
    q = [plain(p["name"])]
    if p["where"] and ADDRESS_LIKE.search(p["where"]):
        q.append(re.sub(r"\s*\(.*?\)", "", plain(p["where"])).strip())
    if p["base"] not in ("En route",) and p["base"].lower() not in " ".join(q).lower():
        q.append(p["base"])
    return ", ".join(q)


def scan_places(text, base, day, section, skip_lead=False):
    """Find place names in bold spans. Returns (place ids, consumed char ranges)."""
    ids, consumed = [], []
    for k, m in enumerate(BOLD.finditer(text)):
        if skip_lead and k == 0 and m.start() == 0:
            continue
        name = m.group(1).rstrip(".")
        if not is_place_name(name):
            continue
        loc = locator(text, m.end())
        where = hours = price = None
        end = m.end()
        if loc:
            end, where, hours, price = loc
        ids.append(register_place(name, base, day, section, where, hours, price))
        consumed.append((m.start(), end))
    for extra in CFG["extra_places"]:
        if extra["day"] == day and extra["section"] == section and re.search(
                rf"\b{re.escape(extra['name'])}\b", plain(text)):
            pid = register_place(extra["name"], base, day, section)
            if pid not in ids:
                ids.append(pid)
    return ids, consumed


def title_places(title, base, day, section):
    """A timed activity's bold title is usually the place itself ('Trang An, Route 2')."""
    t = title.rstrip(".")
    names = [t]
    if " or " in t and all(x[:1].isupper() for x in t.split(" or ")):
        names = t.split(" or ")
    return [register_place(n, base, day, section) for n in names if is_place_name(n.strip())]


# ---------------------------------------------------------------- route, bases, dates

def parse_intro(doc):
    out = []
    for b in doc["pre"]:
        b.use()
        out.append({"text": b.text, "lead": lead(b.text)[0], "line": b.line})
    year = None
    for it in out:
        m = re.search(r"(\d{1,2}) December (\d{4}) is a \*\*(\w+)\*\*", it["text"])
        if m:
            year = int(m.group(2))
    if not year:
        year = 2026
        warn("Could not find the trip year in the intro; assumed 2026")
    return out, year


def parse_date_range(s, year):
    """'12–13 Dec' -> [date(…12), date(…13)];  '16 Dec' -> [date(…16)]"""
    m = re.match(r"(\d{1,2})(?:[–-](\d{1,2}))?\s+Dec", plain(s))
    if not m:
        return []
    a = int(m.group(1))
    b = int(m.group(2) or a)
    return [datetime.date(year, 12, d) for d in range(a, b + 1)]


def parse_route(sec, year):
    chosen = find_sub(sec, "Chosen route")
    bases, notes = [], []
    for b in chosen["blocks"]:
        b.use()
        if b.kind == "table":
            for r in b.rows:
                dates = parse_date_range(r[0], year)
                base_full = plain(r[1])
                short = re.sub(r"\s*\(.*\)$", "", base_full)
                bases.append({"dates": r[0], "base": r[1], "short": short, "nights": r[2], "why": r[3],
                              "isTrain": "train" in short.lower(),
                              "iso": [d.isoformat() for d in dates], "key": slug(short), "index": len(bases)})
        else:
            notes.append(b.text)
    # Line colours: bases named in `base_lines` get a fixed colour; the rest are numbered in order, so adding a
    # stop in one version doesn't shift the colours of the others.
    fixed, k = CFG.get("base_lines", {}), 0
    for b in bases:
        if b["short"] in fixed:
            b["line"] = fixed[b["short"]]
        else:
            b["line"], k = k, k + 1
    background = []
    for sub in sec["subs"]:
        if sub is chosen:
            continue
        background.append({"heading": sub["title"], "nodes": generic(sub["blocks"])})
    return {"bases": bases, "notes": notes, "background": background}


def parse_legs(sec, year):
    legs, total, howto = [], [], []
    for b in sec["blocks"]:
        b.use()
        if b.kind == "table":
            for k, r in enumerate(b.rows):
                dates = parse_date_range(r[0], year)
                dep, _, arr = [x.strip() for x in r[3].partition("→")]
                legs.append({"id": f"leg-{k}", "date": r[0], "leg": r[1], "mode": r[2], "times": r[3],
                             "depart": dep, "arrive": arr or None, "duration": r[4], "cost": r[5],
                             "start": dates[0].isoformat() if dates else None,
                             "end": dates[-1].isoformat() if dates else None,
                             "line": b.lines[k], "flags": [], "uncertain": False})
        elif b.kind == "p":
            total.append(b.text)
    sub = find_sub(sec, "How to book")
    howto = generic(sub["blocks"])
    # Optional: the alternatives to each leg, with their sources.
    other = next(({"heading": s["title"], "nodes": generic(s["blocks"])} for s in sec["subs"]
                  if s["title"].startswith("Other ways")), None)
    return {"legs": legs, "total": total, "howto": howto, "other": other}


# ---------------------------------------------------------------- days

DAY_RE = re.compile(r"^Day (\d+) — (\w+) (\d{1,2}) (\w+) · (.+)$")
SECTION_KEYS = [("Movements", "movements"), ("Accommodation", "accommodation"), ("Activities", "activities"),
                ("Food", "food"), ("Local-life", "local"), ("Rain plan", "rain")]


def night_base(bases, iso):
    for b in bases:
        if iso in b["iso"]:
            return b
    return None


def make_item(iid, text, line, base, day, section, kind="bullet"):
    it = {"id": iid, "kind": kind, "text": text, "line": line, "time": None, "start": None, "end": None,
          "title": None, "more": text, "places": [], "flags": [], "risks": [], "uncertain": is_uncertain(text)}
    m = re.match(rf"^\*\*({TIME_RANGE})(?:\s+(.+?))?\*\*\s*(.*)$", text)
    if m:
        t, btitle, rest = m.groups()
        times = re.findall(TIME, t)
        it["time"], it["start"] = t, tmin(times[0])
        it["end"] = tmin(times[1]) if len(times) > 1 else None
        if btitle:
            it["title"] = btitle.rstrip(".")
            it["more"] = rest
            it["titleIsName"] = True
        else:
            it["title"] = first_clause(rest)
            it["more"] = rest
    else:
        ld, rest = lead(text)
        if ld:
            it["title"], it["more"] = ld, rest
        else:
            it["title"] = first_clause(text)
            it["more"] = text
    # Trim the title off the front of `more` so expanding doesn't repeat it.
    if it["more"].startswith(it["title"]) and not it.get("titleIsName"):
        it["more"] = re.sub(r"^[\s.:;,—]+", "", it["more"][len(it["title"]):])
    return it


def split_multi_time(text):
    """'**17:00** Depart. **19:00** Showers. **21:15** Station.' -> three items."""
    return re.split(rf"(?<=[.!?])\s+(?=\*\*{TIME_RANGE}\*\*)", text)


def base_for(day, start, text, bases):
    tonight = day["_night"]
    prev = day["_prev"]
    if re.search(r"on the road|on the pass|en route", plain(text)):
        return "En route"
    if start is not None and start < 11 * 60 and prev != tonight:
        return prev
    return tonight


def items_from_blocks(blocks, day, section, bases, counter, timeline=True):
    items = []
    for b in blocks:
        b.use()
        if b.kind == "list":
            for li in b.items:
                for part in (split_multi_time(li["text"]) if timeline else [li["text"]]):
                    items.append(build_item(part, li["line"], day, section, bases, counter,
                                            "option" if b.ordered else "bullet"))
        elif b.kind == "p":
            items.append(build_item(b.text, b.line, day, section, bases, counter, "para"))
        elif b.kind == "table":
            warn(f"Day {day['n']} {section}: table at line {b.line} not expected; kept as text")
            items.append(build_item(" | ".join(" | ".join(r) for r in b.rows), b.line, day, section, bases,
                                    counter, "para"))
    return items


def build_item(text, line, day, section, bases, counter, kind):
    counter[section] = counter.get(section, 0) + 1
    iid = f"d{day['n']}-{section}-{counter[section]}"
    it = make_item(iid, text, line, None, day["n"], section, kind)
    base = base_for(day, it["start"], text, bases)
    it["base"] = base
    ids, _ = scan_places(text, base, day["n"], section)
    if it.get("titleIsName") and section in ("activities", "movements", "local", "rain"):
        for pid in title_places(it["title"], base, day["n"], section):
            if pid not in ids:
                ids.insert(0, pid)
    it["places"] = ids
    return it


FOOD_A = re.compile(rf"^(?P<label>[^,—:]+?),\s*(?P<time>{TIME})(?:\s*—\s*(?P<target>.+))?$")
FOOD_B = re.compile(r"^(?P<label>[^—:]+?)\s+—\s+(?P<target>.+)$")
FOOD_C = re.compile(r"^(?P<label>.+?):\s*(?P<target>.*)$")
INHERIT = re.compile(r"^(Alternative|Or\b|If you)")
FOOD_WORDS = re.compile(r"\b(Coffee|coffee|Bia hơi|draught beer|street-food|food section|snack)\b")
REASON_HINT = re.compile(r"\b(because|best|why|This is|It's|it's|reason|worth|better|only|The point|the dish)\b")


def classify_food_sentences(sents):
    out = {"hours": [], "price": [], "order": [], "reserve": [], "notes": [], "sub": []}
    for k, s in enumerate(sents):
        p = plain(s)
        if k == 0 and p[:1].islower():
            # Continues the heading: "Nhà hàng Đức Dê | or any of the goat restaurants…", "cooked by you | at the class below."
            out["sub"].append(s)
        elif re.match(r"^(Order|Ask (them|for)|Say yes)", p) or "Order " in p[:12]:
            out["order"].append(s)
        elif re.search(r"\b[Rr]eserv", p):
            out["reserve"].append(s)
        elif PRICE.search(p):
            out["price"].append(s)
        elif re.search(rf"{TIME}\s*[–-]\s*{TIME}|onwards|\bOpens?\b", p):
            out["hours"].append(s)
        else:
            out["notes"].append(s)
    # The "why it's here" line: first sentence that argues for the place; never an italic hedge.
    prose = [s for s in out["notes"] if not re.fullmatch(r"\*[^*].*\*", s)]
    reason = next((s for s in prose if REASON_HINT.search(plain(s))), None)
    if reason is None and prose:
        reason = prose[0]
    out["reason"] = reason
    return out


def strip_leading_places(s):
    """'**Lạc Thiện**, 6 Dinh Tien Hoang, ~08:00–22:30, or **Chị Hạnh**, 11–15 …, 09:00–21:00. ~100,000 VND'
    -> '~100,000 VND'. Only strips a place when it opens the sentence AND is followed by a locator,
    so place names used mid-sentence ('Go to the corner of **X**') keep their sentence intact."""
    while True:
        m = re.match(r"^(?:[Oo]r\s+|[Aa]nd\s+)?\*\*(.+?)\*\*", s)
        if not m or not is_place_name(m.group(1).rstrip(".")):
            return s
        loc = locator(s, m.end())
        if not loc:
            return s
        s = re.sub(r"^[\s.,;:—]+", "", s[loc[0]:])


def food_entry(it, day, meal, label, heading, time, start, text_after_lead, places_from_target):
    """Turn a food bullet into a Food-view entry. All fields are verbatim fragments of `it.text`."""
    ids, _ = scan_places(text_after_lead, it["base"], day["n"], "food")
    frags = []
    for s in sentences(re.sub(r"^[\s.,;:—]+", "", text_after_lead)):
        s = strip_leading_places(s)
        if len(re.sub(r"[^A-Za-zÀ-ỹ0-9]", "", s)) >= 3:
            frags.append(s)
    fields = classify_food_sentences(frags)
    all_ids = places_from_target + [i for i in ids if i not in places_from_target]
    return {
        "id": it["id"], "day": day["n"], "date": day["date"], "base": it["base"], "meal": meal,
        "label": label, "heading": heading, "time": time, "start": start, "places": all_ids,
        "hours": fields["hours"], "price": fields["price"], "order": fields["order"],
        "reserve": fields["reserve"], "reason": fields["reason"], "notes": fields["notes"], "sub": fields["sub"],
        "text": it["text"], "flags": it["flags"], "uncertain": it["uncertain"], "line": it["line"],
    }


def parse_food(blocks, day, bases, counter):
    items, entries = [], []
    prev_meal, prev_start = None, None
    for b in blocks:
        b.use()
        texts = [(li["text"], li["line"]) for li in b.items] if b.kind == "list" else [(b.text, b.line)]
        for text, line in texts:
            counter["food"] = counter.get("food", 0) + 1
            iid = f"d{day['n']}-food-{counter['food']}"
            label = target = time = None
            m = re.match(r"^\*\*(.+?)\*\*", text)
            after = text
            if m:
                inner = m.group(1)
                for rx in (FOOD_A, FOOD_B, FOOD_C):
                    mm = rx.match(inner)
                    if mm:
                        gd = mm.groupdict()
                        label, target, time = gd["label"].strip(), (gd.get("target") or "").strip(), gd.get("time")
                        after = text[m.end():]
                        break
            else:
                mm = re.match(r"^([^*:]+?):\s+(?=\*\*)", text)
                if mm:
                    label, target = mm.group(1), ""
                    after = text[mm.end():]
            start = tmin(time) if time else None
            meal = None
            if label:
                low = label.lower()
                meal = next((k for k in ("breakfast", "lunch", "dinner", "snack") if k in low), None)
                if not meal and INHERIT.match(label):
                    meal, start = prev_meal, prev_start
                elif not meal and re.match(r"^Reservations?", label):
                    meal = None
                elif not meal:
                    meal = "other"
            it = {"id": iid, "kind": "food" if meal else "note", "text": text, "line": line, "label": label,
                  "meal": meal, "time": time, "start": start, "places": [], "flags": [], "risks": [],
                  "uncertain": is_uncertain(text)}
            it["base"] = base_for(day, start, text, bases)
            heading = None
            target_ids = []
            if target:
                t = target.rstrip(".")
                at = re.match(r"^(.+?) at (\d.+)$", t)
                if at and is_place_name(at.group(1)):
                    target_ids.append(register_place(at.group(1), it["base"], day["n"], "food", where=at.group(2)))
                    heading = t
                elif is_place_name(t):
                    loc = locator(text, m.end()) if m else None
                    where, hours, price = (loc[1:] if loc else (None, None, None))
                    target_ids.append(register_place(t, it["base"], day["n"], "food", where, hours, price))
                    heading = t
                    if loc:
                        after = text[loc[0]:]
                else:
                    heading = t
            if meal:
                prev_meal, prev_start = meal, start
                it["title"] = heading or label
                it["more"] = after
                entry = food_entry(it, day, meal, label, heading, time, start, after, target_ids)
                it["places"] = entry["places"]
                entries.append(entry)
            else:
                ld, rest = lead(text)
                it["title"] = ld or first_clause(text)
                it["more"] = rest if ld else text
                ids, _ = scan_places(text, it["base"], day["n"], "food")
                it["places"] = ids
            items.append(it)
    return items, entries


def parse_accommodation(sub, day, bases, counter):
    nights = re.search(r"\((.+?)\)", sub["title"])
    acc = {"heading": sub["title"], "nights": nights.group(1) if nights else None, "sameAs": None,
           "options": [], "notes": []}
    for b in sub["blocks"]:
        b.use()
        if b.kind == "list":
            for li in b.items:
                counter["acc"] = counter.get("acc", 0) + 1
                text = li["text"]
                names = re.match(r"^((?:\*\*[^*]+\*\*)(?:\s+or\s+\*\*[^*]+\*\*)*)", text)
                opt = {"id": f"d{day['n']}-acc-{counter['acc']}", "kind": "option", "text": text, "line": li["line"],
                       "names": [], "places": [], "flags": [], "risks": [], "uncertain": is_uncertain(text),
                       "base": day["_tonight_stay"]}
                if names:
                    opt["names"] = [n.group(1) for n in BOLD.finditer(names.group(1))]
                    opt["title"] = " or ".join(opt["names"])
                    opt["more"] = re.sub(r"^[\s—,]+", "", text[names.end():])
                    name_spans = list(BOLD.finditer(names.group(1)))  # anchored at 0, so offsets match `text`
                    for k, nm in enumerate(name_spans):
                        loc = locator(text, nm.end()) if k == len(name_spans) - 1 else None
                        where = loc[1] if loc else None
                        opt["places"].append(register_place(nm.group(1), opt["base"], day["n"], "accommodation", where))
                else:
                    opt["title"] = first_clause(text)
                    opt["more"] = text
                    opt["places"], _ = scan_places(text, opt["base"], day["n"], "accommodation")
                acc["options"].append(opt)
        elif b.kind == "p":
            m = re.match(r"^Same as Day (\d+)\.?$", b.text)
            if m:
                acc["sameAs"] = int(m.group(1))
                continue
            counter["accn"] = counter.get("accn", 0) + 1
            it = make_item(f"d{day['n']}-accn-{counter['accn']}", b.text, b.line, None, day["n"], "accommodation", "para")
            it["base"] = day["_tonight_stay"]
            it["places"], _ = scan_places(b.text, it["base"], day["n"], "accommodation")
            acc["notes"].append(it)
    return acc


def parse_days(doc, bases, year):
    days = []
    for sec in doc["sections"]:
        m = DAY_RE.match(sec["title"])
        if not m:
            continue
        n, wd, dnum, mon, label = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), m.group(5)
        date = datetime.date(year, MONTHS[mon], dnum)
        if date.strftime("%A") != wd:
            warn(f"Day {n}: heading says {wd} but {date.isoformat()} is a {date.strftime('%A')}")
        tonight = night_base(bases, date.isoformat())
        prev = night_base(bases, (date - datetime.timedelta(days=1)).isoformat())
        t_short = tonight["short"] if tonight else label
        p_short = prev["short"] if prev else t_short
        stay = t_short
        if tonight and tonight["isTrain"]:
            t_short = p_short
        if prev and prev["isTrain"]:
            p_short = t_short
        day = {"n": n, "date": date.isoformat(), "weekday": wd, "dateLabel": f"{wd} {dnum} {mon}",
               "label": label, "heading": sec["title"], "line": sec["line"], "theme": None,
               "night": tonight["index"] if tonight else None, "nightBase": stay,
               "nightOf": None, "_night": t_short, "_prev": p_short, "_tonight_stay": stay}
        if tonight:
            k = tonight["iso"].index(date.isoformat()) + 1
            day["nightOf"] = [k, len(tonight["iso"])]
        for b in sec["blocks"]:
            if b.kind == "p" and re.match(r"^\*Theme:", b.text):
                day["theme"] = re.sub(r"^\*Theme:\s*|\*$", "", b.text).strip()
                b.use()
            else:
                warn(f"Day {n}: unexpected block before subsections at line {b.line}")
        counter = {}
        sections = {"movements": [], "accommodation": None, "activities": [], "food": [], "local": [], "rain": []}
        food_entries = []
        for sub in sec["subs"]:
            key = next((k for p, k in SECTION_KEYS if sub["title"].startswith(p)), None)
            if key == "accommodation":
                sections["accommodation"] = parse_accommodation(sub, day, bases, counter)
            elif key == "food":
                items, entries = parse_food(sub["blocks"], day, bases, counter)
                sections["food"] = items
                food_entries.extend(entries)
            elif key in ("movements", "local", "rain"):
                sections[key] = items_from_blocks(sub["blocks"], day, key, bases, counter)
            elif key == "activities":
                sections["activities"].append({"heading": None, "items": items_from_blocks(
                    sub["blocks"], day, "activities", bases, counter)})
            else:
                # Day-specific subsections (Day 7: the tour, its itinerary, what to bring) live under Activities.
                sections["activities"].append({"heading": sub["title"], "items": items_from_blocks(
                    sub["blocks"], day, "activities", bases, counter)})
        # Activity/local-life items that are about eating or drinking also appear in the Food view.
        for grp in sections["activities"] + [{"items": sections["local"]}]:
            for it in grp["items"]:
                if it["places"] and FOOD_WORDS.search(plain(it["text"])):
                    src = it["more"] if it.get("titleIsName") else re.sub(rf"^\*\*{TIME_RANGE}\*\*\s*", "", it["text"])
                    e = food_entry(it, day, "other", None, it["title"], it["time"], it["start"], src, [])
                    e["places"] = it["places"]
                    e["fromSection"] = it["id"].split("-")[1]
                    food_entries.append(e)
        if sections["accommodation"] is None:
            warn(f"Day {n}: no Accommodation section")
        day["sections"] = sections
        day["foodEntries"] = food_entries
        days.append(day)
    for d in days:
        acc = d["sections"]["accommodation"]
        if acc and acc["sameAs"]:
            ref = next((x for x in days if x["n"] == acc["sameAs"]), None)
            if not ref:
                warn(f"Day {d['n']}: 'Same as Day {acc['sameAs']}' points nowhere")
        for k in ("_night", "_prev", "_tonight_stay"):
            d.pop(k)
    return days


# ---------------------------------------------------------------- back-matter sections

def parse_primer(sec, bases):
    regions, general = [], []
    cur = None
    for b in sec["blocks"]:
        b.use()
        if b.kind == "p":
            ld, rest = lead(b.text)
            base = next((x["short"] for x in bases if not x["isTrain"] and x["short"] in (ld or "")), None)
            if base or (ld and not regions) or (ld and "Ordering" not in ld and cur is None):
                cur = {"title": ld, "intro": rest, "base": base, "line": b.line, "points": []}
                regions.append(cur)
            else:
                general.append({"text": b.text, "lead": ld, "rest": rest, "line": b.line})
                cur = None
        elif b.kind == "list" and cur:
            for li in b.items:
                ld, rest = lead(li["text"])
                cur["points"].append({"lead": ld, "rest": rest, "text": li["text"], "line": li["line"]})
        else:
            general.extend(generic([b]))
    for r in regions:
        if not r["base"]:
            warn(f"Food primer region '{r['title']}' did not match a base; shown under All only")
    return {"regions": regions, "general": general}


def urgency_rank(u):
    p = plain(u).lower()
    if "immediately" in p:
        return 0
    if p.strip() == "now":
        return 1
    nums = [int(x) for x in re.findall(r"\d+", p)]
    if "week" in p and nums:
        return 10 - sum(nums) / len(nums)
    if "anytime" in p:
        return 99
    warn(f"Checklist urgency '{u}' not recognised; sorted last")
    return 98


def parse_checklist(sec):
    before = find_sub(sec, "Book before you fly")
    ground = find_sub(sec, "Arrange on the ground")
    out = {"beforeHeading": before["title"], "groundHeading": ground["title"], "before": [], "ground": []}
    for b in before["blocks"]:
        b.use()
        if b.kind != "table":
            warn(f"Checklist: unexpected block at line {b.line}")
            continue
        for k, r in enumerate(b.rows):
            out["before"].append({"id": "cl-" + slug(r[1]), "urgency": r[0], "rank": urgency_rank(r[0]),
                                  "item": r[1], "why": r[2], "line": b.lines[k], "flags": [], "risks": [],
                                  "order": k, "uncertain": is_uncertain(r[1] + r[2])})
    for b in ground["blocks"]:
        b.use()
        if b.kind != "table":
            warn(f"Checklist: unexpected block at line {b.line}")
            continue
        for k, r in enumerate(b.rows):
            dn = re.search(r"Day (\d+)", r[0])
            out["ground"].append({"id": "cg-" + slug(r[0] + " " + r[1]), "when": r[0],
                                  "day": int(dn.group(1)) if dn else None, "item": r[1], "line": b.lines[k],
                                  "flags": [], "risks": [], "order": k, "uncertain": is_uncertain(r[1])})
    out["before"].sort(key=lambda x: (x["rank"], x["order"]))
    out["ground"].sort(key=lambda x: (x["day"] or 99, x["order"]))
    return out


def parse_budget(sec):
    out = {"intro": [], "lines": [], "activities": [], "activitiesHeading": None, "flag": None}
    for b in sec["blocks"]:
        b.use()
        if b.kind == "p":
            out["intro"].append(b.text)
        elif b.kind == "table":
            out["header"] = b.header
            out["lines"] = [{"line": r[0], "perPerson": r[1], "notes": r[2], "src": b.lines[k], "flags": []}
                            for k, r in enumerate(b.rows)]
    acts = find_sub(sec, "Activities breakdown")
    out["activitiesHeading"] = acts["title"]
    for b in acts["blocks"]:
        b.use()
        if b.kind == "table":
            out["activitiesHeader"] = b.header
            out["activities"] = [{"item": r[0], "vnd": r[1], "usd": r[2], "src": b.lines[k], "flags": []}
                                 for k, r in enumerate(b.rows)]
    fl = find_sub(sec, "The budget flag")
    out["flag"] = {"heading": fl["title"], "nodes": generic(fl["blocks"])}
    return out


def parse_cash(sec):
    nodes = generic(sec["blocks"])
    no_cards, cards_ok = [], None
    for n in nodes:
        if n["kind"] == "p" and n["lead"] == "Cards fail at":
            no_cards = [x.strip().rstrip(".") for x in n["rest"].split(" · ")]
            n["split"] = True
        if n["kind"] == "p" and n["lead"] == "Cards work at":
            cards_ok = n["rest"]
    if not no_cards:
        warn("Cash section: 'Cards fail at:' paragraph not found")
    return {"nodes": nodes, "noCards": no_cards, "cardsOk": cards_ok}


def parse_packing(sec):
    out = {"intro": [], "bring": [], "bringLead": None, "after": []}
    seen_bring = False
    for b in sec["blocks"]:
        b.use()
        if b.kind == "p" and lead(b.text)[0] == "Bring":
            seen_bring = True
            out["bringLead"] = b.text
        elif b.kind == "list" and seen_bring and not out["bring"]:
            out["bring"] = [{"id": "pk-" + slug(li["text"]), "text": li["text"], "lead": lead(li["text"])[0],
                             "rest": lead(li["text"])[1], "line": li["line"]} for li in b.items]
        elif seen_bring:
            out["after"].extend(generic([b]))
        else:
            out["intro"].extend(generic([b]))
    return out


def parse_phrases(sec):
    out = {"intro": [], "groups": [], "after": []}
    cur = None
    for b in sec["blocks"]:
        b.use()
        if b.kind == "p":
            ld, rest = lead(b.text)
            if ld and not rest:
                cur = {"title": ld, "rows": [], "line": b.line}
                out["groups"].append(cur)
            elif out["groups"]:
                out["after"].append({"text": b.text, "lead": ld, "rest": rest, "line": b.line})
            else:
                out["intro"].append({"text": b.text, "lead": ld, "rest": rest, "line": b.line})
        elif b.kind == "table" and cur:
            out["header"] = b.header
            cur["rows"] = [{"vi": r[0], "say": r[1], "means": r[2]} for r in b.rows]
        else:
            warn(f"Phrasebook: unexpected block at line {b.line}")
    return out


def parse_risks(sec):
    subs = []
    for sub in sec["subs"]:
        subs.append({"id": "risk-" + slug(sub["title"]), "heading": sub["title"], "nodes": generic(sub["blocks"]),
                     "line": sub["line"]})
    return subs


def parse_verify(sec):
    out = {"intro": [], "items": []}
    group = None
    for b in sec["blocks"]:
        b.use()
        if b.kind == "p":
            ld, rest = lead(b.text)
            if ld and not rest:
                group = ld
            elif ld:
                out["items"].append({"id": "v-" + slug(ld), "group": None, "subject": ld, "text": b.text,
                                     "rest": rest, "line": b.line, "affects": []})
                group = None
            else:
                out["intro"].append(b.text)
        elif b.kind == "list":
            for li in b.items:
                ld, rest = lead(li["text"])
                ld = ld or first_clause(li["text"])
                out["items"].append({"id": "v-" + slug(ld), "group": group, "subject": ld, "text": li["text"],
                                     "rest": rest, "line": li["line"], "affects": []})
    return out


# ---------------------------------------------------------------- city guide (city-guide.md)

GUIDE_KINDS = [("At a glance", "glance", "info"), ("See", "see", "sight"), ("Eat", "eat", "food"), ("Market", "shop", "bag"), ("Where we sleep", "stay", "bed"),
               ("Getting around", "move", "route"), ("Good to know", "know", "info")]


def norm_name(n):
    n = re.sub(r"\s*\(.*?\)\s*", " ", plain(n)).strip().rstrip(".").strip()
    return n.casefold()


def parse_guide(bases, days):
    """Parse the readable city guide. Its prose is the user's own rewrite of the itinerary; the parser only
    structures it and links bold names to the places already found in the itinerary."""
    path = ROOT / CFG.get("guide_source", "city-guide.md")
    if not path.exists():
        warn(f"Guide source {path.name} not found; the Guide tab will be empty")
        return None, []
    blocks = parse_blocks(path.read_text("utf-8").splitlines())
    doc = sectionize(blocks)
    index = {}
    for p in PLACES.values():
        index.setdefault(norm_name(p["name"]), []).append(p["id"])
    not_places = set(CFG.get("guide_not_places", []))
    shorts = [b["short"] for b in bases]

    def link(name, base, kind, register, day0):
        ids = index.get(norm_name(name), [])
        if ids:
            same = [i for i in ids if PLACES[i]["base"] == base]
            return (same or ids)[0]
        if register and base and name not in not_places and is_place_name(name):
            pid = register_place(name, base, day0, "guide")
            index.setdefault(norm_name(name), []).append(pid)
            return pid
        return None

    intro = []
    for b in doc["pre"]:
        b.use()
        intro.append(b.text)
    chapters = []
    for sec in doc["sections"]:
        title = sec["title"]
        base = next((s for s in shorts if s.lower() in title.lower()), None)
        if base is None and "train" in title.lower():
            base = next((b["short"] for b in bases if b["isTrain"]), None)
        meta, lead_paras = None, []
        for b in sec["blocks"]:
            b.use()
            if b.kind == "p" and meta is None and re.fullmatch(r"\*[^*].*\*", b.text):
                meta = b.text.strip("*")
            elif b.kind == "p":
                lead_paras.append(b.text)
            else:
                lead_paras.extend(x["text"] for x in (b.items if b.kind == "list" else []))
        dm = re.search(r"Days? (\d+)(?:[–-](\d+))?", meta or "")
        day_list = list(range(int(dm.group(1)), int(dm.group(2) or dm.group(1)) + 1)) if dm else []
        ch = {"id": slug(title), "title": title, "base": base, "meta": meta, "days": day_list, "lead": lead_paras,
              "line": sec["line"], "sections": []}
        if base is None:
            warn(f"Guide chapter '{title}' did not match a base from the itinerary")
        for sub in sec["subs"]:
            kind, icon = next(((k, i) for p, k, i in GUIDE_KINDS if sub["title"].startswith(p)), ("other", "info"))
            gs = {"id": f"{ch['id']}-{kind}", "title": sub["title"], "kind": kind, "icon": icon, "intro": [], "items": []}
            for b in sub["blocks"]:
                b.use()
                if b.kind == "p":
                    gs["intro"].append(b.text)
                elif b.kind == "list":
                    for k, li in enumerate(b.items):
                        name, rest = lead(li["text"])
                        rest = re.sub(r"^—\s*", "", rest)
                        ids = []
                        if name:
                            # A heading that names several known places ("Hoan Kiem Lake and Ngoc Son Temple") links each of them.
                            nn = norm_name(name)
                            for key, pids in index.items():
                                if len(key) > 4 and key != nn and re.search(r"\b" + re.escape(key) + r"\b", nn):
                                    same = [i for i in pids if PLACES[i]["base"] == base]
                                    if same and same[0] not in ids:
                                        ids.append(same[0])
                        for m in BOLD.finditer(li["text"]):
                            is_lead = m.start() == 0
                            pid = link(m.group(1), base, kind, is_lead and kind in ("see", "shop"), (day_list or [0])[0])
                            if pid and pid not in ids:
                                ids.append(pid)
                        gs["items"].append({"id": f"g-{ch['id']}-{kind}-{len(gs['items']) + 1}", "name": name, "text": rest,
                                            "full": li["text"], "places": ids, "flags": [], "risks": [], "line": li["line"],
                                            "uncertain": is_uncertain(li["text"])})
                else:
                    warn(f"Guide '{title}' / '{sub['title']}': table at line {b.line} not supported; kept as text")
                    gs["intro"].append(" | ".join(" | ".join(r) for r in b.rows))
            ch["sections"].append(gs)
        chapters.append(ch)
    covered = {d for c in chapters for d in c["days"]}
    for d in days:
        if d["n"] not in covered:
            warn(f"Guide: no chapter lists Day {d['n']} in its '*… · Days …*' line")
    return {"title": doc["title"], "intro": intro, "chapters": chapters, "source": path.name}, blocks


def guide_items(trip):
    g = trip.get("guide") or {"chapters": []}
    for ch in g["chapters"]:
        for s in ch["sections"]:
            for it in s["items"]:
                yield ch, s, it


# ---------------------------------------------------------------- cross-links

def all_day_items(day):
    s = day["sections"]
    for sec in ("movements", "local", "rain", "food"):
        for it in s[sec]:
            yield sec, it
    for grp in s["activities"]:
        for it in grp["items"]:
            yield "activities", it
    if s["accommodation"]:
        for it in s["accommodation"]["options"] + s["accommodation"]["notes"]:
            yield "accommodation", it


def link_verify(trip):
    by_subject = {v["subject"]: v for v in trip["verify"]["items"]}
    trip["viewFlags"] = {}
    configured = set()
    for rule in CFG["verify_links"]:
        v = by_subject.get(rule["subject"])
        if not v:
            warn(f"verify_links: subject '{rule['subject']}' not found in section 12")
            continue
        configured.add(rule["subject"])
        rx = re.compile(rule["match"])
        req = re.compile(rule["require"]) if rule.get("require") else None

        def hit(text):
            t = plain(text)
            return bool(rx.search(t)) and (req is None or bool(req.search(t)))

        for d in trip["days"]:
            for sec, it in all_day_items(d):
                if hit(it["text"]) and v["id"] not in it["flags"]:
                    it["flags"].append(v["id"])
                    v["affects"].append({"day": d["n"], "section": sec, "item": it["id"], "title": it.get("title")})
            for e in d["foodEntries"]:
                if hit(e["text"]) and v["id"] not in e["flags"]:
                    e["flags"].append(v["id"])
        for ch, gs, it in guide_items(trip):
            if hit(it["full"]) and v["id"] not in it["flags"]:
                it["flags"].append(v["id"])
                v["affects"].append({"guide": ch["id"], "item": it["id"], "title": it["name"]})
        for leg in trip["legs"]["legs"]:
            if hit(" ".join([leg["leg"], leg["mode"], leg["times"]])):
                leg["flags"].append(v["id"])
                v["affects"].append({"leg": leg["id"], "title": leg["leg"]})
        for b in trip["route"]["bases"]:
            if hit(b["base"] + " " + b["why"]):
                b.setdefault("flags", []).append(v["id"])
        for c in trip["checklist"]["before"] + trip["checklist"]["ground"]:
            if hit(c["item"] + " " + c.get("why", "")):
                c["flags"].append(v["id"])
                v["affects"].append({"checklist": c["id"], "title": c["item"]})
        for row in trip["budget"]["lines"]:
            if hit(" ".join([row["line"], row["perPerson"], row["notes"]])):
                row["flags"].append(v["id"])
        for row in trip["budget"]["activities"]:
            if hit(" ".join([row["item"], row["vnd"], row["usd"]])):
                row["flags"].append(v["id"])
                v["affects"].append({"view": "money", "title": row["item"]})
        for view in rule.get("views", []):
            trip["viewFlags"].setdefault(view, []).append(v["id"])
            v["affects"].append({"view": view})
        if not v["affects"]:
            warn(f"verify_links: '{rule['subject']}' matched nothing — it will only appear in the Verify list")
    for v in trip["verify"]["items"]:
        if v["subject"] not in configured:
            warn(f"Section 12 item '{v['subject']}' has no verify_links rule; add one to parse-config.json")


def link_risks(trip):
    risks = {r["heading"]: r for r in trip["risks"]}
    for rule in CFG["risk_links"]:
        r = risks.get(rule["risk"])
        if not r:
            warn(f"risk_links: '{rule['risk']}' not found in section 11")
            continue
        rx = re.compile(rule["match"])
        hits = 0
        if rule.get("guide"):
            for ch, gs, it in guide_items(trip):
                if rx.search(plain(it["full"])):
                    it["risks"].append(r["id"])
                    hits += 1
        if rule.get("checklist"):
            for c in trip["checklist"]["before"] + trip["checklist"]["ground"]:
                if rx.search(plain(c["item"] + " " + c.get("why", ""))):
                    c["risks"].append(r["id"])
                    hits += 1
        for d in trip["days"]:
            if d["n"] not in rule.get("days", []):
                continue
            for sec, it in all_day_items(d):
                if sec in rule.get("sections", [sec]) and rx.search(plain(it["text"])):
                    it["risks"].append(r["id"])
                    hits += 1
        if not hits:
            warn(f"risk_links: '{rule['risk']}' matched nothing")


# ---------------------------------------------------------------- outputs

def merge_places():
    path = DATA / f"places{SUFFIX}.json"
    old, bases = {}, {}
    if path.exists():
        try:
            prev_doc = json.loads(path.read_text("utf-8"))
            old = {p["id"]: p for p in prev_doc.get("places", [])}
            bases = prev_doc.get("bases") or {}
        except (ValueError, KeyError) as e:
            warn(f"places.json unreadable ({e}); coordinates not merged")
    out = []
    for p in sorted(PLACES.values(), key=lambda p: (min(p["days"]), p["name"])):
        prev = old.pop(p["id"], {})
        out.append({"id": p["id"], "name": p["name"], "base": p["base"], "days": p["days"],
                    "sections": p["sections"], "where": p["where"], "hours": p["hours"], "price": p["price"],
                    "query": maps_query(p), "addressInQuery": bool(p["where"] and ADDRESS_LIKE.search(p["where"])),
                    "coords": prev.get("coords"), "coordsNote": prev.get("coordsNote")})
    for pid, p in old.items():
        if p.get("coords"):
            warn(f"places.json: '{pid}' has coordinates but no longer exists in the markdown; dropped")
    doc = {
        "_readme": "Generated by scripts/parse-itinerary.py. Only edit `coords` ([lat, lon] or null) and `coordsNote`. "
                   "Everything else is regenerated from the markdown. Re-run the parser after editing so the site picks it up.",
        "bases": bases,
        "places": out,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return out, bases


def merge_photos(days):
    path = DATA / f"photos{SUFFIX}.json"
    old = {}
    if path.exists():
        try:
            old = {p["id"]: p for p in json.loads(path.read_text("utf-8")).get("slots", [])}
        except (ValueError, KeyError) as e:
            warn(f"photos.json unreadable ({e}); existing photos not merged")
    slots = []
    for p in sorted(PLACES.values(), key=lambda p: (min(p["days"]), p["name"])):
        if not {"activities", "local"} & set(p["sections"]):
            continue
        prev = old.pop(p["id"], {})
        slots.append({"id": p["id"], "caption": p["name"], "day": min(p["days"]), "base": p["base"],
                      "file": prev.get("file"), "alt": prev.get("alt"), "credit": prev.get("credit"),
                      "hero": prev.get("hero", False)})
    for pid, p in old.items():
        if p.get("file"):
            warn(f"photos.json: slot '{pid}' has a file but the place no longer exists; dropped")
    for c in CFG["commons"]:
        if not any(s["caption"] == c["place"] for s in slots):
            warn(f"commons: place '{c['place']}' has no photo slot (check the name in parse-config.json)")
    doc = {
        "_readme": "Generated by scripts/parse-itinerary.py. Put your own images in img/photos/ and set `file` "
                   "(e.g. \"img/photos/trang-an.jpg\"), optional `alt` and `credit`. Commons images are filled in by "
                   "scripts/fetch-commons.py. Re-run the parser afterwards.",
        "slots": slots,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return slots


def unused_blocks(blocks):
    return [b for b in blocks if not b.used and b.kind != "hr"]


def write_asset_manifest():
    # Every version's page and data, so all of them work offline whichever one was generated last.
    files = [f.name for f in sorted(ROOT.glob("*.html"))] + [
        "manifest.webmanifest", "css/app.css", "css/guide.css", "js/app.js",
        "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css"] + [
        f"data/{f.name}" for f in sorted(DATA.glob("trip*.js"))]
    for d in ("fonts",):
        for f in sorted((ROOT / d).glob("*.woff2")):
            files.append(f"{d}/{f.name}")
    for d in ("img/icons", "img/commons", "img/photos"):
        for f in sorted((ROOT / d).glob("*")):
            if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"):
                files.append(f"{d}/{f.name}")
    h = hashlib.sha256()
    for f in files:
        p = ROOT / f
        if p.exists():
            h.update(f.encode())
            h.update(p.read_bytes())
        else:
            warn(f"asset-manifest: {f} does not exist yet")
    version = h.hexdigest()[:12]
    (ROOT / "asset-manifest.js").write_text(
        "// Generated by scripts/parse-itinerary.py — the service worker precaches these files.\n"
        f"self.ASSET_VERSION = {json.dumps(version)};\n"
        f"self.ASSETS = {json.dumps(['./'] + files, indent=1)};\n", "utf-8")
    return version, files


def report(trip, unused, places, slots):
    L = ["# Extraction report", "",
         f"Generated {datetime.datetime.now().isoformat(timespec='seconds')} from `{CFG['source']}`.", ""]
    L += ["## Warnings", ""] + ([f"- {w}" for w in WARNINGS] or ["- none"]) + [""]
    L += ["## Unrepresented text", "",
          "Markdown blocks that no extractor claimed. These are NOT shown on the site.", ""]
    L += ([f"- line {b.line} ({b.kind}): {getattr(b, 'text', '')[:120]}" for b in unused] or ["- none"]) + [""]
    L += ["## Days", ""]
    for d in trip["days"]:
        s = d["sections"]
        acts = sum(len(g["items"]) for g in s["activities"])
        L.append(f"- Day {d['n']} {d['date']} {d['label']} — base {d['nightBase']}; "
                 f"movements {len(s['movements'])}, activities {acts}, food {len(s['food'])}, "
                 f"local {len(s['local'])}, rain {len(s['rain'])}")
    L += ["", "## Places", "", "| id | name | base | days | where | hours | price | maps query |",
          "|---|---|---|---|---|---|---|---|"]
    for p in places:
        L.append("| {id} | {name} | {base} | {days} | {where} | {hours} | {price} | {query} |".format(
            **{k: (str(v).replace("|", "/") if v is not None else "") for k, v in p.items()}))
    L += ["", "## Food entries", ""]
    for d in trip["days"]:
        for e in d["foodEntries"]:
            names = ", ".join(PLACES[i]["name"] for i in e["places"]) or "(no named place)"
            L.append(f"- D{e['day']} {e['meal']} {e['time'] or ''} [{e['base']}] **{e['heading'] or e['label']}** — {names}")
            for k in ("hours", "price", "order", "reserve"):
                for x in e[k]:
                    L.append(f"    - {k}: {x}")
            if e["reason"]:
                L.append(f"    - reason: {e['reason']}")
    L += ["", "## Section 12 flags", ""]
    for v in trip["verify"]["items"]:
        tg = "; ".join(
            f"Day {a['day']} {a['section']}" if "day" in a else a.get("checklist") or a.get("leg") or (f"guide:{a['guide']}" if "guide" in a else f"view:{a.get('view')}")
            for a in v["affects"])
        L.append(f"- **{v['subject']}** → {tg or 'NOTHING'}")
    g = trip.get("guide")
    if g:
        L += ["", f"## City guide ({g['source']})", ""]
        for ch in g["chapters"]:
            L.append(f"- **{ch['title']}** — base {ch['base']}, days {ch['days']}")
            for s in ch["sections"]:
                for it in s["items"]:
                    names = ", ".join(PLACES[i]["name"] for i in it["places"]) or "no map link"
                    extra = (" · flags " + ", ".join(it["flags"])) if it["flags"] else ""
                    extra += " · licence" if it["risks"] else ""
                    L.append(f"    - {s['kind']}: {plain(it['name'] or '')} → {names}{extra}")
    L += ["", "## Photo slots", ""] + [f"- D{s['day']} {s['caption']} — {s['file'] or 'placeholder'}" for s in slots]
    (DATA / f"extraction-report{SUFFIX}.md").write_text("\n".join(L) + "\n", "utf-8")


def main():
    if not SRC.exists():
        sys.exit(f"Source not found: {SRC}")
    lines = SRC.read_text("utf-8").splitlines()
    blocks = parse_blocks(lines)
    doc = sectionize(blocks)

    intro, year = parse_intro(doc)
    route = parse_route(find_section(doc, "1."), year)
    legs = parse_legs(find_section(doc, "2."), year)
    days = parse_days(doc, route["bases"], year)
    primer_sec = find_section(doc, "4.")
    trip = {
        "title": doc["title"], "year": year, "intro": intro, "route": route, "legs": legs, "days": days,
        "primer": {"heading": primer_sec["title"], **parse_primer(primer_sec, route["bases"])},
        "checklist": {"heading": find_section(doc, "5.")["title"], **parse_checklist(find_section(doc, "5."))},
        "budget": {"heading": find_section(doc, "6.")["title"], **parse_budget(find_section(doc, "6."))},
        "cash": {"heading": find_section(doc, "7.")["title"], **parse_cash(find_section(doc, "7."))},
        "packing": {"heading": find_section(doc, "8.")["title"], **parse_packing(find_section(doc, "8."))},
        "logistics": {"heading": find_section(doc, "9.")["title"], "nodes": generic(find_section(doc, "9.")["blocks"])},
        "phrases": {"heading": find_section(doc, "10.")["title"], **parse_phrases(find_section(doc, "10."))},
        "risksHeading": find_section(doc, "11.")["title"],
        "risks": parse_risks(find_section(doc, "11.")),
        "verify": {"heading": find_section(doc, "12.")["title"], **parse_verify(find_section(doc, "12."))},
        "config": {"timezone": CFG["timezone"], "variant": VARIANT, "page": CFG.get("page"),
                   "versions": CFG.get("versions", [])},
    }
    trip["guide"], guide_blocks = parse_guide(route["bases"], days)
    # The "3. Day by day" heading has no body of its own.
    find_section(doc, "3.")
    link_verify(trip)
    link_risks(trip)

    for c in CFG["commons"] + CFG["extra_places"]:
        nm = c.get("caption") or c.get("name")
        if nm not in SRC.read_text("utf-8"):
            warn(f"parse-config.json: '{nm}' does not appear in the markdown")
    for n in CFG["place_exclude"] + CFG["place_include"]:
        if f"**{n}" not in SRC.read_text("utf-8") and n not in SRC.read_text("utf-8"):
            warn(f"parse-config.json: excluded/included name '{n}' no longer appears in the markdown")

    places, base_coords = merge_places()
    trip["baseCoords"] = base_coords
    slots = merge_photos(days)
    trip["places"] = {p["id"]: p for p in places}
    trip["photos"] = {s["id"]: s for s in slots}
    unused = unused_blocks(blocks) + unused_blocks(guide_blocks)

    DATA.mkdir(exist_ok=True)
    trip["generated"] = datetime.datetime.now().isoformat(timespec="seconds")
    body = json.dumps(trip, ensure_ascii=False, indent=1)
    (DATA / f"trip{SUFFIX}.json").write_text(body + "\n", "utf-8")
    (DATA / f"trip{SUFFIX}.js").write_text(
        "// Generated by scripts/parse-itinerary.py from the markdown. Do not edit by hand.\n"
        "window.TRIP = " + json.dumps(trip, ensure_ascii=False, separators=(",", ":")) + ";\n", "utf-8")
    version, files = write_asset_manifest()
    report(trip, unused, places, slots)

    print(f"{len(days)} days, {len(places)} places, {len(slots)} photo slots, "
          f"{sum(len(d['foodEntries']) for d in days)} food entries, "
          f"{len(trip['verify']['items'])} verify items, asset version {version}")
    if unused:
        print(f"!! {len(unused)} markdown blocks not represented — see data/extraction-report.md")
    for w in WARNINGS:
        print("warning:", w)


if __name__ == "__main__":
    main()
