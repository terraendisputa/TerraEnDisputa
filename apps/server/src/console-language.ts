/**
 * Terminal messages follow the system language, like the browser does:
 * Spanish when the locale starts with "es", English otherwise.
 */
export function consoleLanguage(
  environment: NodeJS.ProcessEnv = process.env,
): 'es' | 'en' {
  const locale =
    environment['LC_ALL'] ||
    environment['LC_MESSAGES'] ||
    environment['LANG'] ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  return /^es(?:$|[_.@-])/i.test(locale) ? 'es' : 'en';
}

const language = consoleLanguage();

/** Picks the Spanish or English text, in the same order as the web client. */
export const tr = (es: string, en: string): string =>
  language === 'es' ? es : en;
