import { changeLanguage, language, type Language } from './language.js';

const options: readonly [Language, string, string][] = [
  ['es', 'ES', 'Español'],
  ['en', 'EN', 'English'],
];

/** Español / English switch for the landing, the lobby and the admin. */
export function LanguageSelect() {
  return (
    <div
      className="language-select"
      role="group"
      aria-label={language === 'en' ? 'Language' : 'Idioma'}
    >
      {options.map(([id, short, name]) => (
        <button
          key={id}
          type="button"
          className="secondary"
          lang={id}
          aria-pressed={language === id}
          title={name}
          aria-label={name}
          onClick={() => changeLanguage(id)}
        >
          {short}
        </button>
      ))}
    </div>
  );
}
