import { GAME_NAME, GAME_SHORT_NAME } from './identity.js';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { AdminGameView } from '@game/protocol';
import { gameClockDurationMs } from '@game/game-engine';

import { competitiveRoundLabel } from './competitive-results.js';
import { CompetitiveResultsPanel } from './CompetitiveResultsPanel.js';
import { api, ApiError } from './api.js';
import { errorMessage } from './errors.js';
import { objectiveText } from './objectives.js';
import { playerColorLabel } from './colors.js';
import { redeemAdminLaunch } from './admin-launch.js';
import { AdminBoxes } from './AdminBoxes.js';
import { LanguageSelect } from './LanguageSelect.js';
import { TextSizeToggle } from './TextSizeToggle.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UiIcon } from './UiIcon.js';
import { clockText } from './TurnSummary.js';
import { clockState, durationText } from './admin-clock.js';
import { ReconquistaAdminDetail } from './ReconquistaAdmin.js';
import { PHASE_LABELS } from './game-presentation.js';
import {
  ReconquistaRequestError,
  reconquistaErrorMessage,
  reconquistaRequest,
} from './reconquista-client.js';
import { tr } from './language.js';

interface ReconquistaGameSummary {
  readonly gameId: string;
  readonly playerCount: number;
  readonly players: number;
  readonly started: boolean;
  readonly finished?: boolean;
}

const STATUS_LABELS = {
  LOBBY: tr('Esperando jugadores', 'Waiting for players'),
  SETUP: tr('Preparando el tablero', 'Preparing the board'),
  ACTIVE: tr('En juego', 'Playing'),
  FINISHED: tr('Finalizada', 'Finished'),
};
const SETUP_LABELS = {
  additional_armies: tr('Refuerzos iniciales', 'Initial reinforcements'),
  territory_deal: tr('Reparto de territorios', 'Territory deal'),
  leftover_awards: tr('Territorios sobrantes', 'Leftover territories'),
  starting_order: tr('Orden inicial', 'Starting order'),
  reinforcement: tr('Refuerzos de preparación', 'Setup reinforcements'),
};

const gameDeletionConfirmation = (
  game: Pick<AdminGameView, 'gameId' | 'status'>,
) =>
  game.status === 'SETUP' || game.status === 'ACTIVE'
    ? tr(
        `La partida ${game.gameId} ya está en curso. Eliminarla es destructivo y terminará inmediatamente las sesiones conectadas y el acceso a la partida. ¿Eliminar definitivamente?`,
        `Game ${game.gameId} is already in progress. Deleting it is destructive and immediately ends the connected sessions and access to the game. Delete it for good?`,
      )
    : tr(
        `Eliminar definitivamente la partida ${game.gameId}?`,
        `Delete game ${game.gameId} for good?`,
      );

const groupLabel = (group: 'En curso' | 'Finalizadas') =>
  group === 'Finalizadas'
    ? tr('Finalizadas', 'Finished')
    : tr('En curso', 'In progress');

async function deleteGameAfterConfirmation(
  game: Pick<AdminGameView, 'gameId' | 'status'>,
  deleteGame: (gameId: string) => Promise<unknown>,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
) {
  if (!confirm(gameDeletionConfirmation(game))) return false;
  await deleteGame(game.gameId);
  return true;
}

