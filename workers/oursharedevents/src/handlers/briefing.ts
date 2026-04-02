/**
 * CEO Briefing page handler.
 *
 * Serves a PIN-protected React briefing app.
 * HTML is embedded as a template string so the Worker is fully self-contained.
 */

const BRIEFING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="OCR Briefing">
<title>ourCommunityRituals — CEO Briefing</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.9/babel.min.js"></script>
<style>
:root{--bg:#0a0f1a;--card:#111827;--card2:#1a2332;--t1:#f0f4f8;--t2:#94a3b8;--t3:#64748b;--blue:#3b82f6;--green:#10b981;--amber:#f59e0b;--red:#ef4444;--purple:#8b5cf6;--border:#1e293b}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;background:var(--bg);color:var(--t1);-webkit-font-smoothing:antialiased;line-height:1.6;overflow-x:hidden}
.pin-s{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;text-align:center}
.pin-s h1{font-size:1.5rem;font-weight:700;margin-bottom:.5rem}
.pin-s p{color:var(--t2);font-size:.9rem;margin-bottom:2rem}
.pin-d{display:flex;gap:12px;margin-bottom:2rem}
.dot{width:14px;height:14px;border-radius:50%;border:2px solid var(--t3);transition:all .2s}
.dot.f{background:var(--blue);border-color:var(--blue)}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:280px}
.pb{width:72px;height:72px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--t1);font-size:1.5rem;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
.pb:active{background:var(--blue);transform:scale(.95)}
.pe{color:var(--red);font-size:.85rem;margin-top:1rem;min-height:1.2rem}
.app{max-width:480px;margin:0 auto;padding-bottom:100px}
.hdr{padding:1rem 1.25rem;position:sticky;top:0;z-index:50;background:rgba(10,15,26,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.hdr h1{font-size:1.1rem;font-weight:700}
.hdr .sub{font-size:.75rem;color:var(--t3);margin-top:2px}
.back{background:none;border:none;color:var(--blue);font-size:.9rem;cursor:pointer;padding:0;margin-bottom:4px}
.sec{padding:1.25rem}
.st{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:.75rem}
.c{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem 1.25rem;margin-bottom:.75rem;cursor:pointer;transition:all .2s}
.c:active{background:var(--card2);transform:scale(.98)}
.ct{font-size:1rem;font-weight:600;margin-bottom:4px}
.cd{font-size:.85rem;color:var(--t2);line-height:1.5}
.tg{display:inline-block;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:3px 8px;border-radius:4px;margin-top:8px}
.tg-b{background:rgba(59,130,246,.15);color:var(--blue)}
.tg-g{background:rgba(16,185,129,.15);color:var(--green)}
.tg-p{background:rgba(139,92,246,.15);color:var(--purple)}
.tg-a{background:rgba(245,158,11,.15);color:var(--amber)}
.tg-r{background:rgba(239,68,68,.15);color:var(--red)}
.dp{padding:1.25rem}
.dp h2{font-size:1.3rem;font-weight:700;margin-bottom:.5rem}
.dp .ld{font-size:1rem;color:var(--t2);margin-bottom:1.5rem;line-height:1.6}
.ds{margin-bottom:1.5rem}
.ds h3{font-size:.85rem;font-weight:600;color:var(--blue);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.03em}
.ds p,.ds li{font-size:.9rem;color:var(--t2);line-height:1.7}
.ds ul{padding-left:1.25rem}
.ds li{margin-bottom:.4rem}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:1rem 0}
.sb{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center}
.sn{font-size:1.5rem;font-weight:800}
.sl{font-size:.7rem;color:var(--t3);margin-top:2px}
.num-row{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}
.num-big{font-size:2rem;font-weight:800}
.num-label{font-size:.85rem;color:var(--t2)}
.divider{height:1px;background:var(--border);margin:1.5rem 0}
.q-prompt{font-size:.8rem;color:var(--blue);font-style:italic;margin-top:1rem;padding:8px 12px;border-left:2px solid var(--blue);background:rgba(59,130,246,.05);border-radius:0 6px 6px 0}
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const {useState}=React;
const PIN="2026";

// === DATA ===

const SECTIONS = [
  {
    id:"opportunity", title:"The Opportunity", tag:"Start Here", tagCls:"tg-g",
    card:"Community events generate data no one is capturing. We capture it without collecting personal information.",
    lead:"Every week, thousands of community events happen across the Midwest — bocce tournaments, block parties, food truck rallies, charity fundraisers. Each one generates a signal: people showed up, at this place, at this time. No one is capturing that signal at scale. We are.",
    blocks:[
      {h:"What We Do", p:"ourCommunityRituals operates a platform called ourSharedEvents that automates community event management — registration, check-in, sponsor placement, analytics. For organizers, it replaces spreadsheets and guesswork. For sponsors, it proves ROI. For us, every event generates anonymous geographic intelligence."},
      {h:"Why Now", p:"Three things converged: cloud infrastructure dropped the cost of running a platform like this to near-zero. AI development tools make a lean team viable. And community organizations — Eagles, Elks, VFW — are desperate for younger membership and modernization, but nobody is building tools for them."},
      {h:"The Insight", p:"We never collect personal data. Not as a policy we can change — it's built into the foundation of the system. It's physically incapable of storing personal information in the data that matters. This means our data can be kept forever (no legal obligation to delete it), shared with government and researchers (no privacy risk), and accumulated over years to produce something no competitor can build: hyperlocal maps of community gathering patterns across the entire Midwest."},
      {q:"Ask Matt: What's the timeline from first event to first NCR intelligence output?"}
    ]
  },
  {
    id:"money", title:"How We Make Money", tag:"Revenue", tagCls:"tg-g",
    card:"Three revenue streams from day one. SaaS subscriptions, court rentals, and sponsor placements.",
    lead:"Revenue starts with physical venue rentals, scales through software subscriptions, and compounds through sponsor attribution. Each stream feeds the others.",
    blocks:[
      {h:"Court Rentals (Immediate Revenue)", p:"We have a bocce court at the Eagles lodge in Beverly. Rental pricing per 2-3 hour block:\n\n• Eagles members: $10\n• ABC members: $20\n• Outside (non-members): $50\n• Premium setup (OSE staff on-site): +$50\n\nThe 5x price gap between outside and Eagles drives membership. Every rental is an event on the platform. Premium setup ensures the display surface and QR codes are active — meaning every rental with setup generates data."},
      {h:"Software Subscriptions (Scaling Revenue)", p:"Three tiers — and the upgrade path is already built and working. This isn't on a roadmap. It's deployed.\n\n• Free — registration + check-in. Captures the long tail of community events. Every Free event still generates anonymous data for the intelligence layer.\n\n• Pro — everything in Free plus surveys, email signup, self-serve event config, advanced analytics, PDF exports. For organizers who run events regularly and want deeper engagement data.\n\n• Enterprise — everything in Pro plus white-label branding, custom domains, file uploads, custom QR codes, portfolio analytics across multiple events. For organizations running events across corridors.\n\nUpgrading or downgrading a customer is instant — one action and all their features reconfigure. No manual work, no waiting. This scales to thousands of customers without adding staff.\n\nThe business model has a deliberate feedback loop: Free gives us headcount data. Pro gives us behavioral signals. Enterprise gives us cross-event patterns. Each tier makes the intelligence layer richer, which makes the platform more valuable, which attracts more customers."},
      {h:"Sponsor Attribution (Compounding Revenue)", p:"Sponsors pay for placement at events — logo on the venue TV, brand on the poster, featured in the analytics report. Every placement has unique attribution tokens. The shared report proves ROI without revealing who attended — just how many, when, and which placements performed best. As the event network grows, sponsor reach grows. As sponsor revenue grows, we can subsidize more events."},
      {q:"Ask Matt: What are the target price points for Mid and Enterprise tiers?"}
    ]
  },
  {
    id:"moat", title:"What Makes Us Unkillable", tag:"Competitive Advantage", tagCls:"tg-p",
    card:"Privacy by architecture, not policy. A dataset that grows forever. A flywheel that accelerates.",
    lead:"Every competitor in community events collects personal data — Eventbrite, Meetup, Splash. They carry retention liability, breach risk, and consent overhead. We don't. That single architectural decision creates three compounding advantages.",
    blocks:[
      {h:"Advantage 1: The Dataset Grows Forever", p:"Because we never collect personal information, there's no retention clock. No GDPR deletion requests. No consent expiration. Anonymous scan data from a bocce tournament in 2026 is still valuable in 2036. Ten years of accumulated community gathering patterns across the Midwest is something money can't buy and competitors can't shortcut."},
      {h:"Advantage 2: Breach-Proof by Design", p:"If our main database is breached, the attacker gets: event schedules and anonymous scan counts. No names, no emails, no phone numbers.\n\nThe small amount of personal data we do handle (event registrations, email signups) lives in a completely separate database with automatic destruction timers. Emails self-delete after 30 days. Registrations after 90. That data is also encrypted and scrambled so even during its short life, it's protected. Two separate databases means a breach of one reveals nothing about the other."},
      {h:"Advantage 3: The Flywheel", p:"More events → more anonymous data → better geographic intelligence → more attractive to sponsors → sponsor revenue funds more events → more data. Each revolution of the flywheel makes every previous revolution's data more valuable. Past events get reinterpreted as new patterns emerge. The system doesn't just grow — it deepens."},
      {h:"Advantage 4: Regulatory Head Start", p:"When we reach health events (Phase 4) and youth events (Phase 5), our anonymous architecture is a HIPAA/COPPA asset. We don't need to retrofit privacy — it's the foundation. Competitors will spend years and millions trying to bolt on compliance that we built in from day one."},
      {q:"Ask Matt: Walk me through the two-database separation and how the destroy jobs work."}
    ]
  },
  {
    id:"rollout", title:"The Rollout", tag:"Timeline", tagCls:"tg-a",
    card:"Five regulatory phases. Phase 1-2 by June. Each phase unlocks new event types and new revenue.",
    lead:"Growth is gated by regulatory readiness, not engineering. We expand methodically — each phase adds a compliance ceiling and unlocks event types that require it. A corridor can be at a different phase than another.",
    blocks:[
      {h:"Phase 1 — MVP Launch (Now)", p:"47 community event types. Recreational sports, dinners, markets, cultural events, networking. No permits required. The 'no special regulation' tier. This is where we prove the model works."},
      {h:"Phase 2 — Commerce Layer (June 1 Target)", p:"Adds ~10 ticketed event types. Concerts, food truck rallies, bar crawls, paid fitness classes. Money changes hands through the platform. Requires payment processing, venue license verification, and state sales tax handling."},
      {h:"Phase 3 — Licensed Activities (Post-June)", p:"Adds ~10 types requiring state licensing. Charity raffles, bingo, political events, cannabis events. This is the messiest phase — 50-state regulatory patchwork. Beverly and Hammond have different raffle laws. Each corridor needs its own legal clearance."},
      {h:"Phase 4 — Health Events (Pre-AJ Demo)", p:"Adds ~11 health-related event types. Health fairs, mental health support groups, recovery meetups. Our anonymous design is an asset here — health privacy law (HIPAA) requires protecting patient information, and we never collected it in the first place. The HELP code (an emergency/health QR code) activates fully in this phase."},
      {h:"Phase 5 — Youth Events (Year 2)", p:"Adds ~12 youth event types. Youth sports, school programs, summer camps. Federal law (COPPA) requires parental consent for any data collection from children under 13. Because our platform collects minimal personal data by design, the compliance burden is far lighter than competitors."},
      {h:"The Two-Axis Model", p:"Two independent gates control access. The subscription tier (Free/Pro/Enterprise) controls which features a customer gets. The regulatory phase controls which event types are available in each geographic corridor. They're independent — a Free customer in a Phase 3 corridor can run a charity raffle. An Enterprise customer in a Phase 1 corridor cannot run a health fair."},
      {q:"Ask Matt: What's the realistic timeline for Phase 3 legal research? Who does that work?"}
    ]
  },
  {
    id:"products", title:"The Product Suite", tag:"Products", tagCls:"tg-b",
    card:"Seven products under ourCommunityRituals. OurPulse is the on-ramp. OurSharedRings is the endgame.",
    lead:"The naming is intentional. Six 'OurShared' products form the infrastructure. OurPulse stands alone as the engagement layer — it's how people discover the ecosystem before they know the ecosystem exists.",
    blocks:[
      {h:"OurPulse — The On-Ramp", p:"This comes first in the user journey. League improvement through artifacts (belt progression systems), community playlists, organizer playbooks. It's what makes someone care about showing up Thursday night.\n\nOurPulse isn't the platform — it's the reason someone walks into the platform. A bocce player wants to track their progression. A league organizer wants a playbook for running a tournament. A community member wants to find their Thursday night crew. OurPulse hooks them. OurSharedEvents catches them.\n\nRole in the ecosystem: Top of funnel. Engagement and retention. The heartbeat that makes the community feel alive.\n\nStatus: Concept — early development."},
      {h:"OurSharedSpaces — The Physical Layer", p:"Recurring community gathering events at physical venues. Every Thursday at Eagles (year-round home base) with RIPH patio in spring/summer when weather allows. Bocce court as the anchor, additional community tables alongside. Instagram announces location weekly.\n\nRole in the ecosystem: Go-to-market engine. Where the first events happen, first scans get recorded, first corridor signals emerge. Proves the model in the physical world.\n\nStatus: Active — first events launching."},
      {h:"OurSharedRecords — The Story Layer", p:"Five minutes. One side of the story. Tell me why.\n\nOurSharedRecords is a community storytelling format built around the vinyl record metaphor. A record has two sides. A story has two sides. Each 'record' is a five-minute personal narrative — one person, one perspective, one reason they're here.\n\nSomeone at Thursday bocce tells their five-minute story: why they started playing, what this community means to them, how they found this place. That becomes an OurSharedRecord — captured, shareable, authentic.\n\nThe format is the brand. It's not a podcast (too long). It's not a social media clip (too disposable). It's a record — something worth keeping. 'Tell me why' is the prompt that starts every one.\n\nRole in the ecosystem: OurSharedRecords IS the content marketing. No corporate messaging needed. Authentic community voice drives engagement back to OurPulse (people see a record and want to be part of it) and OurSharedSpaces (they show up Thursday to be in the next one). The records become the social media presence without ever touching personal data in the platform.\n\nStatus: Concept — launches alongside OurSharedSpaces."},
      {h:"OurSharedTables — The Open Door", p:"A church opens its doors on a Sunday. Come eat until the food is gone. No agenda. No sign-up sheet. Just a table.\n\nThis is the most human product in the ecosystem — and the most complicated. It's a web of partnerships: venues, faith communities, local sponsors, volunteers. A business advisor would say the risk isn't worth it. Run it at cost? Complicated partnerships with no guaranteed margin? Unadvisable.\n\nBut some decisions need a longer game than contracts. OurSharedTables runs as close to cost as possible by design. This isn't a profit center. It's a goodwill engine. If it doesn't work because of social dynamics, so be it. But it sure as hell isn't going to fail because we, as one of the instigating partners, were trying to make a buck on it. The heart and the humanity have to be maintained throughout. The vehicle does its good through that integrity.\n\nThe format is simple: we're here, no agenda, having a meal with whoever wants to come until the food is gone. Who wants to help? Local sponsors get the opportunity to be part of something real and purposeful in their community — not a logo on a banner, but food on a table.\n\nWhy this matters now: As war recurs and the entrenched Arab-American community in Bridgeview has to go through another round of legitimizing themselves to their neighbors, these subtle acts matter. Come sit at my table. You're welcome here. Not a program. Not an initiative. A meal.\n\nWhat the data reveals over time: When someone from Beverly shows up at a Sunday dinner in Bridgeview, that's a person physically crossing a community boundary to sit at a table with their neighbors. Anonymous. Accumulated. If these events increase — if more doors open, more tables get set, more cross-corridor attendance grows — the Southside ring lights up with Sunday dinner signals from Bridgeview to Beverly to Evergreen Park. That's behavioral evidence of community cohesion that no pundit, no politician, no news cycle can refute. The data just says: people are sitting at each other's tables. More this year than last.\n\nThe bigger question: Does Detroit's Dearborn community show the same pattern? Does Minneapolis after everything we all just watched happen? The methodology doesn't predict the answer. It captures whatever the answer actually is.\n\nThis is where the platform stops being a technology company and becomes something worth building."},
      {h:"OurSharedMagnets — The Toolkit", p:"Developer toolkit and configuration management. Setup automation, API testing, knowledge base (documentation as code), mock/demo environment with 1-15 configurable sponsors.\n\nRole in the ecosystem: Keeps everything maintainable and testable. The cost of adding the 50th corridor equals the cost of the 5th. Also the sales demo tool — show a sponsor exactly what their placement looks like.\n\nStatus: Active — building alongside OSE."},
      {h:"OurSharedEvents — The Core Platform", p:"The engine everything runs on. Handles event management for organizers, sponsor placement and attribution, and anonymous data collection. Organizers get an admin panel, a public event page, a venue display for TVs, printed QR codes, and a shared analytics report for sponsors.\n\nThe three subscription tiers (Free/Pro/Enterprise) are already built and working. Upgrading a customer is instant. This is live and targeting June for the commerce layer.\n\nThis is where all the data originates. Every other product in the ecosystem either feeds data into OurSharedEvents or draws intelligence from it."},
      {h:"OurSharedRings — The Intelligence Layer", p:"Research and data analysis platform. Where NCR geographic intelligence gets computed. Expensive analysis isolated from event performance. Produces maps, patterns, and ring emergence insights.\n\nRole in the ecosystem: Where the anonymous dataset becomes actionable intelligence. Government agencies, park districts, urban planners, academic researchers subscribe for insights.\n\nStatus: Concept — Q4 2026."},
      {h:"How They All Connect", p:"OurPulse hooks someone in → OurSharedSpaces gives them a place to go → OurSharedEvents captures the data → OurSharedRecords tells the story → OurSharedTables manages the spaces → OurSharedMagnets keeps it all running → OurSharedRings turns it into intelligence → that intelligence feeds back into OurPulse as better playbooks and community insights.\n\nThe loop closes. Every product feeds every other product."},
      {q:"Ask Matt: What does the OurPulse belt progression system look like? How does a bocce player move from beginner to advanced?"}
    ]
  },
  {
    id:"growth", title:"The Growth Model", tag:"Go-To-Market", tagCls:"tg-g",
    card:"Start at Eagles in Beverly. Scale through fraternal organizations across highway corridors.",
    lead:"We don't cold-call venues. We become members. The technology is invisible to everyone except us. The community just sees a good time.",
    blocks:[
      {h:"The Eagles Strategy", p:"Matt is an Eagles member — bartended at the Charleston, IL lodge before it closed. This isn't an outsider pitching technology. It's a member bringing energy to an institution that needs it.\n\nEagles lodges are aging. Membership declining. Buildings underutilized. But the infrastructure is there — halls, kitchens, bars, patios, parking. They need younger members who respect the culture and bring activity.\n\nThe approach: assimilate, don't take over. New school helps modernize without alienating. The bocce court is the bridge — familiar enough for existing members, appealing enough for new ones."},
      {h:"ourSharedSpaces — Every Thursday", p:"Weekly recurring event. Bocce as the anchor, additional community tables alongside. Eagles is the year-round home base. In spring/summer when weather allows, it moves to RIPH's back patio — announced on Instagram. Eagles covers every gap: rain, heat, RIPH unavailable.\n\nThis is the founding event that seeds the Beverly node. Fixed cadence builds habit. Seasonal rotation between venues generates inter-venue attendance patterns. That's the first corridor signal."},
      {h:"Corridor Expansion", p:"Growth follows highway corridors radiating from Chicago:\n\n• Start: Beverly/EP/Oak Lawn core\n• Wave 1: I-94 (Chicago → Detroit), I-90 (Chicago → Milwaukee)\n• Wave 2: Kalamazoo, Ann Arbor, Rockford, Lafayette\n• Wave 3: Full Midwest ring (Minneapolis, St. Louis, Nashville)\n\n19th ward connections open doors to additional courts and park district spaces in the Beverly/Morgan Park area. Each new venue is another node."},
      {h:"The Fraternal Organization Playbook", p:"This scales to every fraternal org with underutilized space — Elks, Moose, VFW, American Legion. Same playbook: become a member, bring activity, let the platform run quietly. Each lodge becomes a node in the intelligence network.\n\nWhat they see: more members, more bar revenue, more activity.\nWhat we see: data, corridor intelligence, a replicable model."},
      {q:"Ask Matt: How many Eagles lodges are on the I-94 corridor between Chicago and Detroit?"}
    ]
  },
  {
    id:"risks", title:"Risks & What We Need", tag:"Honest Assessment", tagCls:"tg-r",
    card:"What could slow us down, and what the new CEO needs to act on.",
    lead:"We're building something real but we're early. Here's what G needs to know walking in.",
    blocks:[
      {h:"Risk: Infrastructure Blocker", p:"The core databases aren't provisioned yet. The code is written and tested, but there's no production runway. This is the #1 blocker — everything downstream (staging, production launch, Phase 2 commerce) waits on this. It's a weekend's work but it hasn't been done yet."},
      {h:"Risk: Single Developer", p:"Matt is the sole engineer. Platform continuity depends on documentation quality and AI-assisted development (Bloodraven). The documentation is exceptionally thorough, but bus factor is 1."},
      {h:"Risk: Phase 3 Legal Complexity", p:"50-state regulatory variance for licensed activities (raffles, cannabis, political events) is a legal research problem, not an engineering one. Each corridor needs its own legal clearance. This is the slowest phase to expand."},
      {h:"Risk: HIPAA/COPPA Compliance Cost", p:"Phases 4-5 will require legal review, BAA templates, and potentially outside counsel. Costs are deferred to Year 2 but they're real."},
      {h:"What the CEO Needs to Decide", p:"1. Infrastructure provisioning — when and who does it?\n2. Phase 2 commerce target — is June 1 realistic given current state?\n3. Legal counsel for Phase 3 — engage now or defer?\n4. First hire priorities — another engineer? Operations? Sales?\n5. Eagles lodge partnership formalization — verbal agreement to formal terms?"},
      {q:"Ask Matt: What's your honest assessment of the June 1 target? What would make you more confident?"}
    ]
  },
  {
    id:"ip", title:"The IP Portfolio", tag:"Protection", tagCls:"tg-p",
    card:"10 protectable innovations spanning patents, trademarks, and trade secrets.",
    lead:"The platform generates intellectual property at multiple layers. Several innovations are novel enough for patent protection.",
    blocks:[
      {h:"Patent Candidates", list:[
        "Anonymous ID Architecture — 7-layer schema-enforced anonymity model",
        "NCR Methodology — ring emergence model for hyperlocal geographic intelligence",
        "Two-Database PII Firewall — architecturally separated databases with automated destruction"
      ]},
      {h:"Trademarks", list:[
        "ourCommunityRituals — parent organization",
        "OurPulse — community engagement on-ramp",
        "OurSharedSpaces — physical venue events",
        "OurSharedRecords — community storytelling",
        "OurSharedTables — space management",
        "OurSharedMagnets — developer toolkit",
        "OurSharedEvents — core event platform",
        "OurSharedRings — research intelligence",
        "UEC (Universal Event Codes) — color-semantic QR standard"
      ]},
      {h:"Trade Secrets", list:[
        "Signal classification system — distinguishing passive awareness from active participation",
        "Ring classification model — how we determine which communities form interconnected clusters",
        "Offline resilience system — keeps events running even when the internet doesn't"
      ]},
      {q:"Ask Matt: Have any provisional patents been filed? What's the timeline for trademark registration?"}
    ]
  },
  {
    id:"ncr-deep", title:"Deep Dive: NCR Intelligence", tag:"Vision", tagCls:"tg-b",
    card:"The long-term play. How anonymous event data becomes hyperlocal economic intelligence.",
    lead:"NCR (Neighborhood Community Rituals) is the methodology for turning years of anonymous scan data into geographic intelligence that government agencies, researchers, and urban planners need but can't produce themselves.",
    blocks:[
      {h:"The Three Phases", p:"Phase 1 (Now): Individual events generate per-event metrics. '42 people checked in tonight.'\n\nPhase 2 (Next): Cross-event aggregation. 'Thursdays at this venue draw 3x more than Tuesdays. This sponsor performs best at evening events.'\n\nPhase 3 (Horizon): Geo-spatial intelligence. 'This 4-block radius has the highest engagement density on the south side. Community gathering patterns in the Beverly corridor have strengthened 40% year-over-year.'"},
      {h:"Ring Emergence", p:"Communities form interconnected 'rings' — clusters of neighborhoods where event attendance flows between them. Beverly ↔ Evergreen Park ↔ Oak Lawn isn't three separate markets. It's one ring.\n\nDiscovering these rings requires enough accumulated data to see patterns emerge naturally. We don't predict the rings — we let the data reveal them. That's not a gap in the plan. That's scientific discipline."},
      {h:"Who Pays for This", p:"Government agencies (park districts, city planning). Academic researchers (Northwestern, UChicago). Local business associations. Public health organizations (once we reach health events).\n\nBecause the dataset contains no personal information, there are no legal barriers to sharing it with researchers or government. That's what makes this commercially viable — universities can publish on it, cities can plan with it, and none of it requires consent management."},
      {h:"The Endgame", p:"At saturation, the platform stops being an event company that also does research. It becomes the shared instrument all institutions use to understand the communities they serve.\n\nA dataset of anonymous community gathering patterns, accumulated over years, covering the entire Midwest, that never expires. Applied through a geographic methodology that works the same way whether you're looking at three neighborhoods or three states. That's the long-term asset."},
      {q:"Ask Matt: When does the dataset reach the density threshold for first NCR output? What does the academic partnership look like?"}
    ]
  },
  {
    id:"wkrp", title:"OurWKRP — The Music Company", tag:"Separate Entity", tagCls:"tg-a",
    card:"A music + culture media company. Separate from ourCommunityRituals. Built by us, for us, from the room we're already in.",
    lead:"OurWKRP is not part of the ourCommunityRituals platform infrastructure. It doesn't use the anonymous ID architecture. It doesn't need to. It's a standalone music and culture media company built on something no technology can replicate: five people with no blind spots across every genre, era, and live show war story in the room.",
    blocks:[
      {h:"The Starting Five", p:"P — the omnivore. Knows every new release across every genre. Staggering breadth. Walks into any conversation already having done the reading.\n\nG — rock and punk historian. Can place any band in its lineage without blinking. The depth is almost equally staggering.\n\nJS — the niche specialist. Ska, Oi, Madness adjacents. Goes so deep into a lane that everyone else leans in because they didn't know that world existed like that.\n\nMatt — the connector. Backpacker, electronic, DJ, global, indie, metal. Looking for the groove. The thread between everything everyone else brings.\n\nM — the root system. Blues and jazz. The reminder that everything everyone else said came from somewhere. His band, the Juke Shakers, is the live anchor."},
      {h:"The Format: OurRecordStories", p:"Five minutes. One side of the record. Tell me why.\n\nThat's it. One person, one record, five minutes to tell the room why it matters. Long enough to be real. Short enough that anyone can do it. The format democratizes storytelling without cheapening it.\n\nThe constraint is everything. It's not a podcast (too long). It's not a social media clip (too disposable). It's a record — something worth keeping. 'Tell me why' is the prompt that starts every one."},
      {h:"The Formula", p:"People with records.\nPeople with stories.\nA room willing to host.\nSponsors willing to support.\n\nEvery single word does work. Nothing extra. That's the operating model in four lines."},
      {h:"RIPH — The Launch Venue", p:"Rock Island Public House in Blue Island. Every night is music. Friday is DJ night. This isn't a venue we're pitching — it's where the whole thing started. The bocce community, the music crew, the stories. RIPH is already the room.\n\nThe Juke Shakers play here. The crew gathers here. The first OurRecordStories episodes get recorded here. Then Kennedy King College as the institutional bridge. Then Reckless Records as the scene co-sign."},
      {h:"The Spotify Catalog", p:"Between the five of us, our partners, and our kids, we have years of curated playlists spanning every genre, every era, every mood. Not algorithmic — human. Each playlist is an editorial decision someone made about what matters.\n\nWe're mining that catalog for audio features — emotional tone, energy, rhythm, acoustics — to map the crew's collective taste fingerprint. That becomes the curatorial foundation for everything OurWKRP produces."},
      {h:"Why It's Separate (But Connected)", p:"OurWKRP collects personal data. Names, stories, faces, voices. That's the whole point — it's a media company about people and their relationship to music. The anonymous ID architecture that protects ourCommunityRituals would cripple OurWKRP.\n\nThey share a crew, a mission, and a corridor. But they have different rules because they have different jobs. OCR protects privacy. OurWKRP celebrates identity. Both are needed.\n\nHere's where they connect: when Reckless Records wants to run OurRecordStories, they do it through ourSharedEvents on a white-label site. Their brand, their look, their lipstick — running on our structured bones through our flywheel. Every OurRecordStories episode at Reckless generates event data through the anonymous OSE infrastructure. Reckless gets a cultural program that drives foot traffic. We get corridor data from a node with scene credibility.\n\nThat's the enterprise play for any venue or cultural institution: run your own branded version of OurRecordStories. Your room, your community, your name on it. We handle the infrastructure. You get the analytics. The flywheel turns.\n\nKennedy King does the same. RIPH does the same. Every venue becomes a white-label OurRecordStories node running on OSE. The media company creates the format. The platform distributes it at scale."},
      {h:"What G Is Walking Into", p:"G isn't just the new CEO of ourCommunityRituals. G is one of the starting five. The rock and punk historian with staggering knowledge who just got promoted at his day job and is about to take the helm of both companies.\n\nThis briefing is the handoff. Everything Matt has been building — the platform, the methodology, the architecture, the music company — now has a CEO who was in the room the whole time."},
      {q:"Ask Matt: What's the timeline for the first OurRecordStories recording at RIPH? What does the Reckless Records conversation look like?"}
    ]
  }
];

// === COMPONENTS ===

function Pin({onUnlock}){
  const[pin,setPin]=useState("");
  const[err,setErr]=useState("");
  const hit=d=>{if(pin.length>=4)return;const n=pin+d;setPin(n);setErr("");if(n.length===4){if(n===PIN)onUnlock();else setTimeout(()=>{setPin("");setErr("Incorrect PIN")},300)}};
  return(
    <div className="pin-s">
      <h1>ourCommunityRituals</h1>
      <p>CEO Briefing — Confidential</p>
      <div className="pin-d">{[0,1,2,3].map(i=><div key={i} className={\`dot \${i<pin.length?'f':''}\`}/>)}</div>
      <div className="pad">
        {[1,2,3,4,5,6,7,8,9].map(d=><button key={d} className="pb" onClick={()=>hit(String(d))}>{d}</button>)}
        <div/>
        <button className="pb" onClick={()=>hit("0")}>0</button>
        <button className="pb" style={{fontSize:'1rem'}} onClick={()=>{setPin(p=>p.slice(0,-1));setErr("")}}>←</button>
      </div>
      <div className="pe">{err}</div>
    </div>
  );
}

function Home({go}){
  return(
    <div className="app">
      <div className="hdr">
        <h1>ourCommunityRituals</h1>
        <div className="sub">CEO Briefing — April 2026</div>
      </div>
      <div className="sec">
        <div className="sg">
          <div className="sb"><div className="sn" style={{color:'var(--green)'}}>7</div><div className="sl">Products</div></div>
          <div className="sb"><div className="sn" style={{color:'var(--blue)'}}>~90</div><div className="sl">Event Types at Scale</div></div>
          <div className="sb"><div className="sn" style={{color:'var(--purple)'}}>10</div><div className="sl">IP Innovations</div></div>
          <div className="sb"><div className="sn" style={{color:'var(--amber)'}}>5</div><div className="sl">Regulatory Phases</div></div>
        </div>
      </div>
      {SECTIONS.map(s=>(
        <div key={s.id} className="sec" style={{paddingTop:0}}>
          <div className="c" onClick={()=>go(s.id)}>
            <div className="ct">{s.title}</div>
            <div className="cd">{s.card}</div>
            <span className={\`tg \${s.tagCls}\`}>{s.tag}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Detail({section,goBack}){
  const s=SECTIONS.find(x=>x.id===section);
  if(!s)return null;
  return(
    <div className="app">
      <div className="hdr">
        <button className="back" onClick={goBack}>← Back</button>
        <h1>{s.title}</h1>
        <div className="sub"><span className={\`tg \${s.tagCls}\`}>{s.tag}</span></div>
      </div>
      <div className="dp">
        <div className="ld">{s.lead}</div>
        {s.blocks.map((b,i)=>{
          if(b.q) return <div key={i} className="q-prompt">{b.q}</div>;
          return(
            <div key={i} className="ds">
              <h3>{b.h}</h3>
              {b.p && b.p.split('\\n\\n').map((para,j)=><p key={j} style={{marginBottom:'.75rem'}}>{para}</p>)}
              {b.list && <ul>{b.list.map((li,j)=><li key={j}>{li}</li>)}</ul>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App(){
  const[u,setU]=useState(false);
  const[v,setV]=useState(null);
  if(!u)return <Pin onUnlock={()=>setU(true)}/>;
  if(v)return <Detail section={v} goBack={()=>setV(null)}/>;
  return <Home go={setV}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
</script>
</body>
</html>`;

export function handleBriefingPage(): Response {
  return new Response(BRIEFING_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
