/**
 * The landing area's filter tabs and its distance choice (OSE-2156; owner,
 * 2026-11-18: "a responsive tabbed filter design approach ... to condense space",
 * and "search by distance from current location").
 *
 * WITHOUT THIS SCRIPT the page is what it was: every filter group is a fieldset
 * of chips the CSS-only radios drive, and on a phone they fold behind the
 * Filters chip (lib/area-filters-style.ts). The script only turns those groups
 * into tabs: one row of buttons, one group showing at a time. It changes no
 * filter and adds none: the radios still do the filtering, so a chosen chip is
 * the same chip whether its tab is showing or not.
 *
 * TABS (WAI-ARIA tabs pattern): `role=tablist`, `tab`, `tabpanel`,
 * `aria-selected`, `aria-controls`, `aria-labelledby`; a roving tabindex (the
 * selected tab is the one tab stop); Left and Right (mirrored in a right-to-left
 * language), Home and End move and select. A group whose tab is not showing has
 * its radios hidden, because a control whose label is not on screen must not take
 * focus (WCAG 2.4.7) and has no name for a screen reader (4.1.2), as
 * area-filters-style.ts says of the folded groups; a hidden radio keeps its state. A tab whose
 * group holds a chosen value other than the page's default carries a dot, and
 * says so to a screen reader, so a filter set on a tab that is closed is not forgotten.
 *
 * DISTANCE (the "Near me" tab). The choices are chips on radios (name=near): "Any
 * distance" (0) and "Within N mi" for the owner's 2, 5, 10, 25 and 50 (2026-11-19). The page's map already carries each area's centre
 * (`data-ll`, taken from the public res-7 cell id alone, lib/attendee-map.ts), on
 * the pages that draw the street map, and the map's list names each area and links
 * its events, which is how a card finds its area (a card carries no cell and no
 * coordinate). The tab is offered only where those centres
 * are on the page and the browser can give a position. On the person's choice of a
 * distance the phone reads its own position, works out the distance to each
 * area's centre, hides the events (and hexagons) farther than that, lists the rest
 * nearest first and says "about N mi away" on each card. An event with no mapped
 * place has no centre and is left out while a distance is chosen.
 *
 * NEVER WHO, NEVER WHERE (invariants 3 and 4; the owner's ruling of 2026-11-16,
 * "zip finds, tap places"). The position is read by the phone and used by the
 * phone, only after the person chooses a distance: it is never sent, stored,
 * logged or put in the address, and no cell is made from it. This script makes no
 * request of any kind, sets no cookie and writes no storage; the position lives in
 * one variable until the page is closed. The test that pins this reads this
 * source (tests/area-tabs.spec.ts) and drives it in a browser
 * (tests/e2e/2-pages/landing-tabs.component.spec.ts).
 */
