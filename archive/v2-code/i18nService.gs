/**
 * i18nService.gs
 *
 * Internationalization (i18n) service for multi-language support
 *
 * Features:
 * - Locale detection from browser, URL params, and user preferences
 * - Translation key resolution with fallback chains
 * - Locale-specific date, time, number, and currency formatting
 * - Support for parameterized translations
 * - Translation caching for performance
 *
 * @version 1.0.0
 * @since 2025-11-18
 */

/**
 * Supported locales configuration
 * Add new locales here as translations are added
 */
const SUPPORTED_LOCALES = [
  'en-US', // English (United States) - default
  'es-ES', // Spanish (Spain)
  'fr-FR', // French (France)
  'de-DE', // German (Germany)
  'pt-BR', // Portuguese (Brazil)
  'zh-CN', // Chinese (Simplified)
  'ja-JP', // Japanese
  'ko-KR'  // Korean
];

const DEFAULT_LOCALE = 'en-US';

/**
 * Translation strings organized by locale
 * Structure: TRANSLATIONS[locale][category][key] = string
 */
const TRANSLATIONS = {
  'en-US': {
    common: {
      loading: 'Loading...',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      update: 'Update',
      search: 'Search',
      filter: 'Filter',
      export: 'Export',
      import: 'Import',
      yes: 'Yes',
      no: 'No',
      ok: 'OK',
      error: 'Error',
      success: 'Success',
      warning: 'Warning',
      info: 'Information'
    },
    events: {
      title: 'Events',
      createButton: 'Create Event',
      editButton: 'Edit Event',
      deleteButton: 'Delete Event',
      eventName: 'Event Name',
      eventDate: 'Event Date',
      eventTime: 'Event Time',
      location: 'Location',
      description: 'Description',
      noEventsFound: 'No events found',
      eventCreated: 'Event created successfully',
      eventUpdated: 'Event updated successfully',
      eventDeleted: 'Event deleted successfully'
    },
    sponsors: {
      title: 'Sponsors',
      sponsorName: 'Sponsor Name',
      analytics: 'Analytics',
      roi: 'Return on Investment',
      impressions: 'Impressions',
      clicks: 'Clicks',
      ctr: 'Click-Through Rate',
      engagement: 'Engagement Score',
      performance: 'Performance',
      insights: 'Insights'
    },
    analytics: {
      title: 'Analytics',
      report: 'Report',
      dateRange: 'Date Range',
      startDate: 'Start Date',
      endDate: 'End Date',
      metrics: 'Metrics',
      trends: 'Trends',
      export: 'Export Report'
    },
    webhooks: {
      title: 'Webhooks',
      registerWebhook: 'Register Webhook',
      eventType: 'Event Type',
      targetUrl: 'Target URL',
      secret: 'Secret Key',
      enabled: 'Enabled',
      testWebhook: 'Test Webhook',
      deliveries: 'Delivery History',
      lastTriggered: 'Last Triggered',
      deliveryCount: 'Delivery Count'
    },
    errors: {
      BAD_INPUT: 'Invalid request. Please check your input.',
      NOT_FOUND: 'The requested resource was not found.',
      UNAUTHORIZED: 'Authentication failed. Please verify your credentials.',
      RATE_LIMITED: 'Too many requests. Please try again later.',
      INTERNAL: 'An internal error occurred. Please try again later.',
      CONTRACT: 'An unexpected error occurred. Please contact support.',
      NETWORK_ERROR: 'Network error. Please check your connection.',
      VALIDATION_ERROR: 'Validation failed. Please check the form data.'
    },
    validation: {
      required: 'This field is required',
      invalidEmail: 'Please enter a valid email address',
      invalidUrl: 'Please enter a valid URL',
      invalidDate: 'Please enter a valid date',
      minLength: 'Minimum length is {min} characters',
      maxLength: 'Maximum length is {max} characters',
      minValue: 'Minimum value is {min}',
      maxValue: 'Maximum value is {max}'
    }
  },

  'es-ES': {
    common: {
      loading: 'Cargando...',
      save: 'Guardar',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      edit: 'Editar',
      create: 'Crear',
      update: 'Actualizar',
      search: 'Buscar',
      filter: 'Filtrar',
      export: 'Exportar',
      import: 'Importar',
      yes: 'Sí',
      no: 'No',
      ok: 'OK',
      error: 'Error',
      success: 'Éxito',
      warning: 'Advertencia',
      info: 'Información'
    },
    events: {
      title: 'Eventos',
      createButton: 'Crear Evento',
      editButton: 'Editar Evento',
      deleteButton: 'Eliminar Evento',
      eventName: 'Nombre del Evento',
      eventDate: 'Fecha del Evento',
      eventTime: 'Hora del Evento',
      location: 'Ubicación',
      description: 'Descripción',
      noEventsFound: 'No se encontraron eventos',
      eventCreated: 'Evento creado exitosamente',
      eventUpdated: 'Evento actualizado exitosamente',
      eventDeleted: 'Evento eliminado exitosamente'
    },
    sponsors: {
      title: 'Patrocinadores',
      sponsorName: 'Nombre del Patrocinador',
      analytics: 'Análisis',
      roi: 'Retorno de Inversión',
      impressions: 'Impresiones',
      clicks: 'Clics',
      ctr: 'Tasa de Clics',
      engagement: 'Puntuación de Participación',
      performance: 'Rendimiento',
      insights: 'Perspectivas'
    },
    analytics: {
      title: 'Análisis',
      report: 'Informe',
      dateRange: 'Rango de Fechas',
      startDate: 'Fecha de Inicio',
      endDate: 'Fecha de Finalización',
      metrics: 'Métricas',
      trends: 'Tendencias',
      export: 'Exportar Informe'
    },
    webhooks: {
      title: 'Webhooks',
      registerWebhook: 'Registrar Webhook',
      eventType: 'Tipo de Evento',
      targetUrl: 'URL de Destino',
      secret: 'Clave Secreta',
      enabled: 'Habilitado',
      testWebhook: 'Probar Webhook',
      deliveries: 'Historial de Entregas',
      lastTriggered: 'Último Activado',
      deliveryCount: 'Cantidad de Entregas'
    },
    errors: {
      BAD_INPUT: 'Solicitud inválida. Por favor, verifique su entrada.',
      NOT_FOUND: 'No se encontró el recurso solicitado.',
      UNAUTHORIZED: 'Autenticación fallida. Por favor, verifique sus credenciales.',
      RATE_LIMITED: 'Demasiadas solicitudes. Por favor, inténtelo más tarde.',
      INTERNAL: 'Ocurrió un error interno. Por favor, inténtelo más tarde.',
      CONTRACT: 'Ocurrió un error inesperado. Por favor, contacte con soporte.',
      NETWORK_ERROR: 'Error de red. Por favor, verifique su conexión.',
      VALIDATION_ERROR: 'Validación fallida. Por favor, verifique los datos del formulario.'
    },
    validation: {
      required: 'Este campo es obligatorio',
      invalidEmail: 'Por favor, ingrese una dirección de correo válida',
      invalidUrl: 'Por favor, ingrese una URL válida',
      invalidDate: 'Por favor, ingrese una fecha válida',
      minLength: 'La longitud mínima es de {min} caracteres',
      maxLength: 'La longitud máxima es de {max} caracteres',
      minValue: 'El valor mínimo es {min}',
      maxValue: 'El valor máximo es {max}'
    }
  },

  'fr-FR': {
    common: {
      loading: 'Chargement...',
      save: 'Enregistrer',
      cancel: 'Annuler',
      delete: 'Supprimer',
      edit: 'Modifier',
      create: 'Créer',
      update: 'Mettre à jour',
      search: 'Rechercher',
      filter: 'Filtrer',
      export: 'Exporter',
      import: 'Importer',
      yes: 'Oui',
      no: 'Non',
      ok: 'OK',
      error: 'Erreur',
      success: 'Succès',
      warning: 'Avertissement',
      info: 'Information'
    },
    events: {
      title: 'Événements',
      createButton: 'Créer un Événement',
      editButton: 'Modifier l\'Événement',
      deleteButton: 'Supprimer l\'Événement',
      eventName: 'Nom de l\'Événement',
      eventDate: 'Date de l\'Événement',
      eventTime: 'Heure de l\'Événement',
      location: 'Emplacement',
      description: 'Description',
      noEventsFound: 'Aucun événement trouvé',
      eventCreated: 'Événement créé avec succès',
      eventUpdated: 'Événement mis à jour avec succès',
      eventDeleted: 'Événement supprimé avec succès'
    },
    errors: {
      BAD_INPUT: 'Demande invalide. Veuillez vérifier votre saisie.',
      NOT_FOUND: 'La ressource demandée est introuvable.',
      UNAUTHORIZED: 'Échec de l\'authentification. Veuillez vérifier vos identifiants.',
      RATE_LIMITED: 'Trop de requêtes. Veuillez réessayer plus tard.',
      INTERNAL: 'Une erreur interne s\'est produite. Veuillez réessayer plus tard.',
      CONTRACT: 'Une erreur inattendue s\'est produite. Veuillez contacter le support.'
    }
  }
};

