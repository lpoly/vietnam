#!/usr/bin/env python3
"""
Wikimedia Commons photos for the six well-known sights only (see "commons" in parse-config.json).

    python scripts/fetch-commons.py search "Long Bien Bridge"   # list candidate files + licences to review
    python scripts/fetch-commons.py fetch                        # download the files named in parse-config.json
    python scripts/fetch-commons.py fetch southbound             # the same for the southbound version (parse-config.southbound.json)

`fetch` downloads a 1280px rendition of each chosen file into img/commons/, records the author,
licence and source page in data/photos.json, then re-runs the parser so the site picks it up.
Only freely licensed files (CC0, public domain, CC BY, CC BY-SA) are accepted. Never point this at
restaurants, homestays or anything small - Commons will not have accurate pictures of them.
"""
import html
import json
import re
import subprocess
import time
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG_PATH = ROOT / "scripts" / "parse-config.json"
PHOTOS = ROOT / "data" / "photos.json"
OUT = ROOT / "img" / "commons"
API = "https://commons.wikimedia.org/w/api.php"
UA = "VietnamTripStaticSite/1.0 (personal offline itinerary; python-urllib)"
OK_LICENCE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? \d)", re.I)


def get(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def info(titles):
    d = get({"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
             "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1024})
    out = {}
    for p in d["query"]["pages"]:
        if "imageinfo" not in p:
            continue
        ii = p["imageinfo"][0]
        em = ii.get("extmetadata", {})
        out[p["title"]] = {
            "title": p["title"], "mime": ii.get("mime"), "width": ii.get("width"), "height": ii.get("height"),
            "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"),
            "author": strip_html(em.get("Artist", {}).get("value")),
            "licence": strip_html(em.get("LicenseShortName", {}).get("value")),
            "licenceUrl": strip_html(em.get("LicenseUrl", {}).get("value")) or None,
            "description": strip_html(em.get("ImageDescription", {}).get("value"))[:160],
        }
    return out


def search(q):
    d = get({"action": "query", "list": "search", "srsearch": q + " filetype:bitmap", "srnamespace": 6, "srlimit": 12})
    titles = [r["title"] for r in d["query"]["search"]]
    for t, i in info(titles).items():
        ok = "OK " if OK_LICENCE.match(i["licence"] or "") else "NO "
        print(f"{ok}{t}\n    {i['width']}x{i['height']} {i['licence']} by {i['author'][:60]}\n    {i['description']}\n    {i['thumb']}\n")


def fetch(variant=None):
    cfg = json.loads(CFG_PATH.read_text("utf-8"))
    photos_path = PHOTOS
    if variant:
        vcfg = json.loads((ROOT / "scripts" / f"parse-config.{variant}.json").read_text("utf-8"))
        gone = set(vcfg.get("remove", {}).get("commons", []))
        cfg["commons"] = [c for c in cfg["commons"] if c["place"] not in gone] + vcfg.get("commons", [])
        photos_path = ROOT / "data" / f"photos-{variant}.json"
    photos = json.loads(photos_path.read_text("utf-8"))
    slots = {s["caption"]: s for s in photos["slots"]}
    chosen = [c for c in cfg["commons"] if c.get("file")]
    if not chosen:
        sys.exit("No files chosen yet: set 'file' for entries under 'commons' in parse-config.json")
    meta = info([c["file"] for c in chosen])
    OUT.mkdir(parents=True, exist_ok=True)
    for c in chosen:
        i = meta.get(c["file"])
        slot = slots.get(c["place"])
        if not i:
            print(f"!! {c['file']} not found on Commons")
            continue
        if not slot:
            print(f"!! no photo slot for place '{c['place']}' - run the parser first and check the name")
            continue
        if not OK_LICENCE.match(i["licence"] or ""):
            print(f"!! {c['file']} has licence '{i['licence']}' - not accepted")
            continue
        ext = ".png" if i["mime"] == "image/png" else ".jpg"
        name = re.sub(r"[^a-z0-9]+", "-", c["caption"].lower()).strip("-") + ext
        time.sleep(2)
        req = urllib.request.Request(i["thumb"], headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            (OUT / name).write_bytes(r.read())
        slot["file"] = f"img/commons/{name}"
        slot["alt"] = c["caption"]
        slot["hero"] = bool(c.get("hero"))
        slot["credit"] = {"author": i["author"] or "Unknown", "licence": i["licence"], "licenceUrl": i["licenceUrl"],
                          "sourceUrl": i["page"], "title": i["title"], "via": "Wikimedia Commons"}
        print(f"ok  {c['caption']}: {i['title']} ({i['licence']}, {i['author'][:50]})")
    photos_path.write_text(json.dumps(photos, ensure_ascii=False, indent=1) + "\n", "utf-8")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "parse-itinerary.py")] + ([variant] if variant else []), check=False)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "search":
        search(" ".join(sys.argv[2:]))
    elif len(sys.argv) in (2, 3) and sys.argv[1] == "fetch":
        fetch(sys.argv[2] if len(sys.argv) == 3 else None)
    else:
        print(__doc__)
