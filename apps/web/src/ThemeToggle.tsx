import { readThemePreference } from './theme-preference.js';
import { useEffect, useState } from 'react';
import { UiIcon } from './UiIcon.js';
import { tr } from './language.js';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return readThemePreference(localStorage);
    } catch {
      return 'dark';
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
        theme === 'dark'
          ? tr('Cambiar a modo claro', 'Switch to light mode')
          : tr('Cambiar a modo oscuro', 'Switch to dark mode')
      }
      aria-label={
        theme === 'dark'
          ? tr('Cambiar a modo claro', 'Switch to light mode')
          : tr('Cambiar a modo oscuro', 'Switch to dark mode')
      }
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <UiIcon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
