# Vietnam 12–21 December — trip site

A static, offline-first phone site generated from `vietnam-itinerary-12-21-dec.md`.
No backend, no login, no analytics, no external scripts or fonts. Plain HTML/CSS/JS with no build step; one Python script turns the markdown into data.

```
city-guide.md                    ← the readable guide your friends see first (city by city). Edit this for the Guide tab.
vietnam-itinerary-12-21-dec.md   ← the full itinerary: the source of facts, and of the Plan, Food and Essentials tabs.
scripts/parse-itinerary.py       ← markdown → data/trip.json + data/trip.js (+ places, photos, report, offline manifest)
scripts/parse-config.json        ← structural hints (which bold text is not a place, which §12 item flags what)
index.html, css/, js/app.js      ← the site; renders only what is in data/trip.js
sw.js + asset-manifest.js        ← offline cache
data/places.json                 ← every place; add coordinates here
data/photos.json                 ← photo slots; add your own photos here
data/extraction-report.md        ← what the parser found, and anything it could not place
research-notes-2026-10.md        ← sources for every price and time changed in the October 2026 re-plan
archive/                         ← the first version of the itinerary and guide, for reference
```

**Version 2 (October 2026).** The route was re-planned around nature and landmarks, with food alongside: Cuc Phuong dropped, Hue at two nights with the royal tombs, and the last night in Hoi An instead of Da Nang. Prices, hours and hotels were re-researched. Every changed figure is traceable in `research-notes-2026-10.md`, and the old files are in `archive/`.

## Two sources: the guide and the itinerary

The site opens on the **Guide**: one page per place (Hanoi, Ninh Binh, the night train, Phong Nha, Hue, Hai Van Pass and Da Nang), each with *See and do*, *Eat and drink*, *Markets and shops*, *Where we sleep*, *Getting around*, *Good to know* and a *Map* list. The day-by-day schedule, Today screen, rain mode and booking checklist live under **Plan**.

`city-guide.md` is a rewrite of the itinerary in plain prose, organised by place rather than by day. It adds nothing that isn't in the itinerary: prices, times, addresses and uncertainty notes are copied exactly. If you change a fact in the itinerary, change it in the guide too. The two files are separate on purpose, so the guide can read like a guide.

Format the parser expects in `city-guide.md`:

```
## Hanoi                                   ← one chapter per place; the name must contain the base name from §1 of the itinerary
*12–13 December · 2 nights · Days 1–2*     ← first line, in italics; "Days" links the chapter to the plan
Lead paragraphs…
### See and do                             ← section names start with: See / Eat / Market / Where we sleep / Getting around / Good to know
- **Place name** — what to say about it.   ← bold names that match a place in the itinerary get a maps button
```

The §12 "Verify before you go" flags and the motorbike-licence warning attach to guide paragraphs automatically, using the same rules as the itinerary. The extraction report lists every guide entry with its map links and flags, so you can check them after editing.

## Design

- **Visual direction:** transit map. Each base has its own line colour; days are stations; legs are the dashed connectors.
- **Contrast:** body text targets 7:1 so it stays readable in sunlight. Type is always marked with an icon as well as a colour (van, train, bike, food, sight, rain), so nothing relies on colour alone.
- **Motion:** none, apart from 120 ms colour changes on press, and those turn off with the system's reduced-motion setting.
- **Typeface:** Plus Jakarta Sans (SIL Open Font License, `fonts/OFL.txt`). It is served from `fonts/`, including the Vietnamese subset, so it works offline.
- **Icons:** one stroke-icon set drawn inline in `js/app.js`. No icon fonts, no emoji.
- **Sources:**
  - The design system and pre-delivery checklist came from the ui-ux-pro-max skill, using its "Inclusive Design" and "Swiss" styles. Its first suggestion (gradients and scroll animation) was rejected as unsuitable for this brief.
  - Layout patterns were adapted from 21st.dev components, rewritten by hand in plain CSS (no React, no code copied): the trip-details card (route heading, status pill, action toolbar), the travel route card (photo cover, oversized number) and the activity timeline (icon nodes on a rail).

