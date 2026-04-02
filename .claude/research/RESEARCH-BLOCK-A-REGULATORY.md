# Research Block A: Regulatory Landscape — Findings

> **Research date**: 2026-04-02
> **Focus states**: OH, IN, KY, PA, IL, MI, WI
> **Status**: COMPILED from web research — spot-check statutes before relying on for compliance

---

## R-01: Charitable Solicitation Registration

**Summary**: All focus states except Indiana require charitable solicitation registration. Thresholds and exemptions vary significantly — Pennsylvania exempts orgs under $25K in contributions, Ohio has no dollar threshold but exempts certain org types. Indiana is a free pass — no registration required at all.

| State | Registration Required | Threshold/Exemptions | Registration Body | Key Statute |
|-------|----------------------|---------------------|-------------------|-------------|
| **Ohio** | Yes | No dollar threshold; exempts schools, certain trusts, orgs soliciting only members/alumni | OH Attorney General, Charitable Law Section | ORC §1716.02 |
| **Indiana** | **No** | Indiana does not require charity registration | N/A | N/A |
| **Kentucky** | Yes | Must register with AG; exemptions for religious orgs, educational institutions | KY Attorney General | KRS 367.650-670 |
| **Pennsylvania** | Yes | Exempt if contributions < **$25,000**/year AND program revenue < $5M; must register within 30 days of exceeding | PA Dept of State (BCO-10 form) | 10 P.S. §162.1 et seq. |
| **Illinois** | Yes | Must register with AG; exemptions for religious orgs, orgs receiving < $15,000 in contributions if no paid solicitors | IL Attorney General | 225 ILCS 460 |
| **Michigan** | Yes | Must register; exemptions for orgs with contributions < $25,000 if using only volunteers | MI Attorney General | MCL 400.271-294 |
| **Wisconsin** | Yes | Must register with DFI; exemptions for orgs with contributions < $25,000 | WI Dept of Financial Institutions | WI Stat. §202.12 |

**Confidence**: High — sourced from Harbor Compliance, state AG websites, IRS guidance
**Platform implication**: ourSharedEvents should surface a "Does your event involve fundraising?" flag during event creation, with state-specific guidance links for charitable registration.

---

## R-02: Raffle/Bingo/Gaming Laws

**Summary**: Raffles are legal for nonprofits in all focus states but restricted to 501(c)(3) or equivalent organizations — **for-profit event organizers cannot run raffles** in any of these states. Bingo requires specific licenses in most states. Indiana has a 5-year organizational existence requirement.

| State | Nonprofit Raffles | License Required | For-Profit Raffles | Bingo | Revenue Caps / Notes |
|-------|------------------|-----------------|-------------------|-------|---------------------|
| **Ohio** | Legal for 501(c)(3) | No license required | **Illegal** | License required from AG | Raffles exempt from gambling statutes for qualifying nonprofits (ORC §2915) |
| **Indiana** | Legal for 501(c) orgs **active 5+ years** | License from IN Gaming Commission if prizes > $2,500 | **Illegal** | License required from IN Gaming Commission | Raffle license: $50/event or annual; $250/day for convention raffles |
| **Kentucky** | Legal for nonprofits | License required | **Illegal** | License required from Dept of Charitable Gaming | Regulated under KRS Chapter 238 |
| **Pennsylvania** | Legal for qualified nonprofits | "Small Games of Chance" license from county treasurer | **Illegal** | Separate bingo license required | Governed by Local Option Small Games of Chance Act (10 P.S. §328) |
| **Illinois** | Legal for nonprofits | License from local municipality | **Illegal** | License required — IL Gaming Board | Raffles & Chance Act (230 ILCS 15) |
| **Michigan** | Legal for nonprofits | License from MI Lottery Bureau | **Illegal** | License required from MI Lottery Bureau | Charitable Gaming Act |
| **Wisconsin** | Legal for nonprofits | License from local municipality or county | **Illegal** | Class A/B license required from local authority | WI Stat. §563 |

**Confidence**: High — sourced from state gaming commissions, legal guides, statute databases
**Platform implication**: The platform should NEVER offer raffle functionality to for-profit organizers. Event creation should gate raffle features behind verified 501(c)(3) status, with state-specific license reminder prompts.

---

## R-03: Liquor Licensing for Tasting Events

**Summary**: All four focus states offer temporary/special event alcohol permits for nonprofits. Costs range from $50 (IN, KY) to $150 (OH). Lead times are 5 days (KY) to 30 days (OH). Pennsylvania has the most structured system through PLCB Special Occasion Permits. No state allows serving alcohol without some form of permit.