export function AdminScreen() {
  const [wideAdmin, setWideAdmin] = useState(
    () => window.matchMedia('(min-width:600px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width:600px)');
    const update = () => setWideAdmin(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const operationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [initialFailure, setInitialFailure] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [games, setGames] = useState<AdminGameView[]>([]);
  const [version, setVersion] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedReconquista, setSelectedReconquista] = useState<string>();
  const [playerCount, setPlayerCount] = useState(4);
  const [mode, setMode] = useState<'classic' | 'competitive' | 'reconquista'>(
    'classic',
  );
  const [reconquistaGames, setReconquistaGames] = useState<
    ReconquistaGameSummary[]
  >([]);
  const [error, setError] = useState<string>();
  const [connectionError, setConnectionError] = useState<string>();
  const visibleError = error ?? connectionError;

  const load = useCallback(async (initial = false) => {
    try {
      const result = await api.adminGames();
      setGames(result.games);
      setVersion(result.version);
      const listed = (await reconquistaRequest('/games').catch(() => ({
        games: [],
      }))) as { games: ReconquistaGameSummary[] };
      setReconquistaGames(listed.games);
      setAuthenticated(true);
      setConnectionError(undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (initial) setInitialFailure(true);
      setConnectionError(
        caught instanceof ApiError
          ? errorMessage(caught.code)
          : errorMessage('SERVER_ERROR'),
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setInitialFailure(false);
    setError(undefined);
    setConnectionError(undefined);
    void (async () => {
      try {
        await api.adminGames();
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.status !== 401) {
          if (active) {
            setError(errorMessage('SERVER_ERROR'));
            setInitialFailure(true);
            setChecking(false);
          }
          return;
        }
        try {
          await redeemAdminLaunch();
        } catch (caught) {
          if (active)
            setError(
              caught instanceof Error
                ? caught.message
                : errorMessage('SERVER_ERROR'),
            );
        }
      }
      if (active) {
        await load(true);
        setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, accessAttempt]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = setInterval(() => void load(), 2_000);
    return () => clearInterval(timer);
  }, [authenticated, load]);

  const run = async (operation: () => Promise<unknown>) => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401)
        setAuthenticated(false);
      setError(
        caught instanceof ApiError
          ? errorMessage(caught.code)
          : caught instanceof ReconquistaRequestError
            ? reconquistaErrorMessage(caught)
            : errorMessage('SERVER_ERROR'),
      );
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  };

  if (checking)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel" role="status">
          {tr(
            'Comprobando acceso del anfitrión…',
            "Checking the host's access…",
          )}
        </section>
      </main>
    );

  if (initialFailure)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <h1>
            {tr(
              'No pudimos conectar con Terra en disputa',
              "We couldn't connect to Terra en disputa",
            )}
          </h1>
          <p role="alert">{visibleError}</p>
          <button
            type="button"
            onClick={() => setAccessAttempt((value) => value + 1)}
          >
            {tr('Reintentar', 'Retry')}
          </button>
        </section>
      </main>
    );

  if (!authenticated)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <a className="text-link" href="/">
            {tr('← Inicio', '← Home')}
          </a>
          <p className="eyebrow">
            {tr('Administración local', 'Local administration')}
          </p>
          <h1>{tr('Acceso del administrador', 'Administrator access')}</h1>
          <p className="warning">
            {tr(
              'La credencial se enviará sin cifrar si usás HTTP. Hacelo solamente en una red confiable.',
              'The credential is sent unencrypted over HTTP. Do it only on a trusted network.',
            )}
          </p>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(async () => {
                await api.adminLogin(recoveryCode);
                setRecoveryCode('');
                setAuthenticated(true);
              });
            }}
          >
            <label>
              {tr(
                'Código de acceso del administrador',
                'Administrator access code',
              )}
              <input
                required
                autoComplete="off"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
              />
            </label>
            {visibleError && (
              <p className="error-banner" role="alert">
                {visibleError}
              </p>
            )}
            <button type="submit" disabled={busy}>
              {tr('Ingresar', 'Sign in')}
            </button>
          </form>
          <p>
            {tr(
              'El código aparece en la terminal cada vez que iniciás el servidor.',
              'The code shows up in the terminal every time you start the server.',
            )}
          </p>
        </section>
        <LanguageSelect />
      </main>
    );

  const selected = games.find(({ gameId }) => gameId === selectedId);
  // A table with bots waits for its people; the bots sit at the start.
  const humanSeats = selected
    ? selected.configuredPlayerCount - (selected.competitiveBotSeats ?? 0)
    : 0;
  const missingPlayers = selected
    ? Math.max(0, humanSeats - selected.players.length)
    : 0;
  const missingReady = selected
    ? Math.max(
        0,
        selected.players.length - (selected.readyPlayerIds?.length ?? 0),
      )
    : 0;
  // Everyone who joined is ready and the mode's minimum is met: the table
  // shrinks to them on start.
  const bots = selected?.competitiveBotSeats ?? 0;
  // Classic with bots can start with a single person.
  const readyToStart =
    selected?.status === 'LOBBY' &&
    missingReady === 0 &&
    (selected.mode === 'competitive'
      ? bots
        ? missingPlayers === 0
        : selected.players.length >= 4
      : selected.players.length >= (bots ? 1 : 2));
  return (
    <main className="admin-layout">
      <header className="topbar">
        <a className="brand" href="/" title={GAME_NAME} aria-label={GAME_NAME}>
          {GAME_SHORT_NAME}
        </a>
        <span>{tr('Panel del anfitrión', "Host's panel")}</span>
        <div className="admin-tools">
          <TextSizeToggle />
          <ThemeToggle />
          <button
            type="button"
            className="theme-toggle secondary"
            title={tr('Cerrar sesión', 'Sign out')}
            aria-label={tr('Cerrar sesión', 'Sign out')}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.adminLogout();
                setAuthenticated(false);
              })
            }
          >
            <UiIcon name="leave" />
          </button>
        </div>
      </header>
      <aside className="panel admin-sidebar">
        <details className="admin-create" open={wideAdmin || undefined}>
          <summary>
            <h1>{tr('Crear una partida', 'Create a game')}</h1>
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (mode === 'reconquista') {
                  try {
                    const created = (await reconquistaRequest('/games', {
                      playerCount,
                    })) as { gameId: string };
                    // Managed here like Classic; players join through the invitation.
                    setSelectedId(undefined);
                    setSelectedReconquista(created.gameId);
                  } catch (caught) {
                    throw new Error(reconquistaErrorMessage(caught), {
                      cause: caught,
                    });
                  }
                  return;
                }
                const created = await api.createGame(playerCount, mode);
                setSelectedReconquista(undefined);
                setSelectedId(created.gameId);
              });
            }}
          >
            <label className="host-player-count">
              {tr('Modalidad', 'Mode')}
              <select
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as typeof mode;
                  setMode(next);
                  if (next === 'competitive')
                    setPlayerCount((count) => Math.max(4, count));
                }}
              >
                <option value="reconquista">
                  {tr('Reconquista', 'Retake')}
                </option>
                <option value="classic">{tr('Clásico', 'Classic')}</option>
                <option value="competitive">
                  {tr('Competitivo', 'Competitive')}
                </option>
              </select>
              {mode === 'competitive' && (
                <small>
                  {tr(
                    '4–6 jugadores. Resultados y puntuación en partidas finalizadas.',
                    '4–6 players. Results and scoring in finished games.',
                  )}
                </small>
              )}
            </label>
            <label className="host-player-count">
              {tr('Cantidad de jugadores', 'Number of players')}
              <select
                value={playerCount}
                onChange={(event) => setPlayerCount(Number(event.target.value))}
              >
                {(mode === 'competitive' ? [4, 5, 6] : [2, 3, 4, 5, 6]).map(
                  (count) => (
                    <option key={count}>{count}</option>
                  ),
                )}
              </select>
            </label>
            <button
              className="host-create-button"
              type="submit"
              disabled={busy}
            >
              <span aria-hidden="true">＋ </span>
              {tr('Crear partida', 'Create game')}
            </button>
          </form>
        </details>
        <details className="admin-existing" open={wideAdmin || undefined}>
          <summary>
            <h2>{tr('Continuar una partida', 'Continue a game')}</h2>
          </summary>
          {games.length === 0 && reconquistaGames.length === 0 && (
            <p>
              {tr(
                'Todavía no hay partidas guardadas.',
                'There are no saved games yet.',
              )}
            </p>
          )}
          <nav
            aria-label={tr('Partidas existentes', 'Existing games')}
            className="game-list"
          >
            {(['En curso', 'Finalizadas'] as const).map((group) => (
              <section key={group} aria-label={groupLabel(group)}>
                <h3>{groupLabel(group)}</h3>
                {games
                  .filter(
                    (game) =>
                      (game.status === 'FINISHED') ===
                      (group === 'Finalizadas'),
                  )
                  .map((game) => (
                    <button
                      type="button"
                      className={
                        selectedId === game.gameId
                          ? 'selected-game secondary'
                          : 'secondary'
                      }
                      key={game.gameId}
                      aria-pressed={selectedId === game.gameId}
                      onClick={() => {
                        setSelectedReconquista(undefined);
                        setSelectedId(game.gameId);
                      }}
                    >
                      <strong>{game.gameId.slice(0, 8)}</strong>
                      <small>
                        {STATUS_LABELS[game.status]} · {game.players.length}/
                        {game.configuredPlayerCount}
                      </small>
                      <small>
                        {game.mode === 'competitive'
                          ? tr('Competitivo', 'Competitive')
                          : tr('Clásico', 'Classic')}
                      </small>
                    </button>
                  ))}
                {reconquistaGames
                  .filter(
                    (game) =>
                      (game.finished === true) === (group === 'Finalizadas'),
                  )
                  .map((game) => (
                    <button
                      type="button"
                      key={game.gameId}
                      className={
                        selectedReconquista === game.gameId
                          ? 'selected-game secondary'
                          : 'secondary'
                      }
                      aria-pressed={selectedReconquista === game.gameId}
                      onClick={() => {
                        setSelectedId(undefined);
                        setSelectedReconquista(game.gameId);
                      }}
                    >
                      <strong>{game.gameId.slice(0, 8)}</strong>
                      <small>
                        {game.finished
                          ? STATUS_LABELS.FINISHED
                          : game.started
                            ? STATUS_LABELS.ACTIVE
                            : STATUS_LABELS.LOBBY}{' '}
                        · {game.players}/{game.playerCount}
                      </small>
                      <small>{tr('Reconquista', 'Retake')}</small>
                    </button>
                  ))}
              </section>
            ))}
          </nav>
        </details>
        {/* Nothing checks for updates by itself; the link is there to look. */}
        {version && (
          <p className="admin-version">
            {GAME_NAME} {version} ·{' '}
            <a
              href="https://github.com/terraendisputa/TerraEnDisputa/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              {tr('Ver versiones', 'See releases')}
            </a>
          </p>
        )}
      </aside>
      <section className="panel admin-detail">
        {visibleError && (
          <p className="error-banner" role="alert">
            {visibleError}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError(undefined);
                void load();
              }}
            >
              {tr('Reintentar', 'Retry')}
            </button>
          </p>
        )}
        {selectedReconquista ? (
          <ReconquistaAdminDetail
            key={selectedReconquista}
            gameId={selectedReconquista}
            busy={busy}
            run={run}
            onDeleted={() => setSelectedReconquista(undefined)}
          />
        ) : !selected ? (
          <div className="empty-state">
            <h2>{tr('Elegí una partida', 'Choose a game')}</h2>
            <p>
              {tr(
                'Creá una mesa o abrí una existente.',
                'Create a table or open an existing one.',
              )}
            </p>
          </div>
        ) : (
          <>
            <AdminBoxes
              key={selected.gameId}
              gameId={selected.gameId}
              lobby={selected.status === 'LOBBY'}
              seats={
                <>
                  <label className="inline-control">
                    {tr('Jugadores requeridos', 'Required players')}
                    <select
                      disabled={busy || selected.status !== 'LOBBY'}
                      value={
                        selected.mode === 'competitive' &&
                        selected.competitiveBotSeats
                          ? '6+2'
                          : selected.configuredPlayerCount
                      }
                      onChange={(event) =>
                        void run(() =>
                          event.target.value === '6+2'
                            ? api.configureGame(selected.gameId, 6, 80, 2)
                            : selected.mode === 'classic'
                              ? api.configureGame(
                                  selected.gameId,
                                  Number(event.target.value),
                                  undefined,
                                  // Fewer seats keep room for who joined.
                                  Math.min(
                                    bots,
                                    Number(event.target.value) -
                                      Math.max(1, selected.players.length),
                                  ),
                                )
                              : api.configureGame(
                                  selected.gameId,
                                  Number(event.target.value),
                                  selected.competitiveBotSeats
                                    ? undefined
                                    : selected.competitiveDurationMinutes,
                                ),
                        )
                      }
                    >
                      {(selected.mode === 'competitive'
                        ? [4, 5, 6]
                        : [2, 3, 4, 5, 6]
                      ).map((count) => (
                        <option
                          key={count}
                          disabled={
                            count < selected.players.length ||
                            (selected.mode === 'classic' && count < 2)
                          }
                        >
                          {count}
                        </option>
                      ))}
                      {selected.mode === 'competitive' && (
                        <option
                          value="6+2"
                          disabled={
                            selected.players.length > 4 ||
                            !!selected.competitiveDeciding
                          }
                        >
                          {tr(
                            '6: 4 jugadores + 2 bots',
                            '6: 4 players + 2 bots',
                          )}
                        </option>
                      )}
                    </select>
                  </label>
                  {selected.mode === 'classic' && (
                    <label
                      className="inline-control"
                      title={tr(
                        'Asientos que ocupan bots al comenzar. Siempre queda al menos uno para una persona.',
                        'Seats taken by bots at the start. At least one always stays for a person.',
                      )}
                    >
                      Bots
                      <select
                        disabled={busy || selected.status !== 'LOBBY'}
                        value={bots}
                        onChange={(event) =>
                          void run(() =>
                            api.configureGame(
                              selected.gameId,
                              selected.configuredPlayerCount,
                              undefined,
                              Number(event.target.value),
                            ),
                          )
                        }
                      >
                        {Array.from(
                          { length: selected.configuredPlayerCount },
                          (_, n) => (
                            <option
                              key={n}
                              value={n}
                              disabled={
                                selected.configuredPlayerCount - n <
                                selected.players.length
                              }
                            >
                              {n === 0 ? tr('Sin bots', 'No bots') : n}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                  {selected.mode === 'classic' && (
                    <label
                      className="inline-control"
                      title={tr(
                        'Express: turnos de 2 minutos y tiempo máximo de juego, después dos rondas finales. Sin puntaje.',
                        'Express: 2-minute turns and a maximum game time, then two final rounds. No scoring.',
                      )}
                    >
                      {tr('Duración', 'Duration')}
                      <select
                        disabled={busy || selected.status !== 'LOBBY'}
                        value={selected.classicExpress ? 'express' : 'free'}
                        onChange={(event) =>
                          void run(() =>
                            api.configureGame(
                              selected.gameId,
                              selected.configuredPlayerCount,
                              undefined,
                              undefined,
                              undefined,
                              event.target.value === 'express',
                            ),
                          )
                        }
                      >
                        <option value="free">
                          {tr('Sin límite', 'No limit')}
                        </option>
                        <option value="express">
                          {`Express: ${durationText(gameClockDurationMs(selected))} + 2 ${tr('rondas', 'rounds')}`}
                        </option>
                      </select>
                    </label>
                  )}
                  {selected.mode === 'competitive' && (
                    <label className="inline-control">
                      {tr('Duración', 'Duration')}
                      <select
                        disabled={
                          busy ||
                          selected.status !== 'LOBBY' ||
                          selected.configuredPlayerCount === 4 ||
                          !!selected.competitiveBotSeats
                        }
                        value={
                          selected.configuredPlayerCount === 4
                            ? 60
                            : (selected.competitiveDurationMinutes ?? 80)
                        }
                        onChange={(event) =>
                          void run(() =>
                            api.configureGame(
                              selected.gameId,
                              selected.configuredPlayerCount,
                              Number(event.target.value) as 60 | 80,
                            ),
                          )
                        }
                      >
                        {selected.configuredPlayerCount !== 4 && (
                          <option value={80}>
                            {tr('1:20 h + 2 rondas', '1:20 h + 2 rounds')}
                          </option>
                        )}
                        {!selected.competitiveBotSeats && (
                          <option value={60}>
                            {selected.configuredPlayerCount === 4
                              ? tr('1:00 h + 2 rondas', '1:00 h + 2 rounds')
                              : tr(
                                  'Express: 1:00 h + 2 rondas',
                                  'Express: 1:00 h + 2 rounds',
                                )}
                          </option>
                        )}
                      </select>
                    </label>
                  )}
                  {selected.mode === 'competitive' && (
                    <label
                      className="inline-control"
                      title={tr(
                        'Clasificatorias, semifinales y finales: sin bots. Quien abandona o queda ausente pasa a inactivo, con turnos de 1 minuto.',
                        'Qualifiers, semifinals and finals: no bots. Whoever leaves or goes absent becomes inactive, with 1-minute turns.',
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={
                          busy ||
                          selected.status !== 'LOBBY' ||
                          !!selected.competitiveBotSeats
                        }
                        checked={!!selected.competitiveDeciding}
                        onChange={(event) =>
                          void run(() =>
                            api.configureGame(
                              selected.gameId,
                              selected.configuredPlayerCount,
                              undefined,
                              undefined,
                              event.target.checked,
                            ),
                          )
                        }
                      />
                      {tr('Partida definitoria', 'Deciding game')}
                    </label>
                  )}
                </>
              }
              start={
                <>
                  {selected.status === 'LOBBY' && (
                    <p
                      className={`host-lobby-notice ${readyToStart ? 'host-ready' : 'host-waiting'}`}
                      role="status"
                    >
                      <span aria-hidden="true">
                        {readyToStart ? '✓ ' : '◷ '}
                      </span>
                      {readyToStart && missingPlayers > 0
                        ? tr(
                            `Todos los que entraron están listos. Podés comenzar con ${selected.players.length} jugadores.`,
                            `Everyone who joined is ready. You can start with ${selected.players.length} players.`,
                          )
                        : missingPlayers > 0
                          ? tr(
                              `Falta${missingPlayers === 1 ? '' : 'n'} ${missingPlayers} ${missingPlayers === 1 ? 'persona' : 'personas'} para completar la mesa.`,
                              `${missingPlayers} more ${missingPlayers === 1 ? 'person is' : 'people are'} needed to fill the table.`,
                            )
                          : missingReady > 0
                            ? tr(
                                `Esperando que ${missingReady} ${missingReady === 1 ? 'persona marque' : 'personas marquen'} «Estoy listo».`,
                                `Waiting for ${missingReady} ${missingReady === 1 ? 'person' : 'people'} to mark «I'm ready».`,
                              )
                            : tr(
                                'Todos están listos. Podés comenzar.',
                                'Everyone is ready. You can start.',
                              )}{' '}
                      {tr('Listos', 'Ready')}:{' '}
                      {selected.readyPlayerIds?.length ?? 0}/{humanSeats}.
                      {bots === 1
                        ? tr(
                            ' El bot se suma al comenzar.',
                            ' The bot joins at the start.',
                          )
                        : bots
                          ? tr(
                              ` Los ${bots} bots se suman al comenzar.`,
                              ` The ${bots} bots join at the start.`,
                            )
                          : ''}
                    </p>
                  )}
                  <div className="button-row">
                    {selected.status === 'LOBBY' && (
                      <button
                        type="button"
                        disabled={busy || !readyToStart}
                        title={
                          readyToStart
                            ? undefined
                            : tr(
                                'Todos los que entraron deben estar listos.',
                                'Everyone who joined must be ready.',
                              )
                        }
                        onClick={() =>
                          void run(async () => {
                            if (selected.players.length !== humanSeats)
                              await api.configureGame(
                                selected.gameId,
                                selected.players.length + bots,
                              );
                            return api.startGame(selected.gameId);
                          })
                        }
                      >
                        {tr('Comenzar partida', 'Start game')}
                      </button>
                    )}
                  </div>
                </>
              }
              status={
                <>
                  <p
                    className={`host-status-badge ${selected.status === 'LOBBY' ? (readyToStart ? 'host-ready' : 'host-waiting') : 'host-neutral'}`}
                  >
                    <span aria-hidden="true">
                      {selected.status === 'LOBBY'
                        ? readyToStart
                          ? '✓ '
                          : '◷ '
                        : '● '}
                    </span>
                    {readyToStart
                      ? tr('Todo listo para comenzar', 'All set to start')
                      : STATUS_LABELS[selected.status]}
                  </p>
                  <h2>
                    {tr('Partida', 'Game')} {selected.gameId.slice(0, 8)}
                  </h2>
                  <small>
                    {selected.mode === 'competitive'
                      ? tr('Competitivo', 'Competitive')
                      : selected.classicExpress
                        ? tr('Clásico Express', 'Classic Express')
                        : tr('Clásico', 'Classic')}
                  </small>
                  {selected.setup && (
                    <p className="admin-state-line">
                      {tr('Preparación:', 'Setup:')}{' '}
                      <strong>{SETUP_LABELS[selected.setup.stage]}</strong>
                      {selected.setup.currentPlayerId
                        ? tr(
                            ` · turno de ${selected.players.find(({ id }) => id === selected.setup?.currentPlayerId)?.nickname ?? 'jugador'}`,
                            ` · ${selected.players.find(({ id }) => id === selected.setup?.currentPlayerId)?.nickname ?? 'player'}'s turn`,
                          )
                        : ''}
                    </p>
                  )}
                  {selected.turn && (
                    <p className="admin-state-line">
                      {selected.mode === 'competitive'
                        ? `${competitiveRoundLabel(selected)} · ${selected.turn.round.kind === 'normal' && selected.turn.round.pass === 'incorporation' ? tr('Refuerzos', 'Reinforcements') : tr('Ataques', 'Attacks')}`
                        : selected.turn.round.kind === 'initial_hostility'
                          ? tr('Hostilidad inicial', 'Initial hostility')
                          : `${tr('Ronda', 'Round')} ${selected.turn.round.roundNumber} · ${selected.turn.round.pass === 'hostility' ? tr('Ataques', 'Attacks') : tr('Refuerzos', 'Reinforcements')}`}{' '}
                      ·{' '}
                      <strong>
                        {selected.players.find(
                          ({ id }) => id === selected.turn?.playerId,
                        )?.nickname ?? tr('jugador', 'player')}
                      </strong>{' '}
                      · {PHASE_LABELS[selected.turn.phase]}
                    </p>
                  )}
                  {selected.status === 'FINISHED' &&
                    selected.result &&
                    (() => {
                      const winner = selected.players.find(
                        ({ id }) => id === selected.result?.winnerId,
                      );
                      const reason = selected.result.victoryReason;
                      const reasonText =
                        reason.kind === 'time_limit' &&
                        selected.mode === 'classic'
                          ? winner
                            ? tr(
                                'Se terminó el tiempo: ganó por desempate (más países, después tropas, canjes y cartas).',
                                'Time ran out: won on the tiebreak (most countries, then troops, exchanges and cards).',
                              )
                            : tr(
                                'Se terminó el tiempo con empate en países, tropas, canjes y cartas.',
                                'Time ran out with a tie in countries, troops, exchanges and cards.',
                              )
                          : reason.kind === 'time_limit'
                            ? tr(
                                'Se completaron las dos rondas finales.',
                                'The two final rounds were completed.',
                              )
                            : reason.kind === 'no_competitors'
                              ? tr(
                                  'No quedan jugadores habilitados.',
                                  'No eligible players are left.',
                                )
                              : reason.kind === 'control_all_territories'
                                ? tr(
                                    'Conquistó los 50 territorios.',
                                    'Conquered all 50 territories.',
                                  )
                                : reason.kind === 'control_territories'
                                  ? tr(
                                      'Controló 30 territorios.',
                                      'Controlled 30 territories.',
                                    )
                                  : reason.kind === 'secret_objective'
                                    ? objectiveText(
                                        reason.objectiveId,
                                        reason.effectiveDestructionTargetColor,
                                      )
                                    : tr('Partida finalizada', 'Game over');
                      return (
                        <section className="objective-box admin-result">
                          <p className="eyebrow">
                            {tr('Resultado final', 'Final result')}
                          </p>
                          <h3>
                            {winner
                              ? tr(
                                  `Ganó ${winner.nickname}`,
                                  `${winner.nickname} won`,
                                )
                              : reason.kind === 'time_limit' &&
                                  selected.mode === 'classic'
                                ? tr('Empate', 'Tie')
                                : tr('Partida cerrada', 'Game closed')}
                          </h3>
                          {selected.result?.scoringEligible === false && (
                            <p>
                              {tr(
                                'Sin puntuación oficial; el detalle indica el motivo.',
                                'No official score; the detail gives the reason.',
                              )}
                            </p>
                          )}
                          {winner && (
                            <p>
                              <span
                                className={`color-dot color-${winner.color}`}
                              />{' '}
                              {playerColorLabel(winner.color)}
                            </p>
                          )}
                          <p>{reasonText}</p>
                        </section>
                      );
                    })()}
                  {selected.competitiveClock &&
                    (selected.status !== 'FINISHED' ||
                      selected.pendingInheritance) && (
                      <section className="panel admin-clock">
                        <dl>
                          <div>
                            <dt>
                              {tr('Duración de la partida', 'Game duration')}
                            </dt>
                            <dd>
                              {Math.floor(
                                selected.competitiveClock.elapsedMs / 60000,
                              )}{' '}
                              min
                            </dd>
                          </div>
                          <div>
                            <dt>{tr('Turno actual', 'Current turn')}</dt>
                            <dd>
                              {clockText(
                                selected.competitiveClock.activationRemainingMs,
                              )}{' '}
                              {tr('restantes', 'left')}
                            </dd>
                          </div>
                        </dl>
                        <p className="admin-state-line">
                          {clockState(
                            selected.competitiveClock,
                            selected.players,
                          )}
                        </p>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            selected.competitiveClock.pauseReason ===
                              'disconnection'
                          }
                          onClick={() =>
                            void run(() =>
                              api.pauseGame(
                                selected.gameId,
                                !selected.competitiveClock?.pauseReason,
                              ),
                            )
                          }
                        >
                          {selected.competitiveClock.pauseReason
                            ? tr(
                                'Reanudar cuando todos estén disponibles',
                                'Resume when everyone is available',
                              )
                            : tr(
                                'Pausar por inconveniente técnico',
                                'Pause for a technical problem',
                              )}
                        </button>
                      </section>
                    )}
                  {selected.mode === 'competitive' &&
                    selected.status !== 'FINISHED' &&
                    selected.competitiveDeciding && (
                      <p className="admin-bots">
                        {tr(
                          'Partida definitoria: sin bots. Quien abandona o queda ausente pasa a inactivo, con turnos de 1 minuto.',
                          'Deciding game: no bots. Whoever leaves or goes absent becomes inactive, with 1-minute turns.',
                        )}
                      </p>
                    )}
                  {selected.status !== 'FINISHED' &&
                    !selected.competitiveDeciding && (
                      <section className="admin-bots">
                        {/* Without Express nobody turns absent: bots come in by hand. */}
                        {(selected.mode === 'competitive' ||
                          selected.classicExpress) && (
                          <label className="inline-control">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={
                                selected.competitiveBotsReplaceAbsent !== false
                              }
                              onChange={(event) =>
                                void run(() =>
                                  api.configureBots(selected.gameId, {
                                    replaceAbsent: event.target.checked,
                                  }),
                                )
                              }
                            />
                            {tr(
                              'Reemplazar ausentes por bot',
                              'Replace absent players with a bot',
                            )}
                          </label>
                        )}
                        <label className="inline-control">
                          {tr('Dificultad de los bots', 'Bot difficulty')}
                          <select
                            disabled={busy}
                            value={selected.competitiveBotLevel ?? 'hard'}
                            onChange={(event) =>
                              void run(() =>
                                api.configureBots(selected.gameId, {
                                  level: event.target.value as
                                    'easy' | 'normal' | 'hard',
                                }),
                              )
                            }
                          >
                            <option value="easy">{tr('Fácil', 'Easy')}</option>
                            <option value="normal">Normal</option>
                            <option value="hard">
                              {tr('Difícil', 'Hard')}
                            </option>
                          </select>
                        </label>
                      </section>
                    )}
                  <ul className="player-list">
                    {selected.players.map((player) => (
                      <li key={player.id}>
                        <span
                          className={`color-dot color-${player.color}`}
                          aria-hidden="true"
                        />
                        <span className="admin-player-copy">
                          <strong>
                            {player.nickname}
                            {player.bot && player.bot !== 'table'
                              ? ' (bot)'
                              : ''}
                            {player.inactive
                              ? tr(' (inactivo)', ' (inactive)')
                              : ''}
                          </strong>
                          <small>
                            {playerColorLabel(player.color)} ·{' '}
                            {tr('Asiento', 'Seat')} {player.seatIndex + 1} ·{' '}
                            {player.bot === 'table'
                              ? tr('bot de la mesa', 'table bot')
                              : player.controller === 'controlled'
                                ? tr('con jugador', 'with a player')
                                : tr('sin jugador', 'no player')}
                          </small>
                          {selected.status === 'LOBBY' && (
                            <span
                              className={`host-status-badge host-player-ready ${selected.readyPlayerIds?.includes(player.id) ? 'host-ready' : 'host-waiting'}`}
                              title={
                                selected.readyPlayerIds?.includes(player.id)
                                  ? tr('Jugador listo', 'Player ready')
                                  : tr('Todavía no está listo', 'Not ready yet')
                              }
                            >
                              <span aria-hidden="true">
                                {selected.readyPlayerIds?.includes(player.id)
                                  ? '✓ '
                                  : '◷ '}
                              </span>
                              {selected.readyPlayerIds?.includes(player.id)
                                ? tr('Listo', 'Ready')
                                : tr('Pendiente', 'Pending')}
                            </span>
                          )}
                        </span>
                        <div className="row-actions">
                          {selected.mode === 'competitive' &&
                            (selected.status === 'SETUP' ||
                              selected.status === 'ACTIVE') &&
                            !player.eliminated &&
                            !player.disqualified &&
                            selected.competitiveDeciding && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                title={
                                  player.inactive
                                    ? tr(
                                        `Devolverle los turnos normales a ${player.nickname}`,
                                        `Give ${player.nickname} normal turns back`,
                                      )
                                    : tr(
                                        `${player.nickname} abandonó: sus turnos pasan a durar 1 minuto`,
                                        `${player.nickname} left: their turns now last 1 minute`,
                                      )
                                }
                                onClick={() =>
                                  void run(() =>
                                    api.markInactive(
                                      selected.gameId,
                                      player.id,
                                      !player.inactive,
                                    ),
                                  )
                                }
                              >
                                {player.inactive
                                  ? tr('Quitar inactivo', 'Clear inactive')
                                  : tr('Marcar inactivo', 'Mark inactive')}
                              </button>
                            )}
                          {(selected.status === 'SETUP' ||
                            selected.status === 'ACTIVE') &&
                            !player.eliminated &&
                            !player.disqualified &&
                            !selected.competitiveDeciding &&
                            // Express frees a table bot's seat for a person.
                            (player.bot !== 'table' ||
                              !!selected.classicExpress) && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                title={
                                  player.bot === 'table'
                                    ? tr(
                                        `Liberar el asiento de ${player.nickname}: sus turnos pasan solos hasta que lo tome una persona`,
                                        `Free ${player.nickname}'s seat: its turns pass on their own until a person takes it`,
                                      )
                                    : player.bot
                                      ? tr(
                                          `Devolverle el lugar a ${player.nickname}`,
                                          `Give ${player.nickname} their place back`,
                                        )
                                      : tr(
                                          `Poner un bot en lugar de ${player.nickname}`,
                                          `Put a bot in place of ${player.nickname}`,
                                        )
                                }
                                onClick={() =>
                                  void run(() =>
                                    api.assignBot(
                                      selected.gameId,
                                      player.id,
                                      !player.bot,
                                    ),
                                  )
                                }
                              >
                                {player.bot
                                  ? tr('Quitar bot', 'Remove bot')
                                  : tr('Poner bot', 'Add bot')}
                              </button>
                            )}
                          {selected.status === 'LOBBY' && (
                            <button
                              type="button"
                              aria-label={tr(
                                `Quitar a ${player.nickname}`,
                                `Remove ${player.nickname}`,
                              )}
                              title={tr(
                                `Quitar a ${player.nickname}`,
                                `Remove ${player.nickname}`,
                              )}
                              disabled={busy}
                              className="danger-quiet"
                              onClick={() =>
                                void run(() =>
                                  api.removePlayer(selected.gameId, player.id),
                                )
                              }
                            >
                              <span className="remove-player-label">
                                {tr('Quitar', 'Remove')}
                              </span>
                              <span
                                className="remove-player-icon"
                                aria-hidden="true"
                              >
                                ×
                              </span>
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              }
              advanced={
                <details open>
                  <summary>
                    {tr('Opciones avanzadas', 'Advanced options')}
                  </summary>
                  <button
                    disabled={busy}
                    type="button"
                    className="danger"
                    onClick={() => {
                      void run(async () => {
                        if (
                          await deleteGameAfterConfirmation(
                            selected,
                            api.deleteGame,
                          )
                        )
                          setSelectedId(undefined);
                      });
                    }}
                  >
                    {tr('Eliminar partida', 'Delete game')}
                  </button>
                </details>
              }
            />
            {/* The wide score table spans both columns. */}
            {selected.status === 'FINISHED' && (
              <CompetitiveResultsPanel game={selected} />
            )}
          </>
        )}
      </section>
      <LanguageSelect />
    </main>
  );
}
