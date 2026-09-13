/**
 * Admin front-door: the path-chooser and the full dashboard are mutually
 * exclusive — never stacked (chooser on top, dashboard below).
 *
 * On load the page is `.chooser-active`, which hides everything in
 * #main-content except the chooser itself. Choosing a path reveals the right
 * view: startSponsor / chooseAdvanced drop `chooser-active` (show the
 * dashboard), the wizard shows via its own `wizard-active` scoping, and
 * returning to a selected event (post-wizard reload) also reveals the dashboard.
 */
import { describe, test, expect } from 'vitest';
import { handleAdminPage } from '../src/handlers/pages';

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}

describe('admin front door is mutually exclusive with the dashboard', () => {
  test('the page loads in the chooser-active (front-door) state', async () => {
    expect(await adminHtml()).toMatch(/<body[^>]*class="[^"]*chooser-active/);
  });

  test('chooser-active hides the dashboard (everything in main but the chooser)', async () => {
    const html = await adminHtml();
    expect(html).toMatch(
      /body\.chooser-active #main-content > \*:not\(#admin-path-chooser\)[^{]*\{\s*display:\s*none/
    );
  });

  test('choosing "the full dashboard" reveals it (drops chooser-active)', async () => {
    const html = await adminHtml();
    expect(html).toMatch(
      /function chooseAdvanced\(\)[\s\S]{0,200}classList\.remove\('chooser-active'\)/
    );
  });

  test('choosing "create a sponsor" reveals the dashboard (drops chooser-active)', async () => {
    const html = await adminHtml();
    expect(html).toMatch(
      /function startSponsor\(\)[\s\S]{0,400}classList\.remove\('chooser-active'\)/
    );
  });

  test('returning to a selected event (post-wizard reload) reveals the dashboard', async () => {
    const html = await adminHtml();
    expect(html).toMatch(/savedRow && saved[\s\S]{0,400}classList\.remove\('chooser-active'\)/);
  });
});
