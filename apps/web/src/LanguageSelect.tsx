import { changeLanguage, language, type Language } from './language.js';

const names: Record<Language, string> = { es: 'Español', en: 'English' };

/** Español / English, always at the bottom center of the page, where websites usually keep it. */
export function LanguageSelect() {
  return (
    <footer className="site-language">
      <label>
        <span className="visually-hidden">
          {language === 'en' ? 'Language' : 'Idioma'}
        </span>
        <select
          value={language}
          onChange={(event) => changeLanguage(event.target.value as Language)}
        >
          {(Object.keys(names) as Language[]).map((id) => (
            <option key={id} value={id} lang={id}>
              {names[id]}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