| State | Permit Type | Cost | Lead Time | Duration | Who Can Apply | Key Restrictions |
|-------|------------|------|-----------|----------|---------------|-----------------|
| **Ohio** | F-2 Permit | $150 ($160 w/ D-permit holder) | 30 days | Max 4 consecutive days | Nonprofits only (charitable, cultural, fraternal, educational, political) | Max 1 permit per 30 days; must notify chief peace officer; wet territory only |
| **Ohio** | F-12 Permit | Varies | Varies | Up to 90 days | Nonprofits | Beer and wine only |
| **Indiana** | Temporary Beer & Wine Permit | $50/day | Varies | Per-day basis | Any qualifying applicant | Beer and wine only — no hard liquor; on-site consumption only; need catering permit for spirits |
| **Kentucky** | NQ4 + Special Temporary License | $50 (NQ4 base) | 5 working days | Max 10 days (nonprofits w/ NQ4); max 30 days (general) | Nonprofits (NQ4); fairs/expos (general) | Wet territory only; NQ4 is malt beverage only — special temp adds spirits/wine |
| **Pennsylvania** | Special Occasion Permit (PLCB) | ~$30-100 (varies) | 30+ days recommended | Per-event | Nonprofits, established orgs | Regulated by PLCB; must purchase spirits through state stores |

**Confidence**: High — sourced from state liquor control boards, statute references, application forms
**Platform implication**: Event creation for "tasting" or "alcohol-served" events should trigger a state-specific permit checklist with lead time warnings (especially OH and PA at 30 days).

---

## R-04: Youth Sports Coaching Background Checks

**Summary**: Pennsylvania has the strictest requirements (3 clearances mandatory for all youth volunteers). Ohio requires background checks for school-affiliated coaches. Indiana and Kentucky rely more on organizational policies than state mandates for community-level programs. The SafeSport Act technically applies broadly but enforcement focuses on NGB-affiliated organizations.

### State Requirements

| State | Mandatory for Youth Volunteers | Type Required | Key Statute |
|-------|-------------------------------|--------------|-------------|
| **Ohio** | Required for school-affiliated coaches (paid and volunteer) | BCI&I background check + FBI fingerprinting | ORC §3319.39 |
| **Indiana** | Not universally mandated by state for community organizations | Varies by organization policy | HB 1 (2010) applies to schools |
| **Kentucky** | Required for school-related activities | State police check + national sex offender registry | Varies |
| **Pennsylvania** | **Yes — mandatory for ALL volunteers with youth contact** | 3 clearances required: (1) PA State Police criminal check, (2) PA Child Abuse History, (3) FBI fingerprint | PA Child Protective Services Law (Act 153 of 2014) |
| **Illinois** | Required for school-affiliated; recommended for community orgs | State police check; DCFS CANTS check for mandated reporters | 105 ILCS 5/10-21.9 |

### SafeSport Act Applicability

The Protecting Young Victims from Sexual Abuse and Safe Sport Authorization Act of 2017:
- **Primary scope**: National Governing Bodies (NGBs) under the USOC/USOPC umbrella
- **Broader reach**: Extends mandated reporting requirements to organizations participating in **interstate or international** amateur sporting events
- **Community impact**: A local rec volleyball league that ONLY operates locally is not directly covered. However, if teams travel to tournaments across state lines, the Act's mandatory reporting provisions apply.
- **Practical effect**: Most community organizers should implement background checks as best practice regardless of legal mandate, because:
  - Insurance carriers increasingly require them
  - Parent expectations demand them
  - Liability exposure without them is significant

**Confidence**: Medium-High — SafeSport Act scope interpretation varies; PA requirements are definitive
**Platform implication**: Phase 5 youth event creation should require acknowledgment of background check obligations with state-specific requirements. PA events should flag the 3-clearance requirement prominently.

---

## R-05: COPPA Compliance for Youth Event Check-in

**Summary**: COPPA likely applies when a community event platform collects a child's name via digital check-in form, even if the parent fills it out. The key trigger is whether the platform is "directed to children" or has "actual knowledge" of collecting data from children under 13. A QR-code-based check-in form that collects a child's name is collecting "personal information" under COPPA.

### Decision Tree: Does COPPA Apply?

```
Is the check-in form a website/online service?
├── YES (QR code → web form = online service)
│   ├── Is the form "directed to children"?
│   │   ├── YES (e.g., "Youth Soccer Check-in") → COPPA APPLIES
│   │   └── NO (general event form)
│   │       └── Does the operator have "actual knowledge" 
│   │           that user is under 13?
│   │           ├── YES (form asks age/birthdate, or event 
│   │           │   is explicitly for children) → COPPA APPLIES
│   │           └── NO → COPPA does NOT apply
│   └── Is the PARENT filling out the form on behalf of child?
│       └── Still applies — collecting child's name + any PII 
│           about the child triggers COPPA regardless of who 
│           types it in
└── NO (paper form, offline) → COPPA does NOT apply
```

### Minimum Viable COPPA Compliance for a Check-in Form

1. **Privacy policy**: Must be clearly posted, describing what data is collected, how it's used, and disclosure practices
2. **Verifiable parental consent (VPC)**: Must obtain consent BEFORE collecting child's data. Acceptable methods include:
   - "Email plus" method: Email parent, require response confirming consent, then email again after a delay
   - Signed consent form (physical or electronic signature)
   - Credit card verification
   - Knowledge-based authentication
