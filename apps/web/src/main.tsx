import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { language } from './language.js';

document.documentElement.lang = language;
const root = document.querySelector('#root');

if (root === null) {
  throw new Error('Missing application root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
