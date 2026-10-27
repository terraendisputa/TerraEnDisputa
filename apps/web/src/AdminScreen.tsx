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
import { clockText } from './TurnSummary.js';
import { ReconquistaAdminDetail } from './ReconquistaAdmin.js';
import { PHASE_LABELS } from './game-presentation.js';
import {
  ReconquistaRequestError,
  reconquistaErrorMessage,
  reconquistaRequest,
} from './reconquista-client.js';

interface ReconquistaGameSummary {
  readonly gameId: string;
  readonly playerCount: number;
  readonly players: number;
  readonly started: boolean;
}

const STATUS_LABELS = {
  LOBBY: 'Esperando jugadores',
  SETUP: 'Preparando el tablero',
  ACTIVE: 'En juego',
  FINISHED: 'Finalizada',
};
const SETUP_LABELS = {
  additional_armies: 'Refuerzos iniciales',
  territory_deal: 'Reparto de territorios',
  leftover_awards: 'Territorios sobrantes',
  starting_order: 'Orden inicial',
  reinforcement: 'Refuerzos de preparación',
};

const gameDeletionConfirmation = (
  game: Pick<AdminGameView, 'gameId' | 'status'>,
) =>
  game.status === 'SETUP' || game.status === 'ACTIVE'
    ? `La partida ${game.gameId} ya está en curso. Eliminarla es destructivo y terminará inmediatamente las sesiones conectadas y el acceso a la partida. ¿Eliminar definitivamente?`
    : `Eliminar definitivamente la partida ${game.gameId}?`;

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
  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
    return () => {
      if (previous) document.documentElement.dataset.theme = previous;
      else delete document.documentElement.dataset.theme;
    };
  }, []);
  const operationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [initialFailure, setInitialFailure] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [games, setGames] = useState<AdminGameView[]>([]);
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
          Comprobando acceso del anfitrión…
        </section>
      </main>
    );

  if (initialFailure)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <h1>No pudimos conectar con Terra en disputa</h1>
          <p role="alert">{visibleError}</p>
          <button
            type="button"
            onClick={() => setAccessAttempt((value) => value + 1)}
          >
            Reintentar
          </button>
        </section>
      </main>
    );

  if (!authenticated)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <a className="text-link" href="/">
            ← Inicio
          </a>
          <p className="eyebrow">Administración local</p>
          <h1>Acceso del administrador</h1>
          <p className="warning">
            La credencial se enviará sin cifrar si usás HTTP. Hacelo solamente
            en una red confiable.
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
              Código de acceso del administrador
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
              Ingresar
            </button>
          </form>
          <p>
            El código aparece en la terminal cada vez que iniciás el servidor.
          </p>
        </section>
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
        <span>Panel del anfitrión</span>
      </header>
      <aside className="panel admin-sidebar">
        <details className="admin-create" open={wideAdmin || undefined}>
          <summary>
            <h1>Crear una partida</h1>
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
              Modalidad
              <select
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as typeof mode;
                  setMode(next);
                  if (next === 'competitive')
                    setPlayerCount((count) => Math.max(4, count));
                }}
              >
                <option value="classic">Clásico</option>
                <option value="competitive">Competitivo</option>
                <option value="reconquista">Reconquista</option>
              </select>
              {mode === 'competitive' && (
                <small>
                  4–6 jugadores. Resultados y puntuación en partidas
                  finalizadas.
                </small>
              )}
            </label>
            <label className="host-player-count">
              Cantidad de jugadores
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
              <span aria-hidden="true">＋ </span>Crear partida
            </button>
          </form>
        </details>
        <details className="admin-existing" open={wideAdmin || undefined}>
          <summary>
            <h2>Continuar una partida</h2>
          </summary>
          {games.length === 0 && reconquistaGames.length === 0 && (
            <p>Todavía no hay partidas guardadas.</p>
          )}
          <nav aria-label="Partidas existentes" className="game-list">
            {(['En curso', 'Finalizadas'] as const).map((group) => (
              <section key={group} aria-label={group}>
                <h3>{group}</h3>
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
                          ? 'Competitivo'
                          : 'Clásico'}
                      </small>
                    </button>
                  ))}
              </section>
            ))}
            {reconquistaGames.length > 0 && (
              <section aria-label="Reconquista">
                <h3>Reconquista</h3>
                {reconquistaGames.map((game) => (
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
                      {game.started ? 'En juego' : 'Esperando jugadores'} ·{' '}
                      {game.players}/{game.playerCount}
                    </small>
                    <small>Reconquista</small>
                  </button>
                ))}
              </section>
            )}
          </nav>
        </details>
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
              Reintentar
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
            <h2>Elegí una partida</h2>
            <p>Creá una mesa o abrí una existente.</p>
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
                    Jugadores requeridos
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
                          6: 4 jugadores + 2 bots
                        </option>
                      )}
                    </select>
                  </label>
                  {selected.mode === 'classic' && (
                    <label
                      className="inline-control"
                      title="Asientos que ocupan bots al comenzar. Siempre queda al menos uno para una persona."
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
                              {n === 0 ? 'Sin bots' : n}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                  {selected.mode === 'classic' && (
                    <label
                      className="inline-control"
                      title="Express: turnos de 2 minutos y tiempo máximo de juego, después dos rondas finales. Sin puntaje."
                    >
                      Duración
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
                        <option value="free">Sin límite</option>
                        <option value="express">
                          {`Express: ${durationText(gameClockDurationMs(selected))} + 2 rondas`}
                        </option>
                      </select>
                    </label>
                  )}
                  {selected.mode === 'competitive' && (
                    <label className="inline-control">
                      Duración
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
                          <option value={80}>1:20 h + 2 rondas</option>
                        )}
                        {!selected.competitiveBotSeats && (
                          <option value={60}>
                            {selected.configuredPlayerCount === 4
                              ? '1:00 h + 2 rondas'
                              : 'Express: 1:00 h + 2 rondas'}
                          </option>
                        )}
                      </select>
                    </label>
                  )}
                  {selected.mode === 'competitive' && (
                    <label
                      className="inline-control"
                      title="Clasificatorias, semifinales y finales: sin bots. Quien abandona o queda ausente pasa a inactivo, con turnos de 1 minuto."
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
                      Partida definitoria
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
                        ? `Todos los que entraron están listos. Podés comenzar con ${selected.players.length} jugadores.`
                        : missingPlayers > 0
                          ? `Falta${missingPlayers === 1 ? '' : 'n'} ${missingPlayers} ${missingPlayers === 1 ? 'persona' : 'personas'} para completar la mesa.`
                          : missingReady > 0
                            ? `Esperando que ${missingReady} ${missingReady === 1 ? 'persona marque' : 'personas marquen'} «Estoy listo».`
                            : 'Todos están listos. Podés comenzar.'}{' '}
                      Listos: {selected.readyPlayerIds?.length ?? 0}/
                      {humanSeats}.
                      {bots === 1
                        ? ' El bot se suma al comenzar.'
                        : bots
                          ? ` Los ${bots} bots se suman al comenzar.`
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
                            : 'Todos los que entraron deben estar listos.'
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
                        Comenzar partida
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
                      ? 'Todo listo para comenzar'
                      : STATUS_LABELS[selected.status]}
                  </p>
                  <h2>Partida {selected.gameId.slice(0, 8)}</h2>
                  <small>
                    {selected.mode === 'competitive'
                      ? 'Competitivo'
                      : selected.classicExpress
                        ? 'Clásico Express'
                        : 'Clásico'}
                  </small>
                  {selected.setup && (
                    <p className="admin-state-line">
                      Preparación:{' '}
                      <strong>{SETUP_LABELS[selected.setup.stage]}</strong>
                      {selected.setup.currentPlayerId
                        ? ` · turno de ${selected.players.find(({ id }) => id === selected.setup?.currentPlayerId)?.nickname ?? 'jugador'}`
                        : ''}
                    </p>
                  )}
                  {selected.turn && (
                    <p className="admin-state-line">
                      {selected.mode === 'competitive'
                        ? `${competitiveRoundLabel(selected)} · ${selected.turn.round.kind === 'normal' && selected.turn.round.pass === 'incorporation' ? 'Refuerzos' : 'Ataques'}`
                        : selected.turn.round.kind === 'initial_hostility'
                          ? 'Hostilidad inicial'
                          : `Ronda ${selected.turn.round.roundNumber} · ${selected.turn.round.pass === 'hostility' ? 'Ataques' : 'Refuerzos'}`}{' '}
                      ·{' '}
                      <strong>
                        {selected.players.find(
                          ({ id }) => id === selected.turn?.playerId,
                        )?.nickname ?? 'jugador'}
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
                            ? 'Se terminó el tiempo: ganó por desempate (más países, después tropas, canjes y cartas).'
                            : 'Se terminó el tiempo con empate en países, tropas, canjes y cartas.'
                          : reason.kind === 'time_limit'
                            ? 'Se completaron las dos rondas finales.'
                            : reason.kind === 'no_competitors'
                              ? 'No quedan jugadores habilitados.'
                              : reason.kind === 'control_all_territories'
                                ? 'Conquistó los 50 territorios.'
                                : reason.kind === 'control_territories'
                                  ? 'Controló 30 territorios.'
                                  : reason.kind === 'secret_objective'
                                    ? objectiveText(
                                        reason.objectiveId,
                                        reason.effectiveDestructionTargetColor,
                                      )
                                    : 'Partida finalizada';
                      return (
                        <section className="objective-box admin-result">
                          <p className="eyebrow">Resultado final</p>
                          <h3>
                            {winner
                              ? `Ganó ${winner.nickname}`
                              : reason.kind === 'time_limit' &&
                                  selected.mode === 'classic'
                                ? 'Empate'
                                : 'Partida cerrada'}
                          </h3>
                          {selected.result?.scoringEligible === false && (
                            <p>
                              Sin puntuación oficial; el detalle indica el
                              motivo.
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
                            <dt>Duración de la partida</dt>
                            <dd>
                              {Math.floor(
                                selected.competitiveClock.elapsedMs / 60000,
                              )}{' '}
                              min
                            </dd>
                          </div>
                          <div>
                            <dt>Turno actual</dt>
                            <dd>
                              {clockText(
                                selected.competitiveClock.activationRemainingMs,
                              )}{' '}
                              restantes
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
                            ? 'Reanudar cuando todos estén disponibles'
                            : 'Pausar por inconveniente técnico'}
                        </button>
                      </section>
                    )}
                  {selected.mode === 'competitive' &&
                    selected.status !== 'FINISHED' &&
                    selected.competitiveDeciding && (
                      <p className="admin-bots">
                        Partida definitoria: sin bots. Quien abandona o queda
                        ausente pasa a inactivo, con turnos de 1 minuto.
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
                            Reemplazar ausentes por bot
                          </label>
                        )}
                        <label className="inline-control">
                          Dificultad de los bots
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
                            <option value="easy">Fácil</option>
                            <option value="normal">Normal</option>
                            <option value="hard">Difícil</option>
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
                            {player.inactive ? ' (inactivo)' : ''}
                          </strong>
                          <small>
                            {playerColorLabel(player.color)} · Asiento{' '}
                            {player.seatIndex + 1} ·{' '}
                            {player.bot === 'table'
                              ? 'bot de la mesa'
                              : player.controller === 'controlled'
                                ? 'con jugador'
                                : 'sin jugador'}
                          </small>
                          {selected.status === 'LOBBY' && (
                            <span
                              className={`host-status-badge host-player-ready ${selected.readyPlayerIds?.includes(player.id) ? 'host-ready' : 'host-waiting'}`}
                              title={
                                selected.readyPlayerIds?.includes(player.id)
                                  ? 'Jugador listo'
                                  : 'Todavía no está listo'
                              }
                            >
                              <span aria-hidden="true">
                                {selected.readyPlayerIds?.includes(player.id)
                                  ? '✓ '
                                  : '◷ '}
                              </span>
                              {selected.readyPlayerIds?.includes(player.id)
                                ? 'Listo'
                                : 'Pendiente'}
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
                                    ? `Devolverle los turnos normales a ${player.nickname}`
                                    : `${player.nickname} abandonó: sus turnos pasan a durar 1 minuto`
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
                                  ? 'Quitar inactivo'
                                  : 'Marcar inactivo'}
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
                                    ? `Liberar el asiento de ${player.nickname}: sus turnos pasan solos hasta que lo tome una persona`
                                    : player.bot
                                      ? `Devolverle el lugar a ${player.nickname}`
                                      : `Poner un bot en lugar de ${player.nickname}`
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
                                {player.bot ? 'Quitar bot' : 'Poner bot'}
                              </button>
                            )}
                          {selected.status === 'LOBBY' && (
                            <button
                              type="button"
                              aria-label={`Quitar a ${player.nickname}`}
                              title={`Quitar a ${player.nickname}`}
                              disabled={busy}
                              className="danger-quiet"
                              onClick={() =>
                                void run(() =>
                                  api.removePlayer(selected.gameId, player.id),
                                )
                              }
                            >
                              <span className="remove-player-label">
                                Quitar
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
                  <summary>Opciones avanzadas</summary>
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
                    Eliminar partida
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
    </main>
  );
}

/** The Competitive clock's state, naming why it is paused. */
function clockState(
  clock: NonNullable<AdminGameView['competitiveClock']>,
  players: AdminGameView['players'],
) {
  if (clock.pauseReason === 'admin') return 'Pausada por el administrador';
  if (clock.pauseReason === 'restart')
    return 'Pausada por reinicio del servidor';
  if (clock.pauseReason === 'disconnection') {
    const player = players.find(({ id }) => id === clock.disconnectedPlayerId);
    return (
      <>
        Pausada: esperando a{' '}
        {player && (
          <>
            <span className={`color-dot color-${player.color}`} />{' '}
            <strong>{player.nickname}</strong>
          </>
        )}{' '}
        · Reconexión {clockText(clock.technicalRemainingMs ?? 0)}
      </>
    );
  }
  return 'En curso';
}

/** 60 minutes read as 1:00 h, as in the Competitive duration choice. */
function durationText(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`
    : `${minutes} min`;
}
