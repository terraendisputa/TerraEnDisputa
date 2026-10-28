export type IconName =
  | 'sun'
  | 'moon'
  | 'sound'
  | 'mute'
  | 'music'
  | 'musicOff'
  | 'plus'
  | 'reinforcement'
  | 'movement'
  | 'minus'
  | 'fit'
  | 'dice'
  | 'close'
  | 'leave'
  | 'objective'
  | 'cards'
  | 'pact'
  | 'sword'
  | 'exchange'
  | 'endRegroup'
  | 'check'
  | 'finish'
  | 'shield'
  | 'arrow'
  | 'collapse'
  | 'expand'
  | 'balloon'
  | 'galleon'
  | 'cannon'
  | 'wildcard'
  | 'plane'
  | 'tank'
  | 'missile'
  | 'nuke'
  | 'situation'
  | 'copy'
  | 'textSize';

const paths: Record<IconName, string> = {
  reinforcement:
    'M3 12h7M6.5 8.5v7M13 20V9h8v11M12 20h10M13 9V5h2v2h4V5h2v4M16 20v-4h2v4',
  movement: 'M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4',
  finish: 'M5 22V3m0 1c5-3 9 3 15 0l-3 4 3 4c-6 3-10-3-15 0m5 5 3 3 7-7',
  collapse: 'm6 15 6-6 6 6',
  expand: 'm6 9 6 6 6-6',
  // The attack sword stopped by a bar, like endRegroup: the attacks end, not the turn.
  // Regroup arrows stopped by a bar: the regroup ends, not the turn.
  // Two arrows turning in a circle around a check: regrouping is over.
  endRegroup:
    'M19.5 9.5A8 8 0 0 0 6 6.3M6 2.8v3.5h3.5M4.5 14.5A8 8 0 0 0 18 17.7m0 3.5v-3.5h-3.5M9 12l2 2 4-4',
  // A card between two arrows turning in a circle: exchange cards.
  exchange:
    'M10 8.5h4v7h-4ZM4 11a8 8 0 0 1 13.7-5.5M18 2v3.5h-3.5M20 13a8 8 0 0 1-13.7 5.5M6 22v-3.5h3.5',
  check: 'm4 12 5 5L20 6',
  balloon:
    'M12 2C3 2 3 11 9 16h6C21 11 21 2 12 2Zm0 0c-4 4-4 9 0 14m0-14c4 4 4 9 0 14M7 10h10m-8 6 1 4h4l1-4m-5 4v2h4v-2',
  galleon: 'M3 17h18l-4 4H7ZM12 2v15M11 4 5 14h6Zm2 1 6 9h-6M2 23h20',
  cannon:
    'm4 11 14-6 3 4-14 6Zm3 4h9m-4-3 3 4M10 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0m10 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0M2 22h20',
  wildcard: 'm12 2 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z',
  plane: 'M2 13l8-2 2-8h2l-1 8 8 2v2l-8-1-1 5 3 2v1l-5-1-5 1v-1l3-2-1-5-8 1Z',
  tank: 'M3 15h18v4H3Zm3-4h10v4H6Zm4 0V8h11',
  // The board game's missile, as drawn on the map: an upright rocket with fins.
  missile:
    'M12 2c2.5 2.5 3.5 5.5 3.5 9v5l3 3v3h-3v-2h-7v2h-3v-3l3-3v-5c0-3.5 1-6.5 3.5-9ZM9.5 10h5',
  situation: 'M5 3h14v18H5Zm3 4h8m-8 4h8m-8 4h5',
  // Two overlapping sheets.
  copy: 'M9 9h11v11H9ZM15 9V4H4v11h5',
  // A mushroom cloud with a billowing cap: fire the missile.
  nuke: 'M6.5 11c-2.2 0-3.5-1.6-3-3.4.4-1.4 1.7-2 2.8-1.8C6.5 3.8 8 2.5 10 2.8c1-1.2 3-1.2 4 0 2-.3 3.5 1 3.7 3 1.1-.2 2.4.4 2.8 1.8.5 1.8-.8 3.4-3 3.4ZM10.3 11v2.3m3.4-2.3v2.3M8 13.3h8m-5.5 0c0 2.3-.4 4-1.3 5.4m4.3-5.4c0 2.3.4 4 1.3 5.4M3.5 22c.3-1.5 1.5-2.5 3-2.3.6-1 2-1.4 3-.8.8-.8 2.2-.8 3 0 1-.6 2.4-.2 3 .8 1.5-.2 2.7.8 3 2.3Z',
  sword: 'm3 21 2-2m-1-1 3-3m-3-3 8 8M7 15 17 3l4-1-1 4L9 17',
  shield: 'M12 3C9 5 6 6 4 6v6c0 5 8 9 8 9s8-4 8-9V6c-2 0-5-1-8-3Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  objective: 'M21 12a9 9 0 1 1-9-9m5 9a5 5 0 1 1-5-5m0 5 9-9m-5 0h5v5',
  cards: 'M9 5h10v16H9ZM6 18H3V2h10v1m-1 10 2-3 2 3-2 3Z',
  pact: 'm3 8 4-4 5 2 5-2 4 4-4 10-3 2-4-2-3 1-5-5Zm4 0 4-2m1 0-4 5 3 2 3-3 5 4m-9 4 2-3m2 5 2-3',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.5 14A8.7 8.7 0 0 1 10 3.5 8.7 8.7 0 1 0 20.5 14Z',
  sound: 'M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  mute: 'M11 5 6 9H3v6h3l5 4Zm5 4 5 6m0-6-5 6',
  // Two beamed notes; crossed out when the music is off.
  music:
    'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 9l11-2',
  musicOff:
    'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0M3 3l18 18',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  fit: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  dice: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm1 4h.01M12 12h.01M16 16h.01',
  close: 'm6 6 12 12M18 6 6 18',
  leave: 'M9 4H4v16h5m5-13 5 5-5 5M8 12h11',
  textSize: 'M3 19 8 6l5 13M4.8 15h6.4M14 19l3.5-9 3.5 9m-5.8-3h4.6',
};

