# QR Code Form Routing (`/forms/` links only)

> **Scope note (2026-09-30).** This page covers only the **`/forms/` link**: the
> URL that opens a form page (register, check-in, survey, email signup). For how
> QR codes and short links work, read
> **[QR-AND-SHORTLINKS.md](QR-AND-SHORTLINKS.md)**. That page covers `/q/` scan
> tracking, `/s/` short-link routing, poster codes and placements, resolution,
> time buckets, the K=5 floor, and who sees what.
>
> An earlier version of this page presented `/forms/` routing as "the" QR
> system. It is not: printed poster codes today are `/s/` short links, and a
> placement code is a `/q/` scan link. Both are covered in the new doc.
>
> Paths below are relative to `workers/oursharedevents/`. Verified against
> `src/handlers/form-pages.ts` and `src/router.ts` at `edb9406`.

---

## `/forms/` link routing

### URL

```
/forms/{eventId}?type={formType}[&deployment={posterDeploymentId}]
```

| Parameter    | Values                                                                  | Default    | Notes                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`       | `register`, `checkin`, `survey`, `email-signup` (`email` also accepted) | `register` | An unknown value renders the registration form                                                                                                                                                                |
| `deployment` | a `poster_deployments.id`                                               | none       | Carried into the form as a hidden `deploymentId` and written to `form_registrations.source_placement_id` (OSE-627)                                                                                            |
| `event`      | **ignored**                                                             | —          | Since OSE-R-007 the page title comes from the event row in D1, never from the URL. An unknown event id falls back to the label "Event". The old `?event=` examples on this page were removed for that reason. |

### How a visitor reaches a form

- **Anonymous check-in poster code.** A `/s/<code>` of kind `checkin` redirects
  to `/forms/<id>?type=checkin`, built server-side from the event id alone
  (`internalTarget` in `src/lib/poster-codes.ts`).
- **Event page CTA.** A `/q/` placement scan lands on
  `/events/<id>?type=<form>&deployment=<pd_id>`, and the page's CTA continues to
  the form while keeping the `deployment` attribution (`qrScanTarget` in
  `src/handlers/qr-scan.ts`).
- **Direct form links.** The generic poster bundle (`src/handlers/poster-bundle.ts`,
  `formUrl`) emits `/forms/<id>?type=<form>` for all four types, with no scan
  recorded. The `/poster` page does not render these; it renders `/s/` codes.

### Flow

```
GET /forms/:eventId?type=...
  │
  ├─ Event exists but is not publicly renderable (archived / draft / ready)
  │     → 302 to the /events listing (OSE-291 "a poster must never rot")
  │
  └─ Otherwise → mobile-first HTML form page (nonce CSP)
        │
        ▼
     fetch() POST /api/v2/events/:id/forms/:type   (success shown inline, no reload)
        ├─ event not active                → 410 EVENT_NOT_ACTIVE
        ├─ flag forms.<type> off           → 403 FORM_DISABLED
        └─ survey / email-signup on an event below
           Phase 2, or on a missing event  → 403 PHASE_REQUIRED (fail-closed, OSE-1270)
```

- **Feature flags.** Gating uses the `forms.<type>` flag through
  `isFeatureEnabled` (`src/router.ts`). The per-tier presets live in
  `@ocr/flags` (`SHARED_TIER_PRESETS`, consumed by `src/lib/feature-flags.ts`).
  See [TIERS.md](TIERS.md) and [FORMS.md](FORMS.md). The per-tier ON/OFF matrix
  that used to be here was not re-verified and has been removed.
- **Privacy.** Form submissions go to `FORMS_DB`, never `DB`
  ([ADR-001](../adr/ADR-001-anonymous-identity-architecture.md)). Check-in
  records a count only. See [PRIVACY.md](PRIVACY.md).

### Test IDs

Every interactive element carries a `data-testid` (`src/handlers/form-pages.ts`):

| Element                  | Test ID                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Form container           | `form-register`, `form-checkin`, `form-survey`, `form-email`                                             |
| Error message            | `form-error`                                                                                             |
| Success state            | `form-success`                                                                                           |
| Header / event name      | `form-header`, `form-event-name`                                                                         |
| Poster attribution field | `form-deployment-id`                                                                                     |
| Registration             | `register-name-input`, `register-email-input`, `register-submit`                                         |
| Check-in                 | `checkin-submit`, `checkin-walk-in-submit`, `checkin-count`                                              |
| Survey                   | `survey-rating-overall`, `survey-rating-1` … `survey-rating-5`, `survey-comments-input`, `survey-submit` |
| Email signup             | `email-email-input`, `email-submit`                                                                      |
| Privacy notice           | `privacy-notice`, `privacy-summary`, `privacy-details`                                                   |
