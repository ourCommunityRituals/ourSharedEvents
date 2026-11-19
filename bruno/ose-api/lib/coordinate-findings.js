// Where a public event answer could carry a point (OSE-2197).
//
// Owner, 2026-11-19: "It should resolve to the H3." A public event answer says
// where an event is by its cell; it never carries the event's stored point.
// This walks a parsed JSON answer and names every place a coordinate could
// sit, by its JSON path:
//
//   - a key named like a coordinate (lat, lon, lng, latitude, longitude, geo,
//     coords, coordinates, position, latlng, ll, or a name ending or starting
//     with one of the first five, such as venue_lat);
//   - a number with three or more decimal places that could be a latitude or
//     longitude (at most 180 either way), except hall_x and hall_y, which are
//     positions on a hall plan (0109_event_booths.sql), not on the earth;
//   - text holding a coordinate pair ("41.657,-87.681", or %2C between), which
//     is how a maps link carries one.
//
// And `finerCells` names every string that is an H3 cell finer than res 7 (a
// cell id's second hex digit is its resolution: 87… is res 7, 89… is res 9).
//
// The workers-pool helper (workers/oursharedevents/tests/helpers/
// coordinate-findings.ts) applies the same three rules;
// tests/integration/bruno-coordinate-findings.test.js runs both on the same
// answers and proves each rule fails on an injected coordinate.

const COORDINATE_KEY =
  /^(geo|coords?|coordinates|position|latlng|lat_lng|lat_lon|ll)$|(^|_)(lat|lon|lng|latitude|longitude)(_|$)/i;
const NOT_A_PLACE = ['hall_x', 'hall_y'];
const PAIR_IN_TEXT = /-?\d{1,3}\.\d{3,}\s*(,|%2C)\s*-?\d{1,3}\.\d{3,}/i;
const FINER_CELL = /^8[89a-f][0-9a-f]{13}$/;

function decimalPlaces(n) {
  const s = String(n);
  if (s.indexOf('e') !== -1) return Infinity;
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function coordinateFindings(value, path, key) {
  path = path || '$';
  key = key || '';
  const out = [];
  if (key && COORDINATE_KEY.test(key)) out.push(path + ': a coordinate-named field');
  if (typeof value === 'number') {
    if (
      !Number.isInteger(value) &&
      Math.abs(value) <= 180 &&
      decimalPlaces(value) >= 3 &&
      NOT_A_PLACE.indexOf(key) === -1
    ) {
      out.push(path + ': ' + value + ' is coordinate-shaped');
    }
  } else if (typeof value === 'string') {
    if (PAIR_IN_TEXT.test(value)) out.push(path + ': text holds a coordinate pair');
  } else if (Array.isArray(value)) {
    value.forEach(function (v, i) {
      out.push.apply(out, coordinateFindings(v, path + '[' + i + ']'));
    });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (k) {
      out.push.apply(out, coordinateFindings(value[k], path + '.' + k, k));
    });
  }
  return out;
}

function finerCells(value, path) {
  path = path || '$';
  const out = [];
  if (typeof value === 'string') {
    if (FINER_CELL.test(value)) out.push(path + ': ' + value + ' is a cell finer than res 7');
  } else if (Array.isArray(value)) {
    value.forEach(function (v, i) {
      out.push.apply(out, finerCells(v, path + '[' + i + ']'));
    });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (k) {
      out.push.apply(out, finerCells(value[k], path + '.' + k));
    });
  }
  return out;
}

module.exports = { coordinateFindings, finerCells };
