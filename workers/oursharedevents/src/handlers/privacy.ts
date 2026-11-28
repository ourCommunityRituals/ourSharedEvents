/**
 * Privacy policy page handler (BE-10 / GDPR Art. 13).
 *
 * Standard community event privacy policy. The commerce addendum (#phase2)
 * covers paid events. Sections #phase4 (health) and #phase5 (children) state
 * the declined regimes of ADR-018 as refusals: no HIPAA/BAA, no under-13 data,
 * no parental-consent process. Never word them as promises
 * (tests/security-privacy.spec.ts, "ADR-018").
 *
 * Data controller: OurSharedEvents, a service of OurCommunityRituals LLC.
 * Keep the retention lines in step with lib/retention-windows.ts and the
 * cookie lines with lib/anonymous-id.ts.
 */

import { HARDENING_HEADERS } from '../lib/security-headers';
import { CANONICAL_PATH, injectCanonical, type CanonicalEnv } from '../lib/canonical';
import { ANON_COOKIE_NAME } from '../lib/anonymous-id';

const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* Colours are @ocr/ui tokens from /ui.css — the page follows the viewer's theme. */
    body { line-height: 1.65; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; }
    header h1 { font-size: 1.3rem; font-weight: 600; }
    header p { font-size: .85rem; color: var(--text-muted); margin-top: .25rem; }
    main { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem 3rem; }
    h2 { font-size: 1.05rem; font-weight: 700; margin: 2rem 0 .6rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    h2:first-of-type { border-top: none; margin-top: 1rem; }
    p { margin-bottom: .75rem; font-size: .95rem; }
    ul { margin: .5rem 0 .75rem 1.5rem; font-size: .95rem; }
    li { margin-bottom: .35rem; }
    a { color: var(--accent); }
    .back { display: inline-flex; align-items: center; min-height: 44px; margin-bottom: 1rem; font-size: 1rem; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .updated { font-size: .85rem; color: var(--text-muted); margin-top: 2rem; }
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
      Data controller: <strong>OurSharedEvents</strong>, a service of OurCommunityRituals LLC (ourCommunityRituals).<br />
      Contact: <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>
    </p>

    <h2>2. What we collect and why (GDPR Art. 13(1)(c)–(d))</h2>
    <p>We collect only what is needed for the specific form you submit:</p>
    <ul>
      <li><strong>Registration:</strong> your name (required) and email (optional), to register you for the event and deduplicate repeat submissions.</li>
      <li><strong>Check-in:</strong> a count of how many people came. We never store your name for this. We use a random anonymous id (see section 4) so one person is counted once.</li>
      <li><strong>Poster codes:</strong> we count scans of the code itself. A poster scan sets no cookie and keeps nothing about your phone.</li>
      <li><strong>Voting in the room:</strong> your vote, counted with the anonymous id (see section 4) so each person votes once. We never know who voted for what.</li>
      <li><strong>Survey:</strong> numerical ratings and optional free-text comments, to improve future events.</li>
      <li><strong>Email sign-up:</strong> your email address, to notify you about future community events.</li>
      <li><strong>Updates list:</strong> if you join the list on our home page, your email address, to send community updates.</li>
      <li><strong>Sponsors:</strong> a business name and, if the sponsor adds one, a contact email that is shown on the sponsor's card.</li>
      <li><strong>Venue staff and admins:</strong> the email used to sign in, and a record of changes made in the admin. IP addresses in that record are shortened so they do not point to one device.</li>
    </ul>
    <p>Legal basis for all processing: <strong>consent</strong> (GDPR Art. 6(1)(a)), except anonymous counting and staff sign-in, which use <strong>legitimate interest</strong> (GDPR Art. 6(1)(f)) — we have a legitimate interest in knowing how many people attend our community events and in keeping the admin secure.</p>
    <p>Places are stored as a map area (a hexagon cell), never as your own location. We do not store your IP address with anything you submit.</p>

    <h2>3. How long we keep your data (GDPR Art. 13(2)(a))</h2>
    <ul>
      <li><strong>Your name and email on a registration:</strong> removed automatically the day after the event ends. The rest of the registration, with no name or email, is deleted 90 days after you register, or the day after the event if that is later.</li>
      <li><strong>Email sign-ups for an event:</strong> encrypted at rest and automatically deleted after 30 days.</li>
      <li><strong>Updates list:</strong> encrypted at rest and automatically deleted after 90 days.</li>
      <li><strong>Survey comments:</strong> scrubbed of any personal information within 24 hours; aggregate ratings are kept indefinitely.</li>
      <li><strong>Anonymous visit records:</strong> deleted after one year.</li>
      <li><strong>Check-in counts:</strong> anonymous aggregate numbers, kept for event reporting. A count below 5 is never shown.</li>
    </ul>
    <p>Names and emails are encrypted when we store them. Nothing you submit through a form is kept longer than 90 days, except a registration for an event more than 90 days away, which is kept until the day after that event.</p>

    <h2>4. Cookies</h2>
    <ul>
      <li><strong>${ANON_COOKIE_NAME}</strong> — a random anonymous id, set when you open an event form or a room's voting code. It lets us count you once and see that people come back, without knowing who you are. It is not linked to your name or email. It lasts one year. You can delete it at any time in your browser settings.</li>
      <li><strong>Staff sign-in</strong> — venue staff and admins who sign in get a sign-in cookie from Cloudflare Access. Visitors never get it.</li>
    </ul>
    <p>We use no advertising cookies, no analytics or tracking tools, and no third-party scripts that follow you.</p>

    <h2>5. Who we share data with (GDPR Art. 13(1)(e)–(f))</h2>
    <p>We do not sell, rent, or share your personal data with third parties for marketing purposes. We use these service providers:</p>
    <ul>
      <li><strong>Cloudflare, Inc.</strong> — runs the website and stores our data (Cloudflare Workers and D1), signs staff in (Cloudflare Access), and may check that a form is sent by a person (Turnstile). Cloudflare processes data as a sub-processor under their
      <a href="https://www.cloudflare.com/cloudflare-customer-dpa/" target="_blank" rel="noopener">Data Processing Addendum</a>.</li>
      <li><strong>Google LLC</strong> — our server fetches a map picture of the event's place and keeps a backup of event details. Neither includes anything about you. Our pages load nothing from Google, unless you choose a link such as "Add to Google Calendar".</li>
    </ul>
    <p>
      Cloudflare and Google are based in the United States, so your data may be handled there.
      Those transfers are covered by the EU-US Data Privacy Framework and by standard contractual
      clauses approved by the European Commission.
    </p>

    <h2>6. Your rights (GDPR Art. 13(2)(b)–(d))</h2>
    <p>Under GDPR, you have the right to:</p>
    <ul>
      <li><strong>Access</strong> — request a copy of data we hold about you (Art. 15)</li>
      <li><strong>Rectification</strong> — ask us to correct inaccurate data (Art. 16)</li>
      <li><strong>Erasure</strong> — ask us to delete your data ("right to be forgotten") (Art. 17)</li>
      <li><strong>Portability</strong> — receive your data in a structured, machine-readable format (Art. 20)</li>
      <li><strong>Objection</strong> — object to processing based on legitimate interest (Art. 21)</li>
      <li><strong>Withdraw consent</strong> — at any time, without affecting lawfulness of prior processing (Art. 7(3))</li>
    </ul>
    <p>To exercise any of these rights, email <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>. Please tell us the email you used, and which event if you know. We will respond within one month.</p>
    <p>
      Because anonymous counting never stores who you are, we cannot find those records by your name or email.
      Deleting the <strong>${ANON_COOKIE_NAME}</strong> cookie in your browser breaks the link to them.
    </p>

    <h2>7. Right to complain (GDPR Art. 13(2)(d))</h2>
    <p>
      You have the right to lodge a complaint with your local data protection supervisory authority.
      In the EU/EEA, find your authority at
      <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noopener">edpb.europa.eu</a>.
      In the UK, contact the
      <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">ICO</a>.
    </p>

    <h2>8. Automated decision-making (GDPR Art. 13(2)(f))</h2>
    <p>We do not use your data for automated decision-making or profiling.</p>

    <h2 id="phase2" class="phase-anchor">9. Commerce addendum (Phase 2 events)</h2>
    <p>
      For events involving paid tickets or commerce, any payment data is processed exclusively by our
      PCI DSS-compliant payment processor and is never stored by OurSharedEvents. Additional financial
      data handling disclosures will be provided at point of payment.
    </p>

    <h2 id="phase4" class="phase-anchor">10. Health information</h2>
    <p>
      We do not collect health information. We do not sign Business Associate Agreements, and we are
      not set up to hold protected health information. Health-related events can still use
      OurSharedEvents for event details and anonymous counts, but no form asks about anyone's health.
      Please do not put health details in a form or a comment.
    </p>

    <h2 id="phase5" class="phase-anchor">11. Children's privacy</h2>
    <p>
      OurSharedEvents is not directed to children under 13, and we do not knowingly collect personal
      data from them. We do not offer a parental-consent process. Family events can still use
      OurSharedEvents for event details and anonymous counts. You must be 18 or older to register,
      sign up or fill in a survey. If you think a child under 13 has given
      us personal data, email <a href="mailto:privacy@oursharedevents.com">privacy@oursharedevents.com</a>
      and we will delete it.
    </p>

    <p class="updated" data-testid="privacy-updated">Last updated: 2026-11-28</p>
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

export function handlePrivacyPage(request?: Request, env?: CanonicalEnv): Response {
  // /privacy-policy serves this page too; both name /privacy as the canonical.
  const body = injectCanonical(PRIVACY_POLICY_HTML, request, env, CANONICAL_PATH.privacy);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...PRIVACY_SECURITY_HEADERS,
    },
  });
}
