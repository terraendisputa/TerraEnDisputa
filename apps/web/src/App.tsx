import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, bootstrap } from './api.js';
import { errorMessage } from './errors.js';
import { PlayerEntry } from './PlayerEntry.js';
import { LanguageSelect } from './LanguageSelect.js';
import { invitationDestination } from './invitation.js';
import './tactical.css';
import './board-art.css';
import './host.css';
import './immersive.css';
import './landing-art.css';
import './site-controls.css';
import { tr } from './language.js';

// Each screen loads only when its route needs it.
const AdminScreen = lazy(() =>
  import('./AdminScreen.js').then((module) => ({
    default: module.AdminScreen,
  })),
);
const GameScreen = lazy(() =>
  import('./GameScreen.js').then((module) => ({
    default: module.GameScreen,
  })),
);
const ReconquistaGameScreen = lazy(() =>
  import('./ReconquistaGameScreen.js').then((module) => ({
    default: module.ReconquistaGameScreen,
  })),
);

function TransportWarning() {
  return (
    <div className="transport-warning" role="status">
      {tr(
        'La conexión no está cifrada. Usala solamente en una red confiable.',
        'The connection is not encrypted. Use it only on a trusted network.',
      )}
    </div>
  );
}

function Landing({ encrypted }: { readonly encrypted: boolean }) {
  const [gameId, setGameId] = useState('');
  const [inviteError, setInviteError] = useState('');
  return (
    <>
      {!encrypted && <TransportWarning />}
      <main className="landing">
        <header className="landing-hero">
          <p className="eyebrow">
            {tr(
              'Servidor propio · 2 a 6 jugadores',
              'Your own server · 2 to 6 players',
            )}
          </p>
          <h1>
            Terra en disputa,
            <br />
            {tr('en tu propia red.', 'on your own network.')}
          </h1>
          <p>
            {tr(
              'Creá una partida o entrá con el enlace que compartió el administrador.',
              'Create a game or join with the link the administrator shared.',
            )}
          </p>
        </header>
        <section className="panel landing-card">
          <h2>{tr('Entrar a una partida', 'Join a game')}</h2>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const destination = invitationDestination(gameId);
              if (!destination) {
                setInviteError(
                  tr(
                    'Pegá un enlace de partida HTTP/HTTPS o un ID válido.',
                    'Paste an HTTP/HTTPS game link or a valid ID.',
                  ),
                );
                return;
              }
              window.location.assign(destination);
            }}
          >
            <label>
              {tr(
                'Enlace de invitación o ID de partida',
                'Invitation link or game ID',
              )}
              <input
                required
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={gameId}
                onChange={(event) => setGameId(event.target.value)}
              />
            </label>
            {inviteError && (
              <p className="error-banner" role="alert">
                {inviteError}
              </p>
            )}
            <button type="submit">{tr('Continuar', 'Continue')}</button>
          </form>
          <hr />
          <a className="button-link secondary" href="/admin">
            {tr('Administrar servidor', 'Manage the server')}
          </a>
        </section>
        <LanguageSelect />
      </main>
    </>
  );
}

const seeking = (
  <main className="entry-layout">
    <section className="panel entry-panel" aria-live="polite">
      <h1>{tr('Buscando tu asiento…', 'Looking for your seat…')}</h1>
    </section>
  </main>
);

/** Classic and Reconquista games share /game/:id; the Reconquista store answers for its own games. */
function GameRoute({
  gameId,
  encrypted,
}: {
  readonly gameId: string;
  readonly encrypted: boolean;
}) {
  const [edition, setEdition] = useState<
    'checking' | 'classic' | 'reconquista'
  >('checking');
  useEffect(() => {
    void fetch(`/api/reconquista/games/${gameId}/entry`)
      .then((response) => response.ok)
      .catch(() => false)
      .then((found) => setEdition(found ? 'reconquista' : 'classic'));
  }, [gameId]);
  if (edition === 'checking') return seeking;
  if (edition === 'reconquista')
    return (
      <Suspense
        fallback={<p>{tr('Preparando Reconquista…', 'Preparing Retake…')}</p>}
      >
        <ReconquistaGameScreen gameId={gameId} />
      </Suspense>
    );
  return <ClassicGameRoute gameId={gameId} encrypted={encrypted} />;
}

function ClassicGameRoute({
  gameId,
  encrypted,
}: {
  readonly gameId: string;
  readonly encrypted: boolean;
}) {
  const forceEntry = new URLSearchParams(window.location.search).has('entry');
  const [session, setSession] = useState<'checking' | 'valid' | 'missing'>(
    forceEntry ? 'missing' : 'checking',
  );
  useEffect(() => {
    if (forceEntry) return;
    void api
      .playerState(gameId)
      .then(() => setSession('valid'))
      .catch(() => setSession('missing'));
  }, [forceEntry, gameId]);
  if (session === 'checking') return seeking;
  if (session === 'missing')
    return (
      <>
        {!encrypted && <TransportWarning />}
        <PlayerEntry
          gameId={gameId}
          onAuthenticated={() => setSession('valid')}
        />
      </>
    );
  return (
    <Suspense fallback={seeking}>
      <GameScreen gameId={gameId} />
    </Suspense>
  );
}

export function App() {
  const [server, setServer] = useState<
    'checking' | 'ready' | 'unavailable' | 'incompatible'
  >('checking');
  const [encrypted, setEncrypted] = useState(true);
  useEffect(() => {
    void bootstrap()
      .then((result) => {
        setEncrypted(result.encrypted);
        setServer('ready');
      })
      .catch((caught) =>
        setServer(
          caught instanceof ApiError && caught.code === 'PROTOCOL_MISMATCH'
            ? 'incompatible'
            : 'unavailable',
        ),
      );
  }, []);
  if (server !== 'ready')
    return (
      <main className="entry-layout">
        <section className="panel entry-panel" aria-live="polite">
          <p className={`connection ${server}`}>
            {server === 'checking'
              ? tr('Conectando', 'Connecting')
              : tr('Sin conexión', 'Offline')}
          </p>
          <h1>
            {server === 'checking'
              ? tr('Contactando al servidor…', 'Contacting the server…')
              : server === 'incompatible'
                ? tr('Versión incompatible', 'Incompatible version')
                : tr('Servidor no disponible', 'Server unavailable')}
          </h1>
          {server !== 'checking' && (
            <p>
              {errorMessage(
                server === 'incompatible'
                  ? 'PROTOCOL_MISMATCH'
                  : 'SERVER_ERROR',
              )}
            </p>
          )}
          {server !== 'checking' && (
            <button type="button" onClick={() => window.location.reload()}>
              {tr('Reintentar', 'Retry')}
            </button>
          )}
        </section>
      </main>
    );
  const path = window.location.pathname;
  let content;
  if (path === '/admin')
    content = (
      <>
        {!encrypted && <TransportWarning />}
        <Suspense fallback={seeking}>
          <AdminScreen />
        </Suspense>
      </>
    );
  const match = /^\/game\/([0-9a-f-]+)$/i.exec(path);
  if (match) content = <GameRoute gameId={match[1]!} encrypted={encrypted} />;
  content ??= <Landing encrypted={encrypted} />;
  return content;
}
