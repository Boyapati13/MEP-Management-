export type AppLocale = 'en' | 'ar' | 'es' | 'fr';

const STORAGE_KEY = 'mep-app-locale';

const LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    liveSync: 'LIVE SYNC',
    syncing: 'SYNCING',
    jumpModule: 'Go to module...',
    dashboard: 'Dashboard',
    signIn: 'Sign In',
    createOrg: 'Create Organization',
    forgotPassword: 'Forgot Password?',
  },
  ar: {
    liveSync: 'مزامنة مباشرة',
    syncing: 'جاري المزامنة',
    jumpModule: 'الانتقال إلى الوحدة...',
    dashboard: 'لوحة التحكم',
    signIn: 'تسجيل الدخول',
    createOrg: 'إنشاء مؤسسة',
    forgotPassword: 'نسيت كلمة المرور؟',
  },
  es: {
    liveSync: 'EN VIVO',
    syncing: 'SINCRONIZANDO',
    jumpModule: 'Ir al módulo...',
    dashboard: 'Panel',
    signIn: 'Iniciar sesión',
    createOrg: 'Crear organización',
    forgotPassword: '¿Olvidó su contraseña?',
  },
  fr: {
    liveSync: 'EN DIRECT',
    syncing: 'SYNCHRONISATION',
    jumpModule: 'Aller au module...',
    dashboard: 'Tableau de bord',
    signIn: 'Connexion',
    createOrg: 'Créer une organisation',
    forgotPassword: 'Mot de passe oublié ?',
  },
};

const DOMAIN_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    dashboard: 'Overview',
    commercial: 'Commercial & Cost',
    delivery: 'Field & Operations',
    technical: 'Technical & Quality',
    controls: 'Governance & Risk',
    settings: 'Admin & Setup',
  },
  ar: {
    dashboard: 'نظرة عامة',
    commercial: 'التجارية والتكاليف',
    delivery: 'العمليات الميدانية',
    technical: 'الهندسة والجودة',
    controls: 'الحوكمة والمخاطر',
    settings: 'الإدارة والإعدادات',
  },
  es: {
    dashboard: 'Resumen',
    commercial: 'Comercial y Costos',
    delivery: 'Campo y Operaciones',
    technical: 'Técnica y Calidad',
    controls: 'Gobernanza y Riesgos',
    settings: 'Admin y Configuración',
  },
  fr: {
    dashboard: 'Aperçu',
    commercial: 'Commercial & Coûts',
    delivery: 'Chantier & Opérations',
    technical: 'Technique & Qualité',
    controls: 'Gouvernance & Risques',
    settings: 'Admin & Configuration',
  },
};

export function getSavedLocale(): AppLocale {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'ar' || val === 'es' || val === 'fr' || val === 'en') return val;
  } catch {}
  return 'en';
}

export function applyLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }
}

export function tLabel(locale: AppLocale, key: string): string {
  return LABELS[locale]?.[key] || LABELS.en[key] || key;
}

export function tDomain(locale: AppLocale, domainId: string, fallback?: string): string {
  return DOMAIN_LABELS[locale]?.[domainId] || fallback || DOMAIN_LABELS.en[domainId] || domainId;
}

export function formatMoney(amount: number | string | undefined | null, currency = 'USD'): string {
  const num = Number(amount || 0);
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${code} ${num.toLocaleString()}`;
  }
}
