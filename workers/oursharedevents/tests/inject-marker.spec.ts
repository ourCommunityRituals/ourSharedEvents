import { describe, expect, test } from 'vitest';
import { injectDiscoveryFilters, EVENT_FILTERS_MARKER } from '../src/lib/event-discovery';
import { injectEventList, EVENT_LIST_MARKER } from '../src/lib/event-list';
import { injectLandingArea, LANDING_AREA_MARKER } from '../src/lib/landing-area';

// H1 (CCR-PR567): marker injection must treat the injected value as a LITERAL
// string, not a String.prototype.replace replacement pattern. `$&`, `$\``, `$'`,
// `$$`, `$n` are active inside a *string* replacement, and escapeHtml does not
// touch `$`/backtick — so a value carrying a `$` (an escaped user query
// `/events?q=$\``, an event name "$5 Bocce", a sponsor name) would splice the
// trusted surrounding markup into the output. These assert the literal contract
// that closes that class.
describe('marker injection is literal ($-splice guard)', () => {
  test('injectDiscoveryFilters inserts a $-bearing bar verbatim, not as a replace pattern', () => {
    const html = `BEFORE${EVENT_FILTERS_MARKER}AFTER`;
    // A rendered filter bar carrying the escaped user query ?q=$`$&$$ .
    const bar = 'value="$`$&$$"';
    expect(injectDiscoveryFilters(html, bar)).toBe('BEFOREvalue="$`$&$$"AFTER');
  });

  test('injectEventList inserts $-bearing list markup verbatim (e.g. an event named "$5 Bocce")', () => {
    const html = `X${EVENT_LIST_MARKER}Y`;
    const list = { html: '<h3>$`$& Bocce</h3>', countText: '1 event' };
    expect(injectEventList(html, list as never)).toBe('X<h3>$`$& Bocce</h3>Y');
  });

  test('injectLandingArea inserts $-bearing area markup verbatim', () => {
    const html = `L${LANDING_AREA_MARKER}R`;
    const area = { html: '<section>$`$& deals</section>' };
    expect(injectLandingArea(html, area as never)).toBe('L<section>$`$& deals</section>R');
  });
});