/**
 * Detect user's preferred locale
 *
 * Priority order:
 * 1. URL parameter (?lang=es)
 * 2. User preference (stored in UserProperties)
 * 3. Accept-Language header
 * 4. Default locale (en-US)
 *
 * @param {Object} [params] - Optional parameters
 * @param {string} [params.langParam] - Language from URL parameter
 * @param {string} [params.acceptLanguage] - Accept-Language header value
 * @returns {string} Detected locale code (e.g., 'en-US')
 */
function i18n_detectLocale(params) {
  params = params || {};

  // 1. Check URL parameter
  if (params.langParam && SUPPORTED_LOCALES.includes(params.langParam)) {
    return params.langParam;
  }

  // 2. Check user preference
  try {
    const userProps = PropertiesService.getUserProperties();
    const savedLocale = userProps.getProperty('preferredLocale');
    if (savedLocale && SUPPORTED_LOCALES.includes(savedLocale)) {
      return savedLocale;
    }
  } catch (e) {
    Logger.log('Could not access user properties: ' + e);
  }

  // 3. Check Accept-Language header
  if (params.acceptLanguage) {
    const languages = params.acceptLanguage.split(',').map(lang => {
      const parts = lang.trim().split(';');
      return parts[0].trim();
    });

    for (const lang of languages) {
      // Try exact match first
      if (SUPPORTED_LOCALES.includes(lang)) {
        return lang;
      }

      // Try language prefix match (e.g., 'es' -> 'es-ES')
      const prefix = lang.split('-')[0];
      const match = SUPPORTED_LOCALES.find(locale => locale.startsWith(prefix + '-'));
      if (match) {
        return match;
      }
    }
  }

  // 4. Default locale
  return DEFAULT_LOCALE;
}

