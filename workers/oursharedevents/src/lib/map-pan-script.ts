/**
 * The map's zoom, its scale bar and the you-are-here mark (owner, 2026-11-18).
 *
 * THE OWNER'S RULING. The map was drawn with no JavaScript (hex-map standard
 * rule 10). On 2026-11-18 the owner chose "a small script on the map only" so
 * the map can be pinched, scrolled and dragged. This is that script. The only
 * other one the map carries is its tooltip (lib/map-tip-script.ts, owner
 * 2026-11-25), which names an area or a place clear of the pointer or finger
 * and keeps the same bans. It keeps the other half of rule 10: it makes no
 * request of any kind (no fetch, no image, no tile). It changes the drawing the
 * server already sent: its `viewBox`, the size its text and lines are set at,
 * and one mark it adds. Once the visitor asks where they are, it also writes
 * distances, as text, into the list under the map and (zoomed in, OSE-2198)
 * into the place panels and the event cards below the map, and puts those
 * cards nearest first: the one change it makes outside the map's figure.
 * Without it (an old browser, or scripts off) the map is exactly what it was,
 * and its buttons stay hidden.
 *
 * WHAT IT DOES
 *   - Phone first (owner, 2026-11-18: "phone is the primary interface"): a
 *     two-finger pinch that never scrolls or zooms the page, a one-finger drag
 *     once the map is zoomed in, + and − buttons of 48 px and a "show the whole
 *     map" button. Then Ctrl + scroll (a trackpad's pinch arrives that way) and
 *     the keyboard (+, −, 0 and the arrows) when focus is
 *     on the map. At most four times the size. The hexagons, the dots and the
 *     streets are one drawing, so they stay lined up at every zoom.
 *   - Text keeps its size on screen as the map grows, and lines grow more
 *     slowly than the map. From twice the size the second tier of street names
 *     and landmarks shows (`data-k`, lib/street-labels.ts).
 *   - A scale bar in miles, worked out from the drawing's real size on screen.
 *   - When the visitor taps "Show where I am", and only then, even where
 *     location is already allowed (owner, 2026-11-19: "the user need to tap and
 *     save purposely by choice"; OSE-2198 Part C): a
 *     ringed dot where they are, the distance to each area in the list under
 *     the map with the nearest put first, and a line read out by a screen
 *     reader naming the nearest area.
 *   - Zoomed in on one area (OSE-2198; owner, 2026-11-19: "this is how you get
 *     accurate measurements and distance from current location to event
 *     distance"): the distance is to each PLACE, not the area. Each dot carries
 *     its res-9 cell's centre (`data-ll`, the point it is drawn at); the
 *     place's panel says how far it is, the event cards below the map (the
 *     zoomed area's list, owner 2026-11-17) say how far their place is and are
 *     put nearest first, and the line names the nearest place. A place's
 *     events are the ones its panel names. An event with no place on the map,
 *     or one its place's panel does not name, is measured to the area's centre
 *     and says "about".
 *
 * NEVER WHO, NEVER WHERE (invariant 3: geolocation picks what to show and is
 * never stored). The position is read by the phone and used by the phone: it
 * is never sent, stored, logged or put in the address, and no cell is made
 * from it (owner ruling 2026-11-16, "zip finds, tap places"): it goes into the
 * distance sum and the you-are-here mark, and nowhere else. The script asks for
 * it only on the tap, never on its own; it keeps nothing (no storage, no
 * cookie) and makes no request (tests/e2e/0-architecture/
 * location-on-tap.invariant.spec.ts).
 *
 * On a phone a one-finger drag scrolls the page while the map is whole
 * (`touch-action: pan-y`), and moves the map once it is zoomed in. A tap that
 * ended a drag does not follow the link under it.
 */
