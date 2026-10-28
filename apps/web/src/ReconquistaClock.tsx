import { useEffect, useState } from 'react';
import type { ReconquistaView } from '@game/protocol/reconquista';
import { clockText } from './TurnSummary.js';
import { tr } from './language.js';

/** Time passed since the view arrived, so the clock counts down between readings. */
function useSince(view: ReconquistaView) {
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setReceived(Date.now()), [view]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, now - received);
}

/** Reconquista Express clock, in the same box as Classic Express. */
export function ReconquistaClock({ view }: { readonly view: ReconquistaView }) {
  const since = useSince(view);
  const clock = view.clock;
  if (!clock || view.campaign?.phase === 'finished') return null;
  const pause = clock.pauseReason;
  const absent = view.players.find((p) => p.id === clock.disconnectedPlayerId);
  const running = !pause;
  const turn = Math.max(0, clock.activationRemainingMs - (running ? since : 0));
  const elapsed =
    clock.elapsedMs + (running && view.stage === 'campaign' ? since : 0);
  return (
    <>
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
                Math.max(0, (clock.technicalRemainingMs ?? 0) - since),
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
            {tr('Turno:', 'Turn:')} <strong>{clockText(turn)}</strong>
          </span>
          <span
            title={tr(
              'Tiempo de juego que queda, sin pausas ni preparación inicial. Al llegar a cero se anuncian las rondas finales.',
              'Game time left, without pauses or the initial setup. When it reaches zero the final rounds are announced.',
            )}
          >
            {`${tr('Partida', 'Game')}: ${Math.max(0, Math.ceil((clock.durationMs - elapsed) / 60000))} min`}
          </span>
        </span>
      )}
      {clock.finalRound !== undefined && (
        <span>{tr('Rondas finales anunciadas', 'Final rounds announced')}</span>
      )}
    </>
  );
}
