import type { PlayerGameView } from '@game/protocol';

type Symbol = PlayerGameView['private']['cards'][number]['symbol'];

// Card faces drawn like the engravings of Classic's Renaissance chart (the vessel and
// the compass rose on the map): ink outlines, paper and gold fills, fine hatching.
const rosePoints = Array.from({ length: 8 }, (_, i) => i * 45);

export function ClassicCardArt({ symbol }: { readonly symbol: Symbol }) {
  return (
    <svg
      className="classic-card-art"
      viewBox="-50 -50 100 100"
      aria-hidden="true"
    >
      {symbol === 'galleon' && (
        <>
          <path
            className="art-paper"
            d="M-8-40q12-4 24 0q4 14-2 28q-10-4-20 0q-4-14-2-28ZM14-24q10-2 18 2q2 10-2 20q-8-4-14 0ZM-20-32-34 4l14 2Z"
          />
          <path
            className="art-line"
            d="M-20 14v-50M4 16v-62M24 12v-38M40 6l10-10M4-46q10-4 14 1q-8 3-14 0"
          />
          <path
            className="art-gold"
            d="M-42 10q37 10 82-4l-10 20q-36 6-64-2ZM-42 10l-4-12h16v14"
          />
          <path
            className="art-solid"
            d="M-28 14h4v4h-4zm12 2h4v4h-4zm12 1h4v4h-4zm12-1h4v4h-4zm12-2h4v4h-4z"
          />
          <path
            className="art-hatch"
            d="M-2-34q4 10 0 18M8-36q3 10 0 20M20-18q2 6 0 12M-26-20l-2 12"
          />
          <path
            className="art-line"
            d="M-48 34q8-5 16 0t16 0t16 0t16 0t16 0M-36 42q8-4 16 0t16 0t16 0t16 0"
          />
        </>
      )}
      {symbol === 'balloon' && (
        <>
          <path
            className="art-paper"
            d="M0-46c-26 0-32 28-18 48l10 14h16l10-14c14-20 8-48-18-48Z"
          />
          <path
            className="art-gold"
            d="M-27-20q27 6 54 0l-2 8q-25 6-50 0ZM-9 28h18l-2 12H-7Z"
          />
          <path
            className="art-line"
            d="M0-46c-12 16-12 40-8 62M0-46c12 16 12 40 8 62M0-46v62M-8 16l1 12M8 16l-1 12M0 16v12"
          />
          <path
            className="art-hatch"
            d="M14-36q6 10 4 22M19-30q3 8 1 16M12-4q2 6-2 12M-4 30v8M1 30v8M5 30v8"
          />
          <path
            className="art-line"
            d="M-44 24q4-6 10-2q4-6 10 0M28 34q4-6 10-2q4-6 10 0"
          />
        </>
      )}
      {symbol === 'cannon' && (
        <>
          <path className="art-paper" d="M-38 8h40l-12 18h-34Z" />
          <g transform="rotate(-14)">
            <path
              className="art-gold"
              d="M-36-7h62l6-3v20l-6-3h-62q-8 0-8-7t8-7Z"
            />
            <path
              className="art-line"
              d="M-24-7v14M-6-7v14M14-7v14M32-10h4v20h-4M-44 0h-4"
            />
            <path className="art-hatch" d="M-34 3h56M-34 5h56" />
          </g>
          <circle className="art-paper" cx="-10" cy="24" r="14" />
          <path
            className="art-line"
            d="M-10 10v28M-24 24H4M-20 14l20 20M0 14l-20 20M-48 40h96"
          />
          <circle className="art-solid" cx="-10" cy="24" r="3" />
          <path
            className="art-solid"
            d="M26 34a5 5 0 1 0 10 0a5 5 0 1 0-10 0M37 34a5 5 0 1 0 10 0a5 5 0 1 0-10 0M31.5 25.5a5 5 0 1 0 10 0a5 5 0 1 0-10 0"
          />
        </>
      )}
      {symbol === 'wildcard' && (
        // The compass rose of the chart: every symbol at once.
        <>
          <circle className="art-line" r="44" />
          <circle className="art-line" r="38" strokeDasharray="2 5" />
          {rosePoints.map((angle) => (
            <path
              key={angle}
              className={angle % 90 === 0 ? 'art-gold' : 'art-paper'}
              d={
                angle % 90 === 0 ? 'M0-40L7-7L0 0L-7-7Z' : 'M0-28L6-6L0 0L-6-6Z'
              }
              transform={`rotate(${angle})`}
            />
          ))}
          <circle className="art-paper" r="7" />
          <circle className="art-solid" r="2.5" />
        </>
      )}
    </svg>
  );
}