const SCRIPT = String.raw`(function () {
  var fig = document.querySelector('figure.amap[data-pan]');
  var svg = fig && fig.querySelector('svg[data-scale]');
  var ctl = fig && fig.querySelector('.amap-ctl');
  if (!svg || !ctl || !svg.getScreenCTM || !svg.createSVGPoint || !window.requestAnimationFrame) return;
  ctl.hidden = false;
  var W = 600, H = 360, MAX = 4, k = 1, cx = W / 2, cy = H / 2, queued = false, here = null, you = null;
  var X0 = +svg.getAttribute('data-x0'), Y0 = +svg.getAttribute('data-y0');
  var S = +svg.getAttribute('data-scale'), MPU = +svg.getAttribute('data-mpu');
  var NS = 'http://www.w3.org/2000/svg';
  function btn(z) { return ctl.querySelector('[data-z="' + z + '"]'); }
  var bar = ctl.querySelector('.amap-bar'), barText = ctl.querySelector('[data-testid="amap-scale-text"]');
  var status = ctl.querySelector('[data-testid="amap-you-status"]');
  function say(key, d, name) {
    // Replaced by a function, so a name with "$&" in it is written as it is.
    return (ctl.getAttribute('data-' + key) || '')
      .replace('{d}', function () { return d; })
      .replace('{name}', function () { return name || ''; });
  }
  var texts = [].slice.call(svg.querySelectorAll('text:not(.amap-dn)'));
  var lines = [].slice.call(svg.querySelectorAll('.amap-s path'));
  var edges = [].slice.call(svg.querySelectorAll('.amap-cell, .amap-zone, .as-pm'));
  var names = [].slice.call(svg.querySelectorAll('.amap-sl .as-t, .amap-sl .as-n, .amap-sl .as-q'));
  // A name the screen cuts at the map's edge (a phone shows the middle of a
  // wide map) is hidden rather than shown in part.
  function fit() {
    var r = svg.getBoundingClientRect();
    names.forEach(function (el) {
      el.style.visibility = '';
      var b = el.getBoundingClientRect();
      if (b.width && (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1)) el.style.visibility = 'hidden';
    });
  }
  function unitPx() { return svg.getScreenCTM().a || 1; }
  function toMap(x, y) {
    var p = svg.createSVGPoint();
    p.x = x; p.y = y;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function sizes() {
    texts.concat(lines, edges).forEach(function (el) { el.style.fontSize = ''; el.style.strokeWidth = ''; });
    if (k === 1) return;
    var t = texts.map(function (el) { var cs = getComputedStyle(el); return [parseFloat(cs.fontSize), parseFloat(cs.strokeWidth) || 0]; });
    var l = lines.map(function (el) { return parseFloat(getComputedStyle(el).strokeWidth) || 1; });
    texts.forEach(function (el, i) { el.style.fontSize = t[i][0] / k + 'px'; el.style.strokeWidth = t[i][1] / k + 'px'; });
    lines.forEach(function (el, i) { el.style.strokeWidth = l[i] / Math.sqrt(k) + 'px'; });
    var e = edges.map(function (el) { return parseFloat(getComputedStyle(el).strokeWidth) || 1; });
    edges.forEach(function (el, i) { el.style.strokeWidth = e[i] / k + 'px'; });
  }

  function scale() {
    if (!(MPU > 0)) return;
    var miPerPx = MPU / unitPx() / 1609.344, nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50], d = nice[0];
    for (var i = 0; i < nice.length; i++) if (nice[i] / miPerPx <= 120) d = nice[i];
    bar.style.width = Math.round(d / miPerPx) + 'px';
    barText.textContent = say('miles', d);
  }

  function proj(lat, lng) {
    var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
    return [((lng + 180) / 360 - X0) * S, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) - Y0) * S];
  }
  function inFrame(p) { return p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H; }
  function mark() {
    if (!here) return;
    var p = proj(here[0], here[1]), u = unitPx(), r = [18, 9, 3.5];
    if (!you) {
      you = document.createElementNS(NS, 'g');
      you.setAttribute('class', 'amap-you');
      you.setAttribute('data-testid', 'amap-you');
      you.setAttribute('aria-hidden', 'true');
      you.setAttribute('pointer-events', 'none');
      ['y1', 'y2', 'y3'].forEach(function (c) {
        var e = document.createElementNS(NS, 'circle');
        e.setAttribute('class', c);
        you.appendChild(e);
      });
      svg.appendChild(you);
    }
    you.style.display = inFrame(p) ? '' : 'none';
    [].forEach.call(you.childNodes, function (c, i) {
      c.setAttribute('cx', p[0].toFixed(1));
      c.setAttribute('cy', p[1].toFixed(1));
      c.setAttribute('r', (r[i] / u).toFixed(2));
      if (i === 1) c.style.strokeWidth = (3 / u).toFixed(2) + 'px';
    });
  }

  function apply() {
    k = Math.max(1, Math.min(MAX, k));
    var vw = W / k, vh = H / k;
    cx = Math.max(vw / 2, Math.min(W - vw / 2, cx));
    cy = Math.max(vh / 2, Math.min(H - vh / 2, cy));
    svg.setAttribute('viewBox', [cx - vw / 2, cy - vh / 2, vw, vh].map(function (v) { return +v.toFixed(2); }).join(' '));
    if (k >= 2) fig.setAttribute('data-k', ''); else fig.removeAttribute('data-k');
    svg.style.touchAction = k > 1 ? 'none' : 'pan-y';
    btn('in').disabled = k >= MAX;
    btn('out').disabled = k <= 1;
    btn('reset').disabled = k <= 1;
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; sizes(); fit(); mark(); scale(); });
  }
  function zoomAt(f, px, py) {
    var k2 = Math.max(1, Math.min(MAX, k * f));
    cx = px - (px - cx) * k / k2;
    cy = py - (py - cy) * k / k2;
    k = k2;
    apply();
  }

  btn('in').addEventListener('click', function () { zoomAt(2, cx, cy); });
  btn('out').addEventListener('click', function () { zoomAt(0.5, cx, cy); });
  btn('reset').addEventListener('click', function () { k = 1; apply(); });

  svg.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var p = toMap(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y);
  }, { passive: false });

  var pts = {}, moved = 0;
  function two() {
    var ids = Object.keys(pts);
    return ids.length === 2 ? [pts[ids[0]], pts[ids[1]]] : null;
  }
  function gap(a) { return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  function mid(a) { return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
  svg.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(pts).length === 1) moved = 0;
  });
  svg.addEventListener('pointermove', function (e) {
    var p = pts[e.pointerId];
    if (!p) return;
    var pair = two();
    if (pair) {
      var d0 = gap(pair), m0 = mid(pair);
      p.x = e.clientX; p.y = e.clientY;
      var d1 = gap(pair), m1 = mid(pair), u = unitPx();
      cx -= (m1.x - m0.x) / u;
      cy -= (m1.y - m0.y) / u;
      var c = toMap(m1.x, m1.y);
      if (d0 > 0) zoomAt(d1 / d0, c.x, c.y); else apply();
      moved += 10;
      e.preventDefault();
      return;
    }
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (k <= 1) return;
    moved += Math.abs(dx) + Math.abs(dy);
    var w = unitPx();
    cx -= dx / w;
    cy -= dy / w;
    apply();
    if (moved > 6 && svg.setPointerCapture && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
  });
  // Two fingers on the map are a pinch of the map, never a scroll or a zoom of
  // the page; one finger on the whole map still scrolls the page.
  function keep(e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }
  svg.addEventListener('touchstart', keep, { passive: false });
  svg.addEventListener('touchmove', keep, { passive: false });
  function up(e) { delete pts[e.pointerId]; }
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('click', function (e) {
    if (moved > 6) { e.preventDefault(); e.stopPropagation(); }
    moved = 0;
  }, true);

  fig.addEventListener('keydown', function (e) {
    var key = e.key, step = 60 / k;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (key === '+' || key === '=') zoomAt(2, cx, cy);
    else if (key === '-' || key === '_') zoomAt(0.5, cx, cy);
    else if (key === '0') { k = 1; apply(); }
    else if (k > 1 && key === 'ArrowLeft') { cx -= step; apply(); }
    else if (k > 1 && key === 'ArrowRight') { cx += step; apply(); }
    else if (k > 1 && key === 'ArrowUp') { cy -= step; apply(); }
    else if (k > 1 && key === 'ArrowDown') { cy += step; apply(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', function () { fit(); mark(); scale(); });

  function miles(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    var h = x * x + Math.cos(a * r) * Math.cos(c * r) * y * y;
    return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function fmt(d) { return d < 10 ? d.toFixed(1) : String(Math.round(d)); }
  function pointOf(el) { var p = el.getAttribute('data-ll').split(','); return [+p[0], +p[1]]; }
  // " · 0.4 mi from you" at the end of box, in its own span, written as text.
  function note(box, cls, text) {
    var s = box.querySelector('.' + cls);
    if (!s) {
      s = document.createElement('span');
      s.className = cls;
      s.setAttribute('data-testid', cls);
      box.appendChild(s);
    }
    s.textContent = ' · ' + text;
  }
  // The landing's map: the distance to each area's centre, in the list under it.
  function areas(lat, lng) {
    var best = null;
    [].forEach.call(fig.querySelectorAll('[data-ll]'), function (el) {
      var p = pointOf(el), d = miles(lat, lng, p[0], p[1]);
      if (!best || d < best.d) best = { d: d, key: 'nearest', name: el.getAttribute('data-name') || '' };
      var row = fig.querySelector('li[data-area="' + el.getAttribute('data-cell') + '"]');
      if (!row) return;
      note(row, 'amap-dist', say('from', fmt(d)));
      row.setAttribute('data-d', d.toFixed(3));
    });
    // Nearest first: the list under the map is put in order of distance. Each
    // row keeps its number (its value), so it still matches its hexagon.
    [].forEach.call(fig.querySelectorAll('ol.amap-legend'), function (ol) {
      [].slice.call(ol.children)
        .filter(function (li) { return li.hasAttribute('data-d'); })
        .sort(function (a, b) { return +a.getAttribute('data-d') - +b.getAttribute('data-d'); })
        .forEach(function (li) { ol.appendChild(li); });
    });
    return best;
  }
  // Zoomed in on one area: the distance to each place's own point (its res-9
  // cell's centre, on its dot), not the area's. Its panel and its events' cards
  // say how far; the cards are put nearest first. An event with no place on the
  // map is measured to the area's centre and says "about".
  function places(lat, lng, zone) {
    var best = null, near = Object.create(null), a = pointOf(zone), far = miles(lat, lng, a[0], a[1]);
    // A dot is a link to its panel (#amap-dot-N); the panel is the section its
    // title (amap-ph-N) heads, its first line says what is there, and its cards
    // are the place's events.
    [].forEach.call(fig.querySelectorAll('a[href^="#amap-dot-"][data-ll]'), function (dot) {
      var p = pointOf(dot), d = miles(lat, lng, p[0], p[1]);
      var n = (dot.getAttribute('href') || '').replace('#amap-dot-', '');
      var title = document.getElementById('amap-ph-' + n);
      var panel = title && title.parentNode;
      var meta = panel && panel.querySelector('p.amap-pm');
      if (meta) note(meta, 'amap-place-dist', say('from', fmt(d)));
      if (panel) [].forEach.call(panel.querySelectorAll('[data-event-id]'), function (c) { near[c.getAttribute('data-event-id')] = d; });
      if (!best || d < best.d) best = { d: d, key: 'near-place', name: title ? title.textContent : n };
    });
    var cards = [].slice.call(document.querySelectorAll('.view-list article.event-card[data-event-id]'));
    cards.forEach(function (c) {
      var id = c.getAttribute('data-event-id'), placed = id in near, d = placed ? near[id] : far;
      var meta = c.querySelector('p.meta');
      if (meta) note(meta, 'amap-card-dist', say(placed ? 'from' : 'from-about', fmt(d)));
      c.setAttribute('data-pd', d.toFixed(3));
    });
    // Nearest first; the same distance keeps the page's order (sort is stable).
    cards.slice()
      .sort(function (x, y) { return +x.getAttribute('data-pd') - +y.getAttribute('data-pd'); })
      .forEach(function (c) { c.parentNode.appendChild(c); });
    return best || { d: far, key: 'nearest', name: zone.getAttribute('data-name') || '' };
  }
  function located(lat, lng) {
    here = [lat, lng];
    var zone = fig.querySelector('.amap-zone[data-ll]');
    var best = zone ? places(lat, lng, zone) : areas(lat, lng);
    mark();
    status.textContent = say(inFrame(proj(lat, lng)) ? 'you' : 'outside') + (best ? ' ' + say(best.key, fmt(best.d), best.name) : '');
  }
  var geo = navigator.geolocation, me = btn('me');
  function find() {
    me.disabled = true;
    status.textContent = say('locating');
    geo.getCurrentPosition(
      function (p) { me.disabled = false; located(p.coords.latitude, p.coords.longitude); },
      function () { me.disabled = false; me.hidden = true; status.textContent = say('off'); },
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 15000 }
    );
  }
  // Read only on the tap, even where location is already allowed (owner,
  // 2026-11-19: "the user need to tap and save purposely by choice"). The
  // permission state only hides a button that could never work.
  if (!geo) me.hidden = true;
  else {
    me.addEventListener('click', find);
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (s) {
        if (s.state === 'denied') me.hidden = true;
      }, function () {});
    }
  }
  apply();
})();`;

/** The script, once per map. The page's `html()` gives it the response's nonce. */
export const PAN_SCRIPT = `<script>${SCRIPT}</script>`;
