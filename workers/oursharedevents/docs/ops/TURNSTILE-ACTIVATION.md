# Turnstile activation runbook (L4 — OSE-1378)

Turnstile ships **dark**: `TURNSTILE_ENABLED = "0"` in every env, and `guardTurnstile`
(`src/lib/turnstile.ts`) is a **no-op** until the flag is exactly `"true"`. This file is
the "flip it on" procedure. **Do it in a separate terminal** (it handles a secret).

> **Hard ordering — do NOT skip.** Slice 2 (the client widget) MUST ship before the flag
> flips, or every mutation 403s. Sequence: **widget → secret + vars → Slice 2 client →
> staging flag on → validate → prod.** Rollback is one flag flip.

## What's built (Slice 1 — server core, this branch)

- `src/lib/turnstile.ts` — `guardTurnstile(request, env, action, bodyToken?)`. Dark → `null`.
  Enabled → canonical siteverify, fail-closed: requires `success` + matching `action` +
  allowlisted `hostname`; missing/oversized token, no secret, no hostnames, network/parse
  error → 403.
- Wired into the five mutation handlers with per-endpoint actions:
  `register`, `checkin` (token via `cf-turnstile-response` **header** — it's bodyless),
  `survey`, `email-signup` (`src/handlers/forms.ts`), and `subscribe` (`src/handlers/pages.ts`).
- `tests/turnstile.spec.ts` — 15 born-red unit tests (node pool). CI: the worker **unit**
  job (node project) — a regression turns it red.

## Still needed to go live (Slice 2 — client + CSP, separate PR)

1. Render the widget on each form surface (`src/handlers/form-pages.ts`, the subscribe form):
   `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer>` +
   `<div class="cf-turnstile" data-sitekey="<SITEKEY>" data-action="<action>">`, and include
   the token in the submit — as the JSON field `cf-turnstile-response` (register/survey/
   email-signup/subscribe) or the `cf-turnstile-response` **header** (check-in).
   Render **only when enabled** (pass `TURNSTILE_SITE_KEY` + enabled flag into the render).
2. CSP: add `https://challenges.cloudflare.com` to **`script-src` and `frame-src`** on the
   two hand-rolled CSP strings — `form-pages.ts:47` and `pages.ts:165` — **only when enabled**
   (the widget renders in an iframe, so `frame-src` is required; default-src 'self' blocks it).
3. Widget lifecycle: tokens are single-use. On a same-page retry, `window.turnstile.reset(id)`.

## Activation steps

1. **Create the widget** (dashboard → Turnstile, or the CF API / `wrangler turnstile widget
create`). Domains: `stg.oursharedevents.com` (staging), `oursharedevents.com` +
   `www.oursharedevents.com` (prod), `localhost`/`127.0.0.1` (dev only). Mode: `managed`.
   Keep the **sitekey** (public) and **secret** (private).
2. **Secret** (separate terminal): `wrangler secret put TURNSTILE_SECRET --env staging`
   (then `--env production`). Never commit it; never paste it in chat.
3. **Vars** in `wrangler.toml` `[env.*.vars]`:
   - `TURNSTILE_SITE_KEY = "<sitekey>"` (non-secret, consumed by the Slice-2 client render).
   - `TURNSTILE_HOSTNAMES = "stg.oursharedevents.com"` (staging) /
     `"oursharedevents.com,www.oursharedevents.com"` (prod). **Never include localhost in prod.**
4. **Ship Slice 2** (client widget + CSP) and deploy it while `TURNSTILE_ENABLED` is still `"0"`.
5. **Flip staging**: set `TURNSTILE_ENABLED = "true"` in `[env.staging.vars]`, deploy.
6. **Validate** (staging): a real form submit with a solved widget → 200; a submit with no /
   tampered token → 403 `TURNSTILE_FAILED`; replay the same token → 403 (single-use). Confirm
   the `hostname`/`action` echoed by siteverify match. Check for `TURNSTILE_EVENT`
   `outcome:"misconfigured"` logs (means secret/hostnames are unset).
7. **Prod**: repeat 5–6 for `[env.production.vars]`.

## Rollback

Set `TURNSTILE_ENABLED = "0"` and deploy — instant no-op. No data impact. The client widget
can stay shipped (it just isn't required by the server when dark), or gate its render on the flag.