## Run it

```
python scripts/serve.py          # http://localhost:8000  (offline mode works on localhost)
```

Or just open `index.html` in a browser. Everything renders from `file://`, but offline caching needs a real web address (localhost or the deployed site).

Node is not needed. There is no `npm start`, because there is nothing to build.

## Regenerate after editing the itinerary

```
python scripts/parse-itinerary.py
```

Python 3.9+ with the standard library only. Then open `data/extraction-report.md` and check two sections:

- **Warnings.** For example, a §12 item with no linking rule, or a config name that no longer appears in the markdown.
- **Unrepresented text.** Any markdown block the parser could not place. Anything listed here is *not* on the site. It currently reads "none".

The parser expects the current shape of the document: `## Day N — Weekday D Month · Base`, the `### Movements / Accommodation / Activities / Food / Local-life element / Rain plan` subsections, the tables in §1, §2, §5 and §6, and `**Bold lead.**` paragraphs elsewhere. Text inside those structures can change freely. If you add a new `###` subsection to a day, it appears under Activities with its own heading.

Things the parser decides heuristically, all visible in the report:

- **Places.** Bold, capitalised names followed by an address, hours or price, plus bold activity titles. If it wrongly treats a bold phrase as a place, add it to `place_exclude` in `scripts/parse-config.json`. If it misses one, add it to `place_include`.
- **§12 flags.** Each "Verify before you go" item is attached to the items it affects by a regex in `verify_links`. A new §12 item gets a warning until you add a rule. Until then it still appears in More → Verify before you go.
- **Food fields.** Address, hours, price, "what to order" and the "why" line are split out of each food bullet. Every field is a verbatim fragment, and the full bullet is always one tap away under "As written in the itinerary".

## Deploy (Vercel)

The repo root *is* the site. No build command, no framework.

- **Without installing anything:** push this folder to a GitHub repo. In Vercel, choose New Project → import the repo → Framework preset **Other**, leave Build Command empty, Output Directory `.`. Each push redeploys.
- **With Node installed:** `npx vercel deploy --prod` from this folder.

`vercel.json` adds `X-Robots-Tag: noindex`, a strict Content-Security-Policy (scripts from this site only; images from this site and OpenStreetMap tiles) and no-cache headers for the service worker. `.vercelignore` keeps the markdown, scripts and report off the public site. The URL is unlisted but not secret: anyone with the link can read it.

**Before you lose signal:** open the deployed site on each phone, wait for More → Offline to say **✓ Ready offline**, and reload once. After every redeploy, open it once more while online. The first load fetches the new version in the background and a "Reload" prompt appears. "Add to Home Screen" makes it open like an app.

## Photos

The site shows 19 photos of the well-known sights only, all from Wikimedia Commons and all freely licensed (CC0, CC BY or CC BY-SA). Each one was checked by eye to confirm it shows the named place. They are stored in `img/commons/`, and every photo shows its author and licence next to it. One photo per city is marked as that city's header image (`"hero": true`). The full list, with exact Commons file names, is under `commons` in `scripts/parse-config.json`.

- **Swap a photo:** run `python scripts/fetch-commons.py search "query"`, put the chosen `File:` title in `parse-config.json`, then run `python scripts/fetch-commons.py fetch`. Only freely licensed files are accepted.
- **Add your own photo:** put it in `img/photos/`, set `"file"` (and optionally `"credit"`) on its slot in `data/photos.json`, then re-run the parser.

## Maps

The Guide home page has a route map: the trip as a transit line over an Esri World Street Map background (built on OpenStreetMap and other data), one station per base, with the train leg dotted. Each city page has its own map, with numbered pins that match its numbered sights, plus small food, bed and shop pins.

