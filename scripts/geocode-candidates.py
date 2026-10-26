#!/usr/bin/env python3
"""
Optional helper for populating place coordinates. Nothing it finds reaches the site until you approve it.

    python scripts/geocode-candidates.py lookup     # query OpenStreetMap Nominatim, write data/places.candidates.json
    (open data/places.candidates.json, check each candidate on a map, set "approved": true on the good ones)
    python scripts/geocode-candidates.py apply      # copy approved coordinates into data/places.json
    python scripts/parse-itinerary.py               # rebuild the site data

Nominatim's usage policy allows ~1 request per second with an identifying User-Agent; this script
waits 1.1 s between requests and only looks up places that have no coordinates yet.

Expect misses and wrong hits: Vietnam's July 2025 province reorganisation means OSM labels and the
itinerary's addresses disagree in places (Phong Nha is now Quang Tri; Hoi An is now Da Nang City), and
many small restaurants are not in OSM at all. A wrong pin is worse than no pin - leave unsure ones out.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "data" / "places.json"
CANDS = ROOT / "data" / "places.candidates.json"
UA = "VietnamTripStaticSite/1.0 (personal itinerary geocoding review; python-urllib)"


def lookup():
    places = json.loads(PLACES.read_text("utf-8"))["places"]
    old = {}
    if CANDS.exists():
        old = {c["id"]: c for c in json.loads(CANDS.read_text("utf-8"))}
    out = []
    for p in places:
        if p.get("coords"):
            continue
        if p["id"] in old and old[p["id"]].get("query") == p["query"]:
            out.append(old[p["id"]])
            continue
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": p["query"] + ", Vietnam", "format": "jsonv2", "limit": 3, "countrycodes": "vn"})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                hits = json.load(r)
        except Exception as e:  # network trouble: record and move on
            hits = []
            print("!!", p["name"], e)
        out.append({"id": p["id"], "name": p["name"], "query": p["query"], "approved": False, "pick": 0,
                    "candidates": [{"lat": float(h["lat"]), "lon": float(h["lon"]), "label": h.get("display_name"),
                                    "type": h.get("type"),
                                    "check": f"https://www.openstreetmap.org/?mlat={h['lat']}&mlon={h['lon']}#map=17/{h['lat']}/{h['lon']}"}
                                   for h in hits]})
        print(f"{len(hits)} hit(s)  {p['name']}")
        time.sleep(1.1)
    CANDS.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"\nWrote {CANDS}. Review each entry; set \"approved\": true (and \"pick\" to the right candidate index).")


def apply():
    doc = json.loads(PLACES.read_text("utf-8"))
    cands = {c["id"]: c for c in json.loads(CANDS.read_text("utf-8"))}
    n = 0
    for p in doc["places"]:
        c = cands.get(p["id"])
        if c and c.get("approved") and c["candidates"]:
            h = c["candidates"][c.get("pick", 0)]
            p["coords"] = [round(h["lat"], 6), round(h["lon"], 6)]
            p["coordsNote"] = "Nominatim, reviewed: " + (h.get("label") or "")
            n += 1
    PLACES.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"Applied {n} approved coordinates. Now run: python scripts/parse-itinerary.py")


import math

# Where each base is, for sanity-checking results; looked up once, then stored in places.json under "bases".
BASE_QUERIES = {"Hanoi": "Hoan Kiem Lake, Hanoi", "Ninh Binh": "Tam Coc, Ninh Binh",
                "Phong Nha": "Phong Nha, Bo Trach", "Hue": "Hue, Vietnam", "Hoi An": "Hoi An, Vietnam"}
RADIUS_KM = {"Hanoi": 15, "Ninh Binh": 40, "Phong Nha": 60, "Hue": 70, "Hoi An": 60}
CORRIDOR = (15.7, 18.0, 105.9, 108.6)  # lat min/max, lon min/max for "En route" stops between Phong Nha and Hoi An


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 3, "countrycodes": "vn"})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        hits = json.load(r)
    time.sleep(1.1)
    return hits


# Extra search terms (usually the Vietnamese name OpenStreetMap uses). Search hints only, never coordinates.
ALIASES = {
    "Hue Imperial City (Đại Nội)": ["Đại Nội, Huế", "Hoàng thành Huế"],
    "Thien Mu Pagoda": ["Chùa Thiên Mụ, Huế"],
    "My Son Sanctuary": ["Thánh địa Mỹ Sơn", "Mỹ Sơn"],
    "Bích Động Pagoda": ["Chùa Bích Động", "Bích Động"],
    "Tan Hoa": ["Tân Hóa, Minh Hóa", "Tân Hóa, Quảng Trị"],
    "Hai Van Pass": ["Hải Vân Quan", "Đèo Hải Vân"],
    "Marble Mountains": ["Ngũ Hành Sơn, Đà Nẵng"],
    "Trang An, Route 2": ["Bến thuyền Tràng An", "Khu du lịch sinh thái Tràng An"],
    "Phong Nha Cave by boat": ["Động Phong Nha"],
    "Bích Động Pagoda": ["Chùa Bích Động"],
    "Japanese Covered Bridge": ["Chùa Cầu, Hội An"],
    "Thang Long Imperial Citadel": ["Hoàng thành Thăng Long"],
    "The Presidential Palace grounds and the stilt house": ["Nhà sàn Bác Hồ", "Phủ Chủ tịch"],
    "Lang Co / Lap An Lagoon": ["Đầm Lập An"],
    "Lang Co station": ["Ga Lăng Cô"],
    "Dong Hoi station": ["Ga Đồng Hới"],
    "Khe Sanh Combat Base": ["Sân bay Tà Cơn"],
    "Hoan Kiem weekend walking street": ["Hồ Hoàn Kiếm"],
    "Silk Path Grand Hue": ["Silk Path Grand Hue Hotel"],
    "La Siesta Premium Hang Be": ["La Siesta Premium Hàng Bè"],
    "Hanoi La Siesta Classic Ma May": ["La Siesta Classic Mã Mây"],
    "Hanoi Emerald Waters Hotel & Spa": ["Emerald Waters Hotel"],
    "Bún Bò Huế Bà Tuyết": ["Bún bò Bà Tuyết, Huế"],
    "Cơm Hến Bà Đen": ["Cơm hến Bà Đen, Huế"],
    "Mì Quảng Bà Mua": ["Mì Quảng Bà Mua, Đà Nẵng"],
    "The Phong Nha Caves Exploration Museum": ["Phong Nha Cave Exploration Museum"],
    "Bong Lai valley": ["Bồng Lai, Phong Nha"],
}


def reject(ids):
    """Clear wrong pins and remember the rejection so `auto` never re-adds them."""
    doc = json.loads(PLACES.read_text("utf-8"))
    for p in doc["places"]:
        if p["id"] in ids:
            p["coords"] = None
            p["coordsNote"] = "rejected: auto match did not agree with the itinerary"
            print("rejected", p["name"])
    PLACES.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")


def auto():
    """Look up every place without coordinates and keep a result ONLY if it lies within the expected radius of its
    base (or inside the route corridor for stops between cities). Accepted pins are marked "auto" in coordsNote so
    the site can say they are approximate; anything that fails the check stays null and gets no pin."""
    doc = json.loads(PLACES.read_text("utf-8"))
    bases = doc.get("bases") or {}
    for b, q in BASE_QUERIES.items():
        if b not in bases:
            hits = nominatim(q)
            if hits:
                bases[b] = [round(float(hits[0]["lat"]), 5), round(float(hits[0]["lon"]), 5)]
                print(f"base {b}: {bases[b]}  ({hits[0].get('display_name', '')[:60]})")
    doc["bases"] = bases
    ok = miss = 0
    for p in doc["places"]:
        if p.get("coords") or (p.get("coordsNote") or "").startswith("rejected"):
            continue
        name_only = re.sub(r"\s*\(.*?\)", "", p["name"]).replace("**", "").strip()
        tries = ALIASES.get(p["name"], []) + [p["query"]]
        if p["base"] in bases:
            tries.append(f"{name_only}, {p['base']}")
        found = None
        for q in tries:
            try:
                hits = nominatim(q + ", Vietnam")
            except Exception as e:
                print("!!", p["name"], e)
                hits = []
            for h in hits:
                ll = (float(h["lat"]), float(h["lon"]))
                if p["base"] in bases:
                    good = km(ll, bases[p["base"]]) <= RADIUS_KM.get(p["base"], 30)
                else:
                    good = CORRIDOR[0] <= ll[0] <= CORRIDOR[1] and CORRIDOR[2] <= ll[1] <= CORRIDOR[3]
                if good:
                    found = (ll, h.get("display_name", ""))
                    break
            if found:
                break
        if found:
            p["coords"] = [round(found[0][0], 6), round(found[0][1], 6)]
            p["coordsNote"] = "auto: OpenStreetMap match '" + found[1][:120] + "' (not hand-checked)"
            ok += 1
            print(f"pin  {p['name']}")
        else:
            miss += 1
            print(f"---  {p['name']} (no match inside the expected area)")
    PLACES.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"\n{ok} pinned, {miss} left without a pin. Now run: python scripts/parse-itinerary.py")


import re  # noqa: E402  (used by auto)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "reject":
        reject(set(sys.argv[2:]))
    else:
        {"lookup": lookup, "apply": apply, "auto": auto}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()