const SCRIPT = String.raw`(function () {
  var box = document.querySelector('.area-filters[data-tabs]');
  if (!box) return;
  var near = box.querySelector('[data-tab="near"]');
  var areas = [].slice.call(document.querySelectorAll('g[data-ll][data-cell]'));
  var geo = navigator.geolocation;
  var canNear = !!(near && geo && areas.length);
  var panels = [].slice.call(box.children).filter(function (p) {
    return p.hasAttribute('data-tab') && (p !== near || canNear);
  });
  if (panels.length < 2) return;

  var list = document.createElement('div');
  list.className = 'disc-chips area-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', box.getAttribute('data-tabs') || '');
  list.setAttribute('data-testid', 'area-tabs');
  var on = box.getAttribute('data-tabs-on') || '';
  var cur = 0;
  var tabs = panels.map(function (p) {
    var name = p.getAttribute('data-tab');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'disc-chip';
    b.id = 'tab-' + name;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'tabpanel-' + name);
    b.setAttribute('data-testid', 'tab-' + name);
    b.textContent = p.getAttribute('data-tab-label') || name;
    p.id = 'tabpanel-' + name;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', b.id);
    p.setAttribute('data-testid', 'tabpanel-' + name);
    list.appendChild(b);
    return b;
  });
  box.insertBefore(list, panels[0]);

  function radiosOf(p) {
    return [].slice.call(p.querySelectorAll('label[for]')).map(function (l) {
      return document.getElementById(l.getAttribute('for'));
    }).filter(Boolean);
  }
  function select(i, focus) {
    cur = i;
    tabs.forEach(function (t, j) {
      var open = j === i;
      t.setAttribute('aria-selected', open ? 'true' : 'false');
      t.tabIndex = open ? 0 : -1;
      t.classList.toggle('active', open);
      panels[j].hidden = !open;
      // A radio whose label is not on screen is hidden too: out of the tab order
      // and out of the accessibility tree (it would have no name). It still holds
      // its :checked state, which the filters' rules read.
      radiosOf(panels[j]).forEach(function (r) { r.hidden = !open; });
    });
    if (focus) tabs[i].focus();
  }
  function changed(p) {
    return radiosOf(p).some(function (r) { return r.checked !== r.defaultChecked; });
  }
  function marks() {
    tabs.forEach(function (t, j) {
      var label = panels[j].getAttribute('data-tab-label') || '';
      var flag = changed(panels[j]);
      t.textContent = label;
      t.removeAttribute('data-changed');
      if (!flag) return;
      t.setAttribute('data-changed', '');
      var dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = ' ●';
      var sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = ' (' + on + ')';
      t.appendChild(dot);
      t.appendChild(sr);
    });
  }

  tabs.forEach(function (t, j) { t.addEventListener('click', function () { select(j, false); }); });
  list.addEventListener('keydown', function (e) {
    var i = tabs.indexOf(document.activeElement), n = tabs.length;
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    var rtl = getComputedStyle(list).direction === 'rtl';
    var k = e.key;
    var j = k === (rtl ? 'ArrowLeft' : 'ArrowRight') ? (i + 1) % n
      : k === (rtl ? 'ArrowRight' : 'ArrowLeft') ? (i + n - 1) % n
      : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    select(j, true);
  });

  // ── distance ─────────────────────────────────────────────────────────────
  var chips = canNear ? [].slice.call(near.querySelectorAll('input[name="near"]')) : [];
  function radius() {
    var c = chips.filter(function (r) { return r.checked; })[0];
    return c ? +c.value : 0;
  }
  function lock(on) { chips.forEach(function (r) { r.disabled = on; }); }
  var status = canNear ? near.querySelector('.near-note[role="status"]') : null;
  var here = null;
  function say(key, d) { return (near.getAttribute('data-' + key) || '').replace('%d', d); }
  function miles(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    var h = x * x + Math.cos(a * r) * Math.cos(c * r) * y * y;
    return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function fmt(d) { return d < 10 ? d.toFixed(1) : String(Math.round(d)); }
  var centre = {}, areaOf = {}, cards = [];
  if (canNear) {
    areas.forEach(function (a) {
      var p = a.getAttribute('data-ll').split(',');
      centre[a.getAttribute('data-cell')] = [+p[0], +p[1]];
    });
    // Which area an event is in: the map's list names the area (data-area) and links
    // each of its events, so no card carries a cell (the page holds no cell id below
    // the map's threshold, and none beside the map's own above it).
    [].forEach.call(document.querySelectorAll('li[data-area]'), function (li) {
      [].forEach.call(li.querySelectorAll('a[href]:not(.amap-zoom)'), function (a) {
        var m = /\/events\/([^/?#]+)/.exec(a.getAttribute('href') || '');
        if (m) areaOf[decodeURIComponent(m[1])] = li.getAttribute('data-area');
      });
    });
    cards = [].slice.call(document.querySelectorAll('.view-list article.event-card'));
    cards.forEach(function (c, i) { c.setAttribute('data-i', String(i)); });
  }
  function apply() {
    var r = radius(), live = r > 0 && !!here, dist = {}, shown = 0;
    areas.forEach(function (a) {
      var c = a.getAttribute('data-cell'), p = centre[c];
      dist[c] = live ? miles(here[0], here[1], p[0], p[1]) : 0;
      a.style.display = !live || dist[c] <= r ? '' : 'none';
    });
    [].forEach.call(document.querySelectorAll('li[data-area]'), function (li) {
      var c = li.getAttribute('data-area');
      li.style.display = !live || !(c in dist) || dist[c] <= r ? '' : 'none';
    });
    cards.forEach(function (c) {
      var cell = areaOf[c.getAttribute('data-event-id')], d = live && cell in dist ? dist[cell] : null;
      var ok = !live || (d !== null && d <= r);
      c.style.display = ok ? '' : 'none';
      if (live && ok) shown += 1;
      var meta = c.querySelector('p.meta'), s = meta && meta.querySelector('.near-d');
      if (d !== null && ok) {
        c.setAttribute('data-d', d.toFixed(3));
        if (!s && meta) {
          s = document.createElement('span');
          s.className = 'near-d';
          s.setAttribute('data-testid', 'card-distance');
          meta.appendChild(s);
        }
        if (s) s.textContent = ' · ' + say('away', fmt(d));
      } else {
        c.removeAttribute('data-d');
        if (s) s.remove();
      }
    });
    var order = cards.slice().sort(function (a, b) {
      var x = a.hasAttribute('data-d') ? +a.getAttribute('data-d') : Infinity;
      var y = b.hasAttribute('data-d') ? +b.getAttribute('data-d') : Infinity;
      return x === y ? 0 : x - y; // equal (or both Infinity): keep the page's order (sort is stable)
    });
    order.forEach(function (c) { c.parentNode.appendChild(c); });
    status.textContent = !live ? '' : say(shown ? 'shown' : 'none', String(r));
    marks();
  }
  function locate() {
    lock(true);
    status.textContent = say('locating', '');
    geo.getCurrentPosition(
      function (p) { here = [p.coords.latitude, p.coords.longitude]; lock(false); apply(); },
      function () { lock(false); chips[0].checked = true; apply(); status.textContent = say('off', ''); },
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 15000 }
    );
  }
  if (canNear) {
    chips.forEach(function (r) {
      r.addEventListener('change', function () {
        if (radius() > 0 && !here) locate(); else apply();
      });
    });
  }

  document.addEventListener('change', marks);
  select(0, false);
  marks();
})();`;

/** The script, once per landing area. The page's `html()` gives it the response's nonce. */
export const AREA_TABS_SCRIPT = `<script>${SCRIPT}</script>`;