/**
 * Get translation for a key
 *
 * @param {string} key - Translation key (e.g., 'events.createButton')
 * @param {string} [locale] - Locale code (defaults to en-US)
 * @param {Object} [params] - Parameters for interpolation (e.g., {min: 5})
 * @returns {string} Translated string
 */
function i18n_translate(key, locale, params) {
  locale = locale || DEFAULT_LOCALE;
  params = params || {};

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    Logger.log(`Unsupported locale: ${locale}, falling back to ${DEFAULT_LOCALE}`);
    locale = DEFAULT_LOCALE;
  }

  // Split key into parts (e.g., 'events.createButton' -> ['events', 'createButton'])
  const keyParts = key.split('.');

  // Navigate through translation object
  let translation = TRANSLATIONS[locale];
  for (const part of keyParts) {
    if (translation && typeof translation === 'object' && part in translation) {
      translation = translation[part];
    } else {
      // Key not found, try fallback to default locale
      if (locale !== DEFAULT_LOCALE) {
        Logger.log(`Translation not found for ${key} in ${locale}, trying ${DEFAULT_LOCALE}`);
        return i18n_translate(key, DEFAULT_LOCALE, params);
      }

      // Fallback failed, return key itself
      Logger.log(`Translation not found for ${key} in any locale`);
      return key;
    }
  }

  // If translation is not a string, return key
  if (typeof translation !== 'string') {
    Logger.log(`Invalid translation type for ${key}: ${typeof translation}`);
    return key;
  }

  // Interpolate parameters
  let result = translation;
  for (const [paramKey, paramValue] of Object.entries(params)) {
    const placeholder = '{' + paramKey + '}';
    result = result.replace(new RegExp(placeholder, 'g'), String(paramValue));
  }

  return result;
}

