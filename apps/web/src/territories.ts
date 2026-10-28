import { CLASSIC_GAME_DEFINITION, resolveGameBoard } from '@game/game-engine';
const CLASSIC_TERRITORIES = resolveGameBoard(
  CLASSIC_GAME_DEFINITION,
).territories;
import { APPROVED_SHARED_BOUNDARIES } from './approved-map-geometry.js';
import { BOARD_MAP_GEOMETRY } from './board-map-geometry.js';
import { classicCountryName } from './place-names.js';

interface TerritoryPresentation {
  readonly id: string;
  readonly label: string;
  readonly continent: string;
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly scale?: number;
}

/** Approved image geometry; canonical IDs, names, continents and graph stay in the engine. */
export const TERRITORIES: readonly TerritoryPresentation[] = Object.values(
  CLASSIC_TERRITORIES,
).map(({ id, displayName, continentId }) => ({
  id,
  label: classicCountryName(id, displayName),
  continent: continentId,
  ...BOARD_MAP_GEOMETRY[id]!,
}));
export const TERRITORY_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(TERRITORIES.map(({ id, label }) => [id, label]));
type VisualAdjacencyKind = 'shared-border' | 'special-link';
interface MapConnection {
  readonly from: string;
  readonly to: string;
  readonly kind: VisualAdjacencyKind;
}
const edgeKey = (a: string, b: string) => [a, b].sort().join(':');
const MAP_CONNECTIONS: readonly MapConnection[] = Object.values(
  CLASSIC_TERRITORIES,
).flatMap((territory) =>
  territory.adjacentTerritoryIds
    .filter((id) => territory.id < id)
    .map((id) => ({
      from: territory.id,
      to: id,
      kind: APPROVED_SHARED_BOUNDARIES[edgeKey(territory.id, id)]
        ? ('shared-border' as const)
        : ('special-link' as const),
    })),
);

export function resolveBoardPresentation(definition: unknown) {
  resolveGameBoard(definition);
  return { territories: TERRITORIES, connections: MAP_CONNECTIONS };
}
