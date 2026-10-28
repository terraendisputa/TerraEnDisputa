export type Language = 'es' | 'en';

const STORAGE_KEY = 'ted-language';

/**
 * The saved choice wins; otherwise the system language decides: Spanish for
 * any Spanish locale, English for everything else.
 */
export function readLanguage(
  storage: Pick<Storage, 'getItem'> | undefined,
  systemLanguages: readonly string[],
): Language {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* Storage can be blocked; the system language still applies. */
  }
  const first = systemLanguages[0]?.toLowerCase() ?? 'es';
  return first.startsWith('es') ? 'es' : 'en';
}

export const language: Language =
  typeof window === 'undefined'
    ? 'es'
    : readLanguage(
        (() => {
          try {
            return window.localStorage;
          } catch {
            return undefined;
          }
        })(),
        navigator.languages?.length
          ? navigator.languages
          : [navigator.language],
      );

/** Picks the text for the current language: `tr('Salir', 'Leave')`. */
export function tr(es: string, en: string): string {
  return language === 'en' ? en : es;
}

/** Saves the choice and reloads, so every screen and text picks it up. */
export function changeLanguage(next: Language): void {
  if (next === language) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Without storage the reload keeps the system language. */
  }
  window.location.reload();
}

/** Bot names that change in English; the rest keep their Argentine word. */
const BOT_NAMES_EN: Readonly<Record<string, string>> = {
  'Bot Bélico': 'Bot Warmonger',
  'Bot Seisdados': 'Bot Six-Dice',
  'Bot Tirabombas': 'Bot Bombthrower',
};

/** The name shown for a seat: the server keeps the Spanish bot names. */
export const displayNickname = (nickname: string) =>
  language === 'en' ? (BOT_NAMES_EN[nickname] ?? nickname) : nickname;

/** Parses a server reply, showing the bot names in the current language. */
export const parseServerJson = (text: string): unknown =>
  JSON.parse(text, (key, value: unknown) =>
    key === 'nickname' && typeof value === 'string'
      ? displayNickname(value)
      : value,
  );
