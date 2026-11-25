/**
 * The map's own tooltip: what an area or a place is, with clear space round the
 * pointer or the finger (owner, 2026-11-25: "more user friendly providing space
 * from the mouse pointer", and "what displays when I hover or press and hold on
 * a mobile?").
 *
 * WHY A SCRIPT. Until now each hexagon and each dot named itself with an SVG
 * `<title>`, which the browser shows as its own tooltip: a small box right
 * under the pointer, over the hexagon, that no style can move. A phone never
 * shows it at all: a tap follows the link (or, on a hexagon that is not a
 * link, does nothing) and a press and hold opens the phone's link menu or link
 * preview, with the address, not the area's name and count.
 *
 * WHAT IT DOES. The server still sends the `<title>` (with scripts off, the
 * browser's tooltip is what it was) and, beside it, the same words in
 * `data-tip`. When this runs, each `<title>` becomes its parent's `aria-label`,
 * so a screen reader reads the same name and the browser's tooltip no longer
 * shows; then one tooltip of its own:
 *   - mouse or pen: 16 px below and right of the pointer, following it, flipped
 *     to the other side where it would leave the screen;
 *   - keyboard focus on an area or a place: centred above it, or below where
 *     there is no room;
 *   - touch, press and hold (450 ms, the finger still): centred 64 px above the
 *     finger, so the finger does not cover it, and the link menu does not open;
 *     letting go does not follow the link. A plain tap still opens the area or
 *     the place as before. A tap on a hexagon that is not a link (a small one
 *     on a narrow phone) shows the tooltip, where before it did nothing. On
 *     touch it goes after 4 s, on the next touch or a scroll.
 *   - Escape hides it.
 * Moving the finger, a second finger (a pinch) or the page scrolling cancels a
 * hold, so the map's pinch and drag (lib/map-pan-script.ts) work as before.
 *
 * It keeps hex-map rule 10's other half as the zoom script does: it makes no
 * request, stores nothing, reads no position, and changes only the drawing the
 * server sent plus one box of text that is hidden from screen readers (the
 * words are already the shape's name).
 */
const SCRIPT = String.raw`(function () {
  var figs = [].filter.call(document.querySelectorAll('figure.amap'), function (f) { return f.querySelector('[data-tip]'); });
  if (!figs.length || !document.body || !Element.prototype.closest) return;
  var GAP = 16, LIFT = 64, HOLD = 450, SLOP = 10, LINGER = 4000, EDGE = 8;
  var tip = document.createElement('div');
  tip.className = 'amap-tip';
  tip.setAttribute('data-testid', 'amap-tip');
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.appendChild(tip);
  figs.forEach(function (fig) {
    fig.classList.add('amap-tips');
    [].forEach.call(fig.querySelectorAll('[data-tip] title'), function (t) {
      var p = t.parentNode;
      if (!p.getAttribute('aria-label')) p.setAttribute('aria-label', t.textContent);
      p.removeChild(t);
    });
  });
  var cur = null, timer = 0, press = null, held = false;
  function at(e) {
    var t = e.target;
    return t && t.closest ? t.closest('figure.amap [data-tip]') : null;
  }
  function view() {
    var d = document.documentElement;
    return { w: d.clientWidth || window.innerWidth, h: d.clientHeight || window.innerHeight };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }
  // Beside the pointer: below and right, flipped where it would leave the screen.
  function beside(x, y) {
    var w = tip.offsetWidth, h = tip.offsetHeight, v = view();
    var left = x + GAP, top = y + GAP;
    if (left + w > v.w - EDGE) left = x - GAP - w;
    if (top + h > v.h - EDGE) top = y - GAP - h;
    put(left, top, w, h, v);
  }
  // Centred on x, its bottom 'above' or else its top 'below'.
  function centred(x, above, below) {
    var w = tip.offsetWidth, h = tip.offsetHeight, v = view();
    var top = above - h >= EDGE ? above - h : below;
    put(x - w / 2, top, w, h, v);
  }
  function put(left, top, w, h, v) {
    tip.style.left = clamp(left, EDGE, v.w - EDGE - w) + 'px';
    tip.style.top = clamp(top, EDGE, v.h - EDGE - h) + 'px';
  }
  function open(el) {
    var text = el.getAttribute('data-tip');
    if (!text) return false;
    if (cur !== el) tip.textContent = text;
    cur = el;
    tip.hidden = false;
    clearTimeout(timer);
    return true;
  }
  function hide() {
    clearTimeout(timer);
    tip.hidden = true;
    cur = null;
  }
  function touchShow(el, x, y) {
    if (!open(el)) return;
    centred(x, y - LIFT, y + LIFT);
    timer = setTimeout(hide, LINGER);
  }
  function cancel() {
    if (press) clearTimeout(press.t);
    press = null;
  }

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
      return;
    }
    var el = at(e);
    if (el && open(el)) beside(e.clientX, e.clientY);
    else if (cur) hide();
  });
  document.addEventListener('pointerout', function (e) {
    if (e.pointerType !== 'touch' && !e.relatedTarget && cur) hide();
  });
  document.addEventListener('pointerdown', function (e) {
    held = false;
    if (e.pointerType !== 'touch') return;
    if (press) { cancel(); return; }
    if (cur) hide();
    var el = at(e);
    if (!el) return;
    var x = e.clientX, y = e.clientY;
    press = { el: el, x: x, y: y, t: setTimeout(function () {
      press = null;
      held = true;
      touchShow(el, x, y);
    }, HOLD) };
  }, true);
  document.addEventListener('pointerup', function (e) {
    if (e.pointerType !== 'touch' || !press) return;
    var p = press;
    cancel();
    // A tap on a hexagon that is not a link did nothing before: it names the area.
    if (!p.el.closest('a') && !(e.target.closest && e.target.closest('a'))) touchShow(p.el, p.x, p.y);
  }, true);
  document.addEventListener('pointercancel', cancel, true);
  // Letting go after a hold shows the tooltip, it does not open the link.
  document.addEventListener('click', function (e) {
    if (held) { held = false; e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('contextmenu', function (e) {
    if ((held || press) && at(e)) e.preventDefault();
  }, true);
  document.addEventListener('focusin', function (e) {
    var el = at(e);
    if (!el || !open(el)) return;
    var r = el.getBoundingClientRect();
    centred(r.left + r.width / 2, r.top - EDGE, r.bottom + EDGE);
  });
  document.addEventListener('focusout', function (e) {
    if (cur && at(e) === cur) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && cur) hide();
  });
  window.addEventListener('scroll', function () { cancel(); if (cur) hide(); }, { passive: true });
})();`;

/** The script, once per map. The page's `html()` gives it the response's nonce. */
export const TIP_SCRIPT = `<script>${SCRIPT}</script>`;
