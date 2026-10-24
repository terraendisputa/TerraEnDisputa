import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, bootstrap } from './api.js';
import { errorMessage } from './errors.js';
import { PlayerEntry } from './PlayerEntry.js';
import { invitationDestination } from './invitation.js';
import './tactical.css';
import './board-art.css';
import './host.css';
import './immersive.css';
import './landing-art.css';

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
      La conexión no está cifrada. Usala solamente en una red confiable.
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
          <p className="eyebrow">Servidor propio · 2 a 6 jugadores</p>
          <h1>
            Terra en disputa,
            <br />
            en tu propia red.
          </h1>
          <p>
            Creá una partida o entrá con el enlace que compartió el
            administrador.
          </p>
        </header>
        <section className="panel landing-card">
          <h2>Entrar a una partida</h2>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const destination = invitationDestination(gameId);
              if (!destination) {
                setInviteError(
                  'Pegá un enlace de partida HTTP/HTTPS o un ID válido.',
                );
                return;
              }
              window.location.assign(destination);
            }}
          >
            <label>
              Enlace de invitación o ID de partida
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
            <button type="submit">Continuar</button>
          </form>
          <hr />
          <a className="button-link secondary" href="/admin">
            Administrar servidor
          </a>
        </section>
      </main>
    </>
  );
}

const seeking = (
  <main className="entry-layout">
    <section className="panel entry-panel" aria-live="polite">
      <h1>Buscando tu asiento…</h1>
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
      <Suspense fallback={<p>Preparando Reconquista…</p>}>
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
            {server === 'checking' ? 'Conectando' : 'Sin conexión'}
          </p>
          <h1>
            {server === 'checking'
              ? 'Contactando al servidor…'
              : server === 'incompatible'
                ? 'Versión incompatible'
                : 'Servidor no disponible'}
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
              Reintentar
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
