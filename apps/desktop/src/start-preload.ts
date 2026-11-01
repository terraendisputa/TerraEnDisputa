// Runs only for the app's own start page (start.html). Game pages loaded in
// the same window get nothing from it: it checks where it is before
// touching the page, and the main process checks the sender again.
import { ipcRenderer } from 'electron';

interface StartState {
  readonly spanish: boolean;
  readonly serverRunning: boolean;
  readonly error?: string;
}

if (location.origin === 'ted://app' && location.pathname === '/start.html')
  window.addEventListener('DOMContentLoaded', () => {
    void (async () => {
      const state = (await ipcRenderer.invoke('start:state')) as StartState;
      const lang = state.spanish ? 'es' : 'en';
      document.documentElement.lang = lang;
      for (const element of document.querySelectorAll<HTMLElement>(
        `[data-${lang}]`,
      ))
        element.textContent = element.dataset[lang] ?? '';
      const form = document.getElementById('join') as HTMLFormElement;
      const link = document.getElementById('link') as HTMLInputElement;
      const joinButton = document.getElementById(
        'join-button',
      ) as HTMLButtonElement;
      const error = document.getElementById('join-error') as HTMLElement;
      const server = document.getElementById('server') as HTMLButtonElement;
      if (state.serverRunning)
        server.textContent =
          server.dataset[state.spanish ? 'runningEs' : 'runningEn'] ?? '';
      error.textContent = state.error ?? '';
      link.addEventListener('input', () => (error.textContent = ''));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        joinButton.disabled = true;
        void (
          ipcRenderer.invoke('start:join', link.value) as Promise<string>
        ).then((problem) => {
          error.textContent = problem;
          joinButton.disabled = false;
          if (problem) link.focus();
        });
      });
      server.addEventListener('click', () => {
        server.disabled = true;
        if (!state.serverRunning)
          server.textContent = state.spanish ? 'Iniciando…' : 'Starting…';
        void ipcRenderer.invoke('start:server');
      });
      link.focus();
    })();
  });
