/**
 * Event category and event type names in every page language (OSE-1764).
 *
 * WHY. The landing's "Kinds of events" cards and the event page's type line
 * printed the registry's English `display_name` / `name` on every page, so a
 * Spanish, Polish or Arabic page showed English cards (owner, 2026-11-28: "My
 * category cards do not translate to the selected language ... this applies to
 * all selected, available languages").
 *
 * WHAT. One table per language, keyed by the registry's own keys: the category
 * code (migration 0076) and the type id (migrations 0024, 0097, 0115). English
 * is the registry's own name, so its table is empty. The registry rows do not
 * change; this is only what a visitor reads. A code or id with no entry falls
 * back to the registry's English name, never to nothing.
 *
 * GATE. tests/event-type-names.spec.ts reads every category code and type id
 * from the migrations and fails if any language lacks a name for one, so a new
 * category or type cannot ship in English only.
 *
 * Polish and Arabic are machine drafts like the rest of their catalogs
 * (catalog-pl.ts, catalog-ar.ts headers): the named readers check them there.
 */

import type { Lang } from './languages';

type Names = Readonly<Record<string, string>>;

const CATEGORY_ES: Names = {
  REC: 'Deportes y recreación',
  SOC: 'Comidas y reuniones',
  ENT: 'Entretenimiento y trivia',
  PER: 'Escenario y micrófono abierto',
  ART: 'Arte, cultura y música en vivo',
  TAB: 'Juegos de mesa',
  MKT: 'Mercados del barrio',
  BIZ: 'Negocios y contactos',
  FND: 'Recaudación de fondos',
  VOL: 'Voluntariado y ayuda mutua',
  CIV: 'Vida cívica y del barrio',
  GAR: 'Jardinería y aire libre',
  FIT: 'Ejercicio y carreras',
  LIT: 'Lectura y clubes de libros',
  FAI: 'Comunidad de fe',
};

const CATEGORY_PL: Names = {
  REC: 'Sport i rekreacja',
  SOC: 'Spotkania i wspólne posiłki',
  ENT: 'Rozrywka i quizy',
  PER: 'Scena i otwarty mikrofon',
  ART: 'Sztuka, kultura i muzyka na żywo',
  TAB: 'Gry planszowe',
  MKT: 'Targi sąsiedzkie',
  BIZ: 'Biznes i kontakty',
  FND: 'Zbiórki',
  VOL: 'Wolontariat i pomoc sąsiedzka',
  CIV: 'Sprawy obywatelskie i sąsiedzkie',
  GAR: 'Ogród i plener',
  FIT: 'Ruch i bieganie',
  LIT: 'Książki i kluby czytelnicze',
  FAI: 'Wspólnota wiary',
};

const CATEGORY_AR: Names = {
  REC: 'الرياضة والترفيه',
  SOC: 'لقاءات ووجبات جماعية',
  ENT: 'تسلية ومسابقات',
  PER: 'المسرح والمايك المفتوح',
  ART: 'فنون وثقافة وموسيقى حية',
  TAB: 'ألعاب الطاولة',
  MKT: 'أسواق الحي',
  BIZ: 'الأعمال والتعارف المهني',
  FND: 'جمع التبرعات',
  VOL: 'التطوع والمساعدة المتبادلة',
  CIV: 'شؤون مدنية وشؤون الحي',
  GAR: 'البستنة والهواء الطلق',
  FIT: 'اللياقة والجري',
  LIT: 'الكتب ونوادي القراءة',
  FAI: 'مجتمع الإيمان',
};

