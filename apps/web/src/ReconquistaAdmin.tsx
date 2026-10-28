import { useEffect, useState } from 'react';
import {
  reconquistaEntrySchema,
  reconquistaViewSchema,
  type ReconquistaEntry,
  type ReconquistaView,
} from '@game/protocol/reconquista';
import { AdminBoxes } from './AdminBoxes.js';
import {
  reconquistaPresentation,
  reconquistaRequest,
} from './reconquista-client.js';
import { RECONQUISTA_NAME, playerColorNames } from './reconquista-labels.js';
import { reconquistaExpressDurationMs } from '@game/game-engine/reconquista';
import { clockState, durationText } from './admin-clock.js';
import { clockText } from './TurnSummary.js';
import { tr } from './language.js';

/** Host detail for a Reconquista game, with the same blocks as Classic's admin detail. */
export function ReconquistaAdminDetail({
  gameId,
  busy,
  run,
  onDeleted,
}: {
  readonly gameId: string;
  readonly busy: boolean;
  readonly run: (operation: () => Promise<unknown>) => Promise<void>;
  readonly onDeleted: () => void;
}) {
  const [entry, setEntry] = useState<ReconquistaEntry>();
  const [view, setView] = useState<ReconquistaView>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const next = reconquistaEntrySchema.parse(
        await reconquistaRequest('/games/' + gameId + '/entry'),
      );
      const state =
        next.stage === 'started'
          ? reconquistaViewSchema.parse(
              await reconquistaRequest(
                '/games/' + gameId + '/state?observer=1',
              ),
            )
          : undefined;
      if (!active) return;
      setEntry(next);
      setView(state);
    };
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 2_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameId, attempt]);
  if (!entry)
    return (
      <p role="status">{tr('Cargando la partida…', 'Loading the game…')}</p>
    );
  const reload = () => setAttempt((value) => value + 1);
  const lobby = entry.stage === 'lobby';
  // A table with bots waits for its people; the bots sit at the start.
  const bots = lobby ? (entry.botSeats ?? 0) : 0;
  const missingPlayers = entry.playerCount - bots - entry.players.length;
  const ready = entry.players.filter((p) => p.ready).length;
  const missingReady = entry.players.length - ready;
  // Everyone who joined is ready: the table shrinks to them on start (user
  // decision 2026-10-24). With bots, a single person can start.
  const readyToStart =
    lobby && missingReady === 0 && entry.players.length >= (bots ? 1 : 2);
  const configure = (settings: {
    readonly playerCount?: number;
    readonly express?: boolean;
    readonly bots?: number;
  }) => reconquistaRequest(`/games/${gameId}`, settings, 'PATCH');
  const setBots = (settings: object) =>
    run(async () => {
      await reconquistaRequest(`/games/${gameId}/bots`, settings);
      reload();
    });
  const eliminated = (id: string) => !!view?.campaign?.eliminations[id];
  const presentation = view ? reconquistaPresentation(view) : undefined;
  const finished = view?.campaign?.phase === 'finished';
  const nickname = (id: string | undefined) =>
    entry.players.find((p) => p.id === id)?.nickname ?? tr('jugador', 'player');
  return (
    <AdminBoxes
      key={gameId}
      gameId={gameId}
      lobby={lobby}
      seats={
        <>
          <label className="inline-control">
            {tr('Jugadores requeridos', 'Required players')}
            <select
              disabled={busy || !lobby}
              value={entry.playerCount}
              onChange={(event) =>
                void run(async () => {
                  await configure({ playerCount: Number(event.target.value) });
                  reload();
                })
              }
            >
              {[2, 3, 4, 5, 6].map((count) => (
                <option
                  key={count}
                  disabled={
                    count < entry.players.length + bots || count <= bots
                  }
                >
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label
            className="inline-control"
            title={tr(
              'Asientos que ocupan bots al comenzar. Siempre queda al menos uno para una persona.',
              'Seats taken by bots at the start. At least one always stays for a person.',
            )}
          >
            Bots
            <select
              disabled={busy || !lobby}
              value={entry.botSeats ?? 0}
              onChange={(event) =>
                void run(async () => {
                  await configure({ bots: Number(event.target.value) });
                  reload();
                })
              }
            >
              {Array.from({ length: entry.playerCount }, (_, n) => (
                <option
                  key={n}
                  value={n}
                  disabled={entry.playerCount - n < entry.players.length}
                >
                  {n === 0 ? tr('Sin bots', 'No bots') : n}
                </option>
              ))}
            </select>
          </label>
          <label
            className="inline-control"
            title={tr(
              'Express: turnos de 3 minutos y tiempo máximo de juego, después dos rondas finales.',
              'Express: 3-minute turns and a maximum game time, then two final rounds.',
            )}
          >
            {tr('Duración', 'Duration')}
            <select
              disabled={busy || !lobby}
              value={entry.express ? 'express' : 'free'}
              onChange={(event) =>
                void run(async () => {
                  await configure({
                    express: event.target.value === 'express',
                  });
                  reload();
                })
              }
            >
              <option value="free">{tr('Sin límite', 'No limit')}</option>
              <option value="express">
                {`Express: ${durationText(reconquistaExpressDurationMs(entry.playerCount))} + 2 ${tr('rondas', 'rounds')}`}
              </option>
            </select>
          </label>
        </>
      }
      start={
        <>
          {lobby && (
            <p
              className={`host-lobby-notice ${readyToStart ? 'host-ready' : 'host-waiting'}`}
              role="status"
            >
              <span aria-hidden="true">{readyToStart ? '✓ ' : '◷ '}</span>
              {readyToStart && missingPlayers > 0
                ? tr(
                    `Todos los que entraron están listos. Podés comenzar con ${entry.players.length + bots} jugadores.`,
                    `Everyone who joined is ready. You can start with ${entry.players.length + bots} players.`,
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
              {tr('Listos', 'Ready')}: {ready}/{entry.playerCount - bots}.
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
            {lobby && (
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
                    if (entry.players.length + bots !== entry.playerCount)
                      await configure({
                        playerCount: entry.players.length + bots,
                      });
                    await reconquistaRequest(`/games/${gameId}/start`, {});
                    reload();
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
            className={`host-status-badge ${lobby ? (readyToStart ? 'host-ready' : 'host-waiting') : 'host-neutral'}`}
          >
            <span aria-hidden="true">
              {lobby ? (readyToStart ? '✓ ' : '◷ ') : '● '}
            </span>
            {readyToStart
              ? tr('Todo listo para comenzar', 'All set to start')
              : lobby
                ? tr('Esperando jugadores', 'Waiting for players')
                : finished
                  ? tr('Finalizada', 'Finished')
                  : tr('En juego', 'Playing')}
          </p>
          <h2>
            {tr('Partida', 'Game')} {gameId.slice(0, 8)}
          </h2>
          <small>
            {RECONQUISTA_NAME}
            {entry.express ? ' Express' : ''}
          </small>
          {presentation && !finished && (
            <p className="admin-state-line">
              {[
                presentation.round !== undefined
                  ? `${tr('Ronda', 'Round')} ${presentation.round}`
                  : undefined,
                presentation.phase,
              ]
                .filter(Boolean)
                .join(' · ')}
              {presentation.actorId && (
                <>
                  {' '}
                  · {tr('turno de', 'turn:')}{' '}
                  <strong>{nickname(presentation.actorId)}</strong>
                </>
              )}
            </p>
          )}
          {finished && (
            <section className="objective-box admin-result">
              <p className="eyebrow">{tr('Resultado final', 'Final result')}</p>
              <h3>
                {view?.campaign?.winners.length
                  ? tr(
                      `Ganó ${view.campaign.winners.map(nickname).join(' y ')}`,
                      `${view.campaign.winners.map(nickname).join(' and ')} won`,
                    )
                  : tr('Empate', 'Tie')}
              </h3>
            </section>
          )}
          {view?.clock && !finished && (
            <section className="panel admin-clock">
              <dl>
                <div>
                  <dt>{tr('Duración de la partida', 'Game duration')}</dt>
                  <dd>{Math.floor(view.clock.elapsedMs / 60000)} min</dd>
                </div>
                <div>
                  <dt>{tr('Turno actual', 'Current turn')}</dt>
                  <dd>
                    {clockText(view.clock.activationRemainingMs)}{' '}
                    {tr('restantes', 'left')}
                  </dd>
                </div>
              </dl>
              <p className="admin-state-line">
                {clockState(view.clock, entry.players)}
              </p>
              <button
                type="button"
                disabled={busy || view.clock.pauseReason === 'disconnection'}
                onClick={() =>
                  void run(async () => {
                    await reconquistaRequest(`/games/${gameId}/pause`, {
                      paused: !view.clock?.pauseReason,
                    });
                    reload();
                  })
                }
              >
                {view.clock.pauseReason
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
          {!lobby && !finished && (
            <section className="admin-bots">
              {/* Without Express nobody turns absent: bots come in by hand. */}
              {entry.express && (
                <label className="inline-control">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={entry.botsReplaceAbsent !== false}
                    onChange={(event) =>
                      void setBots({ replaceAbsent: event.target.checked })
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
                  value={entry.botLevel ?? 'hard'}
                  onChange={(event) =>
                    void setBots({ level: event.target.value })
                  }
                >
                  <option value="easy">{tr('Fácil', 'Easy')}</option>
                  <option value="normal">Normal</option>
                  <option value="hard">{tr('Difícil', 'Hard')}</option>
                </select>
              </label>
            </section>
          )}
          <ul className="player-list">
            {entry.players.map((player, index) => (
              <li key={player.id}>
                <span
                  className={`color-dot color-${player.color}`}
                  aria-hidden="true"
                />
                <span className="admin-player-copy">
                  <strong>
                    {player.nickname}
                    {player.bot && player.bot !== 'table' ? ' (bot)' : ''}
                  </strong>
                  <small>
                    {playerColorNames[player.color] ?? player.color} ·{' '}
                    {tr('Asiento', 'Seat')} {index + 1}
                    {player.bot === 'table'
                      ? tr(' · bot de la mesa', ' · table bot')
                      : player.free
                        ? tr(' · sin jugador', ' · no player')
                        : ''}
                  </small>
                  {lobby && (
                    <span
                      className={`host-status-badge host-player-ready ${player.ready ? 'host-ready' : 'host-waiting'}`}
                      title={
                        player.ready
                          ? tr('Jugador listo', 'Player ready')
                          : tr('Todavía no está listo', 'Not ready yet')
                      }
                    >
                      <span aria-hidden="true">
                        {player.ready ? '✓ ' : '◷ '}
                      </span>
                      {player.ready
                        ? tr('Listo', 'Ready')
                        : tr('Pendiente', 'Pending')}
                    </span>
                  )}
                </span>
                <div className="row-actions">
                  {!lobby &&
                    !finished &&
                    !player.free &&
                    !eliminated(player.id) &&
                    // Express frees a table bot's seat for a person.
                    (player.bot !== 'table' || !!entry.express) && (
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
                          void setBots({
                            playerId: player.id,
                            enabled: !player.bot,
                          })
                        }
                      >
                        {player.bot
                          ? tr('Quitar bot', 'Remove bot')
                          : tr('Poner bot', 'Add bot')}
                      </button>
                    )}
                  {lobby && (
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
                        void run(async () => {
                          await reconquistaRequest(
                            `/games/${gameId}/players/${player.id}`,
                            undefined,
                            'DELETE',
                          );
                          reload();
                        })
                      }
                    >
                      <span className="remove-player-label">
                        {tr('Quitar', 'Remove')}
                      </span>
                      <span className="remove-player-icon" aria-hidden="true">
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
          <summary>{tr('Opciones avanzadas', 'Advanced options')}</summary>
          <button
            disabled={busy}
            type="button"
            className="danger"
            onClick={() =>
              void run(async () => {
                if (
                  !window.confirm(
                    lobby
                      ? tr(
                          `Eliminar definitivamente la partida ${gameId}?`,
                          `Delete game ${gameId} for good?`,
                        )
                      : tr(
                          `La partida ${gameId} ya está en curso. Eliminarla es destructivo y terminará inmediatamente el acceso a la partida. ¿Eliminar definitivamente?`,
                          `Game ${gameId} is already in progress. Deleting it is destructive and immediately ends access to the game. Delete it for good?`,
                        ),
                  )
                )
                  return;
                await reconquistaRequest(
                  `/games/${gameId}`,
                  undefined,
                  'DELETE',
                );
                onDeleted();
              })
            }
          >
            {tr('Eliminar partida', 'Delete game')}
          </button>
        </details>
      }
    />
  );
}
