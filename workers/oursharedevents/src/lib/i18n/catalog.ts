/**
 * The string catalog for the public pages (OSE-1760).
 *
 * Every visible string that used to be an inline `lang === 'es' ? ... : ...`
 * lives here, keyed once. A render function asks `msg(lang, key)` and never
 * decides a language itself. English is the source of truth: its keys define
 * `MessageKey`, and every other language is typed against that set, so a key
 * missing from Spanish is a compile error, not a silent English string.
 *
 * Adding a language: add its tag to `LANGUAGES`, add a catalog below. A language
 * that is not finished may declare fewer keys; the lookup then falls back to
 * English for that key only.
 *
 * Organizer-entered text (titles, descriptions, venues) is never in here: it
 * shows as typed. Legal and civic text is translated by a person and reviewed;
 * a machine draft may start it and never ships alone.
 *
 * Polish and Arabic live in their own files (`catalog-pl.ts`, `catalog-ar.ts`),
 * typed against `MessageKey` the same way. Both are machine drafts awaiting a
 * native read (OSE-1968).
 */
import { ar } from './catalog-ar';
import { pl } from './catalog-pl';
import { zh_hans } from './catalog-zh-hans';
import { zh_hant } from './catalog-zh-hant';
import { hi } from './catalog-hi';
import { pt } from './catalog-pt';
import { bn } from './catalog-bn';
import { ru } from './catalog-ru';
import { ja } from './catalog-ja';
import { fr } from './catalog-fr';
import { de } from './catalog-de';
import { ur } from './catalog-ur';
import { id } from './catalog-id';
import { ko } from './catalog-ko';
import { vi } from './catalog-vi';
import { tr } from './catalog-tr';
import { it } from './catalog-it';
import { tl } from './catalog-tl';
import { uk } from './catalog-uk';
import { fa } from './catalog-fa';
import { DEFAULT_LANG, INTL_LOCALE, LANGUAGES, type Lang } from './languages';

