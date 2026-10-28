import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { language } from './language.js';
import { readThemePreference } from './theme-preference.js';
import { applyTextSize } from './text-size.js';

document.documentElement.lang = language;
try {
  document.documentElement.dataset.theme = readThemePreference(localStorage);
} catch {
  document.documentElement.dataset.theme = 'dark';
}
applyTextSize();
const root = document.querySelector('#root');

if (root === null) {
  throw new Error('Missing application root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
