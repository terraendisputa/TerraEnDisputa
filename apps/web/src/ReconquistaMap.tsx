import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ReconquistaBoard,
  ReconquistaView,
} from '@game/protocol/reconquista';
import { MapViewport } from './MapViewport.js';
import { playerColorNames, playerColors } from './reconquista-labels.js';
import { tr } from './language.js';
import { translateMapArt } from './place-names.js';

const artBase = '/api/reconquista/art/';
// The frame sits outside the map, so the map keeps its 2400 × 1400 coordinates.
const viewBox = '-40 -40 2480 1480';

const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** Follows ThemeToggle, which writes data-theme on the root element. */
function useDocumentTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    setTheme(currentTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}

const star = (r: number, cx: number, cy: number) =>
  'M' +
  Array.from({ length: 10 }, (_, i) => {
    const d = i % 2 ? r * 0.4 : r;
    const a = (i * Math.PI) / 5;
    return `${(cx + d * Math.sin(a)).toFixed(1)},${(cy - d * Math.cos(a)).toFixed(1)}`;
  }).join('L') +
  'Z';
const onLight = (color: string) => color === 'white' || color === 'yellow';

/** Army counter: wargame chit in the player's colour, dark strip with a red star. */
function ArmyCounter({ color, armies }: { color: string; armies: number }) {
  return (
    <>
      <rect
        className="counter-body"
        x="-13"
        y="-14"
        width="26"
        height="28"
        rx="3"
        fill={playerColors[color] ?? '#888'}
      />
      <rect className="counter-strip" x="-12" y="-13" width="24" height="7" />
      <path className="counter-star" d={star(3.2, 0, -9.3)} />
      <text
        className={`counter-count ${onLight(color) ? 'on-light' : 'on-dark'}`}
        y="10"
      >
        {armies}
      </text>
    </>
  );
}

/**
 * The missile piece, painted in its owner's colour.
 * Each one sits on a spot and heading fixed by the board, so it never moves between turns.
 */
function Missile({
  color,
  spot,
}: {
  color: string;
  spot: readonly [number, number, number];
}) {
  const body = playerColors[color] ?? '#888';
  return (
    <g
      className={`missile-piece color-${color}`}
      transform={`translate(${spot[0]} ${spot[1]}) rotate(${spot[2]}) scale(.9)`}
    >
      <path d="M-9,10L-19,24V30L-9,22ZM9,10L19,24V30L9,22Z" fill={body} />
      <path className="missile-nozzle" d="M-6,20L-7.5,27H7.5L6,20Z" />
      <path d="M-9,-10V20H9V-10Z" fill={body} />
      <path
        className={color === 'red' ? 'missile-nose dark-nose' : 'missile-nose'}
        d="M-9,-10C-9,-18 -4,-25 0,-28C4,-25 9,-18 9,-10Z"
      />
      <rect className="missile-band" x="-8.3" y="-6" width="16.6" height="4" />
      <path
        className={onLight(color) ? 'missile-star red' : 'missile-star'}
        d={star(4.6, 0, 7)}
      />
      <path d="M-1.6,22V31H1.6V22Z" fill={body} />
    </g>
  );
}

