/** Initial secret dealing only; no victory evaluation, runtime exports or public projection. */
import {
  RECONQUISTA_COLORS,
  text,
  unique,
  validateReconquistaCatalog,
} from './contracts.js';
import { preparationNeighbors, type PreparationRandom } from './preparation.js';
export interface ObjectivePlayer {
  readonly id: string;
  readonly color: string;
}
export interface InitialSecret {
  readonly objectiveId: string;
  readonly targetPlayerId?: string;
}
export function dealInitialObjectives(
  catalog: unknown,
  players: readonly ObjectivePlayer[],
  circle: readonly string[],
  random: PreparationRandom,
) {
  validateReconquistaCatalog(catalog);
  if (players.length < 2 || players.length > 6)
    throw new Error('Expected 2–6 players');
  players.forEach((p) => {
    text(p.id);
    if (!RECONQUISTA_COLORS.some((c) => c === p.color))
      throw new Error('Invalid color');
  });
  unique(players.map((p) => p.id));
  unique(players.map((p) => p.color));
  unique(circle);
  if (
    circle.length !== players.length ||
    circle.some((id) => !players.some((p) => p.id === id))
  )
    throw new Error('Invalid circle');
  const objectives = (
    catalog as {
      objectives: {
        id: string;
        kind: string;
        target?: string;
        minTerritories?: number;
      }[];
    }
  ).objectives;
  // D80: destroying a colour nobody plays leaves the deck, so it never turns into
  // one more "destroy the player on your right".
  const colors = new Set(players.map((p) => p.color));
  const eligible = objectives.filter(
    (o) =>
      (players.length > 3 ||
        (o.kind !== 'destruction' && o.minTerritories !== 35)) &&
      (o.kind !== 'destruction' ||
        o.target === 'left_neighbor' ||
        colors.has(o.target ?? '')),
  );
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error('Invalid objective RNG');
    const j = Math.floor(value * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const count = players.length === 2 ? 2 : 1;
  let cursor = 0;
  const secrets = players.map((player) => ({
    playerId: player.id,
    objectives: Array.from({ length: count }, (): InitialSecret => {
      const card = shuffled[cursor++]!;
      if (card.kind !== 'destruction') return { objectiveId: card.id };
      const neighbors = preparationNeighbors(circle, player.id);
      const target =
        card.target === 'left_neighbor'
          ? neighbors.left
          : players.find((p) => p.color === card.target)?.id;
      return {
        objectiveId: card.id,
        targetPlayerId:
          !target || target === player.id ? neighbors.right : target,
      };
    }),
  }));
  return {
    kind: 'reconquista-objectives' as const,
    secrets,
    removedObjectiveIds: shuffled.slice(cursor).map((o) => o.id),
    excludedObjectiveIds: objectives
      .filter((o) => !eligible.includes(o))
      .map((o) => o.id),
  };
}
/** Explicit owner-only view; never return the complete deal to a participant. */
export function privateInitialObjectives(
  deal: ReturnType<typeof dealInitialObjectives>,
  playerId: string,
): readonly InitialSecret[] {
  const entry = deal.secrets.find((p) => p.playerId === playerId);
  if (!entry) throw new Error('Unknown objective owner');
  return entry.objectives.map((o) => ({ ...o }));
}
