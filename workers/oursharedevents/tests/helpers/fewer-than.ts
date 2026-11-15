/**
 * Give a test window (or `globalThis`, for a fragment run with `new Function`)
 * the page's `oseFewerThan`, from the one source (`src/lib/withheld-words.ts`).
 *
 * A test that runs one script cut out of `admin.html` or `shared-report.html`
 * does not run the block that defines the helper, so it installs it here. The
 * copy each template carries is held to the same source by
 * `withheld-count-words.spec.ts`.
 */
import { WITHHELD_WORDS_CLIENT_JS } from '../../src/lib/withheld-words';

export function installFewerThan(target: object): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', WITHHELD_WORDS_CLIENT_JS)(target);
}