/** Approved v8 artwork with per-occupant forces; shared countries show both colors. */
export function ReconquistaMap({
  board,
  view,
  selected,
  target,
  markerId,
  conquest,
  legalIds,
  missileIds,
  onCountry,
  onClear,
  preview = {},
}: {
  readonly board: ReconquistaBoard;
  readonly view: ReconquistaView;
  readonly selected: string;
  readonly target: string;
  /** Player whose selection is shown: the viewer, or the player on turn. */
  readonly markerId: string;
  /** A pending move into a conquered country, shown to everyone instead of any selection. */
  readonly conquest?: readonly {
    readonly id: string;
    readonly playerId: string;
  }[];
  readonly legalIds: readonly string[];
  readonly missileIds: readonly string[];
  readonly onCountry: ((id: string) => void) | undefined;
  /** A click on the sea, frame or artwork outside every country. */
  readonly onClear: () => void;
  /** Pending changes to the viewer's forces while choosing an amount, as Classic previews them. */
  readonly preview?: Readonly<
    Record<string, { readonly armies: number; readonly missiles: number }>
  >;
}) {
  const [art, setArt] = useState({ light: '', dark: '' });
  const host = useRef<HTMLDivElement>(null);
  const [resetKey] = useState(0);
  const theme = useDocumentTheme();
  // On phones the open menu covers the bottom of the map, so the outlined countries are brought above it.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600;
  useEffect(() => {
    let stopped = false;
    void Promise.all(
      ['light', 'dark'].map(async (theme) => {
        const response = await fetch(artBase + theme);
        if (!response.ok) throw Error('Map unavailable');
        return response.text();
      }),
    )
      .then(([light, dark]) => {
        if (!stopped)
          setArt({
            light: translateMapArt(light!),
            dark: translateMapArt(dark!),
          });
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  const player = (id: string) => view.players.find((p) => p.id === id);
  const legalKey = legalIds.join(','),
    missileKey = missileIds.join(',');
  useEffect(() => {
    const legal = new Set(legalKey.split(','));
    const missiles = new Set(missileKey.split(','));
    for (const element of host.current?.querySelectorAll('[id^="country-"]') ??
      []) {
      const id = element.id.slice(8);
      const territory = view.territories.find((t) => t.id === id);
      const name = board.countries.find((c) => c.id === id)?.name ?? id;
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute(
        'aria-label',
        `${name}${
          territory
            ? ': ' +
              territory.forces
                .map(
                  (f) =>
                    `${player(f.playerId)?.nickname ?? f.playerId} ${f.armies} ${tr('ejércitos', 'armies')}, ${f.missiles} ${tr('misiles', 'missiles')}`,
                )
                .join('; ')
            : ''
        }${missiles.has(id) ? tr(', destino de misil', ', missile target') : legal.has(id) ? tr(', disponible', ', available') : ''}`,
      );
      element.classList.toggle('reconquista-missile-target', missiles.has(id));
    }
  }, [art, theme, board, view, legalKey, missileKey]);
  // Country shapes from the artwork, for the attack and regroup outlines drawn above it.
  const shapes = useMemo(
    () =>
      new Map(
        Array.from(
          art.light.matchAll(/<path id="country-([a-z_]+)" d="([^"]+)"/g),
          (m) => [m[1]!, m[2]!] as const,
        ),
      ),
    [art.light],
  );
  const markerColor = player(markerId)?.color ?? '';
  // Origin in the selecting player's colour; the destination in its enemy occupant's, or
  // the selecting player's own when regrouping.
  const outlines = (
    conquest
      ? conquest.map(({ id, playerId }) => ({
          id,
          color: player(playerId)?.color ?? '',
        }))
      : [
          ...(selected ? [{ id: selected, color: markerColor }] : []),
          ...(target && target !== selected
            ? [
                {
                  id: target,
                  color:
                    player(
                      view.territories
                        .find((t) => t.id === target)
                        ?.forces.find((f) => f.playerId !== markerId)
                        ?.playerId ?? '',
                    )?.color ?? markerColor,
                },
              ]
            : []),
        ]
  ).filter((o) => o.color && shapes.has(o.id));
  const forces = view.territories.flatMap((t) => {
    const country = board.countries.find((c) => c.id === t.id);
    if (!country) return [];
    let start = 0;
    const shown = t.forces.map((base) => {
      const delta =
        base.playerId === view.self?.playerId ? preview[t.id] : undefined;
      const f = delta
        ? {
            ...base,
            armies: base.armies + delta.armies,
            missiles: base.missiles + delta.missiles,
          }
        : base;
      const entry = { f, owner: player(f.playerId), delta, start };
      start += f.missiles;
      return entry;
    });
    return [{ t, country, shown }];
  });
  // Names and other artwork lie over the countries, so a click looks through them
  // for a country below; only a click with none below clears the selection.
  const choose = (
    eventTarget: EventTarget,
    point?: { x: number; y: number },
  ) => {
    if (!onCountry || !(eventTarget instanceof Element)) return;
    const path =
      eventTarget.closest('[id^="country-"]') ??
      (point
        ? document
            .elementsFromPoint(point.x, point.y)
            .find(
              (e) => e.id.startsWith('country-') && host.current?.contains(e),
            )
        : null);
    if (path) onCountry(path.id.slice(8));
    else if (point) onClear();
  };
  return (
    <section
      className="map-frame reconquista-map"
      aria-label={tr('Mapa de Reconquista', 'Retake map')}
    >
      <MapViewport
        resetKey={resetKey}
        onScaleChange={() => {}}
        {...(narrow && outlines.length
          ? {
              reveal: outlines
                .map(({ id }) => `.reconquista-art > div [id="country-${id}"]`)
                .join(','),
            }
          : {})}
      >
        <div
          className="reconquista-art"
          ref={host}
          onClick={(e) => choose(e.target, { x: e.clientX, y: e.clientY })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              choose(e.target);
            }
          }}
        >
          {/* Only one theme inline: both SVGs carry global <style> rules and ids that would override each other. */}
          <div
            key={theme}
            className={`reconquista-${theme}`}
            dangerouslySetInnerHTML={{ __html: art[theme] }}
          />
          <svg
            className="reconquista-markers"
            viewBox={viewBox}
            aria-hidden="true"
          >
            {outlines.map(({ id, color }) => (
              <g key={id} className={`country-outline color-${color}`}>
                <path className="outline-halo" d={shapes.get(id)} />
                <path
                  className="outline-line"
                  d={shapes.get(id)}
                  fill={playerColors[color]}
                  stroke={playerColors[color]}
                />
              </g>
            ))}
            {forces.map(({ t, country, shown }) =>
              shown.flatMap(({ f, owner, start }) =>
                Array.from({ length: f.missiles }, (_, i) => (
                  <Missile
                    key={`${t.id}-${f.playerId}-${i}`}
                    color={owner?.color ?? ''}
                    spot={
                      country.missileSpots[
                        (start + i) % country.missileSpots.length
                      ]!
                    }
                  />
                )),
              ),
            )}
            {forces.map(({ t, country, shown }) => {
              const [x, y] = country.label;
              const shared = shown.length > 1;
              return (
                <g
                  key={t.id}
                  className={shared ? 'shared-country' : undefined}
                  transform={`translate(${x - (shared ? 16 : 0)} ${y})`}
                >
                  {shown.map(({ f, owner, delta }, i) => (
                    <g
                      key={f.playerId}
                      transform={`translate(${i * 32} 0)`}
                      className={`force-marker color-${owner?.color ?? ''}${delta ? ' force-preview' : ''}`}
                    >
                      <title>
                        {`${owner?.nickname ?? ''} (${playerColorNames[owner?.color ?? ''] ?? ''}): ${f.armies} ${tr('ejércitos', 'armies')}, ${f.missiles} ${tr('misiles', 'missiles')}`}
                      </title>
                      <ArmyCounter
                        color={owner?.color ?? ''}
                        armies={f.armies}
                      />
                      {delta && delta.missiles > 0 && (
                        <text className="force-delta" x="-16" y="5">
                          −{6 * delta.missiles}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </MapViewport>
    </section>
  );
}