// Fine engraving stays inside the existing silhouettes and scales with them.
// Card illustrations and compact utility marks keep their original drawings.
const engraving: Partial<Record<IconName, string>> = {
  reinforcement: 'M16 11h2m-2 2h2',
  movement: 'M4 4h6m4 16h6M4 10h6m4 10h6',
  finish: 'M8 5v5m3-4v4m3-3v3',
  sword: 'M10 13 18 5M5 17l2 2',
  shield: 'M12 6v12M7 9h10M7 12c0 2 2 4 3 4m7-4c0 2-2 4-3 4',
  objective: 'M3 11h3m5 7v3M6 5l2 2m9 10 2 2',
  cards: 'M11 7h2m2 12h2M5 5h2m-2 3v6',
  pact: 'm3 9 3 4m12-5 2 2m-8 6 2 2',
  sun: 'M10 10c1-1 3-1 4 0m-4 4c1 1 3 1 4 0',
  moon: 'M6 11a7 7 0 0 0 7 7m3-14v4m-2-2h4',
  sound: 'M8 9v6M5 11v2',
  mute: 'M8 9v6M5 11v2',
  fit: 'M6 7V6h1m10 0h1v1M6 17v1h1m10 0h1v-1',
  dice: 'M7 6h10M6 7v10m1 1h10M18 7v10',
  leave: 'M6 7v2m0 6v2M11 4h1m-1 16h1',
};

// Drawn upright, shown leaning like the sword.
const leaning: Partial<Record<IconName, string>> = {
  missile: 'translate(12 12) rotate(45) scale(0.9) translate(-12 -12)',
};

export function UiIcon({ name }: { readonly name: IconName }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g transform={leaning[name]}>
        <path d={paths[name]} />
        {engraving[name] && (
          <path d={engraving[name]} strokeWidth="0.9" opacity="0.7" />
        )}
      </g>
    </svg>
  );
}