const en = {
  'share.label': 'Share this event',
  'share.copied': 'Link copied!',
  'calendar.label': 'Add to calendar',
  'calendar.ics': 'Apple or Outlook',
  'calendar.subscribe': 'Subscribe to calendar',
  'calendar.subscribe.apple': 'Apple Calendar',
  'calendar.subscribe.ics': 'Calendar address (.ics)',
  // OSE-1998: the event page's link to a fair's stall list. No count.
  'stalls.see': 'See the stalls',
  'directions.pre': 'Get directions',
  'directions.live': 'Navigate now',
  'video.watch': '▶ Watch the video',
  'back.label': 'Back',
  'language.label': 'Language',
  // The phone header's menu button (lib/i18n/language-menu.ts).
  'menu.label': 'Menu',
  'choices.heading': 'How would you like to take part?',
  'choices.registerNote': 'Asks for your name and email.',
  'choices.checkinLabel': 'Count me in, anon',
  'choices.checkinNote': 'Counted, never named.',
  'what.donation': 'Donate →',
  'what.league': 'View the league →',
  'what.workshop': 'Register →',
  'what.substack': 'Subscribe →',
  'what.tickets': 'Get tickets →',
  'what.menu': 'Menu & reservations →',
  'what.website': 'Visit the site →',
  // The event page, all three phases. A `{name}` is filled by `fmt`; the value
  // put there is escaped by the caller.
  'page.skip': 'Skip to event content',
  'nav.site': 'Site',
  'nav.allEvents': '&larr; All events',
  'nav.eventPage': 'Event page',
  'nav.poster': 'Poster',
  'event.type': 'Type: {type}',
  'event.hostedBy': 'Hosted by {host}',
  'live.badge': 'Live now',
  'live.badgeLabel': 'Event is live now',
  'sponsors.supportedBy': 'Supported by',
  'sponsors.label': 'Event sponsors',
  'sponsors.thanks': 'Thanks to our sponsors',
  'section.what': 'What',
  'section.where': 'Where',
  'section.who': 'Who',
  'section.howMuch': 'How much',
  'section.why': 'Why',
  'section.how': 'How',
  'who.photoOf': 'Photo of {host}',
  'who.host': 'Host',
  'map.alt': 'Map of {venue}',
  'cta.register': 'Register',
  'cta.checkin': 'Check in at this event',
  'cta.survey': 'Share feedback',
  'cta.emailSignup': 'Get event updates',
  'price.free': 'Free',
  'price.sliding': 'Sliding scale',
  'price.donation': 'Pay what you can',
  'price.varies': 'Varies',
  // OSE-2012: how people take part (lib/attendance-mode.ts).
  'mode.in_person': 'In person',
  'mode.online': 'Online',
  'mode.both': 'Online and in person',
  'countdown.now': 'Starting now',
  'countdown.today': 'Starts today',
  'countdown.tomorrow': 'Starts tomorrow',
  'countdown.in': 'Starts in ',
  'countdown.minute': ' minute',
  'countdown.minutes': ' minutes',
  'countdown.hour': ' hour',
  'countdown.hours': ' hours',
  'countdown.days': ' days',
  'next.atVenue': 'Next at {venue}',
  'next.thisVenue': 'this venue',
  'next.fallbackHeading': 'The corridor keeps going',
  'next.fallbackNote': 'More gatherings are always coming together nearby.',
  'next.browse': "See what's coming up",
  'recap.title': 'recap',
  'recap.titleCalledOff': 'no longer taking place',
  'recap.chip': "This one's a wrap",
  'recap.chipCalledOff': 'Not happening',
  'recap.happened': 'Happened {when}',
  'recap.ended': 'This event has ended.',
  'recap.calledOffWhen': 'No longer taking place. It was planned for {when}',
  'recap.calledOff': 'No longer taking place.',
  'recap.whatHeading': 'What this was',
  'recap.empty': "The host hasn't written this one up yet. The numbers below are the story.",
  'recap.emptyCalledOff': "The host didn't write this one up.",
  'stats.heading': 'By the numbers',
  'stats.registered': 'Registered',
  'stats.checkedIn': 'Checked in',
  'stats.walkedIn': 'Walked in',
  'stats.surveys': 'Surveys submitted',
  'stats.emailSignups': 'Email signups',
  'stats.fewerThan': 'Fewer than {floor} {label}',
  'stats.walkInShare': '{pct}% of check-ins were walk-ins',
  'stats.showedUpShare': '{pct}% of those registered showed up',
  'connect.heading': 'Hear about the next one',
  'connect.note': "One email when something's coming up. Nothing else.",
  'connect.cta': 'Keep me posted',
  // The never-who disclosure on the event page (lib/never-who.ts). Spacing is
  // part of the page's bytes; keep it as it is.
  'neverWho.line': 'Never who, only how many.',
  'neverWho.trigger': 'How this works',
  'neverWho.event': `<p>
      You're part of the group, anonymously. OurSharedEvents tracks when
      groups gather &mdash; never who you are. Event hosts and sponsors see
      corridors and venues, not people. The link you followed counted as a
      single click; nothing about your device, location, or identity was
      collected to display this page.
    </p>`,
  // The band on every staging page (lib/test-site-notice.ts), in the page's language.
  'testSite.headline': 'Testing purposes only.',
  'testSite.listings':
    'Events, venues and businesses here are drawn from public listings for testing; nothing here is an endorsement or an offer.',

  // ── /events and the landing (OSE-1762) ──────────────────────────────────────
  // The never-who paragraph on each. `{events}` is the address of /events in the
  // page's language. Spacing is part of the page's bytes; keep it as it is.
  'neverWho.landing': `<p>
          Attendance is measured <strong>without gathering who you are</strong>, by default. We
          count that people came — where and when — never who they are. This page sets no cookies and
          runs no analytics. If you choose &ldquo;Use my location&rdquo;, it uses only your zip
          area, never your exact spot.
        </p>
        <p>
          Choosing to be named is a feature, not the norm &mdash; nothing names you unless you pick
          it. <a href="{events}" data-testid="privacy-more">See what&#x2019;s happening &rarr;</a>
        </p>`,
  'neverWho.events': `<p>
          You're part of the group, anonymously. OurSharedEvents tracks when
          groups gather &mdash; never who you are. Event hosts and sponsors see
          corridors and venues, not people. Nothing about your device, location,
          or identity was collected to display this page.
        </p>`,
  // The page shells (templates/public.html, templates/landing.html).
  'page.skipContent': 'Skip to content',
  'list.title': 'Upcoming events | OurSharedEvents',
  'list.mainLabel': 'Upcoming community events',
  'list.sponsorsRegion': 'Sponsors',
  'landing.title': "OurSharedEvents — what's happening near you",
  'landing.description':
    'Find events in your town or near your zip code. Attendance is counted without gathering who you are.',
  'landing.homeLabel': 'OurSharedEvents home',
  'landing.navLabel': 'Primary',
  'landing.events': 'Events',
  'landing.map': 'Map',
  'landing.lead': 'What&#x2019;s happening near you?',
  'landing.whereLabel': 'Where are you?',
  'landing.nearMe': 'Use my location',
  'landing.nearNote': 'We use only your zip area, never your exact spot.',
  'landing.locationOff': 'Location is off. Type your town or zip below.',
  'landing.finding': 'Finding your zip…',
  'landing.doorsLabel': 'For organizers',
  'landing.doorEvent': 'Sign in to create an event',
  'landing.doorSponsor': 'Sign in to add a sponsor',
  'landing.whySignIn': 'Why sign in?',
  'landing.signInNote': `Organizer tools are private and by invitation. Cloudflare Access emails you a one-time
            code, so OurSharedEvents never sees or stores a password. Attendees never sign in, and
            nothing here names them.`,
  // The footer's links (lib/legal-footer.ts).
  'footer.browse': 'Browse Events',
  'footer.privacy': 'Privacy',
  // OSE-1986: the page a reader gets when the landing or the event list is
  // refused by the per-caller limit (handlers/pages.ts, pageLimitResponse).
  'limit.status': 'Please wait',
  'limit.title': 'Too many visits at once',
  'limit.body':
    'This connection has opened this page many times in the last minute. Please wait a minute, then try again.',
  'limit.again': 'Try again',
  // OSE-2164: the dead-end pages (handlers/pages.ts, event-code.ts, shortlink-resolve.ts).
  // `err.notFound.body` is EVENT_NOT_OPEN_COPY: one message for a missing, draft, ready
  // or taken-down event, so a probe cannot tell them apart. `{title}` and `{n}` are slots.
  'err.status': 'Error {n}',
  'err.cta.browse': 'Browse upcoming events',
  'err.notFound.title': "We couldn't find that event",
  'err.notFound.body':
    "This event isn't open to the public. It may not be published yet, or it may have been taken down. See what's coming up next.",
  'err.unavailable.title': "We're having trouble loading this event",
  'err.unavailable.body':
    'Our event service is briefly unavailable. Try again in a minute, or browse what else is coming up.',
  'err.ended.title': '{title} has ended',
  'err.ended.next': 'Here is what is on next at this venue.',
  'err.ended.soon': 'See what is coming up next.',
  'err.code.title': "That code didn't match an event",
  'err.code.body': 'Check the six characters you were given and type them again.',
  'err.codeLimit.title': 'Too many codes tried',
  'err.codeLimit.body': 'Wait a minute, then type the code again.',
  'err.codeDown.title': "We're having trouble opening this event",
  'err.codeDown.body': 'Try again in a minute.',
  'err.link.title': "That link doesn't open an event",
  'err.link.body':
    'It may have been typed wrong, or the event may have been taken down. See what is on near you.',
  'err.link.cta': 'See events near you',
  'err.linkLimit.title': 'Too many links tried',
  'err.linkLimit.body': 'Wait a minute, then open the link again.',
  'err.linkDown.title': "We're having trouble opening this link",
  'err.linkDown.body': 'Try again in a minute.',
  // The /events filter bar, heading, count and empty states (lib/event-discovery.ts).
  // One set per `when` window. `{n}` is a number; `One` is the form for exactly one.
  'when.all.chip': 'Everything',
  'when.all.heading': 'Upcoming events',
  'when.all.empty': 'Nothing scheduled right now. Check back soon.',
  'when.all.count': '{n} events',
  'when.all.countOne': '{n} event',
  'when.today.chip': 'Today',
  'when.today.heading': 'Today',
  'when.today.empty': 'Nothing on today.',
  'when.today.count': '{n} events today',
  'when.today.countOne': '{n} event today',
  'when.weekend.chip': 'This weekend',
  'when.weekend.heading': 'This weekend',
  'when.weekend.empty': 'Nothing this weekend yet.',
  'when.weekend.count': '{n} events this weekend',
  'when.weekend.countOne': '{n} event this weekend',
  'when.week.chip': 'Next 7 days',
  'when.week.heading': 'In the next 7 days',
  'when.week.empty': 'Nothing in the next 7 days yet.',
  'when.week.count': '{n} events in the next 7 days',
  'when.week.countOne': '{n} event in the next 7 days',
  'when.month.chip': 'This month',
  'when.month.heading': 'This month',
  'when.month.empty': 'Nothing this month yet.',
  'when.month.count': '{n} events this month',
  'when.month.countOne': '{n} event this month',
  'when.next-month.chip': 'Next month',
  'when.next-month.heading': 'Next month',
  'when.next-month.empty': 'Nothing next month yet.',
  'when.next-month.count': '{n} events next month',
  'when.next-month.countOne': '{n} event next month',
  'when.next-90.chip': 'Next 90 days',
  'when.next-90.heading': 'In the next 90 days',
  'when.next-90.empty': 'Nothing in the next 90 days yet.',
  'when.next-90.count': '{n} events in the next 90 days',
  'when.next-90.countOne': '{n} event in the next 90 days',
  'when.past.chip': 'Recently wrapped',
  'when.past.heading': 'Recently wrapped',
  'when.past.empty': 'Nothing has wrapped recently.',
  'when.past.count': '{n} events recently wrapped',
  'when.past.countOne': '{n} event recently wrapped',
  'disc.try.weekend': 'Try this weekend',
  'disc.try.week': 'Try the next 7 days',
  'disc.try.month': 'Try this month',
  'disc.try.next-90': 'Try the next 90 days',
  'disc.try.all': 'See everything',
  'disc.headingPlace': 'Events in {place}',
  'disc.headingQuery': 'Matches for “{q}”',
  'disc.placeCount': '{n} events in {place}',
  'disc.placeCountOne': '{n} event in {place}',
  'disc.queryCount': '{n} matches for “{q}”',
  'disc.queryCountOne': '{n} match for “{q}”',
  'disc.upcoming': '{n} upcoming events',
  'disc.upcomingOne': '{n} upcoming event',
  'disc.withWrapped': '{base}, {n} wrapped',
  'disc.withWrappedOne': '{base}, {n} wrapped',
  'disc.searchLabel': 'Search events by name, venue, town or zip',
  'disc.searchPlaceholder': 'Search by name, venue, town or zip',
  'disc.search': 'Search',
  'disc.when': 'When',
  'disc.clear': 'Clear',
  'disc.emptyPlace': 'Nothing in {place} yet.',
  'disc.seeAll': 'See all events',
  'disc.emptyQuery': 'Nothing matches &ldquo;{q}&rdquo;. Try a shorter word, or {link}.',
  'disc.clearSearch': 'clear the search',
  // The event card and the list around it (lib/event-list.ts).
  'list.none': 'No events scheduled.',
  'list.error': 'Could not load events. Please try again.',
  'list.noneUpcoming': 'Nothing coming up yet.',
  'list.wrappedHeading': 'Wrapped',
  'card.untitled': 'Untitled event',
  'card.recap': 'See how it went',
  'card.recapLabel': 'See how it went: {name}',
  'card.registerLabel': 'Register for {name}',
  'card.wrapped': 'Wrapped',
  'card.open': 'Open {name} public page',
  'card.supportedBy': 'Supported by {sponsor}',
  // The landing's area: its empty state and filters (lib/landing-area.ts).
  'area.emptyHeading': 'Nothing on the map yet.',
  'area.emptyNote': 'Be the first &mdash; start a gathering and it shows up here.',
  'area.create': 'Create an event &rarr;',
  'area.otherType': 'Other',
  'area.type': 'Type',
  'area.allTypes': 'All types',
  // The icon slider (lib/category-slider.ts, OSE-2207).
  'area.kinds': 'Kinds of events',
  'slider.prev': 'Show earlier choices',
  'slider.next': 'Show more choices',
  'area.where': 'Where',
  'area.all': 'All',
  'area.online': 'Online',
  'area.inPerson': 'In person',
  'area.timeOfDay': 'Time of day',
  'area.anyTime': 'Any time',
  'area.beforeDark': 'Home before dark',
  'area.view': 'View',
  'area.list': 'List',
  'area.map': 'Map',
  'area.filters': 'Filters',
  // The filter tabs and the distance choice (OSE-2156; lib/area-tabs-script.ts).
  'area.tabs': 'Filter events',
  'area.tabsOn': 'filter on',
  'area.near': 'Near me',
  'area.nearLabel': 'Distance from where you are, in miles',
  'area.nearAny': 'Any distance',
  'area.nearWithin': 'Within {d} mi',
  'area.nearPrivacy': 'Your location is used on this device only. It is never sent or stored.',
  'area.nearLocating': 'Finding your location...',
  'area.nearOff': 'Location is off, so distance cannot be used.',
  'area.nearShown':
    'Showing events within {d} mi, nearest first. Events with no place on the map are left out.',
  'area.nearNone': 'No events with a place on the map within {d} mi. Try a wider distance.',
  'area.nearAway': 'about {d} mi away',
  'area.more': 'Click for more',
  'area.moreShown': 'Showing {n} of {total} events.',
  // The neighborhood map (lib/attendee-map.ts).
  'map.near': 'near {venue}',
  'map.exampleLabel':
    'Example map: three neighborhoods drawn as numbered hexagons, the busiest shaded deepest',
  'map.listedBelow': '{note} &mdash; every event is listed below.',
  'map.seeList': 'See the list of events',
  'map.exampleCaption':
    '<strong>Example.</strong> This is what the map looks like once neighborhoods fill in: one numbered hexagon each, a few square kilometres, never a street address.',
  'map.corridorNote':
    '<strong>A neighborhood appears on the map once it has {min} events in the next {days} days.</strong> {sofar}',
  'map.areaNote':
    '<strong>The map appears once this area has {min} events in the next {days} days.</strong> {sofar}',
  'map.noneYet': 'None yet',
  'map.busiest': 'The busiest has {n} so far',
  'map.soFar': 'There are {n} so far',
  'map.soFarOne': 'There is {n} so far',
  'map.noPlace': '<strong>None of these events has a place on the map yet</strong>',
  'map.areaTitle': 'Area {n}: {count}',
  'map.areaTitleNamed': 'Area {n}, {name}: {count}',
  'map.sponsor': '(Supported by {sponsor})',
  'map.areas': '{n} neighborhoods',
  'map.areasOne': '{n} neighborhood',
  'map.caption':
    '{events} in {areas}, every kind, over the next {days} days (the filters above change the list, not the map). Each hexagon is a few square kilometres, never a street address.',
  'map.captionFiltered':
    '{events} in {areas} over the next {days} days. The filters above narrow the map and the list. Each hexagon is a few square kilometres, never a street address.',
  'map.credit': 'Street map data © {osm} contributors, prepared by {protomaps}.',
  'map.tapToZoom': 'Tap a hexagon to see its events on the map.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.zoomReset': 'Show the whole map',
  'map.zoomHint':
    'Pinch, or tap + and −, to zoom. Once zoomed in, drag with one finger to move the map.',
  'map.showMe': 'Show where I am',
  'map.locating': 'Finding you on the map…',
  'map.locationOff': 'Location is off, so the map cannot show where you are.',
  'map.you': 'You are here: the ringed dot.',
  'map.youOutside': 'You are outside this map.',
  'map.nearest': 'The nearest area, {name}, is about {d} mi away.',
  'map.fromYou': '{d} mi from you',
  'map.fromYouAbout': 'about {d} mi from you',
  'map.nearestPlace': 'Nearest: {name}, {d} mi away.',
  'map.miles': '{d} mi',
  'map.scale': 'Map scale',
  'map.allAreas': 'Back to all areas',
  'map.zoomCaption':
    '{events} in this area over the next {days} days. A solid dot is a named place, shown on its block; a pale dot marks only its block.',
  'map.zoomCaptionNamed':
    '{events} in this area ({name}) over the next {days} days. A solid dot is a named place, shown on its block; a pale dot marks only its block.',
  'map.listCaption':
    '{events} in this area over the next {days} days, listed by place. A place is a block, never a street address.',
  'map.listCaptionNamed':
    '{events} in this area ({name}) over the next {days} days, listed by place. A place is a block, never a street address.',
  'map.noTiles':
    '<strong>The street map for this area is not here yet.</strong> Its events are listed below.',
  'map.zoomEmpty': '<strong>No upcoming events in this area.</strong>',
  'map.unplaced': 'Somewhere in this area',
  'map.dotTitle': 'Spot {n}: {count}',
  'map.place': 'Place {n}',
  'map.placeNamed': 'Place {n} · {name}',
  'map.events': '{n} events',
  'map.eventsOne': '{n} event',
  'map.atVenue': 'at {venue}',
  'map.onBlock': 'somewhere on this block',
  'map.prevPlace': '‹ Place {n}',
  'map.nextPlace': 'Place {n} ›',
  'map.placesNav': 'Places in this area',
  'map.allPlaces': 'Show all places',
  'map.openEvent': 'Open event',
  'map.openNamed': '{label}: {name}',
  'map.goGoogle': 'Take me there (Google Maps)',
  'map.goApple': 'Take me there (Apple Maps)',
  'map.goLabel': '{app}: directions to {name}',
  'map.morePlace': '{n} more here, in the list of all places.',
  'map.external': '{label} (opens another site)',
  'map.link.signup': 'Sign up →',
  'map.link.sponsor': 'Sponsor this event →',
  'map.link.ow': 'Listen →',
  'map.link.more': 'More →',
  // The landing's where-are-you form (lib/landing-where.ts).
  'where.unknownZip': "We couldn't find zip {zip}. Check it and try again.",
  'where.noUsZip': "We couldn't find a US zip where you are. Type your town or zip instead.",
  'where.unknownPlace':
    "We couldn't find a place called {place}. Check the spelling, or type a zip code.",
  'where.label': 'Town or zip code',
  'where.submit': 'Find events',
  'where.comingUp': 'Coming up',
  'where.near': 'Near {where}',
  'where.everyPlace': 'In every place called {place}',
  'where.choose': '{count} places are called {place}. Pick yours:',
  'where.credit': 'Town names from {geonames} ({license}).',
  'where.change': 'Change',
  'where.nothingNear': 'Nothing near {zip} yet.',
  'where.nothingIn': 'Nothing in {place} yet.',
  'where.nothingInAny': 'Nothing in any place called {place} yet.',
  'where.createOne': 'Create one',
  // The data-provenance bar (lib/demo-banner.ts), in the page's language.
  'provenance.demoChip': 'DEMO',
  'provenance.demoText': 'Showcase only &mdash; not the live site.',
  'provenance.demoLabel': 'Demo site notice',
  'provenance.degradedChip': 'DATA UNAVAILABLE',
  'provenance.degradedText': 'Showing sample content while the live data reconnects.',
  'provenance.degradedLabel': 'Data temporarily unavailable notice',
  // The form pages (handlers/form-pages.ts, OSE-1850). Labels, buttons, help,
  // confirmations and error copy. The privacy notice keys (`privacy.*`) follow
  // below (owner 2026-11-28).
  'form.eventFallback': 'Event',
  'form.sponsorThanks': 'Event supported by',
  'form.register.heading': 'Register for this event',
  'form.register.name': 'Your name',
  'form.register.namePlaceholder': 'Jane Smith',
  'form.register.email': 'Email (optional)',
  'form.register.emailNote': 'Only to tell you if plans change.',
  'form.register.emailPlaceholder': 'jane@example.com',
  'form.register.done': "You're registered!",
  'form.checkin.heading': 'Check In',
  'form.checkin.tap': 'Tap to<br/>Check In',
  'form.checkin.noRegistration': "Didn't register?",
  'form.checkin.walkIn': 'Check in as a walk-in',
  'form.checkin.done': "You're checked in.",
  'form.checkin.doneButton': 'Checked in',
  'form.survey.heading': 'How was the event?',
  'form.survey.rating': 'Overall rating',
  'form.survey.rate': 'Rate {n} out of 5',
  'form.survey.comments': 'Comments (optional)',
  'form.survey.commentsPlaceholder': 'Tell us what you thought...',
  'form.survey.submit': 'Submit Feedback',
  'form.survey.done': 'Thanks for your feedback!',
  'form.email.heading': 'Stay in the loop',
  'form.email.intro': "One email when something's coming up. Never shared.",
  'form.email.label': 'Your email',
  'form.email.placeholder': 'you@example.com',
  'form.email.submit': 'Sign me up',
  'form.email.done': "You're on the list!",
  'form.error.invalidEventId':
    "This event link doesn't look right. Try the original link or contact the host.",
  'form.error.invalidBody':
    "We couldn't read your response. Please refresh the page and try again.",
  'form.error.payloadTooLarge': 'Your message is too long. Please shorten it and try again.',
  'form.error.missingField': 'Please fill out all required fields and try again.',
  'form.error.invalidEmail': "That email doesn't look right. Please check and try again.",
  'form.error.configError':
    "Something's not set up on our side. Please try again in a few minutes.",
  'form.error.busy': "We're having trouble right now. Please try again in a moment.",
  'form.error.methodNotAllowed': "This action isn't available right now.",
  'form.error.tooMany': 'Too many tries. Please wait a moment and try again.',
  'form.error.server': 'Sorry, something went wrong on our end. Please try again.',
  'form.error.generic': 'Sorry, something went wrong. Please try again.',
  'form.next.googleCalendar': 'Add to Google Calendar',
  'form.next.eventPage': 'Back to the event page',
  'form.next.checkin': 'On the day, check in with one tap.',
  'form.next.browse': 'See what else is coming up',
  'form.privacy.details': 'Privacy details',
  // Shown only on a page that is not in English, above the official English text.
  'form.privacy.englishNote': 'This is a translation. The English text is the official one.',
  // The short line under the OurSharedEvents name in a page header (owner
  // 2026-11-28: the name stays one name; the line is in the reader's language).
  'brand.tagline': "Your community's events",
  // The privacy notice under each form (owner 2026-11-28: in the page's
  // language; the English text stays the official one and shows under it).
  'privacy.summary.register': 'Your name and email are cleared the day after the event.',
  'privacy.summary.survey': 'Comments are cleaned of personal details within 24 hours.',
  'privacy.summary.email': 'Your email is deleted after 30 days.',
  'privacy.purpose.register':
    'We collect your name and, if you choose, your email, so the organizer can reach you if this event changes.',
  'privacy.purpose.checkin':
    'We record an <strong>anonymous count only</strong> — no personal data is stored.',
  'privacy.purpose.survey':
    'We collect your ratings and optional comments to improve future events.',
  'privacy.purpose.email':
    'We collect your email address to notify you about future community events.',
  'privacy.basisLabel': 'Legal basis:',
  'privacy.basis.register': 'GDPR Art. 6(1)(a) — your <strong>consent</strong>.',
  'privacy.basis.checkin': 'GDPR Art. 6(1)(f) — legitimate interest in knowing attendance numbers.',
  'privacy.basis.survey': 'GDPR Art. 6(1)(a) — your <strong>consent</strong>.',
  'privacy.basis.email':
    'GDPR Art. 6(1)(a) — your <strong>consent</strong>. You can <strong>withdraw consent</strong> at any time.',
  'privacy.retention.register':
    'Your name and email are encrypted, and <strong>cleared the day after the event</strong>. The rest of the registration is deleted 90 days after you register, or the day after the event if that is later.',
  'privacy.retention.checkin': 'Anonymous aggregate counts are kept for event reporting only.',
  'privacy.retention.survey':
    'Comments are scrubbed of personal information within <strong>24</strong> hours. Aggregate ratings are kept indefinitely.',
  'privacy.retention.email':
    'Your email is encrypted at rest and automatically deleted after <strong>30</strong> days.',
  'privacy.rights':
    'You have the right to access, correct, or erase your data, and to lodge a complaint with your local data protection',
  'privacy.authority': 'supervisory authority',
  'privacy.commerce':
    '<strong>Commerce notice:</strong> Payment data is handled by our PCI DSS-compliant processor and never stored by us.',
  'privacy.policyLink': 'Full privacy policy',
  'privacy.officialEnglish': 'Official English text',
  // The public sponsor card (/sponsors/<id>). The sponsor's own name, address,
  // phone and email are theirs and show as typed.
  'sponsorCard.whatsOn': "What's on",
  'sponsorCard.call': 'Call {phone}',
  'sponsorCard.email': 'Email {email}',
  'sponsorCard.website': 'Visit website',
  'sponsorCard.notFoundTitle': 'Sponsor not found',
  'sponsorCard.notFoundBody': 'This sponsor is not on show right now.',
  'sponsorCard.limitTitle': 'Too many requests',
  'sponsorCard.limitBody': 'Give it a minute and try again.',
  'sponsorCard.errorTitle': 'Something went wrong',
  'sponsorCard.errorBody': 'Try again in a moment.',
  // Stamp passport (owner, 2026-11-28): the card a walk or market keeps on the
  // visitor's phone. {have} and {total} are filled on the phone, never sent.
  'passport.label': 'Stamp passport',
  'passport.scanHere': "Scan this stop's code to collect its stamp.",
  'passport.saved': 'Stamp saved for this stop.',
  'passport.count': 'You have {have} of {total} stamps.',
  'passport.done': 'Card complete! Show this screen at the prize table.',
  'passport.private': 'Your stamps stay on this phone. We never see them.',
  'passport.clear': 'Clear my stamps',
  'passport.stamped': 'Stamped',
  'passport.noScript': 'Turn on JavaScript to keep stamps on this phone.',
  'partners.coHostedWith': 'Co-hosted with {names}',
  'partners.with': 'With {names}',
  'partners.publicBody': '{name} (public body)',
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'share.label': 'Compartir este evento',
  'share.copied': 'Enlace copiado',
  'calendar.label': 'Agregar al calendario',
  'calendar.ics': 'Apple u Outlook',
  'calendar.subscribe': 'Suscribirse al calendario',
  'calendar.subscribe.apple': 'Calendario de Apple',
  'calendar.subscribe.ics': 'Dirección del calendario (.ics)',
  'stalls.see': 'Ver los puestos',
  'directions.pre': 'Cómo llegar',
  'directions.live': 'Cómo llegar',
  'video.watch': '▶ Ver el video',
  'back.label': 'Volver',
  'language.label': 'Idioma',
  'menu.label': 'Menú',
  'choices.heading': '¿Cómo quieres participar?',
  'choices.registerNote': 'Pide tu nombre y correo.',
  'choices.checkinLabel': 'Cuenta conmigo, de forma anónima',
  'choices.checkinNote': 'Te contamos, nunca te nombramos.',
  'what.donation': 'Donar →',
  'what.league': 'Ver la liga →',
  'what.workshop': 'Inscribirse →',
  'what.substack': 'Suscribirse →',
  'what.tickets': 'Comprar entradas →',
  'what.menu': 'Menú y reservas →',
  'what.website': 'Visitar el sitio →',
  'page.skip': 'Ir al contenido del evento',
  'nav.site': 'Sitio',
  'nav.allEvents': '&larr; Todos los eventos',
  'nav.eventPage': 'Página del evento',
  'nav.poster': 'Cartel',
  'event.type': 'Tipo: {type}',
  'event.hostedBy': 'Organizado por {host}',
  'live.badge': 'En vivo',
  'live.badgeLabel': 'El evento está en vivo',
  'sponsors.supportedBy': 'Con el apoyo de',
  'sponsors.label': 'Patrocinadores del evento',
  'sponsors.thanks': 'Gracias a nuestros patrocinadores',
  'section.what': 'Qué',
  'section.where': 'Dónde',
  'section.who': 'Quién',
  'section.howMuch': 'Cuánto cuesta',
  'section.why': 'Por qué',
  'section.how': 'Cómo',
  'who.photoOf': 'Foto de {host}',
  'who.host': 'Quien organiza',
  'map.alt': 'Mapa de {venue}',
  'cta.register': 'Inscribirse',
  'cta.checkin': 'Registrar mi llegada',
  'cta.survey': 'Danos tu opinión',
  'cta.emailSignup': 'Recibir novedades del evento',
  'price.free': 'Gratis',
  'price.sliding': 'Precio escalonado',
  'price.donation': 'Paga lo que puedas',
  'price.varies': 'Varía',
  // OSE-2012: how people take part (lib/attendance-mode.ts).
  'mode.in_person': 'Presencial',
  'mode.online': 'En línea',
  'mode.both': 'En línea y presencial',
  'countdown.now': 'Empieza ahora',
  'countdown.today': 'Empieza hoy',
  'countdown.tomorrow': 'Empieza mañana',
  'countdown.in': 'Empieza en ',
  'countdown.minute': ' minuto',
  'countdown.minutes': ' minutos',
  'countdown.hour': ' hora',
  'countdown.hours': ' horas',
  'countdown.days': ' días',
  'next.atVenue': 'Próximamente en {venue}',
  'next.thisVenue': 'este lugar',
  'next.fallbackHeading': 'El corredor sigue',
  'next.fallbackNote': 'Siempre hay más encuentros organizándose cerca.',
  'next.browse': 'Ver lo que viene',
  'recap.title': 'resumen',
  'recap.titleCalledOff': 'ya no se realizará',
  'recap.chip': 'Ya terminó',
  'recap.chipCalledOff': 'No se realizará',
  'recap.happened': 'Se realizó el {when}',
  'recap.ended': 'Este evento ya terminó.',
  'recap.calledOffWhen': 'Ya no se realizará. Estaba previsto para el {when}',
  'recap.calledOff': 'Ya no se realizará.',
  'recap.whatHeading': 'De qué se trató',
  'recap.empty':
    'Quien organiza aún no ha escrito sobre este evento. Las cifras de abajo cuentan la historia.',
  'recap.emptyCalledOff': 'Quien organiza no escribió sobre este evento.',
  'stats.heading': 'En cifras',
  'stats.registered': 'inscritos',
  'stats.checkedIn': 'registraron su llegada',
  'stats.walkedIn': 'llegaron sin inscribirse',
  'stats.surveys': 'encuestas enviadas',
  'stats.emailSignups': 'suscripciones por correo',
  'stats.fewerThan': 'Menos de {floor} {label}',
  'stats.walkInShare': 'El {pct}% de las llegadas fueron sin inscripción',
  'stats.showedUpShare': 'Llegó el {pct}% de los inscritos',
  'connect.heading': 'Entérate del próximo',
  'connect.note': 'Un correo cuando se acerque algo. Nada más.',
  'connect.cta': 'Avísame',
  'neverWho.line': 'Nunca quién, solo cuántos.',
  'neverWho.trigger': 'Cómo funciona',
  'neverWho.event': `<p>
      Eres parte del grupo, de manera anónima. OurSharedEvents registra cuándo
      se reúnen los grupos &mdash; nunca quién eres. Quienes organizan y
      patrocinan ven corredores y lugares, no personas. El enlace que seguiste
      contó como un solo clic; no se recopiló nada sobre tu dispositivo, tu
      ubicación ni tu identidad para mostrar esta página.
    </p>`,
  'testSite.headline': 'Solo para pruebas.',
  'testSite.listings':
    'Los eventos, lugares y negocios que aparecen aquí provienen de listados públicos y se usan para hacer pruebas; nada de esto es una recomendación ni una oferta.',

  // ── /events and the landing (OSE-1762) ──────────────────────────────────────
  // MACHINE DRAFT, awaiting a human review (owner rule: privacy text is read by
  // a person before it is final): neverWho.landing, neverWho.events,
  // landing.description, landing.nearNote and landing.signInNote.
  'neverWho.landing': `<p>
          La asistencia se mide <strong>sin saber quién eres</strong>, siempre de entrada.
          Contamos que la gente vino — dónde y cuándo — nunca quién es. Esta página no usa cookies
          ni herramientas de análisis. Si eliges &ldquo;Usar mi ubicación&rdquo;, solo usa la zona
          de tu código postal, nunca tu ubicación exacta.
        </p>
        <p>
          Dar tu nombre es una opción, no la norma &mdash; nada te nombra a menos que tú lo
          elijas. <a href="{events}" data-testid="privacy-more">Mira lo que está pasando &rarr;</a>
        </p>`,
  'neverWho.events': `<p>
          Eres parte del grupo, de manera anónima. OurSharedEvents registra cuándo
          se reúnen los grupos &mdash; nunca quién eres. Quienes organizan y
          patrocinan ven corredores y lugares, no personas. No se recopiló nada sobre
          tu dispositivo, tu ubicación ni tu identidad para mostrar esta página.
        </p>`,
  'page.skipContent': 'Ir al contenido',
  'list.title': 'Próximos eventos | OurSharedEvents',
  'list.mainLabel': 'Próximos eventos de la comunidad',
  'list.sponsorsRegion': 'Patrocinadores',
  'landing.title': 'OurSharedEvents — qué pasa cerca de ti',
  'landing.description':
    'Encuentra eventos en tu ciudad o cerca de tu código postal. La asistencia se cuenta sin saber quién eres.',
  'landing.homeLabel': 'Inicio de OurSharedEvents',
  'landing.navLabel': 'Principal',
  'landing.events': 'Eventos',
  'landing.map': 'Mapa',
  'landing.lead': '¿Qué pasa cerca de ti?',
  'landing.whereLabel': '¿Dónde estás?',
  'landing.nearMe': 'Usar mi ubicación',
  'landing.nearNote': 'Solo usamos la zona de tu código postal, nunca tu ubicación exacta.',
  'landing.locationOff': 'La ubicación está desactivada. Escribe tu ciudad o código postal abajo.',
  'landing.finding': 'Buscando tu código postal…',
  'landing.doorsLabel': 'Para quienes organizan',
  'landing.doorEvent': 'Inicia sesión para crear un evento',
  'landing.doorSponsor': 'Inicia sesión para agregar un patrocinador',
  'landing.whySignIn': '¿Por qué iniciar sesión?',
  'landing.signInNote': `Las herramientas para organizar son privadas y solo por invitación. Cloudflare Access
            te envía por correo un código de un solo uso, así que OurSharedEvents nunca ve ni guarda una
            contraseña. Quienes asisten nunca inician sesión, y nada aquí los nombra.`,
  'footer.browse': 'Ver eventos',
  'footer.privacy': 'Privacidad',
  'limit.status': 'Espera un momento',
  'limit.title': 'Demasiadas visitas a la vez',
  'limit.body':
    'Esta conexión ha abierto esta página muchas veces en el último minuto. Espera un minuto y vuelve a intentarlo.',
  'limit.again': 'Volver a intentarlo',
  'err.status': 'Error {n}',
  'err.cta.browse': 'Ver próximos eventos',
  'err.notFound.title': 'No encontramos ese evento',
  'err.notFound.body':
    'Este evento no está abierto al público. Puede que aún no se haya publicado o que se haya retirado. Mira lo que viene.',
  'err.unavailable.title': 'Tenemos problemas para cargar este evento',
  'err.unavailable.body':
    'Nuestro servicio de eventos no está disponible por un momento. Vuelve a intentarlo en un minuto o mira qué más viene.',
  'err.ended.title': '{title} ha terminado',
  'err.ended.next': 'Esto es lo que sigue en este lugar.',
  'err.ended.soon': 'Mira lo que viene.',
  'err.code.title': 'Ese código no coincide con ningún evento',
  'err.code.body': 'Revisa los seis caracteres que te dieron y escríbelos de nuevo.',
  'err.codeLimit.title': 'Demasiados códigos probados',
  'err.codeLimit.body': 'Espera un minuto y vuelve a escribir el código.',
  'err.codeDown.title': 'Tenemos problemas para abrir este evento',
  'err.codeDown.body': 'Vuelve a intentarlo en un minuto.',
  'err.link.title': 'Ese enlace no abre ningún evento',
  'err.link.body':
    'Puede que esté mal escrito o que el evento se haya retirado. Mira lo que hay cerca de ti.',
  'err.link.cta': 'Ver eventos cerca de ti',
  'err.linkLimit.title': 'Demasiados enlaces probados',
  'err.linkLimit.body': 'Espera un minuto y vuelve a abrir el enlace.',
  'err.linkDown.title': 'Tenemos problemas para abrir este enlace',
  'err.linkDown.body': 'Vuelve a intentarlo en un minuto.',
  'when.all.chip': 'Todo',
  'when.all.heading': 'Próximos eventos',
  'when.all.empty': 'No hay nada programado por ahora. Vuelve pronto.',
  'when.all.count': '{n} eventos',
  'when.all.countOne': '{n} evento',
  'when.today.chip': 'Hoy',
  'when.today.heading': 'Hoy',
  'when.today.empty': 'No hay nada hoy.',
  'when.today.count': '{n} eventos hoy',
  'when.today.countOne': '{n} evento hoy',
  'when.weekend.chip': 'Este fin de semana',
  'when.weekend.heading': 'Este fin de semana',
  'when.weekend.empty': 'Todavía no hay nada este fin de semana.',
  'when.weekend.count': '{n} eventos este fin de semana',
  'when.weekend.countOne': '{n} evento este fin de semana',
  'when.week.chip': 'Próximos 7 días',
  'when.week.heading': 'En los próximos 7 días',
  'when.week.empty': 'Todavía no hay nada en los próximos 7 días.',
  'when.week.count': '{n} eventos en los próximos 7 días',
  'when.week.countOne': '{n} evento en los próximos 7 días',
  'when.month.chip': 'Este mes',
  'when.month.heading': 'Este mes',
  'when.month.empty': 'Todavía no hay nada este mes.',
  'when.month.count': '{n} eventos este mes',
  'when.month.countOne': '{n} evento este mes',
  'when.next-month.chip': 'El mes que viene',
  'when.next-month.heading': 'El mes que viene',
  'when.next-month.empty': 'Todavía no hay nada el mes que viene.',
  'when.next-month.count': '{n} eventos el mes que viene',
  'when.next-month.countOne': '{n} evento el mes que viene',
  'when.next-90.chip': 'Próximos 90 días',
  'when.next-90.heading': 'En los próximos 90 días',
  'when.next-90.empty': 'Todavía no hay nada en los próximos 90 días.',
  'when.next-90.count': '{n} eventos en los próximos 90 días',
  'when.next-90.countOne': '{n} evento en los próximos 90 días',
  'when.past.chip': 'Terminados hace poco',
  'when.past.heading': 'Terminados hace poco',
  'when.past.empty': 'Nada ha terminado hace poco.',
  'when.past.count': '{n} eventos terminados hace poco',
  'when.past.countOne': '{n} evento terminado hace poco',
  'disc.try.weekend': 'Prueba este fin de semana',
  'disc.try.week': 'Prueba los próximos 7 días',
  'disc.try.month': 'Prueba este mes',
  'disc.try.next-90': 'Prueba los próximos 90 días',
  'disc.try.all': 'Ver todo',
  'disc.headingPlace': 'Eventos en {place}',
  'disc.headingQuery': 'Resultados para “{q}”',
  'disc.placeCount': '{n} eventos en {place}',
  'disc.placeCountOne': '{n} evento en {place}',
  'disc.queryCount': '{n} resultados para “{q}”',
  'disc.queryCountOne': '{n} resultado para “{q}”',
  'disc.upcoming': '{n} próximos eventos',
  'disc.upcomingOne': '{n} próximo evento',
  'disc.withWrapped': '{base}, {n} terminados',
  'disc.withWrappedOne': '{base}, {n} terminado',
  'disc.searchLabel': 'Busca eventos por nombre, lugar, ciudad o código postal',
  'disc.searchPlaceholder': 'Nombre, lugar, ciudad o código postal',
  'disc.search': 'Buscar',
  'disc.when': 'Cuándo',
  'disc.clear': 'Borrar filtros',
  'disc.emptyPlace': 'Todavía no hay nada en {place}.',
  'disc.seeAll': 'Ver todos los eventos',
  'disc.emptyQuery':
    'Nada coincide con &ldquo;{q}&rdquo;. Prueba con una palabra más corta o {link}.',
  'disc.clearSearch': 'borra la búsqueda',
  'list.none': 'No hay eventos programados.',
  'list.error': 'No se pudieron cargar los eventos. Inténtalo de nuevo.',
  'list.noneUpcoming': 'Todavía no hay nada próximo.',
  'list.wrappedHeading': 'Terminados',
  'card.untitled': 'Evento sin título',
  'card.recap': 'Ver cómo salió',
  'card.recapLabel': 'Ver cómo salió: {name}',
  'card.registerLabel': 'Inscribirse en {name}',
  'card.wrapped': 'Terminado',
  'card.open': 'Abrir la página pública de {name}',
  'card.supportedBy': 'Con el apoyo de {sponsor}',
  'area.emptyHeading': 'Todavía no hay nada en el mapa.',
  'area.emptyNote': 'Empieza tú &mdash; organiza un encuentro y aparecerá aquí.',
  'area.create': 'Crear un evento &rarr;',
  'area.otherType': 'Otro',
  'area.type': 'Tipo',
  'area.allTypes': 'Todos los tipos',
  'area.kinds': 'Tipos de eventos',
  'slider.prev': 'Ver opciones anteriores',
  'slider.next': 'Ver más opciones',
  'area.where': 'Dónde',
  'area.all': 'Todos',
  'area.online': 'En línea',
  'area.inPerson': 'En persona',
  'area.timeOfDay': 'Hora del día',
  'area.anyTime': 'Cualquier hora',
  'area.beforeDark': 'En casa antes del anochecer',
  'area.view': 'Vista',
  'area.list': 'Lista',
  'area.map': 'Mapa',
  'area.filters': 'Filtros',
  'area.tabs': 'Filtrar eventos',
  'area.tabsOn': 'filtro activo',
  'area.near': 'Cerca de mí',
  'area.nearLabel': 'Distancia desde donde estás, en millas',
  'area.nearAny': 'Cualquier distancia',
  'area.nearWithin': 'A menos de {d} mi',
  'area.nearPrivacy': 'Tu ubicación se usa solo en este dispositivo. Nunca se envía ni se guarda.',
  'area.nearLocating': 'Buscando tu ubicación...',
  'area.nearOff': 'La ubicación está desactivada, así que no se puede usar la distancia.',
  'area.nearShown':
    'Mostrando eventos a menos de {d} mi, del más cercano al más lejano. Se omiten los eventos sin lugar en el mapa.',
  'area.nearNone':
    'No hay eventos con lugar en el mapa a menos de {d} mi. Prueba una distancia mayor.',
  'area.nearAway': 'a unas {d} mi',
  'area.more': 'Haz clic para ver más',
  'area.moreShown': 'Mostrando {n} de {total} eventos.',
  'map.near': 'cerca de {venue}',
  'map.exampleLabel':
    'Mapa de ejemplo: tres barrios dibujados como hexágonos numerados; el de más actividad, con el tono más oscuro',
  'map.listedBelow': '{note} &mdash; todos los eventos aparecen abajo.',
  'map.seeList': 'Ver la lista de eventos',
  'map.exampleCaption':
    '<strong>Ejemplo.</strong> Así se verá el mapa cuando se llenen los barrios: un hexágono numerado para cada uno, de unos pocos kilómetros cuadrados, nunca una dirección.',
  'map.corridorNote':
    '<strong>Un barrio aparece en el mapa cuando tiene {min} eventos en los próximos {days} días.</strong> {sofar}',
  'map.areaNote':
    '<strong>El mapa aparece cuando esta zona tiene {min} eventos en los próximos {days} días.</strong> {sofar}',
  'map.noneYet': 'Todavía ninguno',
  'map.busiest': 'El de más actividad tiene {n} por ahora',
  'map.soFar': 'Hay {n} por ahora',
  'map.soFarOne': 'Hay {n} por ahora',
  'map.noPlace': '<strong>Ninguno de estos eventos tiene todavía un lugar en el mapa</strong>',
  'map.areaTitle': 'Zona {n}: {count}',
  'map.areaTitleNamed': 'Zona {n}, {name}: {count}',
  'map.sponsor': '(Con el apoyo de {sponsor})',
  'map.areas': '{n} barrios',
  'map.areasOne': '{n} barrio',
  'map.caption':
    '{events} en {areas}, de todo tipo, en los próximos {days} días (los filtros de arriba cambian la lista, no el mapa). Cada hexágono mide unos pocos kilómetros cuadrados y nunca es una dirección.',
  'map.captionFiltered':
    '{events} en {areas} en los próximos {days} días. Los filtros de arriba acotan el mapa y la lista. Cada hexágono mide unos pocos kilómetros cuadrados y nunca es una dirección.',
  'map.credit': 'Datos del mapa de calles © colaboradores de {osm}, preparados por {protomaps}.',
  'map.tapToZoom': 'Toca un hexágono para ver sus eventos en el mapa.',
  'map.zoomIn': 'Acercar',
  'map.zoomOut': 'Alejar',
  'map.zoomReset': 'Ver todo el mapa',
  'map.zoomHint':
    'Pellizca, o toca + y −, para acercar. Ya acercado, arrastra con un dedo para mover el mapa.',
  'map.showMe': 'Mostrar dónde estoy',
  'map.locating': 'Buscándote en el mapa…',
  'map.locationOff': 'La ubicación está desactivada, así que el mapa no puede mostrar dónde estás.',
  'map.you': 'Estás aquí: el punto con anillo.',
  'map.youOutside': 'Estás fuera de este mapa.',
  'map.nearest': 'El área más cercana, {name}, está a unas {d} mi.',
  'map.fromYou': 'a {d} mi de ti',
  'map.fromYouAbout': 'a unas {d} mi de ti',
  'map.nearestPlace': 'Lo más cercano: {name}, a {d} mi.',
  'map.miles': '{d} mi',
  'map.scale': 'Escala del mapa',
  'map.allAreas': 'Volver a todas las zonas',
  'map.zoomCaption':
    '{events} en esta zona en los próximos {days} días. Un punto sólido es un lugar con nombre, mostrado en su cuadra; un punto claro marca solo su cuadra.',
  'map.zoomCaptionNamed':
    '{events} en esta zona ({name}) en los próximos {days} días. Un punto sólido es un lugar con nombre, mostrado en su cuadra; un punto claro marca solo su cuadra.',
  'map.listCaption':
    '{events} en esta zona en los próximos {days} días, por lugar. Un lugar es una cuadra, nunca una dirección.',
  'map.listCaptionNamed':
    '{events} en esta zona ({name}) en los próximos {days} días, por lugar. Un lugar es una cuadra, nunca una dirección.',
  'map.noTiles':
    '<strong>El mapa de calles de esta zona todavía no está disponible.</strong> Sus eventos aparecen abajo.',
  'map.zoomEmpty': '<strong>No hay eventos próximos en esta zona.</strong>',
  'map.unplaced': 'En algún lugar de esta zona',
  'map.dotTitle': 'Punto {n}: {count}',
  'map.place': 'Lugar {n}',
  'map.placeNamed': 'Lugar {n} · {name}',
  'map.events': '{n} eventos',
  'map.eventsOne': '{n} evento',
  'map.atVenue': 'en {venue}',
  'map.onBlock': 'en algún lugar de esta cuadra',
  'map.prevPlace': '‹ Lugar {n}',
  'map.nextPlace': 'Lugar {n} ›',
  'map.placesNav': 'Lugares de esta zona',
  'map.allPlaces': 'Ver todos los lugares',
  'map.openEvent': 'Abrir el evento',
  'map.openNamed': '{label}: {name}',
  'map.goGoogle': 'Llévame (Google Maps)',
  'map.goApple': 'Llévame (Apple Maps)',
  'map.goLabel': '{app}: cómo llegar a {name}',
  'map.morePlace': '{n} más aquí, en la lista de todos los lugares.',
  'map.external': '{label} (abre otro sitio)',
  'map.link.signup': 'Inscribirse →',
  'map.link.sponsor': 'Patrocinar este evento →',
  'map.link.ow': 'Escuchar →',
  'map.link.more': 'Más →',
  'where.unknownZip': 'No encontramos el código postal {zip}. Revísalo e inténtalo de nuevo.',
  'where.noUsZip':
    'No encontramos un código postal de EE. UU. donde estás. Escribe tu ciudad o código postal.',
  'where.unknownPlace':
    'No encontramos un lugar llamado {place}. Revisa cómo se escribe o escribe un código postal.',
  'where.label': 'Ciudad o código postal',
  'where.submit': 'Buscar eventos',
  'where.comingUp': 'Próximamente',
  'where.near': 'Cerca de {where}',
  'where.everyPlace': 'En todos los lugares llamados {place}',
  'where.choose': 'Hay {count} lugares llamados {place}. Elige el tuyo:',
  'where.credit': 'Nombres de ciudades de {geonames} ({license}).',
  'where.change': 'Cambiar',
  'where.nothingNear': 'Todavía no hay nada cerca de {zip}.',
  'where.nothingIn': 'Todavía no hay nada en {place}.',
  'where.nothingInAny': 'Todavía no hay nada en ningún lugar llamado {place}.',
  'where.createOne': 'Crear uno',
  'provenance.demoChip': 'DEMOSTRACIÓN',
  'provenance.demoText': 'Solo una muestra &mdash; no es el sitio real.',
  'provenance.demoLabel': 'Aviso de sitio de demostración',
  'provenance.degradedChip': 'DATOS NO DISPONIBLES',
  'provenance.degradedText':
    'Mostramos contenido de ejemplo mientras se restablecen los datos reales.',
  'provenance.degradedLabel': 'Aviso de datos no disponibles por el momento',
  // The form pages (OSE-1850). MACHINE DRAFT, awaiting a native read. The
  // privacy notice is translated too (owner 2026-11-28); the English text under
  // it stays the official one.
  'form.eventFallback': 'Evento',
  'form.sponsorThanks': 'Evento con el apoyo de',
  'form.register.heading': 'Inscríbete en este evento',
  'form.register.name': 'Tu nombre',
  'form.register.namePlaceholder': 'Ana García',
  'form.register.email': 'Correo electrónico (opcional)',
  'form.register.emailNote': 'Solo para avisarte si cambian los planes.',
  'form.register.emailPlaceholder': 'ana@ejemplo.com',
  'form.register.done': '¡Ya estás inscrito!',
  'form.checkin.heading': 'Registrar llegada',
  'form.checkin.tap': 'Toca aquí:<br/>¡Ya llegué!',
  'form.checkin.noRegistration': '¿No te inscribiste?',
  'form.checkin.walkIn': 'Registrar llegada sin inscripción',
  'form.checkin.done': 'Tu llegada quedó registrada.',
  'form.checkin.doneButton': 'Llegada registrada',
  'form.survey.heading': '¿Qué tal estuvo el evento?',
  'form.survey.rating': 'Calificación general',
  'form.survey.rate': 'Calificar con {n} de 5',
  'form.survey.comments': 'Comentarios (opcional)',
  'form.survey.commentsPlaceholder': 'Cuéntanos qué te pareció...',
  'form.survey.submit': 'Enviar comentarios',
  'form.survey.done': '¡Gracias por tus comentarios!',
  'form.email.heading': 'Mantente al tanto',
  'form.email.intro': 'Un correo cuando se acerque algo. Nunca lo compartimos.',
  'form.email.label': 'Tu correo electrónico',
  'form.email.placeholder': 'tu@ejemplo.com',
  'form.email.submit': 'Suscribirme',
  'form.email.done': '¡Ya estás en la lista!',
  'form.error.invalidEventId':
    'Este enlace del evento no parece correcto. Prueba el enlace original o contacta al organizador.',
  'form.error.invalidBody':
    'No pudimos leer tu respuesta. Actualiza la página e inténtalo de nuevo.',
  'form.error.payloadTooLarge': 'Tu mensaje es demasiado largo. Acórtalo e inténtalo de nuevo.',
  'form.error.missingField': 'Completa todos los campos obligatorios e inténtalo de nuevo.',
  'form.error.invalidEmail': 'Ese correo no parece correcto. Revísalo e inténtalo de nuevo.',
  'form.error.configError':
    'Falta configurar algo de nuestro lado. Inténtalo de nuevo en unos minutos.',
  'form.error.busy': 'Tenemos problemas en este momento. Inténtalo de nuevo en un momento.',
  'form.error.methodNotAllowed': 'Esta acción no está disponible en este momento.',
  'form.error.tooMany': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'form.error.server': 'Lo sentimos, algo falló de nuestro lado. Inténtalo de nuevo.',
  'form.error.generic': 'Lo sentimos, algo falló. Inténtalo de nuevo.',
  'form.next.googleCalendar': 'Agregar a Google Calendar',
  'form.next.eventPage': 'Volver a la página del evento',
  'form.next.checkin': 'El día del evento, registra tu llegada con un toque.',
  'form.next.browse': 'Ver qué más se acerca',
  'form.privacy.details': 'Detalles de privacidad',
  'form.privacy.englishNote': 'Esto es una traducción. El texto en inglés es el oficial.',
  'brand.tagline': 'Eventos de tu comunidad',
  'privacy.summary.register': 'Tu nombre y tu correo se borran el día después del evento.',
  'privacy.summary.survey': 'Los comentarios se limpian de datos personales en 24 horas.',
  'privacy.summary.email': 'Tu correo se borra a los 30 días.',
  'privacy.purpose.register':
    'Pedimos tu nombre y, si quieres, tu correo, para que el organizador pueda avisarte si este evento cambia.',
  'privacy.purpose.checkin':
    'Solo guardamos un <strong>conteo anónimo</strong>; no se guardan datos personales.',
  'privacy.purpose.survey':
    'Pedimos tus calificaciones y comentarios opcionales para mejorar los próximos eventos.',
  'privacy.purpose.email': 'Pedimos tu correo para avisarte de próximos eventos de la comunidad.',
  'privacy.basisLabel': 'Base legal:',
  'privacy.basis.register': 'RGPD art. 6(1)(a): tu <strong>consentimiento</strong>.',
  'privacy.basis.checkin': 'RGPD art. 6(1)(f): interés legítimo en saber cuántas personas asisten.',
  'privacy.basis.survey': 'RGPD art. 6(1)(a): tu <strong>consentimiento</strong>.',
  'privacy.basis.email':
    'RGPD art. 6(1)(a): tu <strong>consentimiento</strong>. Puedes <strong>retirar tu consentimiento</strong> cuando quieras.',
  'privacy.retention.register':
    'Tu nombre y tu correo se cifran y <strong>se borran el día después del evento</strong>. El resto de la inscripción se borra 90 días después de inscribirte, o el día después del evento si eso es más tarde.',
  'privacy.retention.checkin':
    'Los conteos anónimos totales se guardan solo para los informes del evento.',
  'privacy.retention.survey':
    'Los comentarios se limpian de datos personales en <strong>24</strong> horas. Las calificaciones totales se guardan sin fecha de fin.',
  'privacy.retention.email':
    'Tu correo se guarda cifrado y se borra solo a los <strong>30</strong> días.',
  'privacy.rights':
    'Tienes derecho a ver, corregir o borrar tus datos, y a presentar una queja ante la',
  'privacy.authority': 'autoridad de protección de datos de tu zona',
  'privacy.commerce':
    '<strong>Aviso de pagos:</strong> los datos de pago los maneja nuestro procesador, que cumple con PCI DSS, y nosotros nunca los guardamos.',
  'privacy.policyLink': 'Política de privacidad completa (en inglés)',
  'privacy.officialEnglish': 'Texto oficial en inglés',
  'sponsorCard.whatsOn': 'Qué hay',
  'sponsorCard.call': 'Llamar al {phone}',
  'sponsorCard.email': 'Escribir a {email}',
  'sponsorCard.website': 'Visitar el sitio web',
  'sponsorCard.notFoundTitle': 'No encontramos este patrocinador',
  'sponsorCard.notFoundBody': 'Este patrocinador no se muestra ahora mismo.',
  'sponsorCard.limitTitle': 'Demasiadas visitas',
  'sponsorCard.limitBody': 'Espera un minuto e inténtalo de nuevo.',
  'sponsorCard.errorTitle': 'Algo falló',
  'sponsorCard.errorBody': 'Inténtalo de nuevo en un momento.',
  'passport.label': 'Pasaporte de sellos',
  'passport.scanHere': 'Escanea el código de esta parada para ganar su sello.',
  'passport.saved': 'Sello guardado para esta parada.',
  'passport.count': 'Tienes {have} de {total} sellos.',
  'passport.done': '¡Tarjeta completa! Muestra esta pantalla en la mesa de premios.',
  'passport.private': 'Tus sellos se quedan en este teléfono. Nunca los vemos.',
  'passport.clear': 'Borrar mis sellos',
  'passport.stamped': 'Sellado',
  'passport.noScript': 'Activa JavaScript para guardar sellos en este teléfono.',
  'partners.coHostedWith': 'Coorganizado con {names}',
  'partners.with': 'Con {names}',
  'partners.publicBody': '{name} (organismo público)',
};

