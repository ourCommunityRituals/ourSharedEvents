# Feature Documentation

> What ourSharedEvents **does** — from the end user's perspective.
> For how it's built, see [`docs/architecture/`](../architecture/).

---

## Feature Map by Tier

| Feature | Free | Mid | Enterprise | Doc |
|---------|:----:|:---:|:----------:|-----|
| Event listing (public page) | Y | Y | Y | [EVENTS.md](EVENTS.md) |
| Registration form | Y | Y | Y | [FORMS.md](FORMS.md) |
| Check-in counter | Y | Y | Y | [FORMS.md](FORMS.md) |
| Survey form | - | Y | Y | [FORMS.md](FORMS.md) |
| Email signup form | - | Y | Y | [FORMS.md](FORMS.md) |
| QR code form routing | Y | Y | Y | [QR-ROUTING.md](QR-ROUTING.md) |
| Admin dashboard | Y | Y | Y | [SURFACES.md](SURFACES.md) |
| Self-serve event config | - | Y | Y | [TIERS.md](TIERS.md) |
| Shared analytics report | - | Y | Y | [TIERS.md](TIERS.md) |
| Advanced metrics + PDF export | - | Y | Y | [TIERS.md](TIERS.md) |
| File upload (logos, posters) | - | - | Y | [TIERS.md](TIERS.md) |
| White-label branding | - | - | Y | [TIERS.md](TIERS.md) |
| Custom domain | - | - | Y | [TIERS.md](TIERS.md) |
| Per-event feature overrides | - | - | Y | [TIERS.md](TIERS.md) |
| Portfolio reports | - | - | Y | [TIERS.md](TIERS.md) |
| PII lifecycle (auto-scrub/delete) | Y | Y | Y | [PRIVACY.md](PRIVACY.md) |
| Landing page + email capture | Y | Y | Y | [SURFACES.md](SURFACES.md) |
| Multi-brand isolation | Y | Y | Y | [BRANDS.md](BRANDS.md) |

---

## Document Index

| Document | Audience | Description |
|----------|----------|-------------|
| [FORMS.md](FORMS.md) | End user + Admin | 4-layer form system: register, check-in, survey, email signup |
| [QR-ROUTING.md](QR-ROUTING.md) | End user + Admin | QR code to form routing — how attendees interact |
| [TIERS.md](TIERS.md) | Admin + Sales | 3-tier pricing: Free, Mid, Enterprise feature breakdown |
| [SURFACES.md](SURFACES.md) | End user + Admin | 5 MVP surfaces: what each page does |
| [EVENTS.md](EVENTS.md) | End user + Admin | Event data: creating, viewing, managing events |
| [PRIVACY.md](PRIVACY.md) | Admin + Compliance | PII handling: hashing, encryption, auto-deletion |
| [BRANDS.md](BRANDS.md) | Admin + Sales | Multi-brand isolation and tenant behavior |
| [AUTH.md](AUTH.md) | Admin + DevOps | Authentication: admin access, API keys |
| [ERROR-REFERENCE.md](ERROR-REFERENCE.md) | Support + End user | Every error code and what to do about it |
