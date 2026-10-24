import { readThemePreference } from './theme-preference.js';
import { useEffect, useState } from 'react';
import { UiIcon } from './UiIcon.js';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return readThemePreference(localStorage);
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ted-theme', theme);
    } catch {
      /* The theme still works when storage is unavailable. */
    }
  }, [theme]);
  return (
    <button
      type="button"
      className="theme-toggle secondary"
      aria-pressed={theme === 'dark'}
      title={
        theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
      }
      aria-label={
        theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
      }
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <UiIcon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