**Pins were placed automatically, not hand-checked.** `python scripts/geocode-candidates.py auto` searches OpenStreetMap, sometimes using the place's Vietnamese name, and keeps a result only if it falls within a set distance of its city (15 km for Hanoi, 40 km for Ninh Binh, 60 km for Phong Nha, 70 km for Hue, 60 km for Hoi An), or within the route corridor for stops between cities.

- Results that matched the wrong branch or the wrong place were rejected, so they don't come back.
- 69 of 97 places have pins. The rest (small restaurants, homestays, ambiguous branches) have no pin, only the "Open in maps" search link.
- Each pin records which OpenStreetMap entry it came from, in the `coordsNote` field in `data/places.json`.

To change a pin:

- **Fix a wrong pin:** set its `coords` in `data/places.json` (copy them from Google Maps or openstreetmap.org), or run `python scripts/geocode-candidates.py reject <place-id>`. Then re-run the parser.
- **Pin new places after editing the markdown:** run `python scripts/geocode-candidates.py auto`, then the parser.

Map tiles come from Esri's World Street Map (server.arcgisonline.com). OpenStreetMap's own tile server blocks sites like this one ("Access blocked"). If Esri's tiles fail, the map switches automatically to the Humanitarian OpenStreetMap style (tile.openstreetmap.fr). Tiles need a connection and aren't cached. Offline, the pins, the route line and every link still work.

## What the site does with uncertainty

- **§12 flags.** Every item in §12 "Verify before you go" appears as a yellow **⚠ Verify** chip on each item it affects (day items, route legs, checklist rows, budget rows, whole views). Expanding the item shows the §12 text verbatim. All 16 items are linked.
- **Inline hedges.** Hedges inside the text ("*sources disagree*", "*I can't confirm…*", "(some sources say…)") are highlighted where they appear, and the item gets an **Uncertain** chip so it's visible while collapsed.
- **Motorbike licensing.** The §11 licensing subsection is a full red card at the top of Risk notes. It is linked from every riding item on Days 8–9 and from the IDP, motorbike and insurance checklist rows.

## Known gaps and judgement calls (version 2)

1. **Flights aren't booked.** The plan assumes a Da Nang → Hanoi departure no earlier than about 09:00 on 21 December, so the Hoi An night works. If the only option is earlier, use Variant A (Da Nang) in §1.
2. **The night train timetable for December wasn't published.** The plan uses the most recent Baolau times (21:57 → 05:16). Other sources range from 21:51 to 22:21 for departure and 04:40 to 06:00 for arrival. Everything on Day 5 morning depends on this.
3. **Tam Coc has no day-use rates.** Keeping two rooms until the train is either a second night or late check-out agreed in writing.
4. **Hotel prices are October 2026 booking-site snapshots**, not December quotes. Tam Coc Garden is now a boutique resort (about US$248), so it's listed third rather than as the default.
5. **Day 6's default tour is now Hang Tien** (dry, rated for a mixed group in December). Tu Lan stays as the alternative. Oxalis's own pages disagree on the Tu Lan season.
6. **The Hue tomb day is full.** One source warns against doing the Imperial City and all three tombs in a single rushed day. The combo ticket is valid for two days, and the rain plan drops two of the tombs.
7. **Hoi An dinner has no named restaurant.** None was researched, and the plan says so rather than inventing one.
8. **Landmark descriptions:** a few short descriptions (for example the character of each Hue tomb, or Thien Mu's seven-storey tower) come from general knowledge, not this month's research. They carry no prices or times. See the end of `research-notes-2026-10.md`.
9. **Every place in a city chapter goes on its city map.** For Hue that includes Vinh Moc, a stop on the drive from Phong Nha. The map frames the city and leaves pins like that at the edge.
10. **Long Bien Bridge** is now described from its builder's plate (1899–1902, Daydé & Pillé), as seen in the Commons photo, rather than as "1903, Eiffel-designed".
11. **Food tiles show the first sentence of each entry**, which is often the address and hours. The full entry is under "More".
