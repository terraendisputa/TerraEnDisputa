import type { PlayerGameView } from '@game/protocol';
import { competitiveDurationMs } from '@game/game-engine';
import { gameContextSummary, gamePresentation } from './game-presentation.js';

export function TurnSummary({
  snapshot,
  presentation,
}: {
  readonly snapshot: PlayerGameView;
  readonly presentation: ReturnType<typeof gamePresentation>;
}) {
  const summary = gameContextSummary(snapshot, presentation);
  const pause = snapshot.competitiveClock?.pauseReason;
  const absent = snapshot.players.find(
    ({ id }) => id === snapshot.competitiveClock?.disconnectedPlayerId,
  );
  const detail =
    snapshot.mode === 'competitive'
      ? summary.detail
      : presentation.lock || summary.detail;
  return (
    <div
      className="right-turn-summary"
      role="status"
      title={`${summary.headline} · ${summary.roundNumber === undefined ? '' : `Ronda ${summary.roundNumber} · `}${detail}`}
    >
      <strong>{summary.headline}</strong>
      <span>
        {summary.roundNumber !== undefined && (
          <>
            <strong>Ronda {summary.roundNumber}</strong> ·{' '}
          </>
        )}
        {detail}
      </span>
      {snapshot.competitiveClock && (
        <>
          {/* The clock in its own box, like Reconquista's situation line.
              During a pause the same box says who the game waits for. */}
          {pause ? (
            <span
              className="competitive-clock competitive-pause"
              title={
                pause === 'disconnection'
                  ? `El reloj está congelado mientras se espera que ${absent?.nickname ?? 'el jugador'} se reconecte.`
                  : 'El reloj está congelado; el administrador debe reanudar la partida.'
              }
            >
              <strong>
                {pause === 'disconnection' ? (
                  <>
                    Pausa · Esperando a{' '}
                    {absent && (
                      <span
                        className={`color-dot color-${absent.color}`}
                        aria-hidden="true"
                      />
                    )}{' '}
                    <span className="pause-player">
                      {absent?.nickname ?? 'jugador'}
                    </span>
                  </>
                ) : (
                  'Pausa · Administrador'
                )}
              </strong>
              {pause === 'disconnection' && (
                <span>
                  Reconexión:{' '}
                  {clockText(
                    snapshot.competitiveClock.technicalRemainingMs ?? 0,
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="competitive-clock">
              <span title="Tiempo restante para terminar el turno actual.">
                Turno:{' '}
                <strong>
                  {clockText(snapshot.competitiveClock.activationRemainingMs)}
                </strong>
              </span>
              {/* The game clock counts down to the final rounds. */}
              <span title="Tiempo de juego que queda, sin pausas ni preparación inicial. Al llegar a cero se anuncian las rondas finales.">
                {`Partida: ${Math.max(
                  0,
                  Math.ceil(
                    (competitiveDurationMs(
                      snapshot.configuredPlayerCount,
                      snapshot.competitiveDurationMinutes,
                    ) -
                      snapshot.competitiveClock.elapsedMs) /
                      60000,
                  ),
                )} min`}
              </span>
            </span>
          )}
          {!!snapshot.competitiveClock.lastUnplacedArmiesLost && (
            <span>
              Vencimiento anterior:{' '}
              {snapshot.competitiveClock.lastUnplacedArmiesLost} refuerzos
              perdidos por falta de destino legal.
            </span>
          )}
          {snapshot.competitiveClock.finalRoundNumber !== undefined && (
            <span>Rondas finales anunciadas · No se pueden romper pactos</span>
          )}
        </>
      )}
    </div>
  );
}

export function clockText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
