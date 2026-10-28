import { changeLanguage, language, type Language } from './language.js';
import { UiIcon } from './UiIcon.js';

const names: Record<Language, readonly [string, string]> = {
  es: ['Español', 'Idioma: Español'],
  en: ['English', 'Language: English'],
};

/**
 * Español / English, always at the bottom center of the page, where websites
 * usually keep it. `full` adds «Idioma:» / «Language:» (landing and admin).
 */
export function LanguageSelect({ full = false }: { readonly full?: boolean }) {
  return (
    <footer className="site-language">
      <label>
        <UiIcon name="globe" />
        <span className="visually-hidden">
          {language === 'en' ? 'Language' : 'Idioma'}
        </span>
        <select
          value={language}
          onChange={(event) => changeLanguage(event.target.value as Language)}
        >
          {(Object.keys(names) as Language[]).map((id) => (
            <option key={id} value={id} lang={id}>
              {names[id][full ? 1 : 0]}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
