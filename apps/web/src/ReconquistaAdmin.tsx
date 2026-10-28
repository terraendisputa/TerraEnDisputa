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
  if (!entry) return <p role="status">Cargando la partida…</p>;
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
    entry.players.find((p) => p.id === id)?.nickname ?? 'jugador';
  return (
    <AdminBoxes
      key={gameId}
      gameId={gameId}
      lobby={lobby}
      seats={
        <>
          <label className="inline-control">
            Jugadores requeridos
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
            title="Asientos que ocupan bots al comenzar. Siempre queda al menos uno para una persona."
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
                  {n === 0 ? 'Sin bots' : n}
                </option>
              ))}
            </select>
          </label>
          <label
            className="inline-control"
            title="Express: turnos de 3 minutos y tiempo máximo de juego, después dos rondas finales."
          >
            Duración
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
              <option value="free">Sin límite</option>
              <option value="express">
                {`Express: ${durationText(reconquistaExpressDurationMs(entry.playerCount))} + 2 rondas`}
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
                ? `Todos los que entraron están listos. Podés comenzar con ${entry.players.length + bots} jugadores.`
                : missingPlayers > 0
                  ? `Falta${missingPlayers === 1 ? '' : 'n'} ${missingPlayers} ${missingPlayers === 1 ? 'persona' : 'personas'} para completar la mesa.`
                  : missingReady > 0
                    ? `Esperando que ${missingReady} ${missingReady === 1 ? 'persona marque' : 'personas marquen'} «Estoy listo».`
                    : 'Todos están listos. Podés comenzar.'}{' '}
              Listos: {ready}/{entry.playerCount - bots}.
              {bots === 1
                ? ' El bot se suma al comenzar.'
                : bots
                  ? ` Los ${bots} bots se suman al comenzar.`
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
                    : 'Todos los que entraron deben estar listos.'
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
                Comenzar partida
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
              ? 'Todo listo para comenzar'
              : lobby
                ? 'Esperando jugadores'
                : finished
                  ? 'Finalizada'
                  : 'En juego'}
          </p>
          <h2>Partida {gameId.slice(0, 8)}</h2>
          <small>
            {RECONQUISTA_NAME}
            {entry.express ? ' Express' : ''}
          </small>
          {presentation && !finished && (
            <p className="admin-state-line">
              {[
                presentation.round !== undefined
                  ? `Ronda ${presentation.round}`
                  : undefined,
                presentation.phase,
              ]
                .filter(Boolean)
                .join(' · ')}
              {presentation.actorId && (
                <>
                  {' '}
                  · turno de <strong>{nickname(presentation.actorId)}</strong>
                </>
              )}
            </p>
          )}
          {finished && (
            <section className="objective-box admin-result">
              <p className="eyebrow">Resultado final</p>
              <h3>
                {view?.campaign?.winners.length
                  ? `Ganó ${view.campaign.winners.map(nickname).join(' y ')}`
                  : 'Empate'}
              </h3>
            </section>
          )}
          {view?.clock && !finished && (
            <section className="panel admin-clock">
              <dl>
                <div>
                  <dt>Duración de la partida</dt>
                  <dd>{Math.floor(view.clock.elapsedMs / 60000)} min</dd>
                </div>
                <div>
                  <dt>Turno actual</dt>
                  <dd>
                    {clockText(view.clock.activationRemainingMs)} restantes
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
                  ? 'Reanudar cuando todos estén disponibles'
                  : 'Pausar por inconveniente técnico'}
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
                  Reemplazar ausentes por bot
                </label>
              )}
              <label className="inline-control">
                Dificultad de los bots
                <select
                  disabled={busy}
                  value={entry.botLevel ?? 'hard'}
                  onChange={(event) =>
                    void setBots({ level: event.target.value })
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
                    {playerColorNames[player.color] ?? player.color} · Asiento{' '}
                    {index + 1}
                    {player.bot === 'table'
                      ? ' · bot de la mesa'
                      : player.free
                        ? ' · sin jugador'
                        : ''}
                  </small>
                  {lobby && (
                    <span
                      className={`host-status-badge host-player-ready ${player.ready ? 'host-ready' : 'host-waiting'}`}
                      title={
                        player.ready ? 'Jugador listo' : 'Todavía no está listo'
                      }
                    >
                      <span aria-hidden="true">
                        {player.ready ? '✓ ' : '◷ '}
                      </span>
                      {player.ready ? 'Listo' : 'Pendiente'}
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
                            ? `Liberar el asiento de ${player.nickname}: sus turnos pasan solos hasta que lo tome una persona`
                            : player.bot
                              ? `Devolverle el lugar a ${player.nickname}`
                              : `Poner un bot en lugar de ${player.nickname}`
                        }
                        onClick={() =>
                          void setBots({
                            playerId: player.id,
                            enabled: !player.bot,
                          })
                        }
                      >
                        {player.bot ? 'Quitar bot' : 'Poner bot'}
                      </button>
                    )}
                  {lobby && (
                    <button
                      type="button"
                      aria-label={`Quitar a ${player.nickname}`}
                      title={`Quitar a ${player.nickname}`}
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
                      <span className="remove-player-label">Quitar</span>
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
          <summary>Opciones avanzadas</summary>
          <button
            disabled={busy}
            type="button"
            className="danger"
            onClick={() =>
              void run(async () => {
                if (
                  !window.confirm(
                    lobby
                      ? `Eliminar definitivamente la partida ${gameId}?`
                      : `La partida ${gameId} ya está en curso. Eliminarla es destructivo y terminará inmediatamente el acceso a la partida. ¿Eliminar definitivamente?`,
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
            Eliminar partida
          </button>
        </details>
      }
    />
  );
}
