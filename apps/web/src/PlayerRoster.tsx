import { GAME_NAME, COMPETITIVE_NAME } from './identity.js';
import { ModeLogo, useModeFavicon } from './ModeLogo.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerGameView } from '@game/protocol';
import { MusicToggle } from './MusicToggle.js';
import { UiIcon } from './UiIcon.js';
import { gamePresentation } from './game-presentation.js';

export function PlayerRoster({
  snapshot,
}: {
  readonly snapshot: PlayerGameView;
}) {
  const [inspected, setInspected] = useState<string | null>(null);
  const roster = useRef<HTMLDivElement | null>(null);
  const logoMode = snapshot.mode === 'competitive' ? 'competitive' : 'classic';
  useModeFavicon(logoMode);
  const actor = gamePresentation(snapshot).actorId;
  const players = [...snapshot.players].sort(
    (a, b) => a.seatIndex - b.seatIndex,
  );
  const player = players.find((p) => p.id === inspected);
  function closePlayer() {
    roster.current
      ?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
      ?.focus();
    setInspected(null);
  }
  useEffect(() => {
    const active = roster.current?.querySelector<HTMLElement>(
      '[aria-current="true"]',
    );
    if (
      active &&
      window.matchMedia('(max-width:800px), (max-height:520px)').matches
    ) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [actor]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        roster.current?.querySelector('button[aria-expanded="true"]')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePlayer();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  return (
    <>
      <TurnSound actorId={actor} selfId={snapshot.selfPlayerId} />
      <MusicToggle mode="classic" />
      <nav className="player-roster" aria-label="Jugadores y turno">
        <a
          className="roster-brand"
          href="/"
          title={snapshot.mode === 'competitive' ? COMPETITIVE_NAME : GAME_NAME}
          aria-label={
            snapshot.mode === 'competitive' ? COMPETITIVE_NAME : GAME_NAME
          }
        >
          <ModeLogo mode={logoMode} />
        </a>
        <div
          className="roster-seats"
          ref={roster}
          aria-label="Jugadores; desplazá para ver más"
        >
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`roster-player color-${p.color}${p.eliminated ? ' is-eliminated' : ''}${p.id === snapshot.selfPlayerId ? ' is-self' : ''}`}
              aria-current={p.id === actor ? 'true' : undefined}
              aria-expanded={inspected === p.id}
              aria-label={`Ver información de ${p.nickname}${p.id === actor ? ', turno actual' : ''}`}
              title={`${p.nickname}${p.bot && p.bot !== 'table' ? ' (bot)' : ''}`}
              onClick={() => setInspected(inspected === p.id ? null : p.id)}
            >
              <span className="roster-name">
                {p.nickname}
                {p.bot && p.bot !== 'table' ? ' (bot)' : ''}
              </span>
              <span className="turn-alert" aria-hidden="true">
                !
              </span>
            </button>
          ))}
        </div>
      </nav>
      {player && (
        <section
          className="player-popover"
          aria-label={`Información de ${player.nickname}`}
        >
          <header>
            <strong>
              {player.nickname}
              {player.bot && player.bot !== 'table' ? ' (bot)' : ''}
              {player.id === snapshot.selfPlayerId ? ' · vos' : ''}
            </strong>
            <button
              type="button"
              aria-label="Cerrar información del jugador"
              onClick={closePlayer}
            >
              <UiIcon name="close" />
            </button>
          </header>
          <p className="player-stat">
            <strong>
              {
                Object.values(snapshot.territories ?? {}).filter(
                  (t) => t.ownerId === player.id,
                ).length
              }
            </strong>{' '}
            territorios
          </p>
          <p>
            <UiIcon name="cards" /> {player.cardCount} cartas
          </p>
          <small>
            {player.disqualified
              ? 'Descalificado'
              : player.eliminated
                ? 'Eliminado'
                : player.bot === 'table'
                  ? 'Bot de la mesa'
                  : player.bot
                    ? 'Juega un bot'
                    : player.absent
                      ? 'Ausente · turnos automáticos'
                      : player.controller === 'controllerless_reassignment'
                        ? 'Sin jugador'
                        : player.id === actor
                          ? 'Jugando ahora'
                          : 'En partida'}
          </small>
        </section>
      )}
    </>
  );
}

// Browsers allow audio only after a user gesture. The chime is unlocked by any
// gesture since the page opened (choosing a seat in the waiting room counts),
// so the first turn of the game can already sound.
let turnAudio: AudioContext | undefined;
function unlockTurnAudio() {
  if (typeof AudioContext === 'undefined') return;
  turnAudio ??= new AudioContext();
  if (turnAudio.state === 'suspended') void turnAudio.resume().catch(() => {});
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlockTurnAudio);
  document.addEventListener('keydown', unlockTurnAudio);
}

/** Turn chime and its mute button in the game toolbar; shared by Classic and Reconquista. */
export function TurnSound({
  actorId: actor,
  selfId,
}: {
  readonly actorId: string | null | undefined;
  readonly selfId: string | null | undefined;
}) {
  const [sound, setSound] = useState(true);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  // Starts empty so the chime also plays when the game opens on one's own
  // turn, as in the first round of initial reinforcements.
  const previousActor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setToolbar(document.getElementById('game-toolbar'));
  }, []);
  useEffect(() => {
    if (previousActor.current !== actor && actor === selfId && sound) {
      // Plays at once if the page already had a gesture; otherwise stays silent.
      unlockTurnAudio();
    }
    if (
      previousActor.current !== actor &&
      actor === selfId &&
      sound &&
      turnAudio
    ) {
      const context = turnAudio;
      void context
        .resume()
        .then(() => {
          [523, 659, 784].forEach((frequency, index) => {
            const oscillator = context.createOscillator(),
              gain = context.createGain(),
              time = context.currentTime + index * 0.12;
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.05, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(time);
            oscillator.stop(time + 0.24);
            oscillator.onended = () => {
              oscillator.disconnect();
              gain.disconnect();
            };
          });
        })
        .catch(() => {});
    }
    previousActor.current = actor;
  }, [actor, selfId, sound]);
  const soundControl = (
    <button
      className="turn-sound"
      type="button"
      title={sound ? 'Silenciar sonido de turno' : 'Activar sonido de turno'}
      aria-label={
        sound ? 'Silenciar sonido de turno' : 'Activar sonido de turno'
      }
      aria-pressed={sound}
      onClick={() => {
        if (!sound) unlockTurnAudio();
        setSound(!sound);
      }}
    >
      <UiIcon name={sound ? 'sound' : 'mute'} />
    </button>
  );
  return toolbar ? createPortal(soundControl, toolbar) : soundControl;
}