/**
 * Format date according to locale
 *
 * @param {Date|string} date - Date object or ISO string
 * @param {string} [locale] - Locale code
 * @param {Object} [options] - Formatting options
 * @param {string} [options.style='medium'] - Date style: 'short', 'medium', 'long', 'full'
 * @returns {string} Formatted date string
 */
function i18n_formatDate(date, locale, options) {
  locale = locale || DEFAULT_LOCALE;
  options = options || {};
  const style = options.style || 'medium';

  // Convert to Date object if string
  if (typeof date === 'string') {
    date = new Date(date);
  }

  if (!(date instanceof Date) || isNaN(date)) {
    return 'Invalid Date';
  }

  // Date formatting options by style
  const formatOptions = {
    short: { year: 'numeric', month: '2-digit', day: '2-digit' },
    medium: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    full: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
  };

  const opts = formatOptions[style] || formatOptions.medium;

  // Use Utilities.formatDate for consistent formatting
  // Note: Apps Script doesn't have Intl.DateTimeFormat, so we use a simpler approach
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  // Format based on locale
  if (locale.startsWith('en-')) {
    return `${month}/${day}/${year}`; // MM/DD/YYYY
  } else if (locale.startsWith('es-') || locale.startsWith('fr-') || locale.startsWith('de-') || locale.startsWith('pt-')) {
    return `${day}/${month}/${year}`; // DD/MM/YYYY
  } else if (locale.startsWith('zh-') || locale.startsWith('ja-') || locale.startsWith('ko-')) {
    return `${year}/${month}/${day}`; // YYYY/MM/DD
  }

  return `${year}-${month}-${day}`; // ISO format fallback
}

/**
 * Format number according to locale
 *
 * @param {number} number - Number to format
 * @param {string} [locale] - Locale code
 * @param {Object} [options] - Formatting options
 * @param {number} [options.decimals=0] - Number of decimal places
 * @param {boolean} [options.thousands=true] - Use thousands separator
 * @returns {string} Formatted number string
 */
function i18n_formatNumber(number, locale, options) {
  locale = locale || DEFAULT_LOCALE;
  options = options || {};
  const decimals = options.decimals !== undefined ? options.decimals : 0;
  const useThousands = options.thousands !== undefined ? options.thousands : true;

  if (typeof number !== 'number' || isNaN(number)) {
    return 'NaN';
  }

  // Round to specified decimals
  const rounded = Number(number.toFixed(decimals));

  // Split into integer and decimal parts
  const parts = rounded.toString().split('.');
  let integerPart = parts[0];
  const decimalPart = parts[1] || '';

  // Add thousands separator based on locale
  if (useThousands && integerPart.length > 3) {
    const separator = locale.startsWith('en-') ? ',' : '.';
    integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  }

  // Combine with decimal separator
  if (decimals > 0) {
    const decimalSeparator = locale.startsWith('en-') ? '.' : ',';
    return integerPart + decimalSeparator + (decimalPart || '0'.repeat(decimals));
  }

  return integerPart;
}