const TYPE_ES: Names = {
  'etr-rec-bocce': 'Torneo de bochas',
  'etr-rec-softball': 'Partido de liga de sóftbol',
  'etr-rec-volleyball': 'Encuentro de voleibol',
  'etr-rec-cornhole': 'Torneo de cornhole',
  'etr-rec-pickup': 'Básquetbol informal',
  'etr-rec-kickball': 'Partido de kickball',
  'etr-soc-dinner': 'Cena comunitaria',
  'etr-soc-potluck': 'Comida compartida del barrio',
  'etr-soc-block': 'Fiesta de cuadra',
  'etr-soc-cookout': 'Parrillada comunitaria',
  'etr-soc-watchparty': 'Ver el partido juntos',
  'etr-mkt-flea': 'Mercado de pulgas',
  'etr-mkt-craft': 'Feria de artesanías',
  'etr-mkt-swap': 'Intercambio comunitario',
  'etr-art-gallery': 'Exposición de arte',
  'etr-art-music': 'Música en vivo',
  'etr-art-cultural': 'Festival cultural',
  'etr-art-mural': 'Presentación de un mural',
  'etr-art-photo': 'Exposición de fotos',
  'etr-vol-cleanup': 'Limpieza del barrio',
  'etr-vol-fooddrive': 'Colecta de alimentos',
  'etr-vol-mutual': 'Reparto de ayuda mutua',
  'etr-civ-meeting': 'Reunión de vecinos',
  'etr-civ-forum': 'Foro comunitario',
  'etr-civ-captain': 'Elección de capitán de cuadra',
  'etr-biz-network': 'Encuentro de negocios',
  'etr-biz-workshop': 'Taller de desarrollo profesional',
  'etr-biz-mixer': 'Encuentro del sector',
  'etr-fnd-auction': 'Subasta silenciosa',
  'etr-fnd-walkathon': 'Caminata o carrera solidaria',
  'etr-fnd-carwash': 'Lavado de autos solidario',
  'etr-ent-film': 'Proyección de película',
  'etr-ent-trivia': 'Noche de trivia',
  'etr-ent-gamenight': 'Noche de juegos',
  'etr-ent-karaoke': 'Noche de karaoke',
  'etr-gar-planting': 'Día de siembra en el huerto',
  'etr-gar-harvest': 'Fiesta de la cosecha',
  'etr-gar-trail': 'Caminata por la naturaleza',
  'etr-fai-service': 'Servicio de fe',
  'etr-fai-interfaith': 'Encuentro interreligioso',
  'etr-per-openmic': 'Noche de micrófono abierto',
  'etr-per-poetry': 'Slam de poesía',
  'etr-per-story': 'Noche de cuentos',
  'etr-per-storytime': 'Hora de cuentos',
  'etr-per-comedy': 'Noche de comedia',
  'etr-tab-boardgame': 'Noche de juegos de mesa',
  'etr-tab-rpg': 'Sesión de juego de rol',
  'etr-fit-running': 'Club de corredores',
  'etr-lit-bookclub': 'Club de lectura',
};

const TYPE_PL: Names = {
  'etr-rec-bocce': 'Turniej bocce',
  'etr-rec-softball': 'Mecz ligi softballu',
  'etr-rec-volleyball': 'Spotkanie siatkarskie',
  'etr-rec-cornhole': 'Turniej cornhole',
  'etr-rec-pickup': 'Koszykówka dla chętnych',
  'etr-rec-kickball': 'Mecz kickballa',
  'etr-soc-dinner': 'Wspólna kolacja',
  'etr-soc-potluck': 'Sąsiedzki składkowy posiłek',
  'etr-soc-block': 'Impreza uliczna',
  'etr-soc-cookout': 'Wspólny grill',
  'etr-soc-watchparty': 'Wspólne oglądanie',
  'etr-mkt-flea': 'Pchli targ',
  'etr-mkt-craft': 'Targi rękodzieła',
  'etr-mkt-swap': 'Wymiana sąsiedzka',
  'etr-art-gallery': 'Wystawa sztuki',
  'etr-art-music': 'Muzyka na żywo',
  'etr-art-cultural': 'Festiwal kultury',
  'etr-art-mural': 'Odsłonięcie muralu',
  'etr-art-photo': 'Wystawa zdjęć',
  'etr-vol-cleanup': 'Sprzątanie okolicy',
  'etr-vol-fooddrive': 'Zbiórka żywności',
  'etr-vol-mutual': 'Rozdawanie pomocy sąsiedzkiej',
  'etr-civ-meeting': 'Zebranie mieszkańców',
  'etr-civ-forum': 'Forum mieszkańców',
  'etr-civ-captain': 'Wybór gospodarza ulicy',
  'etr-biz-network': 'Spotkanie biznesowe',
  'etr-biz-workshop': 'Warsztat rozwoju zawodowego',
  'etr-biz-mixer': 'Spotkanie branżowe',
  'etr-fnd-auction': 'Cicha aukcja',
  'etr-fnd-walkathon': 'Marsz lub bieg charytatywny',
  'etr-fnd-carwash': 'Charytatywne mycie aut',
  'etr-ent-film': 'Pokaz filmu',
  'etr-ent-trivia': 'Wieczór quizowy',
  'etr-ent-gamenight': 'Wieczór gier',
  'etr-ent-karaoke': 'Wieczór karaoke',
  'etr-gar-planting': 'Dzień sadzenia w ogrodzie',
  'etr-gar-harvest': 'Święto plonów',
  'etr-gar-trail': 'Spacer szlakiem przyrody',
  'etr-fai-service': 'Nabożeństwo',
  'etr-fai-interfaith': 'Spotkanie różnych wyznań',
  'etr-per-openmic': 'Wieczór otwartego mikrofonu',
  'etr-per-poetry': 'Slam poetycki',
  'etr-per-story': 'Wieczór opowieści',
  'etr-per-storytime': 'Czas opowieści',
  'etr-per-comedy': 'Wieczór stand-upu',
  'etr-tab-boardgame': 'Wieczór gier planszowych',
  'etr-tab-rpg': 'Sesja gry fabularnej',
  'etr-fit-running': 'Spotkanie klubu biegowego',
  'etr-lit-bookclub': 'Spotkanie klubu książki',
};

