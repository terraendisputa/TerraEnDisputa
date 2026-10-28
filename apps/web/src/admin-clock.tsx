import { clockText } from './TurnSummary.js';
import { tr } from './language.js';

/** The game clock's state, naming why it is paused; Reconquista shares it. */
export function clockState(
  clock: {
    readonly pauseReason?: 'admin' | 'restart' | 'disconnection' | undefined;
    readonly disconnectedPlayerId?: string | undefined;
    readonly technicalRemainingMs?: number | undefined;
  },
  players: readonly {
    readonly id: string;
    readonly color: string;
    readonly nickname: string;
  }[],
) {
  if (clock.pauseReason === 'admin')
    return tr('Pausada por el administrador', 'Paused by the administrator');
  if (clock.pauseReason === 'restart')
    return tr(
      'Pausada por reinicio del servidor',
      'Paused by a server restart',
    );
  if (clock.pauseReason === 'disconnection') {
    const player = players.find(({ id }) => id === clock.disconnectedPlayerId);
    return (
      <>
        {tr('Pausada: esperando a', 'Paused: waiting for')}{' '}
        {player && (
          <>
            <span className={`color-dot color-${player.color}`} />{' '}
            <strong>{player.nickname}</strong>
          </>
        )}{' '}
        · {tr('Reconexión', 'Reconnection')}{' '}
        {clockText(clock.technicalRemainingMs ?? 0)}
      </>
    );
  }
  return tr('En curso', 'In progress');
}

/** 60 minutes read as 1:00 h, as in the Competitive duration choice. */
export function durationText(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`
    : `${minutes} min`;
}
