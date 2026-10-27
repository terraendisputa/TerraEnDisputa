import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './UiIcon.js';

// Background music: CC0 tracks from OpenGameArt bundled with the game. Each
// moment of the game has its own tracks: calm while armies are placed, intense
// during attacks, and a final track repeated once someone wins. A change of
// moment never cuts a track; it only starts one when nothing is playing, and a
// silence of one to three minutes follows each track. Only the final track
// replaces the one playing, with a short fade. On by default, starting with the
// first click or key press (browsers block audio before that); turning it off
// only pauses the music, the turn chime keeps its own button. The choice is
// remembered per browser. Track list and moments: music/README.md.
const CLASSIC_TRACKS = import.meta.glob<string>('./music/classic/*.{ogg,mp3}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const RECONQUISTA_TRACKS = import.meta.glob<string>(
  './music/reconquista/*.{ogg,mp3}',
  { eager: true, query: '?url', import: 'default' },
);
export type MusicMoment = 'calm' | 'intense' | 'final';
const MOMENTS: Readonly<Record<string, MusicMoment>> = {
  c02: 'calm',
  c06: 'calm',
  c11: 'calm',
  c12: 'calm',
  c16: 'calm',
  c20: 'calm',
  c18: 'final',
  r01: 'calm',
  r04: 'calm',
  r05: 'calm',
  r07: 'calm',
  r12: 'calm',
  r13: 'calm',
  r17: 'final',
};
/** Tracks by moment; a track not listed above is intense. */
function byMoment(
  files: Readonly<Record<string, string>>,
): Record<MusicMoment, string[]> {
  const groups: Record<MusicMoment, string[]> = {
    calm: [],
    intense: [],
    final: [],
  };
  for (const [path, url] of Object.entries(files))
    groups[MOMENTS[/\/([a-z]\d\d)-/.exec(path)?.[1] ?? ''] ?? 'intense'].push(
      url,
    );
  return groups;
}
const CLASSIC = byMoment(CLASSIC_TRACKS);
const RECONQUISTA = byMoment(RECONQUISTA_TRACKS);
const STORAGE_KEY = 'ted-music';
const VOLUME = 0.35;
const FADE_MS = 1500;
const silence = () => 60_000 + Math.random() * 120_000;

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
  moment,
}: {
  readonly mode: 'classic' | 'reconquista';
  readonly moment: MusicMoment;
}) {
  const groups =
    mode === 'reconquista' && Object.keys(RECONQUISTA_TRACKS).length
      ? RECONQUISTA
      : CLASSIC;
  const tracks = Object.values(groups).flat();
  const [on, setOn] = useState(savedChoice);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const queues = useRef<Partial<Record<MusicMoment, string[]>>>({});
  const current = useRef(moment);
  // Until then the music stays quiet after a track; zero at the start.
  const quietUntil = useRef(0);
  // Starts a track of the current moment if nothing plays and the silence is over.
  const start = useRef<() => void>(() => {});
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
    let wait: ReturnType<typeof setTimeout> | undefined;
    start.current = () => {
      clearTimeout(wait);
      if (!audio.paused && !audio.ended) return;
      const left = quietUntil.current - Date.now();
      if (left > 0) {
        wait = setTimeout(start.current, left);
        return;
      }
      const moment = current.current;
      const pool = groups[moment].length ? groups[moment] : groups.intense;
      const queue = queues.current[moment];
      if (!queue?.length)
        queues.current[moment] = shuffled(pool, audio.currentSrc || undefined);
      audio.src = queues.current[moment]!.shift()!;
      audio.loop = moment === 'final';
      audio.volume = VOLUME;
      void audio.play().catch(() => {});
    };
    const ended = () => {
      quietUntil.current = Date.now() + silence();
      start.current();
    };
    // Until the first click or key press the browser refuses to play.
    const startOnGesture = () => {
      if (audio.paused && audio.src && !audio.ended)
        void audio.play().catch(() => {});
      else start.current();
      document.removeEventListener('pointerdown', startOnGesture);
      document.removeEventListener('keydown', startOnGesture);
    };
    audio.addEventListener('ended', ended);
    if (audio.src && !audio.ended) void audio.play().catch(() => {});
    else start.current();
    document.addEventListener('pointerdown', startOnGesture);
    document.addEventListener('keydown', startOnGesture);
    return () => {
      clearTimeout(wait);
      start.current = () => {};
      audio.removeEventListener('ended', ended);
      document.removeEventListener('pointerdown', startOnGesture);
      document.removeEventListener('keydown', startOnGesture);
      audio.pause();
    };
  }, [on, groups, tracks.length]);
  useEffect(() => {
    if (current.current === moment) return;
    current.current = moment;
    // The final track never waits for a silence.
    if (moment === 'final') quietUntil.current = 0;
    const audio = player.current;
    if (moment !== 'final' || !audio || audio.paused) {
      start.current();
      return;
    }
    // The final track replaces the one playing after a short fade.
    const from = audio.volume;
    const began = Date.now();
    const fade = setInterval(() => {
      const left = 1 - (Date.now() - began) / FADE_MS;
      if (left > 0) {
        audio.volume = from * left;
        return;
      }
      clearInterval(fade);
      audio.pause();
      start.current();
    }, 50);
    return () => clearInterval(fade);
  }, [moment]);
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
