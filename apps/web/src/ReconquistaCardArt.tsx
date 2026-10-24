import type { ReactNode } from 'react';
import { continentArt } from './reconquista-continent-art.js';
import type { CardSymbol } from './reconquista-labels.js';

/**
 * Illustrated card faces for Reconquista: solid
 * silhouettes with lighter details, drawn in the theme's metal color.
 */
type Art = CardSymbol;

const plane = (
  <>
    <path
      className="art-main"
      d="M24 3c1.8 0 2.8 2 2.8 5v9.5L44 25.5v4.2L26.8 26v7.4l5.2 4.4v3.4L24 39.4l-8 1.8v-3.4l5.2-4.4V26L4 29.7v-4.2l17.2-8V8c0-3 1-5 2.8-5Z"
    />
    <path
      className="art-light"
      d="M24 8.5c1 0 1.4 1.6 1.4 3.6S25 15 24 15s-1.4-.9-1.4-2.9.4-3.6 1.4-3.6Z"
    />
    <path className="art-light" d="M10.5 23.6h3v5h-3Zm24 0h3v5h-3Z" />
    <path className="art-line" d="M19.5 3.6h9M8 27.3l12-3m8 0 12 3" />
  </>
);

const ship = (
  <>
    <path className="art-line" d="M16 30V11m8 19V6m8 24V12" />
    <path className="art-main" d="M24.5 8c5.5 3 6.6 9.5 5.5 14h-5.5Z" />
    <path className="art-main" d="M16.5 12.5c4.2 2.2 5.3 7 4.4 10.5h-4.4Z" />
    <path className="art-main" d="M32.5 14c3.4 2 4.2 5.5 3.4 8.5h-3.4Z" />
    <path className="art-light" d="M24 6l5.5-1.6L24 2.8Z" />
    <path className="art-main" d="M5 28h38l-5.5 9.5h-27Z" />
    <path
      className="art-light"
      d="M9 31h30v1.6H9Zm4 3h3v1.5h-3Zm6 0h3v1.5h-3Zm6 0h3v1.5h-3Zm6 0h3v1.5h-3Z"
    />
    <path
      className="art-line"
      d="M3 42c3-2 5.5-2 8.5 0s5.5 2 8.5 0 5.5-2 8.5 0 5.5 2 8.5 0 5.5-2 8 0"
    />
  </>
);

const tank = (
  <>
    <path
      className="art-main"
      d="M35 7.5a4.5 4.5 0 1 1-1.5 8.7 4.5 4.5 0 0 1 1.5-8.7Z"
    />
    <path className="art-main" d="M33.4 4.8h3.4v2.4h-3.4Z" />
    <path className="art-line" d="M37 5.5c2.5-1.5 4.5-.5 5 1.5" />
    <path className="art-main" d="M14 19h12l3 6H11Z" />
    <path className="art-main" d="M27 21h15.5v2.6H27Z" />
    <path className="art-main" d="M7 25h28l5 6H3Z" />
    <path
      className="art-main"
      d="M7 31.5h30a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Z"
    />
    <path
      className="art-light"
      d="M8.5 33.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm7 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm7 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm7 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm7 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z"
    />
    <path className="art-light" d="M16.5 17h5v2h-5Z" />
  </>
);

const star = (
  <>
    <path
      className="art-main"
      d="m24 4 5.6 12.2 13.3 1.4-10 8.9 2.9 13.1L24 32.9l-11.8 6.7 2.9-13.1-10-8.9 13.3-1.4Z"
    />
    <path
      className="art-light"
      d="m24 13 2.6 5.7 6.2.6-4.7 4.2 1.4 6.1-5.5-3.2-5.5 3.2 1.4-6.1-4.7-4.2 6.2-.6Z"
    />
  </>
);

// A Soviet Second World War helmet.
const soldier = (
  <>
    <path
      className="art-main"
      d="M9 29C9 18.5 15.5 11 24 11s15 7.5 15 18v1H9Z"
    />
    <path
      className="art-main"
      d="M4 33.5c2.5-2 5-3 8-3.2h24c3 .2 5.5 1.2 8 3.2L42.5 36h-37Z"
    />
    <path className="art-light" d="M9 29.6h30v1.2H9Z" />
    <path
      className="art-light"
      d="M13.5 24c.6-4 2.8-7.2 6-9l.8 1c-2.8 1.8-4.6 4.6-5.2 8.2Z"
    />
    <path
      className="art-light"
      d="m24 16.5 1.3 2.8 3 .3-2.3 2 .7 3-2.7-1.6-2.7 1.6.7-3-2.3-2 3-.3Z"
    />
  </>
);

const crown = (
  <>
    <path className="art-main" d="M7 36 5 14l10 9 9-14 9 14 10-9-2 22Z" />
    <path className="art-main" d="M7 38h34v4H7Z" />
    <path
      className="art-light"
      d="M24 25a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-10 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm20 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
    />
  </>
);

const faces: Record<Art, ReactNode> = {
  plane,
  ship,
  tank_grenade: tank,
  wildcard: star,
  soldier_wildcard: soldier,
  supercard: crown,
};

export function CardArt({ art }: { readonly art: Art }) {
  return (
    <svg className="card-art" viewBox="0 0 48 48" aria-hidden="true">
      {faces[art]}
    </svg>
  );
}

/** A continent card shows its continent, as drawn on the map. */
export function ContinentArt({
  continentId,
}: {
  readonly continentId: string;
}) {
  return (
    <svg className="card-art" viewBox="0 0 48 48" aria-hidden="true">
      <path className="art-main art-silhouette" d={continentArt[continentId]} />
    </svg>
  );
}
