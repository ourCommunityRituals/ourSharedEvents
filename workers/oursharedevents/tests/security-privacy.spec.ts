/**
 * PR #126 — Security + Privacy Compliance
 * SEC-2 · BE-9 · BE-10
 *
 * Pyramid coverage:
 *   L1 Static — HTML templates contain required security/privacy markup
 *   L2 Integration — /forms/:id and /privacy routes serve correct headers + content
 *
 * SEC-2: CSP headers on form pages; user-scalable=no removed
 * BE-9:  GDPR Art. 13 compliant notices on all 4 form types;
 *        legal_clearance_tier extensibility; check-in notice present
 * BE-10: /privacy policy link present in all notices; /privacy route returns
 *        full GDPR Art. 13 policy page; /privacy-policy alias works
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { handleFormPage } from '../src/handlers/form-pages';
import { handlePrivacyPage } from '../src/handlers/privacy';

const FORM_TYPES = ['register', 'checkin', 'survey', 'email'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formReq(type: string): Request {
  return new Request(`https://t.test/forms/evt1?type=${type}&event=Test+Event`);
}

async function formHtml(type: string, legalTier?: number): Promise<string> {
  const res = handleFormPage(formReq(type), {}, 'evt1', legalTier);
  return res.text();
}

function formRes(type: string, legalTier?: number): Response {
  return handleFormPage(formReq(type), {}, 'evt1', legalTier);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC-2: Security headers
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-2 L2: CSP headers present on all form page responses', () => {
  for (const type of FORM_TYPES) {
    test(`${type} form has Content-Security-Policy header`, () => {
      const res = formRes(type);
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
    });

    test(`${type} form has X-Content-Type-Options: nosniff`, () => {
      expect(formRes(type).headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    test(`${type} form has X-Frame-Options: DENY`, () => {
      expect(formRes(type).headers.get('X-Frame-Options')).toBe('DENY');
    });

    test(`${type} form has Referrer-Policy: strict-origin-when-cross-origin`, () => {
      expect(formRes(type).headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });
  }
});

describe('SEC-2 L1: user-scalable=no removed from viewport meta on all form types', () => {
  for (const type of FORM_TYPES) {
    test(`${type} form viewport does NOT contain user-scalable=no`, async () => {
      const html = await formHtml(type);
      expect(html).not.toContain('user-scalable=no');
      expect(html).not.toContain('maximum-scale=1.0');
    });

    test(`${type} form has correct viewport meta (width=device-width, initial-scale=1.0)`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('width=device-width, initial-scale=1.0');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BE-9: GDPR Art. 13 compliant privacy notices on all 4 forms
// ─────────────────────────────────────────────────────────────────────────────

describe('BE-9 L1: privacy notice present on all 4 form types (including check-in)', () => {
  for (const type of FORM_TYPES) {
    test(`${type} form contains data-testid="privacy-notice"`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('data-testid="privacy-notice"');
    });

    test(`${type} form privacy notice references GDPR legal basis`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('GDPR Art.');
    });

    test(`${type} form privacy notice mentions data subject rights`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('right to access, correct, or erase');
    });

    test(`${type} form privacy notice mentions supervisory authority`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('supervisory authority');
    });
  }
});

describe('BE-9 L1: form-type-specific notice content', () => {
  test('register form notice mentions consent and name/email retention', async () => {
    const html = await formHtml('register');
    expect(html).toContain('consent');
    expect(html).toContain('deleted when the event ends');
  });

  test('checkin form notice states anonymous-only collection', async () => {
    const html = await formHtml('checkin');
    expect(html).toContain('anonymous count only');
  });

  test('survey form notice mentions 24-hour scrub', async () => {
    const html = await formHtml('survey');
    expect(html).toContain('24');
  });

  test('email form notice mentions 30-day deletion and withdrawal', async () => {
    const html = await formHtml('email');
    expect(html).toContain('30');
    expect(html).toContain('withdraw consent');
  });
});

describe('BE-9 L1: legal_clearance_tier extensibility', () => {
  test('tier 1 (default) does not include commerce addendum', async () => {
    const html = await formHtml('register', 1);
    expect(html).not.toContain('Commerce notice');
    expect(html).not.toContain('PCI');
  });

  test('tier 2 adds PCI DSS commerce addendum', async () => {
    const html = await formHtml('register', 2);
    expect(html).toContain('Commerce notice');
    expect(html).toContain('PCI');
  });

  test('tier 4 adds HIPAA health addendum', async () => {
    const html = await formHtml('register', 4);
    expect(html).toContain('Health notice');
    expect(html).toContain('HIPAA');
  });

  test('tier 5 adds COPPA children addendum', async () => {
    const html = await formHtml('register', 5);
    expect(html).toContain("Children's notice");
    expect(html).toContain('COPPA');
  });

  test('tier 5 includes all lower-tier addenda (cumulative)', async () => {
    const html = await formHtml('register', 5);
    expect(html).toContain('Commerce notice');
    expect(html).toContain('Health notice');
    expect(html).toContain("Children's notice");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BE-10: Privacy policy link in notices + /privacy route
// ─────────────────────────────────────────────────────────────────────────────

describe('BE-10 L1: privacy policy link present in all form notices', () => {
  for (const type of FORM_TYPES) {
    test(`${type} form notice contains <a href="/privacy">`, async () => {
      const html = await formHtml(type);
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('data-testid="privacy-policy-link"');
    });
  }
});

describe('BE-10 L1: /privacy page content (GDPR Art. 13 handler)', () => {
  test('privacy page returns 200', () => {
    expect(handlePrivacyPage().status).toBe(200);
  });

  test('privacy page Content-Type is text/html', () => {
    expect(handlePrivacyPage().headers.get('Content-Type')).toContain('text/html');
  });

  test('privacy page has stricter CSP (script-src none)', () => {
    const csp = handlePrivacyPage().headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('privacy page contains controller identity (Art. 13(1)(a))', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('OurSharedEvents');
    expect(html).toContain('ourCommunityRituals');
  });

  test('privacy page contains legal basis section (Art. 13(1)(c))', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('consent');
    expect(html).toContain('Art. 6(1)(a)');
  });

  test('privacy page lists all data subject rights (Art. 13(2)(b))', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('Access');
    expect(html).toContain('Rectification');
    expect(html).toContain('Erasure');
    expect(html).toContain('Portability');
    expect(html).toContain('Objection');
    expect(html).toContain('Withdraw consent');
  });

  test('privacy page mentions right to complain to supervisory authority (Art. 13(2)(d))', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('supervisory authority');
    expect(html).toContain('edpb.europa.eu');
  });

  test('privacy page has phase-specific anchors (phase2, phase4, phase5)', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('id="phase2"');
    expect(html).toContain('id="phase4"');
    expect(html).toContain('id="phase5"');
  });

  test('privacy page has data-testid attributes for automation', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('data-testid="privacy-header"');
    expect(html).toContain('data-testid="privacy-main"');
    expect(html).toContain('data-testid="privacy-updated"');
  });
});

describe('BE-10 L2: /privacy route via SELF fetch', () => {
  test('GET /privacy returns 200', async () => {
    const res = await SELF.fetch('https://t.test/privacy');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  test('GET /privacy-policy alias returns 200', async () => {
    const res = await SELF.fetch('https://t.test/privacy-policy');
    expect(res.status).toBe(200);
  });

  test('GET /privacy has X-Frame-Options: DENY', async () => {
    const res = await SELF.fetch('https://t.test/privacy');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  test('GET /forms/:id returns CSP header via SELF', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=register&event=Test');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});
