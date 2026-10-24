import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './UiIcon.js';

// Background music: CC0 tracks from OpenGameArt bundled with the game, played
// in a shuffled loop. On by default, starting with the first click or key
// press (browsers block audio before that); turning it off only pauses the
// music, the turn chime keeps its own button. The choice is remembered per
// browser. Track list: music/README.md.
const CLASSIC_TRACKS = Object.values(
  import.meta.glob<string>('./music/classic/*.{ogg,mp3}', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
);
const RECONQUISTA_TRACKS = Object.values(
  import.meta.glob<string>('./music/reconquista/*.{ogg,mp3}', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
);
const STORAGE_KEY = 'ted-music';
const VOLUME = 0.35;

function shuffled(tracks: readonly string[], avoidFirst?: string): string[] {
  const list = [...tracks];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  // Never repeat the track that just ended when a new round of the list starts.
  if (list.length > 1 && list[0] === avoidFirst) list.push(list.shift()!);
  return list;
}

function savedChoice(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Music on/off button in the game toolbar; shared by every mode. */
export function MusicToggle({
  mode,
}: {
  readonly mode: 'classic' | 'reconquista';
}) {
  const tracks =
    mode === 'reconquista' && RECONQUISTA_TRACKS.length
      ? RECONQUISTA_TRACKS
      : CLASSIC_TRACKS;
  const [on, setOn] = useState(savedChoice);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<string[]>([]);
  useEffect(() => {
    setToolbar(document.getElementById('game-toolbar'));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Private windows may refuse storage; the button still works.
    }
    if (!on || !tracks.length) return;
    const audio = (player.current ??= new Audio());
    audio.volume = VOLUME;
    const next = () => {
      if (!queue.current.length)
        queue.current = shuffled(tracks, audio.currentSrc || undefined);
      audio.src = queue.current.shift()!;
      void audio.play().catch(() => {});
    };
    // Until the first click or key press the browser refuses to play.
    const startOnGesture = () => {
      if (audio.paused) void audio.play().catch(() => {});
      document.removeEventListener('pointerdown', startOnGesture);
      document.removeEventListener('keydown', startOnGesture);
    };
    audio.addEventListener('ended', next);
    if (audio.src) void audio.play().catch(() => {});
    else next();
    document.addEventListener('pointerdown', startOnGesture);
    document.addEventListener('keydown', startOnGesture);
    return () => {
      audio.removeEventListener('ended', next);
      document.removeEventListener('pointerdown', startOnGesture);
      document.removeEventListener('keydown', startOnGesture);
      audio.pause();
    };
  }, [on, tracks]);
  useEffect(
    () => () => {
      player.current?.pause();
      player.current = null;
    },
    [],
  );
  if (!tracks.length) return null;
  const control = (
    <button
      className="turn-sound music-toggle"
      type="button"
      title={on ? 'Apagar música' : 'Encender música'}
      aria-label={on ? 'Apagar música' : 'Encender música'}
      aria-pressed={on}
      onClick={() => setOn(!on)}
    >
      <UiIcon name={on ? 'music' : 'musicOff'} />
    </button>
  );
  return toolbar ? createPortal(control, toolbar) : control;
}
