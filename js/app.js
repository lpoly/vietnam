/* Trip site. All itinerary text comes from window.TRIP (generated from the markdown by
   scripts/parse-itinerary.py). This file only adds interface labels and layout. */
(function () {
  'use strict';

  var T = window.TRIP;
  var view = document.getElementById('view');
  if (!T) {
    view.innerHTML = '<p class="loading">Trip data is missing. Run <code>python scripts/parse-itinerary.py</code>.</p>';
    return;
  }

  /* ------------------------------------------------------------------ storage (never throws) */
  var mem = {};
  var storageOk = true;
  // Each itinerary version keeps its own ticks and settings.
  var NS = 'vn:' + (T.config.variant ? T.config.variant + ':' : '');
  var store = {
    get: function (k, d) {
      try {
        var v = window.localStorage.getItem(NS + k);
        if (v != null) return JSON.parse(v);
      } catch (e) { storageOk = false; }
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d;
    },
    set: function (k, v) {
      mem[k] = v;
      try { window.localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch (e) { storageOk = false; return false; }
    }
  };
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  var S = {
    rain: obj(store.get('rain', { global: false, days: {} })),
    checks: obj(store.get('checks', {})),
    packing: obj(store.get('packing', {})),
    booked: obj(store.get('booked', {})),
    food: obj(store.get('foodFilter', { base: 'all', meal: 'all' })),
    mapsApp: store.get('mapsApp', 'auto'),
    revealAll: false
  };
  S.rain.days = obj(S.rain.days);
  var openSecs = {}; // per-day open sections, kept for the session

  /* ------------------------------------------------------------------ text helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
  function plain(s) { return String(s == null ? '' : s).replace(LINK, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])\*(?!\*)(.+?)\*(?![*\w])/g, '$1$2'); }
  var HEDGE = /\bsources?\b|\blistings?\b|listed as|can't (?:confirm|verify|vouch)|cannot confirm|reconfirm|disagree|inconsistent|\bvary\b|\bvaries\b|re-addressed|may be defunct|unsure/i;
  function hedgeTest(s) { return HEDGE.test(String(s).replace(/&#39;/g, "'")); }

  /* Inline markdown as used in the itinerary: **bold**, *italic*, [source](https://…) links. Uncertainty hedges are
     highlighted, VND amounts emphasised, domains and phone numbers linked. Text is never altered.
     Links are set aside first so their URLs are not run through the other rules. */
  function md(s) {
    var links = [];
    var h = esc(String(s == null ? '' : s).replace(LINK, function (m, label, url) {
      links.push('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
      return '\u0000' + (links.length - 1) + '\u0000';
    }));
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*\w])\*(?!\*)(.+?)\*(?![*\w])/g, function (m, pre, inner) {
      return pre + (hedgeTest(inner) ? '<em class="hedge">' + inner + '</em>' : '<em>' + inner + '</em>');
    });
    h = h.replace(/\(([^()<>]*)\)/g, function (m, inner) { return hedgeTest(inner) ? '<span class="hedge">' + m + '</span>' : m; });
    h = h.replace(/— ([^—<>]*?\bsources\b[^<>.]*)/g, '<span class="hedge">— $1</span>');
    h = h.replace(/~?\d{1,3}(?:,\d{3})+(?:\s*[–-]\s*\d{1,3}(?:,\d{3})+)?\s*VND(?:\/[a-z]+)?/g, '<span class="money">$&</span>');
    h = h.replace(/\b([a-z][a-z0-9-]*\.(?:com|org\.vn|vn))\b/g, '<a href="https://$1" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/\+84(?: ?\d){9,10}/g, function (m) { return '<a href="tel:' + m.replace(/ /g, '') + '">' + m + '</a>'; });
    return h.replace(/\u0000(\d+)\u0000/g, function (m, i) { return links[+i]; });
  }
  function noNum(h) { return String(h || '').replace(/^\d+\.\s*/, ''); }
  function hm(min) { return min == null ? '' : String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

  /* One stroke icon family (24px grid, 2px stroke), Lucide-style shapes drawn for this site. */
  var PATHS = {
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    alert: '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    octagon: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M15 9l-6 6M9 9l6 6"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6a2 2 0 0 1-4 0M12 3V2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    van: '<path d="M3 6h11l4 4h3v6h-2"/><path d="M3 6v10h2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5M14 6v4h7"/>',
    train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 20l-2 2M15 20l2 2M9 16v.01M15 16v.01"/>',
    bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5 9 10h6l3.5 7.5M9 10 7.5 6H5M15 10l-1.5-4H16"/>',
    boat: '<path d="M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0"/><path d="M4 16 3 12h18l-2 4M12 12V3l5 6h-5"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="M10 22l2-7 3 3v4M7 13l3-5 4 1 3 4M12 15l-1-6"/>',
    food: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 10v11M17 21V3a4 4 0 0 0-3 4v6h3"/>',
    sight: '<path d="M3 20h18M5 20V10l7-5 7 5v10M9 20v-5h6v5"/>',
    bed: '<path d="M2 18V6M2 14h20v4M22 14v-2a3 3 0 0 0-3-3h-8v5"/><circle cx="6.5" cy="11" r="2"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a6 6 0 0 1 12 0v1"/><circle cx="17" cy="8" r="2.5"/><path d="M17 13.5a5 5 0 0 1 4 4.9V21"/>',
    route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    bag: '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  function ic(name, cls) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + (PATHS[name] || PATHS.info) + '</svg>';
  }
  var ICON = { pin: ic('pin') };
  /* Pick an icon for an item from its section and wording, so the timeline reads without relying on colour. */
  function kindIcon(it, section) {
    var t = plain(section === 'movements' ? (it.text || '') : (it.title || it.text || ''));
    if (section === 'rain') return 'umbrella';
    if (section === 'food') return 'food';
    if (section === 'local') return 'people';
    if (section === 'accommodation') return 'bed';
    if (/\b(train|SE19)\b/i.test(t)) return 'train';
    if (/\b(scooters?|motorbikes?|bikes?|bicycles?|Cycle)\b/i.test(t)) return 'bike';
    if (/\b(boats?|wharf|kayak)\b/i.test(t)) return 'boat';
    if (section === 'movements') return /\b(van|transfer|car|Grab|drive|driver)\b/i.test(t) ? 'van' : /foot|walk/i.test(t) ? 'walk' : 'route';
    if (/^(Lunch|Breakfast|Dinner|Picnic lunch|Eat)\b|\b(eat|coffee|Coffee|Bia hơi|Market breakfast)\b/.test(t)) return 'food';
    if (/^(Check in|Back to the homestay|Back for dinner)\b/i.test(t)) return 'bed';
    if (/^(Depart|Pickup|Back|Collect)\b|\bdrive\b/i.test(t)) return 'van';
    if (/\b(Walk|walk|Trek|trek)\b/.test(t)) return 'walk';
    return 'sight';
  }
  function modeIcon(mode) {
    var m = plain(mode);
    if (/train/i.test(m)) return 'train';
    if (/motorbike|scooter|bicycle/i.test(m)) return 'bike';
    if (/Oxalis|tour/i.test(m)) return 'walk';
    return 'van';
  }

  /* ------------------------------------------------------------------ lookups */
  var baseIdx = {};
  T.route.bases.forEach(function (b, i) { baseIdx[b.short] = b.line != null ? b.line : i; });
  function lineVar(short) { return short in baseIdx ? 'var(--line-' + (baseIdx[short] % 7) + ')' : 'var(--line-x)'; }
  function lineStyle(short) { return 'style="--line:' + lineVar(short) + '"'; }
  var verifyById = {};
  T.verify.items.forEach(function (v) { verifyById[v.id] = v; });
  var riskById = {};
  T.risks.forEach(function (r) { riskById[r.id] = r; });
  var lastDate = T.days[T.days.length - 1].date;
  function dayN(n) { return T.days[n - 1]; }

  /* ------------------------------------------------------------------ rain state */
  function rainOn(n) { return Object.prototype.hasOwnProperty.call(S.rain.days, n) ? !!S.rain.days[n] : !!S.rain.global; }
  function saveRain() { store.set('rain', S.rain); }
  function setGlobalRain(v) { S.rain = { global: v, days: {} }; saveRain(); }
  function setDayRain(n, v) {
    if (v === !!S.rain.global) delete S.rain.days[n]; else S.rain.days[n] = v;
    saveRain();
  }
  function paintRainToggle() {
    var btn = document.getElementById('rain-toggle');
    var lbl = document.getElementById('rain-toggle-label');
    var on = T.days.filter(function (d) { return rainOn(d.n); }).map(function (d) { return d.n; });
    btn.setAttribute('aria-pressed', String(!!S.rain.global));
    if (on.length === T.days.length) lbl.textContent = 'Rain plan: all days';
    else if (!on.length) lbl.textContent = 'Rain plan off';
    else lbl.textContent = 'Rain: Day ' + on.join(', ');
    document.body.classList.toggle('rain-global', !!S.rain.global);
  }

  /* ------------------------------------------------------------------ dates */
  function now() {
    var m = /[?&]at=(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(location.search + location.hash);
    if (m) return { date: m[1], min: m[2] ? (+m[2]) * 60 + (+m[3]) : 0, override: true };
    try {
      var f = new Intl.DateTimeFormat('en-CA', { timeZone: T.config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      var p = {};
      f.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour % 24) * 60 + (+p.minute) };
    } catch (e) {
      var d = new Date();
      return { date: d.toISOString().slice(0, 10), min: d.getHours() * 60 + d.getMinutes() };
    }
  }
  function todayCtx() {
    var n = now();
    var d = T.days.filter(function (x) { return x.date === n.date; })[0];
    if (d) return { day: d, inTrip: true, now: n };
    var dep = T.legs.legs.filter(function (l) { return l.start === n.date && l.start > lastDate; });
    if (dep.length) return { day: T.days[T.days.length - 1], inTrip: true, departure: dep, now: n };
    return { day: T.days[0], inTrip: false, now: n };
  }

  /* ------------------------------------------------------------------ maps links */
  function mapsApp() {
    if (S.mapsApp === 'google' || S.mapsApp === 'apple') return S.mapsApp;
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
    return ios ? 'apple' : 'google';
  }
  function gmaps(p) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.query); }
  function amaps(p) { return 'https://maps.apple.com/?q=' + encodeURIComponent(p.query); }
  function mapsHref(p) { return mapsApp() === 'apple' ? amaps(p) : gmaps(p); }
  function placeLink(id) {
    var p = T.places[id];
    if (!p) return '';
    return '<a class="place-link" href="' + esc(mapsHref(p)) + '" target="_blank" rel="noopener noreferrer" title="Search maps for: ' + esc(p.query) + '">' +
      ICON.pin + '<span>' + esc(plain(p.name)) + '</span></a>';
  }
  function placesHTML(ids) {
    ids = (ids || []).filter(function (id) { return T.places[id]; });
    return ids.length ? '<div class="places">' + ids.map(placeLink).join('') + '</div>' : '';
  }

  /* ------------------------------------------------------------------ flags & chips */
  function chipsHTML(o, opts) {
    opts = opts || {};
    var c = [];
    (o.flags || []).forEach(function (id) {
      var v = verifyById[id];
      if (v) c.push('<span class="chip warn">' + ic('alert') + ' Verify: ' + esc(plain(v.subject)) + '</span>');
    });
    if (o.uncertain && !(o.flags || []).length) c.push('<span class="chip hedge">' + ic('alert') + ' Uncertain — see text</span>');
    (o.risks || []).forEach(function (id) {
      var r = riskById[id];
      if (r) c.push('<a class="chip risk" href="#/reference/risks">' + ic('octagon') + ' ' + esc(r.heading.split(' — ')[0]) + '</a>');
    });
    if (opts.extra) c.push(opts.extra);
    return c.length ? '<div class="chips">' + c.join('') + '</div>' : '';
  }
  function flagsDetail(ids) {
    return (ids || []).map(function (id) {
      var v = verifyById[id];
      if (!v) return '';
      return '<div class="flag"><span class="flag-title">' + ic('alert') + '<span>' + esc(noNum(T.verify.heading)) + ' · ' + esc(plain(v.subject)) +
        (v.group ? ' <span class="small" style="font-weight:600">(' + esc(v.group) + ')</span>' : '') + '</span></span>' + md(v.rest || v.text) + '</div>';
    }).join('');
  }
  function risksDetail(ids) {
    return (ids || []).map(function (id) {
      var r = riskById[id];
      return r ? '<a class="risk-link" href="#/reference/risks">' + ic('octagon') + '<span>' + esc(r.heading) + '</span></a>' : '';
    }).join('');
  }

  /* ------------------------------------------------------------------ items */
  function itemBody(it) {
    var body = '';
    if (it.more) body += '<p>' + md(it.more) + '</p>';
    body += placesHTML(it.places);
    body += risksDetail(it.risks);
    body += flagsDetail(it.flags);
    return body;
  }
  function itemBlock(it, opts) {
    opts = opts || {};
    var head = (opts.kicker ? '<div class="meal-label">' + esc(opts.kicker) + '</div>' : '') +
      '<span class="it-title">' + md(it.title || plain(it.text)) + '</span>' + chipsHTML(it);
    var body = itemBody(it);
    if (!body) return '<div class="it-static">' + head + '</div>';
    return '<details class="it" id="it-' + esc(it.id) + '"><summary>' + head + '</summary><div class="it-more">' + body + '</div></details>';
  }
  function timeHTML(it) {
    if (!it.time) return '';
    var p = it.time.split(/\s*[–-]\s*/);
    return esc(p[0]) + (p[1] ? '<span class="end">–' + esc(p[1]) + '</span>' : '');
  }
  function timeline(items, opts) {
    opts = opts || {};
    if (!items.length) return '';
    return '<ol class="tl ' + (opts.cls || '') + '">' + items.map(function (it) {
      var sec = opts.section || (/^d\d+-([a-z]+)-/.exec(it.id || '') || [])[1];
      return '<li class="' + (it.time ? '' : 'untimed') + '" id="' + esc(it.id) + '"><div class="tl-time">' + timeHTML(it) + '</div>' +
        '<div class="tl-node">' + ic(kindIcon(it, sec)) + '</div><div class="tl-body">' + itemBlock(it, { kicker: opts.kicker ? opts.kicker(it) : null }) + '</div></li>';
    }).join('') + '</ol>';
  }

  /* generic nodes from the parser (paragraph / list / table) */
  function nodesHTML(nodes, opts) {
    opts = opts || {};
    return '<div class="nodes">' + (nodes || []).map(function (n) {
      if (n.kind === 'p') return '<p>' + md(n.text) + '</p>';
      if (n.kind === 'list') {
        var tag = n.ordered ? 'ol' : 'ul';
        return '<' + tag + '>' + n.items.map(function (i) { return '<li>' + md(i.text) + '</li>'; }).join('') + '</' + tag + '>';
      }
      if (n.kind === 'table') return tableHTML(n.header, n.rows);
      return '';
    }).join('') + '</div>';
  }
  function tableHTML(header, rows) {
    return '<table class="simple"><thead><tr>' + header.map(function (h) { return '<th>' + md(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + md(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ------------------------------------------------------------------ accommodation */
  function accFor(d) {
    var a = d.sections.accommodation;
    var src = d;
    if (a && a.sameAs) { src = dayN(a.sameAs); a = src.sections.accommodation; }
    return { acc: a, src: src, own: d.sections.accommodation };
  }
  function bookedOpt(d) {
    var r = accFor(d);
    var id = S.booked['d' + r.src.n];
    return r.acc ? r.acc.options.filter(function (o) { return o.id === id; })[0] : null;
  }
  function nightText(d) {
    return d.nightOf ? 'Night ' + d.nightOf[0] + ' of ' + d.nightOf[1] : '';
  }

  /* ------------------------------------------------------------------ views: TODAY */
  function timedMoves(d) {
    return d.sections.movements.filter(function (i) { return i.start != null; }).sort(function (a, b) { return a.start - b.start; });
  }
  function nextMove(ctx) {
    var d = ctx.day;
    if (ctx.departure) return { leg: ctx.departure[0] };
    var mv = timedMoves(d);
    if (ctx.inTrip) {
      var up = mv.filter(function (i) { return (i.end != null ? i.end : i.start) >= ctx.now.min; })[0];
      if (up) return { item: up, day: d };
      var nd = T.days[d.n];
      if (nd) {
        var m2 = timedMoves(nd)[0] || nd.sections.movements[0];
        if (m2) return { item: m2, day: nd, tomorrow: true };
      }
      var later = T.legs.legs.filter(function (l) { return l.start > d.date; });
      if (later.length) return { leg: later[later.length - 1], tomorrow: true };
      return null;
    }
    if (mv[0]) return { item: mv[0], day: d };
    return d.sections.movements[0] ? { item: d.sections.movements[0], day: d } : null;
  }
  function legCard(l) {
    return '<div class="leg">' +
      '<div class="leg-mode">' + ic(modeIcon(l.mode), 'i-xs') + '<span>' + md(l.mode) + '</span></div>' +
      '<div class="leg-route">' + md(l.leg) + ' <span class="muted small">· ' + esc(l.date) + '</span></div>' +
      '<span class="leg-k">Times</span><span class="leg-v">' + md(l.times) + '</span>' +
      '<span class="leg-k">Duration</span><span class="leg-v">' + md(l.duration) + '</span>' +
      '<span class="leg-k">Group cost</span><span class="leg-v">' + md(l.cost) + '</span>' +
      (l.flags.length ? '<div style="grid-column:1/-1">' + chipsHTML(l) + '<details class="it"><summary><span class="muted small">Why this is flagged</span></summary>' + flagsDetail(l.flags) + '</details></div>' : '') +
      '</div>';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function heroPhoto(d) {
    return Object.keys(T.photos).map(function (k) { return T.photos[k]; }).filter(function (p) { return p.day === d.n && p.file; })[0];
  }
  function creditHTML(cr) {
    if (!cr) return '';
    if (typeof cr !== 'object') return esc(cr);
    return 'Photo: ' + (cr.sourceUrl ? '<a href="' + esc(cr.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(cr.author || 'Unknown') + '</a>' : esc(cr.author || '')) +
      (cr.licence ? ', ' + (cr.licenceUrl ? '<a href="' + esc(cr.licenceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(cr.licence) + '</a>' : esc(cr.licence)) : '') +
      (cr.via ? ', via ' + esc(cr.via) : '');
  }
  /* Day header: the day's Commons photo under a dark scrim when there is one, otherwise the base's line colour. */
  function heroHTML(d, kicker) {
    var p = heroPhoto(d);
    return '<header class="hero' + (p ? ' has-photo' : '') + '" ' + lineStyle(d.nightBase) + '>' +
      (p ? '<img src="' + esc(p.file) + '" alt="' + esc(p.alt || plain(p.caption)) + '" decoding="async">' : '') +
      '<div class="hero-num" aria-hidden="true">' + pad2(d.n) + '</div>' +
      '<div class="hero-kicker">' + kicker + '</div>' +
      '<h1 class="hero-title">' + md(d.label) + '</h1>' +
      (d.theme ? '<p class="hero-theme">' + md(d.theme) + '</p>' : '') +
      '<div class="hero-meta"><span class="line-chip">' + esc(d.nightBase) + '</span>' +
      (nightText(d) ? '<span class="chip plain">' + ic('bed', 'i-xs') + esc(nightText(d)) + '</span>' : '') + '</div></header>' +
      (p ? '<p class="hero-credit">' + esc(plain(p.caption)) + ' · ' + creditHTML(p.credit) + '</p>' : '<div style="height:12px"></div>');
  }
  function legRouteHTML(leg) {
    return '<div class="next-route">' + plain(leg).split(/\s*→\s*/).map(esc).join(ic('arrow', 'i-sm')) + '</div>';
  }

  function viewToday() {
    var ctx = todayCtx();
    var d = ctx.day;
    var h = '';
    if (!ctx.inTrip) {
      h += '<p class="outside-note">' + ic('info', 'i-sm') + '<span>Today (' + esc(ctx.now.date) + ', Vietnam time) is outside the trip, so this shows Day 1. ' +
        '<a href="#/route">Pick another day</a>.</span></p>';
    } else if (ctx.now.override) {
      h += '<p class="outside-note">' + ic('clock', 'i-sm') + '<span>Previewing ' + esc(ctx.now.date) + ' ' + esc(hm(ctx.now.min)) + ' (set by <code>?at=</code> in the address).</span></p>';
    }
    h += heroHTML(d, (ctx.inTrip ? 'Today · ' : '') + 'Day ' + d.n + ' of ' + T.days.length + ' · ' + esc(d.dateLabel) + (ctx.departure ? ' · departure day' : ''));

    if (rainOn(d.n) && d.sections.rain.length) {
      var r0 = d.sections.rain[0];
      h += '<a class="card" href="#/day/' + d.n + '/rain" style="display:block;background:var(--rain);color:var(--rain-ink);text-decoration:none;border-color:var(--rain)">' +
        '<div class="card-label" style="color:inherit">' + ic('umbrella', 'i-sm') + 'Rain plan is on for this day</div><div class="next-title">' + md(r0.title) + '</div></a>';
    }

    // Next movement — trip-card layout: status pill, big time, route, then an action toolbar.
    var nm = nextMove(ctx);
    var status = !nm ? '' : nm.tomorrow ? 'Tomorrow' : ctx.inTrip ? 'Next' : 'First';
    h += '<section class="card"><div class="next-head"><div class="card-label" style="margin:0">' + ic('clock', 'i-sm') + 'Next movement</div>' +
      (status ? '<span class="pill' + (status === 'Next' ? ' live' : '') + '">' + status + '</span>' : '') + '</div>';
    if (!nm) {
      h += '<p class="muted">No further movements listed.</p>';
    } else if (nm.leg) {
      h += '<div class="big-time">' + esc(nm.leg.depart) + '</div>' + legRouteHTML(nm.leg.leg) +
        '<p class="next-sub">' + md(nm.leg.mode) + ' · ' + md(nm.leg.duration) + ' · ' + esc(nm.leg.date) + '</p>' + chipsHTML(nm.leg) +
        '<div class="toolbar"><a href="#/route">' + ic('route', 'i-sm') + 'Route</a></div>';
    } else {
      var it = nm.item;
      var leg = T.legs.legs.filter(function (l) { return l.start === nm.day.date && it.time && l.depart === it.time.split(/\s*[–-]\s*/)[0]; })[0];
      var firstPlace = (it.places || []).map(function (id) { return T.places[id]; }).filter(Boolean)[0];
      h += (it.time ? '<div class="big-time">' + esc(it.time) + '</div>' : '') +
        (leg ? legRouteHTML(leg.leg) : '') +
        '<div class="next-title">' + md(it.title) + '</div>' +
        (leg ? '<p class="next-sub">' + md(leg.mode) + ' · ' + md(leg.duration) + ' · ' + md(leg.cost) + '</p>' : '') +
        chipsHTML(it) +
        '<div class="toolbar"><a href="#/day/' + nm.day.n + '/item/' + esc(it.id) + '">' + ic('info', 'i-sm') + 'Details</a>' +
        (firstPlace ? '<a href="' + esc(mapsHref(firstPlace)) + '" target="_blank" rel="noopener noreferrer">' + ic('pin', 'i-sm') + 'Maps</a>' : '') +
        '<a href="#/day/' + nm.day.n + '/movements">' + ic('route', 'i-sm') + 'All</a></div>';
    }
    h += '</section>';

    // Sleeping
    var acc = accFor(d);
    h += '<section class="card"><div class="card-label">' + ic('bed', 'i-sm') + 'Sleeping tonight' + (nightText(d) ? ' · ' + esc(nightText(d)) : '') + '</div>';
    if (ctx.departure) {
      h += '<p>Departure day — see the next movement above.</p>';
    } else if (acc.acc) {
      var b = bookedOpt(d);
      if (b) {
        h += '<div class="stay-name">' + ic('check', 'i-sm') + '<span>' + md(b.title) + '</span></div>' + placesHTML(b.places);
      } else if (acc.acc.options.length) {
        h += acc.acc.options.map(function (o, i) {
          return '<div class="stay-name"><span class="opt-num">' + (i + 1) + '</span><span>' + md(o.title) + '</span></div>';
        }).join('') + '<p class="muted small" style="margin-top:8px">Options from the itinerary. Mark the one you booked in the day view.</p>';
      } else if (acc.acc.notes.length) {
        h += '<div class="stay-name">' + md(acc.acc.notes[0].title) + '</div>';
      }
    }
    h += '</section>';

    // Meals
    var meals = d.sections.food.filter(function (f) { return f.kind === 'food'; });
    h += '<section class="card"><div class="card-label">' + ic('food', 'i-sm') + 'Meals <span class="count">' + meals.length + '</span></div>';
    h += meals.map(function (f) {
      var names = f.places.map(function (id) { return T.places[id] ? plain(T.places[id].name) : ''; }).filter(Boolean);
      return '<a class="meal-row" href="#/day/' + d.n + '/item/' + esc(f.id) + '">' +
        '<span class="meal-ic">' + ic('food', 'i-sm') + '</span>' +
        '<div class="meal-time">' + esc(f.time || '') + '</div><div>' + (f.label && f.label !== f.title ? '<div class="meal-label">' + esc(f.label) + '</div>' : '') +
        '<div class="meal-name">' + (names.length ? esc(names.join(' / ')) : md(f.title)) + '</div></div></a>';
    }).join('') || '<p class="muted">No meals listed.</p>';
    h += '</section>';

    h += '<a class="btn primary block" href="#/day/' + d.n + '">' + ic('calendar', 'i-sm') + 'Open Day ' + d.n + ' in full</a>';
    setTitle('Today · Day ' + d.n);
    return h;
  }

  /* ------------------------------------------------------------------ views: DAY */
  function secHTML(n, key, name, summary, body, o) {
    o = o || {};
    var open = openSecs[n] && openSecs[n][key];
    if (open === undefined) open = !!o.open;
    return '<details class="sec ' + (o.cls || '') + '" data-sec="' + key + '" id="sec-' + key + '"' + (open ? ' open' : '') + '>' +
      '<summary><span class="sec-ic">' + ic(o.icon || 'info') + '</span><span class="sec-name">' + name +
      (o.count ? ' <span class="count">' + o.count + '</span>' : '') + '</span>' + (summary ? '<span class="sec-sum">' + summary + '</span>' : '') + '</summary>' +
      '<div class="sec-body">' + body + '</div></details>';
  }
  function firstTitles(items, k) {
    return items.slice(0, k).map(function (i) { return plain(i.title || ''); }).filter(Boolean).join(' · ');
  }
  function photosHTML(d) {
    var hero = heroPhoto(d);
    var slots = Object.keys(T.photos).map(function (k) { return T.photos[k]; })
      .filter(function (p) { return p.day === d.n && p !== hero; })
      .sort(function (a, b) { return (b.file ? 1 : 0) - (a.file ? 1 : 0); });
    if (!slots.length) return '';
    return '<div class="photos" aria-label="Photos">' + slots.map(function (p) {
      var credit = p.credit ? '<span class="credit">' + creditHTML(p.credit) + '</span>' : '';
      var frame = p.file
        ? '<div class="photo-frame has-img"><img src="' + esc(p.file) + '" alt="' + esc(p.alt || plain(p.caption)) + '" loading="lazy" decoding="async"></div>'
        : '<div class="photo-frame">' + ic('camera') + '<span>No photo yet</span><span>add to data/photos.json</span></div>';
      return '<figure class="photo">' + frame + '<figcaption>' + esc(plain(p.caption)) + credit + '</figcaption></figure>';
    }).join('') + '</div>';
  }

  function viewDay(n) {
    var d = dayN(n);
    if (!d) return notFound();
    var rain = rainOn(n);
    var s = d.sections;
    var h = heroHTML(d, 'Day ' + d.n + ' · ' + esc(d.dateLabel));

    h += '<div class="day-rain"><button type="button" class="switch" data-day-rain="' + n + '" aria-pressed="' + rain + '"><span class="knob"></span>' +
      (rain ? 'Rain plan on for this day' : 'Rain plan off for this day') + '</button></div>';
    h += '<div class="secs">';

    // Movements
    var legs = T.legs.legs.filter(function (l) { return l.start === d.date || (d.n === T.days.length && l.start > lastDate); });
    var tm = timedMoves(d)[0];
    var movSum = tm ? esc(tm.time) + ' ' + esc(plain(tm.title)) : esc(plain((s.movements[0] || {}).title || ''));
    var movesChanged = rain && s.rain.some(function (r) { return /\b(ride|riding|scooters|bikes|Heritage Train|private van)\b/i.test(plain(r.text)); });
    var movBody = (legs.length ? '<div class="legs">' + legs.map(legCard).join('') + '</div>' : '') +
      (movesChanged ? '<a class="chip rain" href="#/day/' + n + '/rain" style="margin:0 0 12px">' + ic('umbrella') + 'The rain plan changes today’s movements — read it</a>' : '') +
      timeline(s.movements, { section: 'movements' });
    h += secHTML(n, 'movements', 'Movements' + (movesChanged ? ' <span class="rain-badge">rain plan applies</span>' : ''), movSum, movBody,
      { icon: tm ? kindIcon(tm, 'movements') : 'route', count: s.movements.length });

    // Accommodation
    var r = accFor(d);
    var accSum = '';
    var accBody = '';
    if (r.acc) {
      var booked = bookedOpt(d);
      accSum = (r.own && r.own.nights ? esc(r.own.nights) + ' · ' : '') + esc(booked ? plain(booked.title) : r.acc.options.map(function (o) { return plain(o.title); }).join(' / ') || plain((r.acc.notes[0] || {}).title || ''));
      if (r.own && r.own.sameAs) accBody += '<p><strong>Same as Day ' + r.own.sameAs + '.</strong> <a href="#/day/' + r.own.sameAs + '/accommodation">Go to Day ' + r.own.sameAs + '</a></p>';
      accBody += r.acc.options.map(function (o, i) {
        var isB = booked && booked.id === o.id;
        return '<div class="opt' + (isB ? ' booked' : '') + '" id="' + esc(o.id) + '" ' + lineStyle(d.nightBase) + '>' +
          '<div class="opt-name"><span class="opt-num">' + (i + 1) + '</span><span>' + md(o.title) + '</span></div>' +
          (isB ? '<div class="booked-mark">' + ic('check', 'i-xs') + 'Marked as booked</div>' : '') +
          chipsHTML(o) + (o.more ? '<p>' + md(o.more) + '</p>' : '') + placesHTML(o.places) + flagsDetail(o.flags) +
          '<button type="button" class="btn small" data-book="d' + r.src.n + '" data-opt="' + esc(o.id) + '" aria-pressed="' + !!isB + '">' +
          (isB ? 'Clear booked mark' : ic('check', 'i-sm') + 'Mark as booked') + '</button></div>';
      }).join('');
      if (r.src === d) accBody += r.acc.notes.map(function (it) { return '<div class="card"><p>' + md(it.text) + '</p>' + placesHTML(it.places) + chipsHTML(it) + flagsDetail(it.flags) + '</div>'; }).join('');
    }
    h += secHTML(n, 'accommodation', 'Accommodation', accSum, accBody, { icon: 'bed', count: r.acc ? r.acc.options.length : 0 });

    // Activities
    var actItems = [];
    s.activities.forEach(function (g) { actItems = actItems.concat(g.items); });
    var named = actItems.filter(function (i) { return i.titleIsName; });
    var timedCount = actItems.filter(function (i) { return i.time; }).length;
    var actSum = (timedCount ? timedCount + ' timed stops · ' : '') + esc(firstTitles(named.length ? named : actItems, 3));
    var actBody = photosHTML(d) + s.activities.map(function (g) {
      var timed = g.items.filter(function (i) { return i.time; });
      var intro = g.items.filter(function (i) { return !i.time && i.kind === 'para'; });
      var rest = g.items.filter(function (i) { return !i.time && i.kind !== 'para'; });
      var out = g.heading ? '<h3 class="sub-heading">' + md(g.heading) + '</h3>' : '';
      out += intro.map(function (i) { return '<div class="card">' + itemBlock(i) + '</div>'; }).join('');
      out += timed.length ? timeline(g.items.filter(function (i) { return i.kind !== 'para'; }), { section: 'activities' }) : timeline(rest, { section: 'activities' });
      return out;
    }).join('');

    // Rain plan
    var rainSum = esc(plain((s.rain[0] || {}).title || ''));
    var rainBody = timeline(s.rain, { cls: 'rain-tl', section: 'rain' });

    if (rain) {
      h += secHTML(n, 'rain', 'Rain plan <span class="rain-badge">in place of activities</span>', rainSum, rainBody, { cls: 'rain', open: true, icon: 'umbrella', count: s.rain.length });
    } else {
      h += secHTML(n, 'activities', 'Activities', actSum, actBody, { icon: 'sight', count: actItems.length });
    }

    // Food
    var foodItems = s.food;
    var foodSum = esc(foodItems.filter(function (f) { return f.kind === 'food' && f.label; }).map(function (f) {
      var names = f.places.map(function (id) { return T.places[id] ? plain(T.places[id].name) : ''; }).filter(Boolean);
      return f.label + ' ' + (names[0] || plain(f.title));
    }).slice(0, 4).join(' · '));
    var foodBody = timeline(foodItems, { kicker: function (it) { return it.label; }, section: 'food' }) +
      '<p class="small" style="margin-top:8px"><a href="#/food">All food across the trip</a></p>';
    h += secHTML(n, 'food', 'Food', foodSum, foodBody, { icon: 'food', count: foodItems.filter(function (f) { return f.kind === 'food'; }).length });

    // Local life
    h += secHTML(n, 'local', 'Local life', esc(firstTitles(s.local, 1)), timeline(s.local, { section: 'local' }), { icon: 'people' });

    if (rain) {
      h += secHTML(n, 'activities', 'Activities <span class="small" style="font-weight:600">(dry-weather plan)</span>', actSum, actBody, { cls: 'dry-hidden', icon: 'sight', count: actItems.length });
    } else {
      h += secHTML(n, 'rain', 'Rain plan', rainSum, rainBody, { cls: 'rain', icon: 'umbrella', count: s.rain.length });
    }
    h += '</div>';

    h += '<div class="day-nav">' +
      (n > 1 ? '<a class="btn" href="#/day/' + (n - 1) + '">Day ' + (n - 1) + '</a>' : '<span></span>') +
      (n < T.days.length ? '<a class="btn primary" href="#/day/' + (n + 1) + '">Day ' + (n + 1) + ic('arrow', 'i-sm') + '</a>' : '<span></span>') + '</div>';
    setTitle('Day ' + n + ' · ' + plain(d.label));
    return h;
  }

  /* ------------------------------------------------------------------ views: ROUTE */
  function viewRoute() {
    var ctx = todayCtx();
    var h = '<h1 class="view-title">' + esc(plain(T.title)) + '</h1>';
    h += '<details class="sec"><summary><span class="sec-name">About this trip</span><span class="sec-sum">' + esc(plain(T.intro[0] ? T.intro[0].text : '')) + '</span></summary><div class="sec-body">' +
      T.intro.map(function (i) { return '<p>' + md(i.text) + '</p>'; }).join('') + viewFlagsHTML('route') + '</div></details>';

    function legLi(l) {
      var local = l.leg.indexOf('→') < 0;
      return '<li class="leg-li"><div class="route-leg' + (local ? ' local' : '') + '"><span class="mode">' + ic(modeIcon(l.mode)) + esc(l.date) + '</span> <b>' + md(l.leg) + '</b><br>' +
        md(l.mode) + ' · ' + md(l.times) + (l.duration && l.duration !== '—' ? ' · <b>' + md(l.duration) + '</b>' : '') + chipsHTML(l) + '</div></li>';
    }
    h += '<ol class="route">';
    T.days.forEach(function (d, i) {
      T.legs.legs.filter(function (l) { return l.end === d.date; }).forEach(function (l) { h += legLi(l); });
      var prev = T.days[i - 1];
      var inter = prev && prev.nightBase !== d.nightBase;
      h += '<li ' + lineStyle(d.nightBase) + '><a class="stop' + (inter ? ' interchange' : '') + (ctx.inTrip && ctx.day.n === d.n ? ' today-stop' : '') + '" href="#/day/' + d.n + '">' +
        '<div class="stop-day">Day ' + d.n + ' · ' + esc(d.dateLabel) + (ctx.inTrip && ctx.day.n === d.n ? ' <span class="pill live">Today</span>' : '') + '</div>' +
        '<div class="stop-name">' + md(d.label) + '</div>' +
        (d.theme ? '<div class="stop-theme">' + md(d.theme) + '</div>' : '') +
        '<div class="stop-meta"><span class="line-chip" ' + lineStyle(d.nightBase) + '>' + esc(d.nightBase) + '</span>' +
        (nightText(d) ? '<span class="chip plain">' + esc(nightText(d)) + '</span>' : '') +
        (rainOn(d.n) ? '<span class="chip rain">' + ic('umbrella') + 'rain plan</span>' : '') + '</div></a></li>';
    });
    T.legs.legs.filter(function (l) { return l.start > lastDate; }).forEach(function (l) { h += legLi(l); });
    h += '</ol>';

    h += '<h2 class="section-title">' + esc(noNum(T.legs.total.length ? 'Transport' : '')) + '</h2>' + T.legs.total.map(function (t) { return '<p>' + md(t) + '</p>'; }).join('');
    h += '<details class="sec"><summary><span class="sec-name">The bases</span><span class="sec-sum">' + esc(T.route.bases.map(function (b) { return b.short; }).join(' → ')) + '</span></summary><div class="sec-body">' +
      T.route.bases.map(function (b) {
        return '<div class="card" ' + lineStyle(b.short) + '><div class="row"><span class="line-chip" ' + lineStyle(b.short) + '>' + md(b.base) + '</span><span class="muted">' + esc(b.dates) + ' · ' + esc(b.nights) + '</span></div>' +
          '<p style="margin-top:8px">' + md(b.why) + '</p>' + chipsHTML(b) + '</div>';
      }).join('') + T.route.notes.map(function (t) { return '<p>' + md(t) + '</p>'; }).join('') + '</div></details>';
    h += '<details class="sec"><summary><span class="sec-name">How to book each of these</span></summary><div class="sec-body">' + nodesHTML(T.legs.howto) + '</div></details>';
    if (T.legs.other && T.legs.other.nodes.length) {
      h += '<details class="sec"><summary><span class="sec-name">' + md(T.legs.other.heading) + '</span></summary>' +
        '<div class="sec-body">' + nodesHTML(T.legs.other.nodes) + '</div></details>';
    }
    T.route.background.forEach(function (g) {
      h += '<details class="sec"><summary><span class="sec-name">' + md(g.heading) + '</span></summary><div class="sec-body">' + nodesHTML(g.nodes) + '</div></details>';
    });
    setTitle('Route');
    return h;
  }

  /* ------------------------------------------------------------------ views: FOOD */
  var MEALS = [['all', 'All meals'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack'], ['other', 'Other']];
  function allFood() {
    var out = [];
    T.days.forEach(function (d) { out = out.concat(d.foodEntries); });
    return out;
  }
  function viewFood() {
    var entries = allFood();
    var bases = [];
    T.route.bases.forEach(function (b) { if (!b.isTrain && entries.some(function (e) { return e.base === b.short; })) bases.push(b.short); });
    entries.forEach(function (e) { if (bases.indexOf(e.base) < 0) bases.push(e.base); });
    if (S.food.base !== 'all' && bases.indexOf(S.food.base) < 0) S.food.base = 'all';
    var meals = MEALS.filter(function (m) { return m[0] === 'all' || entries.some(function (e) { return e.meal === m[0]; }); });

    var h = '<h1 class="view-title">Food</h1><div class="filters"><div class="filter-row" role="group" aria-label="Base">' +
      '<button type="button" class="fchip" data-fbase="all" aria-pressed="' + (S.food.base === 'all') + '">All bases</button>' +
      bases.map(function (b) { return '<button type="button" class="fchip base" ' + lineStyle(b) + ' data-fbase="' + esc(b) + '" aria-pressed="' + (S.food.base === b) + '">' + esc(b) + '</button>'; }).join('') +
      '</div><div class="filter-row" role="group" aria-label="Meal">' +
      meals.map(function (m) { return '<button type="button" class="fchip" data-fmeal="' + m[0] + '" aria-pressed="' + (S.food.meal === m[0]) + '">' + m[1] + '</button>'; }).join('') +
      '</div></div>';

    // Primer for the chosen base, or all of it collapsed.
    var regions = T.primer.regions.filter(function (r) { return S.food.base === 'all' || r.base === S.food.base; });
    if (regions.length) {
      h += '<details class="sec"' + (S.food.base !== 'all' ? '' : '') + '><summary><span class="sec-name">' + esc(noNum(T.primer.heading)) + '</span><span class="sec-sum">' +
        esc(regions.map(function (r) { return r.title; }).join(' · ')) + '</span></summary><div class="sec-body">' +
        regions.map(function (r) {
          return '<div class="card" ' + lineStyle(r.base) + '><div class="food-heading">' + md(r.title) + '</div><p>' + md(r.intro) + '</p>' +
            r.points.map(function (p) { return '<p>' + md(p.text) + '</p>'; }).join('') + '</div>';
        }).join('') + T.primer.general.map(function (g) { return '<p>' + md(g.text) + '</p>'; }).join('') + '</div></details>';
    }

    var shown = entries.filter(function (e) {
      return (S.food.base === 'all' || e.base === S.food.base) && (S.food.meal === 'all' || e.meal === S.food.meal);
    });
    h += '<p class="muted small" style="margin-top:14px">' + shown.length + ' of ' + entries.length + ' entries</p>';
    h += shown.map(foodCard).join('') || '<p class="empty">Nothing matches these filters.</p>';
    setTitle('Food');
    return h;
  }
  function kv(label, vals) {
    vals = (vals || []).filter(Boolean);
    return vals.length ? '<dt>' + label + '</dt><dd>' + vals.map(md).join('<br>') + '</dd>' : '';
  }
  function foodCard(e) {
    var src = e.fromSection === 'local' ? 'Local life' : e.fromSection === 'activities' ? 'Activity' : (e.label || '');
    var meta = 'Day ' + e.day + ' · ' + src + (e.time ? ' · ' + e.time : '') + ' · ' + e.base;
    var places = e.places.map(function (id) {
      var p = T.places[id];
      if (!p) return '';
      var dl = kv('Where', [p.where]) + kv('Hours', [p.hours]) + kv('Price', [p.price]);
      return '<div class="food-place"><div class="food-place-name">' + esc(plain(p.name)) + '</div>' +
        '<a class="place-link" href="' + esc(mapsHref(p)) + '" target="_blank" rel="noopener noreferrer" aria-label="Maps: ' + esc(plain(p.name)) + '">' + ICON.pin + '<span>Maps</span></a>' +
        (dl ? '<dl class="kv">' + dl + '</dl>' : '') + '</div>';
    }).join('');
    var dl2 = kv('Hours', e.hours) + kv('Price', e.price) + kv('Order', e.order) + kv('Book', e.reserve);
    return '<article class="food-card" ' + lineStyle(e.base) + '>' +
      '<div class="food-meta">' + ic(e.fromSection === 'local' ? 'people' : e.fromSection === 'activities' ? 'sight' : 'food', 'i-xs') + esc(meta) + '</div>' +
      '<div class="food-heading">' + md(e.heading || e.label || '') + '</div>' +
      (e.sub.length ? '<p class="food-sub">' + e.sub.map(md).join(' ') + '</p>' : '') +
      chipsHTML(e) + places +
      (dl2 ? '<dl class="kv">' + dl2 + '</dl>' : '') +
      (e.reason ? '<p class="reason">' + md(e.reason) + '</p>' : '') +
      flagsDetail(e.flags) +
      '<details class="as-written"><summary>As written in the itinerary</summary><p>' + md(e.text) + '</p>' +
      '<p class="small"><a href="#/day/' + e.day + '/item/' + esc(e.id) + '">Open in Day ' + e.day + '</a></p></details>' +
      '</article>';
  }

  /* ------------------------------------------------------------------ views: CHECKLIST */
  function viewChecklist() {
    var C = T.checklist;
    var all = C.before.concat(C.ground);
    var done = all.filter(function (c) { return S.checks[c.id]; }).length;
    var h = '<h1 class="view-title">' + esc(noNum(C.heading)) + '</h1>';
    if (!storageOk) h += '<p class="storage-note">This browser is blocking storage, so ticks will be lost when you close the page.</p>';
    h += progress(done, all.length);
    h += viewFlagsHTML('checklist');
    function group(title, items, kind) {
      var d = items.filter(function (c) { return S.checks[c.id]; }).length;
      return '<h2 class="section-title">' + md(title) + ' <span class="sec-count">' + d + '/' + items.length + '</span></h2>' +
        items.map(function (c) {
          var isDone = !!S.checks[c.id];
          var pill = kind === 'before' ? '<span class="urgency u' + Math.min(Math.floor(c.rank), 9) + '">' + esc(plain(c.urgency)) + '</span>'
            : '<span class="urgency">' + esc(plain(c.when)) + '</span>';
          var extra = (c.flags.length || c.risks.length) ? '<details class="it"><summary>' + chipsHTML(c) + '</summary>' + risksDetail(c.risks) + flagsDetail(c.flags) + '</details>' : '';
          return '<div class="check' + (isDone ? ' done' : '') + '"><input type="checkbox" id="c-' + esc(c.id) + '" data-check="' + esc(c.id) + '"' + (isDone ? ' checked' : '') + '>' +
            '<div><label for="c-' + esc(c.id) + '">' + pill + '<div class="check-item">' + md(c.item) + '</div>' +
            (c.why ? '<div class="check-why">' + md(c.why) + '</div>' : '') + '</label>' + extra + '</div></div>';
        }).join('');
    }
    h += group(C.beforeHeading, C.before, 'before');
    h += group(C.groundHeading, C.ground, 'ground');
    h += '<p style="margin-top:20px"><button type="button" class="btn small" data-reset="checks">Untick everything</button></p>';
    setTitle('Booking checklist');
    return h;
  }
  function progress(done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    return '<div class="progress"><div class="progress-text">' + done + ' of ' + total + ' done</div><div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"><span style="width:' + pct + '%"></span></div></div>';
  }
  function viewFlagsHTML(v) {
    return ((T.viewFlags || {})[v] || []).map(function (id) { return flagsDetail([id]); }).join('');
  }

  /* ------------------------------------------------------------------ views: MONEY */
  function viewMoney() {
    var B = T.budget, C = T.cash;
    var h = viewFlagsHTML('money');
    h += '<h2 class="section-title">' + esc(noNum(B.heading)) + '</h2>' + B.intro.map(function (t) { return '<p>' + md(t) + '</p>'; }).join('');
    h += '<div class="budget">' + B.lines.map(function (r) {
      var total = /Subtotal|Total/.test(plain(r.line));
      return '<div class="budget-row' + (total ? ' total' : '') + '"><div>' + md(r.line) + '</div><div class="amt">' + md(r.perPerson) + '</div>' +
        (r.notes ? '<div class="note">' + md(r.notes) + '</div>' : '') + (r.flags.length ? '<div class="note">' + chipsHTML(r) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    h += '<h2 class="section-title">' + md(B.activitiesHeading) + '</h2>' +
      '<table class="simple"><thead><tr>' + B.activitiesHeader.map(function (x) { return '<th>' + md(x) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      B.activities.map(function (r) {
        return '<tr><td>' + md(r.item) + chipsHTML(r) + '</td><td class="num">' + md(r.vnd) + '</td><td class="num">' + md(r.usd) + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<details class="sec" style="margin-top:18px"><summary><span class="sec-name">' + md(B.flag.heading) + '</span></summary><div class="sec-body">' + nodesHTML(B.flag.nodes) + '</div></details>';

    h += '<h2 class="section-title">' + esc(noNum(C.heading)) + '</h2>';
    if (C.noCards.length) {
      h += '<div class="card danger"><div class="card-label">' + ic('wallet', 'i-sm') + 'Cards don’t work here — bring cash</div><ul class="nocards">' +
        C.noCards.map(function (x) { return '<li>' + ic('x', 'i-sm') + '<span>' + md(x) + '</span></li>'; }).join('') + '</ul></div>';
    }
    h += '<div class="nodes">' + C.nodes.map(function (n) {
      if (n.split) return '';
      return nodesHTML([n]);
    }).join('') + '</div>';
    return h;
  }

  /* ------------------------------------------------------------------ views: REFERENCE */
  var REF_TABS = [['money', 'Money'], ['phrases', 'Phrases'], ['packing', 'Packing'], ['group', 'Group'], ['risks', 'Risks']];
  function licenceRisk() { return T.risks[0]; }
  function viewReference(tab) {
    tab = tab || 'money';
    var h = '<h1 class="view-title">' + (tab === 'verify' ? 'Verify before you go' : 'Before you go') + '</h1><div class="seg" role="tablist">' + (tab === 'verify' ? [] : REF_TABS).map(function (t) {
      return '<a class="fchip" role="tab" href="#/essentials/' + t[0] + '" aria-pressed="' + (t[0] === tab) + '" style="display:inline-flex;align-items:center;text-decoration:none">' + t[1] + '</a>';
    }).join('') + '</div>';
    var lic = licenceRisk();
    if (tab !== 'risks' && lic) {
      h += '<a class="risk-link licence-banner" href="#/reference/risks">' + ic('octagon') + '<span>' + esc(lic.heading) + '</span></a>';
    }
    if (tab === 'money') h += viewMoney();
    else if (tab === 'phrases') h += refPhrases();
    else if (tab === 'packing') h += refPacking();
    else if (tab === 'group') h += '<h2 class="section-title">' + esc(noNum(T.logistics.heading)) + '</h2>' + nodesHTML(T.logistics.nodes);
    else if (tab === 'risks') h += refRisks();
    else if (tab === 'verify') h += refVerify();
    h += viewFlagsHTML('reference');
    setTitle(tab === 'verify' ? 'Verify' : 'Before you go');
    return h;
  }
  function refPhrases() {
    var P = T.phrases;
    var h = '<h2 class="section-title">' + esc(noNum(P.heading)) + '</h2>' + P.intro.map(function (i) { return '<p>' + md(i.text) + '</p>'; }).join('');
    h += '<p><button type="button" class="btn small" data-reveal-all>' + (S.revealAll ? 'Hide all pronunciations' : 'Show all pronunciations') + '</button></p>';
    P.groups.forEach(function (g) {
      h += '<div class="phrase-group"><h3 class="sub-heading">' + md(g.title) + '</h3><div class="phrases">' + g.rows.map(function (r) {
        return '<button type="button" class="phrase" aria-expanded="' + S.revealAll + '"><div class="phrase-vi" lang="vi">' + md(r.vi) + '</div>' +
          '<div class="phrase-en">' + md(r.means) + '</div><div class="phrase-say">' + md(r.say) + '</div></button>';
      }).join('') + '</div></div>';
    });
    h += P.after.map(function (i) { return '<p>' + md(i.text) + '</p>'; }).join('');
    return h;
  }
  function refPacking() {
    var K = T.packing;
    var done = K.bring.filter(function (b) { return S.packing[b.id]; }).length;
    var h = '<h2 class="section-title">' + esc(noNum(K.heading)) + '</h2>' + nodesHTML(K.intro);
    if (!storageOk) h += '<p class="storage-note">This browser is blocking storage, so ticks will be lost when you close the page.</p>';
    h += '<p>' + md(K.bringLead) + '</p>' + progress(done, K.bring.length);
    h += K.bring.map(function (b) {
      var isDone = !!S.packing[b.id];
      return '<div class="check' + (isDone ? ' done' : '') + '"><input type="checkbox" id="p-' + esc(b.id) + '" data-pack="' + esc(b.id) + '"' + (isDone ? ' checked' : '') + '>' +
        '<label for="p-' + esc(b.id) + '"><div class="check-item">' + md(b.text) + '</div></label></div>';
    }).join('');
    h += nodesHTML(K.after);
    h += '<p style="margin-top:20px"><button type="button" class="btn small" data-reset="packing">Untick packing list</button></p>';
    return h;
  }
  function refRisks() {
    var h = '<h2 class="section-title">' + esc(noNum(T.risksHeading)) + '</h2>';
    T.risks.forEach(function (r, i) {
      if (i === 0) {
        h += '<section class="licence-card" id="' + esc(r.id) + '"><h2>' + ic('octagon') + '<span>' + md(r.heading) + '</span></h2>' + nodesHTML(r.nodes) + '</section>';
      } else {
        h += '<details class="sec" id="' + esc(r.id) + '" open><summary><span class="sec-name">' + md(r.heading) + '</span></summary><div class="sec-body">' + nodesHTML(r.nodes) + '</div></details>';
      }
    });
    return h;
  }
  function refVerify() {
    var V = T.verify;
    var h = '<h2 class="section-title">' + esc(noNum(V.heading)) + '</h2>' + V.intro.map(function (t) { return '<p>' + md(t) + '</p>'; }).join('');
    var lastGroup = null;
    V.items.forEach(function (v) {
      if (v.group && v.group !== lastGroup) h += '<h3 class="sub-heading">' + md(v.group) + '</h3>';
      lastGroup = v.group;
      var links = [];
      v.affects.forEach(function (a) {
        if (a.day) links.push('<a href="#/day/' + a.day + '/item/' + esc(a.item) + '">Day ' + a.day + ' · ' + esc(plain(a.title || a.section)) + '</a>');
        else if (a.checklist) links.push('<a href="#/checklist">Checklist · ' + esc(plain(a.title)) + '</a>');
        else if (a.leg) links.push('<a href="#/route">Route · ' + esc(plain(a.title)) + '</a>');
        else if (a.view) links.push('<a href="#/' + esc(a.view) + '">' + esc(a.title ? a.view + ' · ' + plain(a.title) : a.view) + '</a>');
      });
      h += '<div class="flag"><span class="flag-title">' + ic('alert') + '<span>' + md(v.subject) + '</span></span>' + md(v.rest || v.text) +
        (links.length ? '<p class="small" style="margin:8px 0 0"><b>Shown on:</b> ' + links.join(' · ') + '</p>' : '') + '</div>';
    });
    return h;
  }

  /* ------------------------------------------------------------------ views: MAPS */
  function viewMaps() {
    var places = Object.keys(T.places).map(function (k) { return T.places[k]; });
    var withC = places.filter(function (p) { return Array.isArray(p.coords) && p.coords.length === 2; });
    var h = '<h1 class="view-title">Maps</h1>' + viewFlagsHTML('maps');
    h += '<p class="card"><b>' + withC.length + ' of ' + places.length + ' places have reviewed coordinates.</b> ' +
      'Places without coordinates are not drawn on a map; their links below hand the name' + ' and address from the itinerary to your maps app as a search. ' +
      'Map tiles need a connection; the links work like any search in your maps app.</p>';
    var bases = [];
    places.forEach(function (p) { if (bases.indexOf(p.base) < 0) bases.push(p.base); });
    bases.sort(function (a, b) { return (a in baseIdx ? baseIdx[a] : 99) - (b in baseIdx ? baseIdx[b] : 99); });
    bases.forEach(function (b) {
      var ps = places.filter(function (p) { return p.base === b; });
      var pc = ps.filter(function (p) { return Array.isArray(p.coords) && p.coords.length === 2; });
      h += '<details class="sec"' + (pc.length ? ' open' : '') + '><summary><span class="sec-name"><span class="line-chip" ' + lineStyle(b) + '>' + esc(b) + '</span></span>' +
        '<span class="sec-sum">' + ps.length + ' places · ' + pc.length + ' with coordinates</span></summary><div class="sec-body">' +
        (pc.length ? '<div class="map" data-map="' + esc(b) + '"></div>' : '') +
        ps.map(function (p) {
          return '<div class="place-row"><div class="place-row-name">' + esc(plain(p.name)) + '</div>' +
            (p.where ? '<div class="small">' + md(p.where) + '</div>' : '') +
            '<div class="small muted">Day ' + p.days.join(', ') + ' · search: “' + esc(p.query) + '”' + (p.coords ? '' : ' · no coordinates') + '</div>' +
            '<div class="row"><a class="btn small" href="' + esc(gmaps(p)) + '" target="_blank" rel="noopener noreferrer">Google Maps</a>' +
            '<a class="btn small" href="' + esc(amaps(p)) + '" target="_blank" rel="noopener noreferrer">Apple Maps</a></div></div>';
        }).join('') + '</div></details>';
    });
    setTitle('Maps');
    if (withC.length) setTimeout(drawMaps, 0);
    return h;
  }
  function loadLeaflet(cb) {
    if (window.L) return cb();
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = cb;
    document.head.appendChild(s);
  }
  function drawMaps() {
    loadLeaflet(function () {
      var cs = getComputedStyle(document.documentElement);
      Array.prototype.forEach.call(document.querySelectorAll('[data-map]'), function (el) {
        var b = el.getAttribute('data-map');
        var col = (cs.getPropertyValue(b in baseIdx ? '--line-' + baseIdx[b] : '--line-x') || '#333').trim();
        var pts = Object.keys(T.places).map(function (k) { return T.places[k]; })
          .filter(function (p) { return p.base === b && Array.isArray(p.coords) && p.coords.length === 2; });
        var m = window.L.map(el, { scrollWheelZoom: false });
        tiles(window.L, m);
        var group = pts.map(function (p) {
          return window.L.circleMarker(p.coords, { radius: 9, color: '#000', weight: 3, fillColor: col, fillOpacity: 1 })
            .bindPopup('<b>' + esc(plain(p.name)) + '</b><br><a href="' + esc(mapsHref(p)) + '" target="_blank" rel="noopener noreferrer">Open in maps</a>')
            .addTo(m);
        });
        var fg = window.L.featureGroup(group);
        m.fitBounds(fg.getBounds().pad(0.2), { maxZoom: 15 });
      });
    });
  }

  /* ------------------------------------------------------------------ views: MORE */
  function viewMore() {
    var h = '<h1 class="view-title">More</h1><ul class="menu">' +
      menuItem('#/today', 'Today', 'Next movement, where you sleep, meals', 'clock') +
      menuItem('#/checklist', 'Booking checklist', 'What to book, in order of urgency', 'check') +
      menuItem('#/reference/verify', 'Verify before you go', 'Every uncertain price, time and place', 'alert') +
      menuItem('#/maps', 'All places on maps', 'Every place, with maps search links', 'map') +
      menuItem('#/essentials/group', 'Group logistics', 'Where eight people will be awkward', 'people') +
      '</ul>';
    h += '<h2 class="section-title">Maps app for place links</h2><div class="radio-row">' +
      [['auto', 'Automatic'], ['google', 'Google Maps'], ['apple', 'Apple Maps']].map(function (o) {
        return '<button type="button" class="fchip" data-maps-app="' + o[0] + '" aria-pressed="' + (S.mapsApp === o[0] || (o[0] === 'auto' && ['google', 'apple'].indexOf(S.mapsApp) < 0)) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    h += '<h2 class="section-title">Offline</h2><p id="offline-status">Checking…</p>';
    h += '<p class="small muted">Saved on this device: ' + (storageOk ? '<span class="status-ok">ticks, booked hotels and rain settings are stored in this browser</span>' : '<span class="status-bad">storage is blocked, settings will not survive a reload</span>') + '.</p>';
    h += '<h2 class="section-title">Data</h2><p class="small">Generated ' + esc(T.generated) + ' from the itinerary markdown. ' +
      Object.keys(T.places).length + ' places, ' + allFood().length + ' food entries, ' + T.verify.items.length + ' items to verify.</p>';
    h += '<p><button type="button" class="btn small" data-reset="all">Reset rain settings and booked marks</button></p>';
    setTitle('More');
    setTimeout(paintOffline, 0);
    return h;
  }
  function menuItem(href, name, desc, icon) {
    return '<li><a href="' + href + '"><span class="menu-ic">' + ic(icon || 'info') + '</span><span><span class="menu-name">' + name + '</span><span class="menu-desc">' + desc + '</span></span></a></li>';
  }
  function paintOffline() {
    var el = document.getElementById('offline-status');
    if (!el) return;
    if (location.protocol === 'file:') {
      el.innerHTML = '<span class="status-bad">Opened from a file.</span> Offline caching only works on the hosted site (see README).';
      return;
    }
    if (!('serviceWorker' in navigator) || !window.caches) {
      el.innerHTML = '<span class="status-bad">This browser does not support offline caching.</span>';
      return;
    }
    caches.keys().then(function (keys) {
      var k = keys.filter(function (x) { return x.indexOf('trip-') === 0; })[0];
      if (k && navigator.serviceWorker.controller) el.innerHTML = '<span class="status-ok">' + ic('check', 'i-sm') + ' Ready offline.</span> Everything is cached on this device (' + esc(k) + ').';
      else if (k) el.innerHTML = '<span class="status-ok">Cached.</span> Reload once to finish switching to offline mode.';
      else el.innerHTML = '<span class="status-bad">Not cached yet.</span> Stay online and reload this page once.';
    }).catch(function () { el.textContent = 'Could not check the offline cache.'; });
  }

  function notFound() { setTitle('Not found'); return '<p class="empty">That page does not exist. <a href="#/today">Go to Today</a>.</p>'; }
  function setTitle(t) {
    document.getElementById('topbar-title').textContent = t;
    document.title = t + ' · ' + plain(T.title);
  }

  /* ------------------------------------------------------------------ views: GUIDE (city-guide.md) */
  var G = T.guide || { chapters: [], intro: [] };
  function chapterPhoto(ch) {
    var slots = Object.keys(T.photos).map(function (k) { return T.photos[k]; })
      .filter(function (p) { return p.file && p.base === ch.base; })
      .sort(function (a, b) { return (b.hero ? 1 : 0) - (a.hero ? 1 : 0) || a.day - b.day; });
    return slots[0];
  }
  function firstSentence(md0) {
    var t = String(md0 || '');
    var m = /^(.+?[.!?])(\s|$)/.exec(plain(t));
    return m ? m[1] : plain(t);
  }
  function countKind(ch, kind) {
    return ch.sections.filter(function (s) { return s.kind === kind; }).reduce(function (a, s) { return a + s.items.length; }, 0);
  }
  function hasCoords(pid) { var c = T.places[pid] && T.places[pid].coords; return Array.isArray(c) && c.length === 2; }
  function cssLine(short) {
    var cs = getComputedStyle(document.documentElement);
    return (cs.getPropertyValue(short in baseIdx ? '--line-' + (baseIdx[short] % 7) : '--line-x') || '#444').trim();
  }
  var MAPQ = [];          // maps waiting to be drawn after the view renders
  var mapsLive = [];
  function queueMap(fn) { MAPQ.push(fn); }
  function flushMaps() {
    mapsLive.forEach(function (m) { try { m.remove(); } catch (e) { /* already gone */ } });
    mapsLive = [];
    if (!MAPQ.length) return;
    var jobs = MAPQ.slice(); MAPQ = [];
    loadLeaflet(function () { jobs.forEach(function (fn) { try { fn(window.L); } catch (e) { /* map failed; the list below still works */ } }); });
  }
  /* Background map. tile.openstreetmap.org refuses requests from sites like this one ("Access blocked"), so the
     primary layer is Esri World Street Map; if its tiles fail, switch once to the Humanitarian OSM style. */
  function tiles(L, m) {
    var primary = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
    });
    var errors = 0, loaded = 0, switched = false;
    primary.on('tileload', function () { loaded++; });
    primary.on('tileerror', function () {
      errors++;
      if (!switched && errors >= 4 && loaded === 0) {
        switched = true;
        m.removeLayer(primary);
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
          maxZoom: 18, subdomains: 'abc',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by Humanitarian OSM Team'
        }).addTo(m);
      }
    });
    primary.addTo(m);
  }

  /* The route as a transit line over a real map: one station per base, the train leg dashed. */
  function routeMapHTML() {
    var bc = T.baseCoords || {};
    var stops = G.chapters.filter(function (c) { return c.base && bc[c.base]; });
    if (stops.length < 2) return '';
    queueMap(function (L) {
      var el = document.getElementById('route-map');
      if (!el) return;
      var m = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false, attributionControl: false });
      L.control.attribution({ position: 'topright', prefix: false }).addTo(m);
      mapsLive.push(m);
      tiles(L, m);
      var pts = stops.map(function (c) { return bc[c.base]; });
      for (var i = 0; i < stops.length - 1; i++) {
        var a = stops[i], b = stops[i + 1];
        var viaTrain = G.chapters.some(function (c) { return c.base && /train/i.test(c.base) && c.days.indexOf(a.days[a.days.length - 1]) >= 0; });
        L.polyline([bc[a.base], bc[b.base]], { color: '#000', weight: 9, opacity: 0.9 }).addTo(m);
        L.polyline([bc[a.base], bc[b.base]], { color: cssLine(b.base), weight: 5, opacity: 1, dashArray: viaTrain ? '2 10' : null, lineCap: 'round' }).addTo(m);
      }
      stops.forEach(function (c, i) {
        // Label on the left when another stop sits just to the east at about the same latitude (Hanoi, with Ha Long).
        var p = bc[c.base];
        var crowded = stops.some(function (o) { var q = bc[o.base]; return o !== c && q[1] > p[1] && q[1] - p[1] < 1.6 && Math.abs(q[0] - p[0]) < 0.6; });
        var icon = L.divIcon({ className: 'station-pin' + (crowded ? ' left' : ''), iconSize: [30, 30], iconAnchor: [15, 15],
          html: '<span style="--line:' + cssLine(c.base) + '"></span><b>' + esc(plain(c.base)) + '</b>' });
        L.marker(bc[c.base], { icon: icon, keyboard: true, title: plain(c.title) }).addTo(m)
          .on('click', function () { location.hash = '#/city/' + c.id; });
      });
      m.fitBounds(L.latLngBounds(pts).pad(0.12));
    });
    return '<div class="route-map" id="route-map" role="img" aria-label="Map of the route from Hanoi to Hoi An"></div>';
  }

  /* Links between the itinerary versions (one page each), from parse-config.json. */
  function versionsHTML() {
    var vs = T.config.versions || [];
    if (vs.length < 2) return '';
    return '<nav class="versions" aria-label="Itinerary versions">' + vs.map(function (v) {
      var here = v.page === T.config.page;
      return '<a class="fchip" href="' + esc(v.page) + '"' + (here ? ' aria-current="page"' : '') + '>' + esc(v.label) + '</a>';
    }).join('') + '</nav>';
  }

  function viewGuide() {
    var ctx = todayCtx();
    var h = '<section class="home-hero">' + routeMapHTML() +
      '<div class="home-title"><h1>' + esc(plain(G.title || T.title).replace(/: the guide$/, '')) + '</h1>' +
      '<p>' + esc(firstSentence(G.intro[0])) + '</p>' + versionsHTML() + '</div></section>';
    if (ctx.inTrip) {
      h += '<a class="today-banner" href="#/today"><span class="pill live">Day ' + ctx.day.n + '</span><span><b>' + md(ctx.day.label) + '</b>' +
        '<span class="small">See what’s happening today</span></span>' + ic('arrow') + '</a>';
    }
    h += '<div class="prose home-intro">' + G.intro.slice(1).map(function (t) { return '<p>' + md(t) + '</p>'; }).join('') + '</div>';
    h += '<h2 class="h2">The places</h2><div class="city-stack">';
    G.chapters.forEach(function (ch, i) {
      var p = chapterPhoto(ch);
      var sees = countKind(ch, 'see');
      h += '<a class="city-tile' + (p ? '' : ' no-photo') + '" href="#/city/' + esc(ch.id) + '" ' + lineStyle(ch.base) + '>' +
        (p ? '<img src="' + esc(p.file) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<span class="city-tile-text"><span class="city-tile-when">' + esc((ch.meta || '').split('·')[0].trim()) + '</span>' +
        '<span class="city-tile-name">' + esc(plain(ch.title)) + '</span>' +
        '<span class="city-tile-lead">' + esc(firstSentence(ch.lead[0])) + '</span>' +
        (sees ? '<span class="city-tile-count">' + sees + ' things to see</span>' : '') + '</span></a>';
    });
    h += '</div>';
    h += '<h2 class="h2">Before you go</h2><div class="tool-grid">' +
      toolTile('#/essentials/money', 'wallet', 'Money and cards', 'Cash, ATMs, tipping') +
      toolTile('#/essentials/phrases', 'chat', 'Phrasebook', 'Tap to hear it in your head') +
      toolTile('#/essentials/packing', 'bag', 'What to pack', 'Two climates, nine days') +
      toolTile('#/essentials/risks', 'shield', 'Staying safe', 'Motorbike licences first') + '</div>' +
      '<a class="plan-cta" href="#/plan">' + ic('calendar') + '<span><b>The day-by-day plan</b><span class="small">Times, transport, rain plans, bookings</span></span></a>';
    setTitle('Vietnam guide');
    return h;
  }
  function toolTile(href, icon, name, sub) {
    return '<a class="tool-tile" href="' + href + '">' + ic(icon) + '<b>' + esc(name) + '</b><span>' + esc(sub) + '</span></a>';
  }

  /* Where this city sits on the line: every stop as a station, this one filled. */
  function routeStrip(ch) {
    return '<ol class="strip" aria-label="Where this is on the route">' + G.chapters.map(function (c) {
      var here = c.id === ch.id;
      return '<li class="' + (here ? 'here' : '') + '" ' + lineStyle(c.base) + '><a href="#/city/' + esc(c.id) + '"' + (here ? ' aria-current="page"' : '') + '>' +
        '<span class="dot"></span><span class="lbl">' + esc(plain(c.base && /train/i.test(c.base) ? 'Train' : c.base || c.title)) + '</span></a></li>';
    }).join('') + '</ol>';
  }
  function photoFor(pids) {
    for (var i = 0; i < (pids || []).length; i++) { var p = T.photos[pids[i]]; if (p && p.file) return p; }
    return null;
  }
  function priceIn(text) {
    var m = /~?\d{1,3}(?:,\d{3})+(?:\s*[–-]\s*\d{1,3}(?:,\d{3})+)?\s*VND(?:\/[a-z]+)?|US\$\d+(?:[–-]\d+)?|~?\$\d+(?:[–-]\d+)?/.exec(plain(text || ''));
    return m ? m[0] : '';
  }
  function moreHTML(it) {
    var full = md(it.text);
    var first = firstSentence(it.text);
    var rest = plain(it.text).length > first.length + 2;
    return rest ? '<p class="entry-first">' + esc(first) + '</p><details class="more"><summary>More</summary><p>' + full + '</p></details>'
      : '<p class="entry-first">' + full + '</p>';
  }
  function flagsBlock(it) {
    return (it.flags.length || it.risks.length || it.uncertain) ? chipsHTML(it) +
      ((it.flags.length || it.risks.length) ? '<details class="more why"><summary>Why it’s flagged</summary>' + risksDetail(it.risks) + flagsDetail(it.flags) + '</details>' : '') : '';
  }

  function viewCity(id) {
    var idx = -1;
    G.chapters.forEach(function (c, i) { if (c.id === id) idx = i; });
    var ch = G.chapters[idx];
    if (!ch) return notFound();
    var p = chapterPhoto(ch);
    var metaParts = (ch.meta || '').split('·').map(function (s) { return s.trim(); }).filter(Boolean);
    var h = '<header class="city-hero' + (p ? '' : ' no-photo') + '" ' + lineStyle(ch.base) + '>' +
      (p ? '<img src="' + esc(p.file) + '" alt="' + esc(p.alt || plain(p.caption)) + '" decoding="async">' : '') +
      '<div class="city-hero-text"><h1>' + esc(plain(ch.title)) + '</h1>' +
      '<p class="city-hero-meta">' + metaParts.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</p></div></header>' +
      (p ? '<p class="hero-credit">' + esc(plain(p.caption)) + '. ' + creditHTML(p.credit) + '</p>' : '');
    h += routeStrip(ch);
    h += '<div class="prose city-lead">' + ch.lead.map(function (t) { return '<p>' + md(t) + '</p>'; }).join('') + '</div>';

    var sec = function (k) { return ch.sections.filter(function (s) { return s.kind === k; }); };
    sec('glance').forEach(function (s) {
      var icons = { When: 'calendar', Weather: 'umbrella', "Don't miss": 'sight', 'Signature dish': 'food', Sleep: 'bed' };
      h += '<div class="facts">' + s.items.map(function (it) {
        return '<div class="fact"><span class="fact-ic">' + ic(icons[plain(it.name)] || 'info') + '</span><span class="fact-k">' + esc(plain(it.name)) + '</span>' +
          '<span class="fact-v">' + md(it.text) + '</span></div>';
      }).join('') + '</div>';
    });

    // Numbered sights: the same numbers appear on the map pins.
    var sights = [];
    sec('see').forEach(function (s) { s.items.forEach(function (it) { sights.push(it); }); });
    var pinned = [];
    sights.forEach(function (it, i) { it._n = i + 1; it.places.forEach(function (pid) { if (hasCoords(pid)) pinned.push({ pid: pid, n: i + 1, kind: 'see' }); }); });
    ch.sections.forEach(function (s) {
      if (s.kind === 'eat' || s.kind === 'stay' || s.kind === 'shop') s.items.forEach(function (it) {
        it.places.forEach(function (pid) { if (hasCoords(pid) && !pinned.some(function (x) { return x.pid === pid; })) pinned.push({ pid: pid, kind: s.kind }); });
      });
    });
    if (pinned.length) {
      queueMap(function (L) {
        var el = document.getElementById('city-map');
        if (!el) return;
        var m = L.map(el, { scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false });
        mapsLive.push(m);
        tiles(L, m);
        var col = cssLine(ch.base);
        var ll = [];
        pinned.forEach(function (x) {
          var pl = T.places[x.pid];
          ll.push(pl.coords);
          var html = x.n ? '<span class="num" style="background:' + col + '">' + x.n + '</span>'
            : '<span class="dotpin k-' + x.kind + '">' + ic(x.kind === 'eat' ? 'food' : x.kind === 'stay' ? 'bed' : 'bag') + '</span>';
          var icon = L.divIcon({ className: 'city-pin', iconSize: [30, 30], iconAnchor: [15, 15], html: html });
          L.marker(pl.coords, { icon: icon, title: plain(pl.name) }).addTo(m)
            .bindPopup('<b>' + esc(plain(pl.name)) + '</b><br><a href="' + esc(mapsHref(pl)) + '" target="_blank" rel="noopener noreferrer">Open in maps</a>');
        });
        var centre = (T.baseCoords || {})[ch.base];
        var near = centre ? ll.filter(function (q) { return Math.abs(q[0] - centre[0]) < 0.25 && Math.abs(q[1] - centre[1]) < 0.25; }) : ll;
        if (!near.length) near = ll;
        if (near.length === 1) m.setView(near[0], 14); else m.fitBounds(L.latLngBounds(near).pad(0.12), { maxZoom: 15 });
      });
      h += '<section class="map-block" id="g-map"><div class="city-map" id="city-map" role="img" aria-label="Map of ' + esc(plain(ch.title)) + '"></div>' +
        '<p class="map-note">' + ic('info', 'i-xs') + 'Numbers match the sights below. Pins are placed automatically from OpenStreetMap and can be off; use “Open in maps” to navigate. The map needs a connection; everything else works offline.</p></section>';
    }

    if (sights.length) {
      h += '<section class="g-sec" id="g-see"><h2 class="h2">' + esc(sec('see')[0].title) + '</h2><div class="sights">' + sights.map(function (it) {
        var ph = photoFor(it.places);
        return '<article class="sight' + (ph ? ' with-photo' : '') + '" id="' + esc(it.id) + '" ' + lineStyle(ch.base) + '>' +
          (ph ? '<figure><img src="' + esc(ph.file) + '" alt="' + esc(ph.alt || plain(ph.caption)) + '" loading="lazy" decoding="async"><figcaption>' + creditHTML(ph.credit) + '</figcaption></figure>' : '') +
          '<div class="sight-body"><h3><span class="num">' + it._n + '</span>' + md(it.name) + '</h3>' + moreHTML(it) + flagsBlock(it) + entryPlaces(it) + '</div></article>';
      }).join('') + '</div></section>';
    }

    sec('eat').forEach(function (s) {
      h += '<section class="g-sec" id="g-eat"><h2 class="h2">' + esc(s.title) + '</h2>' + s.intro.map(function (t) { return '<p class="prose">' + md(t) + '</p>'; }).join('') +
        '<div class="food-rail">' + s.items.map(function (it) {
          var price = priceIn(it.text);
          return '<article class="food-tile" id="' + esc(it.id) + '">' + ic('food') + '<h3>' + md(it.name) + '</h3>' +
            (price ? '<p class="food-price">' + esc(price) + '</p>' : '') + moreHTML(it) + flagsBlock(it) + entryPlaces(it) + '</article>';
        }).join('') + '</div></section>';
    });

    ['shop', 'stay', 'move', 'know', 'other'].forEach(function (k) {
      sec(k).forEach(function (s) {
        h += '<section class="g-sec" id="g-' + esc(k) + '"><h2 class="h2">' + esc(s.title) + '</h2>' +
          s.intro.map(function (t) { return '<p class="prose">' + md(t) + '</p>'; }).join('') +
          '<div class="rows">' + s.items.map(function (it) {
            return '<article class="row-item" id="' + esc(it.id) + '"><span class="row-ic">' + ic(s.icon) + '</span><div><h3>' + md(it.name) + '</h3>' +
              moreHTML(it) + flagsBlock(it) + entryPlaces(it) + '</div></article>';
          }).join('') + '</div></section>';
      });
    });

    if (ch.days.length) {
      h += '<div class="plan-days">' + ic('calendar') + '<span>On the plan</span>' +
        ch.days.map(function (n) { var d = dayN(n); return d ? '<a class="fchip" href="#/day/' + n + '">Day ' + n + '</a>' : ''; }).join('') + '</div>';
    }
    var next = G.chapters[idx + 1], prev = G.chapters[idx - 1];
    if (next) {
      var np = chapterPhoto(next);
      h += '<a class="next-city' + (np ? '' : ' no-photo') + '" href="#/city/' + esc(next.id) + '" ' + lineStyle(next.base) + '>' +
        (np ? '<img src="' + esc(np.file) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<span><span class="small">Next stop</span><b>' + esc(plain(next.title)) + '</b></span>' + ic('arrow') + '</a>';
    }
    if (prev) h += '<p class="prev-city"><a href="#/city/' + esc(prev.id) + '">Back to ' + esc(plain(prev.title)) + '</a></p>';
    setTitle(plain(ch.title));
    return h;
  }

  /* Maps buttons for a guide entry; the one that repeats the entry's own heading just says "Open in maps". */
  function entryPlaces(it) {
    var key = function (s) { return plain(s || '').replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase(); };
    var ids = (it.places || []).filter(function (id) { return T.places[id]; });
    if (!ids.length) return '';
    return '<div class="places">' + ids.map(function (id) {
      var p = T.places[id];
      if (key(p.name) !== key(it.name)) return placeLink(id);
      return '<a class="place-link" href="' + esc(mapsHref(p)) + '" target="_blank" rel="noopener noreferrer" title="Search maps for: ' + esc(p.query) + '">' +
        ICON.pin + '<span>Open in maps</span></a>';
    }).join('') + '</div>';
  }
  /* The Plan tab: today, the booking checklist, and the day-by-day route. */
  function viewPlan() {
    var ctx = todayCtx();
    var C = T.checklist;
    var all = C.before.concat(C.ground);
    var done = all.filter(function (c) { return S.checks[c.id]; }).length;
    var h = '<h1 class="view-title">The plan</h1>' +
      '<div class="plan-links">' +
      '<a class="card plan-link" href="#/today">' + ic('clock') + '<span><b>' + (ctx.inTrip ? 'Today · Day ' + ctx.day.n : 'Today') + '</b><span class="muted small">Next movement, bed, meals</span></span></a>' +
      '<a class="card plan-link" href="#/checklist">' + ic('check') + '<span><b>Bookings</b><span class="muted small">' + done + ' of ' + all.length + ' done</span></span></a>' +
      '</div>';
    h += viewRoute().replace(/^<h1 class="view-title">[\s\S]*?<\/h1>/, '<h2 class="section-title">Day by day</h2>');
    setTitle('The plan');
    return h;
  }

  /* ------------------------------------------------------------------ router */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '').split('?')[0];
    return h.split('/').filter(Boolean);
  }
  function render(keepScroll) {
    var p = parseHash();
    var tab = p[0] || 'guide';
    var html;
    var focusItem = null, focusSec = null;
    if (tab === 'guide') html = viewGuide();
    else if (tab === 'city') html = viewCity(p[1]);
    else if (tab === 'plan') html = viewPlan();
    else if (tab === 'today') html = viewToday();
    else if (tab === 'day') {
      var n = parseInt(p[1], 10);
      if (p[2] === 'item' && p[3]) focusItem = p[3];
      else if (p[2]) focusSec = p[2];
      if (focusItem || focusSec) {
        var d = dayN(n);
        if (d) {
          openSecs[n] = openSecs[n] || {};
          var sec = focusSec || sectionOf(d, focusItem);
          if (sec) openSecs[n][sec] = true;
        }
      }
      html = viewDay(n);
    }
    else if (tab === 'route') html = viewRoute();
    else if (tab === 'food') html = viewFood();
    else if (tab === 'checklist') html = viewChecklist();
    else if (tab === 'money') html = viewReference('money');
    else if (tab === 'reference' || tab === 'essentials') html = viewReference(p[1]);
    else if (tab === 'maps') html = viewMaps();
    else if (tab === 'more') html = viewMore();
    else html = notFound();
    view.innerHTML = html;
    view.classList.toggle('flush-top', tab === 'guide' || tab === 'city');
    flushMaps();
    paintRainToggle();
    var navTab = { city: 'guide', day: 'plan', today: 'plan', route: 'plan', checklist: 'plan', money: 'essentials', reference: (p[1] === 'verify' ? 'more' : 'essentials'), maps: 'more' }[tab] || tab;
    document.body.classList.toggle('show-rain', ['plan', 'today', 'day', 'route'].indexOf(tab) >= 0);
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      if (a.getAttribute('data-tab') === navTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (focusItem) {
      var li = document.getElementById(focusItem) || document.getElementById('it-' + focusItem);
      var det = document.getElementById('it-' + focusItem);
      if (det) det.open = true;
      if (li) { li.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); return; }
    }
    if (focusSec) {
      var s = document.getElementById('sec-' + focusSec);
      if (s) { s.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); return; }
    }
    if (tab === 'city' && p[2]) {
      var gs = document.getElementById('g-' + p[2]);
      if (gs) { gs.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); return; }
    }
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function sectionOf(d, id) {
    var m = /^d\d+-([a-z]+)-/.exec(id || '');
    if (!m) return null;
    var k = m[1];
    if (k === 'acc' || k === 'accn') return 'accommodation';
    if (k === 'activities' && rainOn(d.n)) return 'activities';
    return k;
  }

  /* ------------------------------------------------------------------ events */
  document.getElementById('rain-toggle').addEventListener('click', function () {
    setGlobalRain(!S.rain.global);
    render(true);
  });
  view.addEventListener('toggle', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('sec')) return;
    var p = parseHash();
    if (p[0] !== 'day') return;
    var n = parseInt(p[1], 10);
    openSecs[n] = openSecs[n] || {};
    openSecs[n][t.getAttribute('data-sec')] = t.open;
  }, true);
  view.addEventListener('click', function (e) {
    var t = e.target.closest('button, [data-check], [data-pack]');
    if (!t) return;
    if (t.hasAttribute('data-day-rain')) {
      var n = parseInt(t.getAttribute('data-day-rain'), 10);
      setDayRain(n, !rainOn(n));
      render(true);
    } else if (t.hasAttribute('data-book')) {
      var key = t.getAttribute('data-book'), opt = t.getAttribute('data-opt');
      if (S.booked[key] === opt) delete S.booked[key]; else S.booked[key] = opt;
      store.set('booked', S.booked);
      render(true);
    } else if (t.hasAttribute('data-fbase')) {
      S.food.base = t.getAttribute('data-fbase');
      store.set('foodFilter', S.food);
      render(true);
    } else if (t.hasAttribute('data-fmeal')) {
      S.food.meal = t.getAttribute('data-fmeal');
      store.set('foodFilter', S.food);
      render(true);
    } else if (t.classList.contains('phrase')) {
      t.setAttribute('aria-expanded', String(t.getAttribute('aria-expanded') !== 'true'));
    } else if (t.hasAttribute('data-reveal-all')) {
      S.revealAll = !S.revealAll;
      render(true);
    } else if (t.hasAttribute('data-maps-app')) {
      S.mapsApp = t.getAttribute('data-maps-app');
      store.set('mapsApp', S.mapsApp);
      render(true);
    } else if (t.hasAttribute('data-reset')) {
      var what = t.getAttribute('data-reset');
      if (!window.confirm('Are you sure?')) return;
      if (what === 'checks') { S.checks = {}; store.set('checks', S.checks); }
      if (what === 'packing') { S.packing = {}; store.set('packing', S.packing); }
      if (what === 'all') { setGlobalRain(false); S.booked = {}; store.set('booked', S.booked); }
      render(true);
    }
  });
  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-check')) {
      S.checks[t.getAttribute('data-check')] = t.checked;
      if (!t.checked) delete S.checks[t.getAttribute('data-check')];
      store.set('checks', S.checks);
      render(true);
    } else if (t.hasAttribute('data-pack')) {
      S.packing[t.getAttribute('data-pack')] = t.checked;
      if (!t.checked) delete S.packing[t.getAttribute('data-pack')];
      store.set('packing', S.packing);
      render(true);
    }
  });
  window.addEventListener('hashchange', function () { render(false); });

  /* ------------------------------------------------------------------ offline */
  function toast(msg, action, fn) {
    var el = document.getElementById('toast');
    el.innerHTML = '<span style="flex:1">' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
    el.hidden = false;
    if (action) el.querySelector('button').addEventListener('click', fn);
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () { /* offline install failed; site still works online */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) toast('A newer version of the itinerary is now cached.', 'Reload', function () { location.reload(); });
      else paintOffline();
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  render(false);
})();
