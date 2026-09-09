/**
 * Privacy policy page handler (BE-10 / GDPR Art. 13).
 *
 * Phase 1 baseline — standard community event privacy policy.
 * Phase 2+ addenda (PCI DSS, HIPAA, COPPA) are anchored sections
 * that can be linked via ?phase=N query param for phase-specific notices.
 *
 * Data controller: OurSharedEvents (ourCommunityRituals)
 */

import { HARDENING_HEADERS } from '../lib/security-headers';

const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; line-height: 1.65; }
    header { background: #1a1a2e; color: #fff; padding: 1.25rem 2rem; }
    header h1 { font-size: 1.3rem; font-weight: 600; }
    header p { font-size: .85rem; opacity: .7; margin-top: .25rem; }
    main { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem 3rem; }
    h2 { font-size: 1.05rem; font-weight: 700; color: #1a1a2e; margin: 2rem 0 .6rem; padding-top: 1rem; border-top: 1px solid #dee2e6; }
    h2:first-of-type { border-top: none; margin-top: 1rem; }
    p { margin-bottom: .75rem; font-size: .95rem; }
    ul { margin: .5rem 0 .75rem 1.5rem; font-size: .95rem; }
    li { margin-bottom: .35rem; }
    a { color: #4361ee; }
    .back { display: inline-block; margin-bottom: 1.5rem; font-size: .9rem; color: #4361ee; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .updated { font-size: .8rem; color: #868e96; margin-top: 2rem; }
    .phase-anchor { scroll-margin-top: 1rem; }
  </style>
</head>
<body>
  <header data-testid="privacy-header">
    <h1>OurSharedEvents</h1>
    <p>Privacy Policy</p>
  </header>
  <main data-testid="privacy-main">
    <a href="javascript:history.back()" class="back" data-testid="privacy-back">&larr; Back</a>

    <h2>1. Who we are (GDPR Art. 13(1)(a))</h2>
    <p>
      Data controller: <strong>OurSharedEvents</strong>, operated by ourCommunityRituals.<br />
      Contact: <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>
    </p>

    <h2>2. What we collect and why (GDPR Art. 13(1)(c)–(d))</h2>
    <p>We collect only what is needed for the specific form you submit:</p>
    <ul>
      <li><strong>Registration:</strong> your name (required) and email (optional), to register you for the event and deduplicate repeat submissions.</li>
      <li><strong>Check-in:</strong> an anonymous attendance count only — no personal data is stored.</li>
      <li><strong>Survey:</strong> numerical ratings and optional free-text comments, to improve future events.</li>
      <li><strong>Email sign-up:</strong> your email address, to notify you about future community events.</li>
    </ul>
    <p>Legal basis for all processing: <strong>consent</strong> (GDPR Art. 6(1)(a)), except check-in which uses <strong>legitimate interest</strong> (GDPR Art. 6(1)(f)) — we have a legitimate interest in knowing how many people attend our community events.</p>

    <h2>3. How long we keep your data (GDPR Art. 13(2)(a))</h2>
    <ul>
      <li><strong>Registration data:</strong> deleted automatically when the event ends.</li>
      <li><strong>Email addresses:</strong> encrypted at rest and automatically deleted after 30 days.</li>
      <li><strong>Survey comments:</strong> scrubbed of any personal information within 24 hours; aggregate ratings are kept indefinitely.</li>
      <li><strong>Check-in counts:</strong> anonymous aggregate numbers, kept for event reporting.</li>
    </ul>

    <h2>4. Who we share data with (GDPR Art. 13(1)(e))</h2>
    <p>
      We do not sell, rent, or share your personal data with third parties for marketing purposes.
      Data is stored in <strong>Cloudflare D1</strong> (Cloudflare, Inc.), a serverless SQL database.
      Cloudflare processes data as a sub-processor under their
      <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Data Processing Addendum</a>.
    </p>

    <h2>5. Your rights (GDPR Art. 13(2)(b)–(d))</h2>
    <p>Under GDPR, you have the right to:</p>
    <ul>
      <li><strong>Access</strong> — request a copy of data we hold about you (Art. 15)</li>
      <li><strong>Rectification</strong> — ask us to correct inaccurate data (Art. 16)</li>
      <li><strong>Erasure</strong> — ask us to delete your data ("right to be forgotten") (Art. 17)</li>
      <li><strong>Portability</strong> — receive your data in a structured, machine-readable format (Art. 20)</li>
      <li><strong>Objection</strong> — object to processing based on legitimate interest (Art. 21)</li>
      <li><strong>Withdraw consent</strong> — at any time, without affecting lawfulness of prior processing (Art. 7(3))</li>
    </ul>
    <p>To exercise any of these rights, email <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>. We will respond within 30 days.</p>

    <h2>6. Right to complain (GDPR Art. 13(2)(d))</h2>
    <p>
      You have the right to lodge a complaint with your local data protection supervisory authority.
      In the EU/EEA, find your authority at
      <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noopener">edpb.europa.eu</a>.
      In the UK, contact the
      <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">ICO</a>.
    </p>

    <h2>7. Automated decision-making (GDPR Art. 13(2)(f))</h2>
    <p>We do not use your data for automated decision-making or profiling.</p>

    <h2 id="phase2" class="phase-anchor">8. Commerce addendum (Phase 2 events)</h2>
    <p>
      For events involving paid tickets or commerce, any payment data is processed exclusively by our
      PCI DSS-compliant payment processor and is never stored by OurSharedEvents. Additional financial
      data handling disclosures will be provided at point of payment.
    </p>

    <h2 id="phase4" class="phase-anchor">9. Health information addendum (Phase 4 events)</h2>
    <p>
      For health-related events where a Business Associate Agreement (BAA) applies, health information
      is handled under HIPAA safeguards. Additional disclosures will be provided at the point of
      health data collection.
    </p>

    <h2 id="phase5" class="phase-anchor">10. Children's privacy addendum (Phase 5 events)</h2>
    <p>
      For events open to children under 13, we comply with COPPA. A parent or guardian must
      submit any form on behalf of a child. We do not knowingly collect personal data from
      children under 13 without verifiable parental consent. To request deletion of a child's data,
      email <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>.
    </p>

    <p class="updated" data-testid="privacy-updated">Last updated: 2026-04-23 &mdash; Phase 1 baseline</p>
  </main>
</body>
</html>`;

// Security headers — same policy as form pages (SEC-2)
const PRIVACY_SECURITY_HEADERS: Record<string, string> = {
  ...HARDENING_HEADERS,
  'Content-Security-Policy':
    "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function handlePrivacyPage(): Response {
  return new Response(PRIVACY_POLICY_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...PRIVACY_SECURITY_HEADERS,
    },
  });
}
