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
  const missingPlayers = entry.playerCount - entry.players.length;
  const ready = entry.players.filter((p) => p.ready).length;
  const missingReady = entry.players.length - ready;
  // Everyone who joined is ready: the table shrinks to them on start (user
  // decision 2026-10-24).
  const readyToStart = lobby && missingReady === 0 && entry.players.length >= 2;
  const configure = (playerCount: number) =>
    reconquistaRequest(`/games/${gameId}`, { playerCount }, 'PATCH');
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
        <label className="inline-control">
          Jugadores requeridos
          <select
            disabled={busy || !lobby}
            value={entry.playerCount}
            onChange={(event) =>
              void run(async () => {
                await configure(Number(event.target.value));
                reload();
              })
            }
          >
            {[2, 3, 4, 5, 6].map((count) => (
              <option key={count} disabled={count < entry.players.length}>
                {count}
              </option>
            ))}
          </select>
        </label>
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
                ? `Todos los que entraron están listos. Podés comenzar con ${entry.players.length} jugadores.`
                : missingPlayers > 0
                  ? `Falta${missingPlayers === 1 ? '' : 'n'} ${missingPlayers} ${missingPlayers === 1 ? 'persona' : 'personas'} para completar la mesa.`
                  : missingReady > 0
                    ? `Esperando que ${missingReady} ${missingReady === 1 ? 'persona marque' : 'personas marquen'} «Estoy listo».`
                    : 'Todos están listos. Podés comenzar.'}{' '}
              Listos: {ready}/{entry.playerCount}.
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
                    if (entry.players.length !== entry.playerCount)
                      await configure(entry.players.length);
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
          <small>{RECONQUISTA_NAME}</small>
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
                Ganó {(view?.campaign?.winners ?? []).map(nickname).join(' y ')}
              </h3>
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
                  <strong>{player.nickname}</strong>
                  <small>
                    {playerColorNames[player.color] ?? player.color} · Asiento{' '}
                    {index + 1}
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
