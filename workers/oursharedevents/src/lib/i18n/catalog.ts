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
 */
import { DEFAULT_LANG, INTL_LOCALE, LANGUAGES, type Lang } from './languages';

const en = {
  'share.label': 'Share this event',
  'share.copied': 'Link copied!',
  'calendar.label': 'Add to calendar',
  'calendar.ics': 'Apple or Outlook',
  'directions.pre': 'Get directions',
  'directions.live': 'Navigate now',
  'video.watch': '▶ Watch the video',
  'back.label': 'Back',
  'language.label': 'Language',
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
  'card.recapLabel': 'See how {name} went',
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
  'area.where': 'Where',
  'area.all': 'All',
  'area.online': 'Online',
  'area.inPerson': 'In person',
  'area.view': 'View',
  'area.list': 'List',
  'area.map': 'Map',
  // The neighborhood map (lib/attendee-map.ts).
  'map.near': 'near {venue}',
  'map.exampleLabel':
    'Example map: three neighborhoods drawn as numbered hexagons, the busiest shaded deepest',
  'map.listedBelow': '{note} &mdash; every event is listed below.',
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
  'map.credit': 'Street map data © {osm} contributors.',
  'map.tapToZoom': 'Tap a hexagon to see its events on the map.',
  'map.zoomIn': 'Zoom in',
  'map.allAreas': 'Back to all areas',
  'map.zoomCaption':
    '{events} in this area over the next {days} days. A solid dot is the place itself; a pale dot marks only its block.',
  'map.zoomCaptionNamed':
    '{events} in this area ({name}) over the next {days} days. A solid dot is the place itself; a pale dot marks only its block.',
  'map.zoomEmpty': '<strong>No upcoming events in this area.</strong>',
  'map.unplaced': 'Somewhere in this area',
  'map.dotTitle': 'Spot {n}: {count}',
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
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'share.label': 'Compartir este evento',
  'share.copied': 'Enlace copiado',
  'calendar.label': 'Agregar al calendario',
  'calendar.ics': 'Apple u Outlook',
  'directions.pre': 'Cómo llegar',
  'directions.live': 'Cómo llegar',
  'video.watch': '▶ Ver el video',
  'back.label': 'Volver',
  'language.label': 'Idioma',
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
  'card.recapLabel': 'Ver cómo salió {name}',
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
  'area.where': 'Dónde',
  'area.all': 'Todos',
  'area.online': 'En línea',
  'area.inPerson': 'En persona',
  'area.view': 'Vista',
  'area.list': 'Lista',
  'area.map': 'Mapa',
  'map.near': 'cerca de {venue}',
  'map.exampleLabel':
    'Mapa de ejemplo: tres barrios dibujados como hexágonos numerados; el de más actividad, con el tono más oscuro',
  'map.listedBelow': '{note} &mdash; todos los eventos aparecen abajo.',
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
  'map.credit': 'Datos del mapa de calles © colaboradores de {osm}.',
  'map.tapToZoom': 'Toca un hexágono para ver sus eventos en el mapa.',
  'map.zoomIn': 'Acercar',
  'map.allAreas': 'Volver a todas las zonas',
  'map.zoomCaption':
    '{events} en esta zona en los próximos {days} días. Un punto sólido es el lugar exacto; un punto claro marca solo su cuadra.',
  'map.zoomCaptionNamed':
    '{events} en esta zona ({name}) en los próximos {days} días. Un punto sólido es el lugar exacto; un punto claro marca solo su cuadra.',
  'map.zoomEmpty': '<strong>No hay eventos próximos en esta zona.</strong>',
  'map.unplaced': 'En algún lugar de esta zona',
  'map.dotTitle': 'Punto {n}: {count}',
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
};

/** One catalog per language. A language still being written may omit keys. */
export const CATALOG: Record<Lang, Partial<Record<MessageKey, string>>> = { en, es };

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