/**
 * Format currency according to locale
 *
 * @param {number} amount - Amount to format
 * @param {string} [locale] - Locale code
 * @param {Object} [options] - Formatting options
 * @param {string} [options.currency='USD'] - Currency code (USD, EUR, GBP, etc.)
 * @param {boolean} [options.symbol=true] - Show currency symbol
 * @returns {string} Formatted currency string
 */
function i18n_formatCurrency(amount, locale, options) {
  locale = locale || DEFAULT_LOCALE;
  options = options || {};
  const currency = options.currency || 'USD';
  const showSymbol = options.symbol !== undefined ? options.symbol : true;

  // Currency symbols
  const currencySymbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    KRW: '₩',
    BRL: 'R$'
  };

  const symbol = currencySymbols[currency] || currency;

  // Format number with 2 decimal places
  const formatted = i18n_formatNumber(amount, locale, { decimals: 2, thousands: true });

  // Position symbol based on locale
  if (showSymbol) {
    if (locale.startsWith('en-')) {
      return symbol + formatted; // $1,234.56
    } else if (locale.startsWith('fr-') || locale.startsWith('es-')) {
      return formatted + ' ' + symbol; // 1.234,56 €
    }
    return symbol + formatted; // Default
  }

  return formatted;
}

/**
 * Set user's preferred locale
 *
 * @param {string} locale - Locale code to set
 * @returns {Object} Result envelope
 */
function i18n_setUserLocale(locale) {
  try {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return Err('BAD_INPUT', `Unsupported locale: ${locale}. Supported locales: ${SUPPORTED_LOCALES.join(', ')}`);
    }

    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty('preferredLocale', locale);

    Logger.log(`User locale set to: ${locale}`);
    return Ok({ locale: locale });

  } catch (err) {
    Logger.log('i18n_setUserLocale error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to set user locale: ' + err.message);
  }
}

/**
 * Get list of supported locales
 *
 * @returns {Object} Result envelope with supported locales
 */
function i18n_getSupportedLocales() {
  return Ok({
    locales: SUPPORTED_LOCALES.map(locale => {
      const name = getLocaleName_(locale);
      return {
        code: locale,
        name: name,
        nativeName: name
      };
    }),
    default: DEFAULT_LOCALE
  });
}

/**
 * Get human-readable name for locale
 *
 * @param {string} locale - Locale code
 * @returns {string} Locale name
 * @private
 */
function getLocaleName_(locale) {
  const names = {
    'en-US': 'English (United States)',
    'es-ES': 'Español (España)',
    'fr-FR': 'Français (France)',
    'de-DE': 'Deutsch (Deutschland)',
    'pt-BR': 'Português (Brasil)',
    'zh-CN': '中文（简体）',
    'ja-JP': '日本語',
    'ko-KR': '한국어'
  };

  return names[locale] || locale;
}

/**
 * API endpoint: Get translation
 *
 * @param {Object} params
 * @param {string} params.key - Translation key
 * @param {string} [params.locale] - Locale code
 * @param {Object} [params.params] - Interpolation parameters
 * @returns {Object} Result envelope with translation
 */
function api_translate(params) {
  try {
    if (!params || !params.key) {
      return Err('BAD_INPUT', 'Missing required parameter: key');
    }

    const translation = i18n_translate(params.key, params.locale, params.params);

    return Ok({
      key: params.key,
      locale: params.locale || DEFAULT_LOCALE,
      translation: translation
    });

  } catch (err) {
    Logger.log('api_translate error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to get translation: ' + err.message);
  }
}