3. **Data minimization**: Only collect what's necessary for the event
4. **Data retention limits**: Delete child's PII when no longer needed
5. **Parental access**: Parents must be able to review and delete their child's information

### Key Nuance: "Parent Fills Out the Form"

Even if the parent is the one physically typing, if the **data being collected is about the child** (child's name, age, etc.), COPPA still applies. The FTC FAQ explicitly states that COPPA covers information collected "about a child" regardless of who provides it.

**Confidence**: High — sourced from FTC COPPA FAQ, legal compliance guides
**Platform implication**: Phase 5 youth events MUST implement a COPPA consent flow. The simplest path: when event is flagged as "youth" in admin, the check-in form automatically adds a parental consent step using the "email plus" method (already fits the existing email form type).

---

## R-06: Ticketed Event Sales Tax

**Summary**: Sales tax on event admission varies significantly. Ohio generally taxes admissions. Kentucky exempts nonprofit admissions (since 2019). Pennsylvania taxes amusement/admission but has nonprofit exemptions. Indiana does NOT tax most admission charges. The "suggested donation" vs "ticket price" distinction matters — truly voluntary donations are generally not taxable, but "suggested" amounts that function as admission fees often ARE.

| State | Admissions Taxable | Rate | Nonprofit Exempt | Key Notes |
|-------|-------------------|------|-----------------|-----------|
| **Ohio** | Yes — most admissions taxable | 5.75% state + local | Limited exemptions; some nonprofit events exempt | ORC §5739.02 — admissions to places of amusement are taxable |
| **Indiana** | **No** — admissions generally NOT taxable | N/A | N/A | Indiana does not impose sales tax on admission charges; some local taxes may apply |
| **Kentucky** | Nonprofit admissions EXEMPT (since March 2019) | 6% (if taxable) | **Yes — full exemption for nonprofits** | For-profit admissions still taxable; school events also exempt |
| **Pennsylvania** | Yes — "amusement tax" applies | 6% state + local amusement taxes (Philadelphia has additional) | Yes — qualifying 501(c)(3) can get sales tax exemption certificate (REV-72) | Nonprofits must apply for exemption; not automatic |

### "Suggested Donation" vs "Ticket Price"

- A **truly voluntary donation** (where admission is free regardless of payment) is generally NOT subject to sales tax
- A **"suggested donation"** that functions as a minimum admission price IS typically treated as taxable admission
- **Key test**: Can someone enter without paying? If yes → donation. If no → admission fee.
- The IRS also cares: if there's a quid pro quo (admission in exchange for payment), the "donation" may not be fully tax-deductible for the donor
- **Best practice**: If charging admission, call it what it is. If truly accepting optional donations, make it clear that admission is free and donations are appreciated but not required.

**Confidence**: High — sourced from state revenue departments, Eventbrite tax guides, legal analyses
**Platform implication**: Phase 3 ticketed events need a sales tax configuration per event. The platform should prompt organizers to identify their state and tax-exempt status, and surface whether their admission charges are likely subject to sales tax.

---

## Sources Index

| ID | Source | URL/Reference |
|----|--------|---------------|
| S-01 | Harbor Compliance — State Charitable Registration | harborcompliance.com |
| S-02 | IRS — Charitable Solicitation State Requirements | irs.gov/charities-non-profits |
| S-03 | Ohio Attorney General — Charitable Gaming | charitable.ohioago.gov |
| S-04 | Indiana Gaming Commission — Raffle Requirements | in.gov/igc |
| S-05 | PA Small Games of Chance Act | 10 P.S. §328 |
| S-06 | Ohio Division of Liquor Control — Temporary Permits | com.ohio.gov |
| S-07 | Indiana ATC — Temporary Beer & Wine Permit | in.gov/atc |
| S-08 | Kentucky ABC — Special Temporary License | abc.ky.gov |
| S-09 | PA PLCB — Special Occasion Permits | pa.gov/agencies/lcb |
| S-10 | PA Act 153 of 2014 — Child Protective Services | keepkidssafe.pa.gov |
| S-11 | SafeSport Act of 2017 | congress.gov |
| S-12 | FTC — COPPA FAQ | ftc.gov/business-guidance |
| S-13 | Ohio Revised Code §5739.02 — Sales Tax | codes.ohio.gov |
| S-14 | Kentucky HB 354 (2019) — Nonprofit Admission Exemption | legislature.ky.gov |
| S-15 | PA REV-72 — Sales Tax Exemption Application | pa.gov/agencies/revenue |
| S-16 | Labyrinth Inc — State Fundraising Compliance Guide | labyrinthinc.com |
| S-17 | Little League — State Background Check Laws | littleleague.org |
| S-18 | Raffles for Less — US Raffle Laws by State | rafflesforless.com |
