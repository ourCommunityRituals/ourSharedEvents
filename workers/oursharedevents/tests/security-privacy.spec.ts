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
  const res = await handleFormPage(formReq(type), {}, 'evt1', legalTier);
  return res.text();
}

async function formRes(type: string, legalTier?: number): Promise<Response> {
  return handleFormPage(formReq(type), {}, 'evt1', legalTier);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC-2: Security headers
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-2 L2: CSP headers present on all form page responses', () => {
  for (const type of FORM_TYPES) {
    // OSE-R-007 (2026-05-15): formRes is now async because handleFormPage
    // does a D1 lookup for the canonical event title. Tests await.
    test(`${type} form has Content-Security-Policy header`, async () => {
      const res = await formRes(type);
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
    });

    test(`${type} form has X-Content-Type-Options: nosniff`, async () => {
      expect((await formRes(type)).headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    test(`${type} form has X-Frame-Options: DENY`, async () => {
      expect((await formRes(type)).headers.get('X-Frame-Options')).toBe('DENY');
    });

    test(`${type} form has Referrer-Policy: strict-origin-when-cross-origin`, async () => {
      expect((await formRes(type)).headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin'
      );
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
  // Owner 2026-10-11: the email is optional and is only for reaching the
  // person about this event; name and email are cleared the day after it.
  test('register form notice mentions consent and name/email retention', async () => {
    const html = await formHtml('register');
    expect(html).toContain('consent');
    expect(html).toContain('cleared the day after the event');
    expect(html).not.toContain('deleted when the event ends');
  });

  test('the updates form says what it sends in one short line', async () => {
    const html = await formHtml('email');
    expect(html).toContain(
      '<p class="form-intro">One email when something\'s coming up. Never shared.</p>'
    );
  });

  test('register form says what the optional email is for, in one line', async () => {
    const html = await formHtml('register');
    expect(html).toContain('<label for="email">Email (optional)</label>');
    expect(html).toContain('data-testid="register-email-note">Only to tell you if plans change.<');
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

  // ADR-018: tiers 4 (HIPAA) and 5 (COPPA) are declined regimes, so no
  // health or children's notice is ever added, even if a tier reaches the page.
  test('tier 4 adds no health notice (HIPAA is declined, ADR-018)', async () => {
    const html = await formHtml('register', 4);
    expect(html).not.toContain('Health notice');
    expect(html).not.toContain('HIPAA');
  });

  test('tier 5 adds no children notice (COPPA is declined, ADR-018)', async () => {
    const html = await formHtml('register', 5);
    expect(html).not.toContain("Children's notice");
    expect(html).not.toContain('COPPA');
  });

  test('tier 5 keeps only the commerce notice', async () => {
    const html = await formHtml('register', 5);
    expect(html).toContain('Commerce notice');
    expect(html).not.toContain('Health notice');
    expect(html).not.toContain("Children's notice");
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

// ADR-018: HIPAA, COPPA and SOPPA are declined regimes. No public text may
// promise their safeguards (a BAA, HIPAA handling, verifiable parental consent),
// because OSE refuses those regimes by construction.
const DECLINED_REGIME_PROMISES: RegExp[] = [
  /HIPAA safeguards/i,
  /under HIPAA/i,
  /Business Associate Agreement[^.]*applies/i,
  /protected under HIPAA/i,
  /with verifiable parental consent|without verifiable parental consent/i,
  /we comply with COPPA/i,
  /submit this form \(COPPA\)/i,
];

describe('ADR-018: public privacy text states the declined regimes, never promises them', () => {
  test('privacy page makes no HIPAA, BAA or COPPA-consent promise', async () => {
    const html = await handlePrivacyPage().text();
    for (const re of DECLINED_REGIME_PROMISES) expect(html).not.toMatch(re);
  });

  test('privacy page says plainly that health data and BAAs are refused', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('We do not collect health information');
    expect(html).toContain('We do not sign Business Associate Agreements');
  });

  test('privacy page says plainly that it is not for children under 13', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('not directed to children under 13');
    expect(html).toContain('We do not offer a parental-consent process');
  });

  for (const type of FORM_TYPES) {
    for (const tier of [1, 2, 3, 4, 5]) {
      test(`${type} form notice at tier ${tier} makes no HIPAA, BAA or COPPA promise`, async () => {
        const html = await formHtml(type, tier);
        for (const re of DECLINED_REGIME_PROMISES) expect(html).not.toMatch(re);
      });
    }
  }
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