const TYPE_AR: Names = {
  'etr-rec-bocce': 'بطولة بوتشي',
  'etr-rec-softball': 'مباراة دوري سوفتبول',
  'etr-rec-volleyball': 'لقاء كرة طائرة',
  'etr-rec-cornhole': 'بطولة كورنهول',
  'etr-rec-pickup': 'كرة سلة حرة',
  'etr-rec-kickball': 'مباراة كيكبول',
  'etr-soc-dinner': 'عشاء جماعي',
  'etr-soc-potluck': 'وجبة مشتركة في الحي',
  'etr-soc-block': 'حفلة الشارع',
  'etr-soc-cookout': 'شواء جماعي',
  'etr-soc-watchparty': 'مشاهدة جماعية',
  'etr-mkt-flea': 'سوق المستعمل',
  'etr-mkt-craft': 'معرض الحرف اليدوية',
  'etr-mkt-swap': 'سوق التبادل',
  'etr-art-gallery': 'معرض فني',
  'etr-art-music': 'موسيقى حية',
  'etr-art-cultural': 'مهرجان ثقافي',
  'etr-art-mural': 'إزاحة الستار عن جدارية',
  'etr-art-photo': 'معرض صور',
  'etr-vol-cleanup': 'تنظيف الحي',
  'etr-vol-fooddrive': 'حملة جمع الطعام',
  'etr-vol-mutual': 'توزيع المساعدات المتبادلة',
  'etr-civ-meeting': 'اجتماع سكان الحي',
  'etr-civ-forum': 'منتدى مجتمعي',
  'etr-civ-captain': 'انتخاب مسؤول الشارع',
  'etr-biz-network': 'لقاء أعمال',
  'etr-biz-workshop': 'ورشة تطوير مهني',
  'etr-biz-mixer': 'لقاء مهني',
  'etr-fnd-auction': 'مزاد صامت',
  'etr-fnd-walkathon': 'مشي أو جري خيري',
  'etr-fnd-carwash': 'غسيل سيارات خيري',
  'etr-ent-film': 'عرض فيلم',
  'etr-ent-trivia': 'أمسية مسابقات',
  'etr-ent-gamenight': 'أمسية ألعاب',
  'etr-ent-karaoke': 'أمسية كاريوكي',
  'etr-gar-planting': 'يوم الزراعة في الحديقة',
  'etr-gar-harvest': 'مهرجان الحصاد',
  'etr-gar-trail': 'نزهة في الطبيعة',
  'etr-fai-service': 'صلاة جماعية',
  'etr-fai-interfaith': 'لقاء بين الأديان',
  'etr-per-openmic': 'أمسية المايك المفتوح',
  'etr-per-poetry': 'أمسية شعر',
  'etr-per-story': 'أمسية حكايات',
  'etr-per-storytime': 'وقت الحكايات',
  'etr-per-comedy': 'أمسية كوميديا',
  'etr-tab-boardgame': 'أمسية ألعاب الطاولة',
  'etr-tab-rpg': 'جلسة لعب أدوار',
  'etr-fit-running': 'لقاء نادي الجري',
  'etr-lit-bookclub': 'لقاء نادي الكتاب',
};

/** Category names per language, keyed by `event_type_category_registry.category_code`. */
export const CATEGORY_NAMES: Readonly<Record<Lang, Names>> = {
  en: {},
  es: CATEGORY_ES,
  pl: CATEGORY_PL,
  ar: CATEGORY_AR,
};

/** Type names per language, keyed by `event_type_registry.id`. */
export const TYPE_NAMES: Readonly<Record<Lang, Names>> = {
  en: {},
  es: TYPE_ES,
  pl: TYPE_PL,
  ar: TYPE_AR,
};

function pick(table: Readonly<Record<Lang, Names>>, lang: Lang, key: string): string | undefined {
  const names = table[lang];
  return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : undefined;
}

/** A category's name in `lang`; the registry's own name when the code is unknown. */
export function categoryName(lang: Lang, code: string, registryName: string): string {
  return pick(CATEGORY_NAMES, lang, code) ?? registryName;
}

/** A type's name in `lang`; the registry's own name when the id is unknown. */
export function eventTypeName(lang: Lang, id: string, registryName: string): string {
  return pick(TYPE_NAMES, lang, id) ?? registryName;
}