/** One catalog per language. A language still being written may omit keys. */
export const CATALOG: Record<Lang, Partial<Record<MessageKey, string>>> = {
  en,
  es,
  'zh-hans': zh_hans,
  'zh-hant': zh_hant,
  hi,
  ar,
  pt,
  bn,
  ru,
  ja,
  fr,
  de,
  ur,
  id,
  ko,
  vi,
  tr,
  it,
  tl,
  pl,
  uk,
  fa,
};

/** The type names a WHAT link can carry; each has a `what.<type>` key. */
export const WHAT_TYPES = [
  'donation',
  'league',
  'workshop',
  'substack',
  'tickets',
  'menu',
  'website',
] as const;

export type WhatType = (typeof WHAT_TYPES)[number];

export function msg(lang: Lang, key: MessageKey): string {
  return CATALOG[lang][key] ?? en[key];
}

/**
 * A message with its `{name}` slots filled. The values go in as given, so a
 * caller escapes anything organizer-entered first. A slot with no value is left
 * as written, which a test then sees.
 */
export function fmt(lang: Lang, key: MessageKey, vars: Record<string, string | number>): string {
  return msg(lang, key).replace(/\{(\w+)\}/g, (slot, name: string) =>
    name in vars ? String(vars[name]) : slot
  );
}

/**
 * A message that counts: `one` when the language calls `n` singular ("1
 * event"), `other` otherwise ("0 events", "3 events"). `n` fills `{n}`.
 */
export function fmtCount(
  lang: Lang,
  n: number,
  keys: { one: MessageKey; other: MessageKey },
  vars: Record<string, string | number> = {}
): string {
  const form = new Intl.PluralRules(INTL_LOCALE[lang]).select(n) === 'one' ? keys.one : keys.other;
  return fmt(lang, form, { ...vars, n });
}

/** Every language's text for one key, in `LANGUAGES` order. */
export function msgAll(key: MessageKey): Record<Lang, string> {
  return Object.fromEntries(LANGUAGES.map((l) => [l, msg(l, key)])) as Record<Lang, string>;
}

export { DEFAULT_LANG };
