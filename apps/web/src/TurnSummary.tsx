import type { PlayerGameView } from '@game/protocol';
import { gameClockDurationMs } from '@game/game-engine';
import { gameContextSummary, gamePresentation } from './game-presentation.js';
import { tr } from './language.js';

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
      title={`${summary.headline} · ${summary.roundNumber === undefined ? '' : `${tr('Ronda', 'Round')} ${summary.roundNumber} · `}${detail}`}
    >
      <strong>{summary.headline}</strong>
      <span>
        {summary.roundNumber !== undefined && (
          <>
            <strong>
              {tr('Ronda', 'Round')} {summary.roundNumber}
            </strong>{' '}
            ·{' '}
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
                  ? tr(
                      `El reloj está congelado mientras se espera que ${absent?.nickname ?? 'el jugador'} se reconecte.`,
                      `The clock is frozen while waiting for ${absent?.nickname ?? 'the player'} to reconnect.`,
                    )
                  : tr(
                      'El reloj está congelado; el administrador debe reanudar la partida.',
                      'The clock is frozen; the administrator must resume the game.',
                    )
              }
            >
              <strong>
                {pause === 'disconnection' ? (
                  <>
                    {tr('Pausa · Esperando a', 'Paused · Waiting for')}{' '}
                    {absent && (
                      <span
                        className={`color-dot color-${absent.color}`}
                        aria-hidden="true"
                      />
                    )}{' '}
                    <span className="pause-player">
                      {absent?.nickname ?? tr('jugador', 'player')}
                    </span>
                  </>
                ) : (
                  tr('Pausa · Administrador', 'Paused · Administrator')
                )}
              </strong>
              {pause === 'disconnection' && (
                <span>
                  {tr('Reconexión:', 'Reconnection:')}{' '}
                  {clockText(
                    snapshot.competitiveClock.technicalRemainingMs ?? 0,
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="competitive-clock">
              <span
                title={tr(
                  'Tiempo restante para terminar el turno actual.',
                  'Time left to finish the current turn.',
                )}
              >
                {tr('Turno:', 'Turn:')}{' '}
                <strong>
                  {clockText(snapshot.competitiveClock.activationRemainingMs)}
                </strong>
              </span>
              {/* The game clock counts down to the final rounds. */}
              <span
                title={tr(
                  'Tiempo de juego que queda, sin pausas ni preparación inicial. Al llegar a cero se anuncian las rondas finales.',
                  'Game time left, without pauses or the initial setup. When it reaches zero the final rounds are announced.',
                )}
              >
                {`${tr('Partida', 'Game')}: ${Math.max(
                  0,
                  Math.ceil(
                    (gameClockDurationMs(snapshot) -
                      snapshot.competitiveClock.elapsedMs) /
                      60000,
                  ),
                )} min`}
              </span>
            </span>
          )}
          {!!snapshot.competitiveClock.lastUnplacedArmiesLost && (
            <span>
              {tr(
                `Vencimiento anterior: ${snapshot.competitiveClock.lastUnplacedArmiesLost} refuerzos perdidos por falta de destino legal.`,
                `Last timeout: ${snapshot.competitiveClock.lastUnplacedArmiesLost} reinforcements lost for lack of a legal destination.`,
              )}
            </span>
          )}
          {snapshot.competitiveClock.finalRoundNumber !== undefined && (
            <span>
              {snapshot.mode === 'competitive'
                ? tr(
                    'Rondas finales anunciadas · No se pueden romper pactos',
                    'Final rounds announced · Pacts cannot be broken',
                  )
                : tr('Rondas finales anunciadas', 'Final rounds announced')}
            </span>
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
