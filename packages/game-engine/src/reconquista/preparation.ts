/** Development-only Reconquista preparation. Never registered as a playable runtime. */
import {
  integer,
  list,
  object,
  text,
  unique,
  validateReconquistaCatalog,
  type ReconquistaTerritory,
} from './contracts.js';

export interface PreparationCountry {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly island: boolean;
}
export interface PreparationBoard {
  readonly countries: readonly PreparationCountry[];
  readonly connections: readonly {
    readonly endpoints: readonly [string, string];
    readonly kind: 'border' | 'bridge';
  }[];
}
export function preparationBoard(catalog: unknown): PreparationBoard {
  validateReconquistaCatalog(catalog);
  const c = catalog as Record<string, unknown>;
  return {
    countries: list(c.territories).map((value) => {
      const t = value as Record<string, unknown>;
      return {
        id: text(t.id),
        name: text(t.name),
        continentId: text(t.continentId),
        island: t.island === true,
      };
    }),
    connections: list(c.connections).map((value) => {
      const edge = value as Record<string, unknown>;
      const ends = list(edge.endpoints).map(text);
      return {
        endpoints: [ends[0]!, ends[1]!] as const,
        kind: edge.kind as 'border' | 'bridge',
      };
    }),
  };
}

/** RNG draws in [0,1), injected by the caller; no client authority or deck policy. */
export type PreparationRandom = () => number;
function draw(random: PreparationRandom): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error('Invalid preparation RNG draw');
  return value;
}
export interface RankingRound {
  readonly playerIds: readonly string[];
  readonly values: readonly number[];
}
export function rankPreparationPlayers(
  players: readonly string[],
  random: PreparationRandom,
): {
  readonly order: readonly string[];
  readonly rounds: readonly RankingRound[];
} {
  players.forEach(text);
  unique(players);
  if (players.length < 2 || players.length > 6)
    throw new Error('Expected 2–6 players');
  const rounds: RankingRound[] = [];
  function rank(group: readonly string[]): string[] {
    if (group.length === 1) return [...group];
    // A broken deterministic RNG must fail rather than choose a seat-based winner.
    if (rounds.length >= 1000)
      throw new Error('Preparation RNG did not resolve ties');
    const values = group.map(() => draw(random));
    rounds.push({ playerIds: [...group], values });
    const scores = [...new Set(values)].toSorted((a, b) => b - a);
    return scores.flatMap((score) =>
      rank(group.filter((_, i) => values[i] === score)),
    );
  }
  return { order: rank(players), rounds };
}
function shuffle<T>(values: readonly T[], random: PreparationRandom): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(draw(random) * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export interface PreparationState {
  readonly kind: 'reconquista-preparation';
  readonly scope: 'development';
  readonly players: readonly string[];
  readonly circle: readonly string[];
  readonly ranking: readonly RankingRound[];
  readonly remainderRecipients: readonly string[];
  readonly distributionAttempts: number;
  readonly territories: readonly ReconquistaTerritory[];
  readonly stage: 'placement' | 'awaiting-rules';
  readonly passIndex: number;
  readonly playerIndex: number;
}
export function initialBudgets(playerCount: number): readonly number[] {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6)
    throw new Error('Expected 2–6 players');
  return playerCount === 2 ? [18] : [8, 4];
}

/** D10/D19: one ranking is reused for the two leftovers and the fixed circle. */
export function createPreparation(
  board: PreparationBoard,
  players: readonly string[],
  random: PreparationRandom,
): PreparationState {
  const ranked = rankPreparationPlayers(players, random);
  const ids = board.countries.map((c) => c.id);
  unique(ids);
  if (ids.length !== 72)
    throw new Error('Preparation requires all 72 countries');
  const each = Math.floor(ids.length / players.length);
  const baseCount = each * players.length;
  const remainderRecipients = ranked.order.slice(0, ids.length - baseCount);
  let territories: ReconquistaTerritory[] = [];
  let distributionAttempts = 0;
  const continents = [...new Set(board.countries.map((c) => c.continentId))];
  // D30: rejection sampling of the entire country deal, never of the initiative ranking.
  while (distributionAttempts < 1000) {
    distributionAttempts++;
    const countries = shuffle(ids, random);
    territories = countries.map((id, i) => {
      const playerId =
        i < baseCount
          ? players[i % players.length]!
          : remainderRecipients[i - baseCount]!;
      return {
        id,
        ownership: { kind: 'exclusive' as const, playerId },
        forces: [{ playerId, armies: 1, missiles: 0 }],
      };
    });
    const owners = new Map(
      territories.map((t) => [t.id, t.forces[0]!.playerId]),
    );
    const full = continents.some((continent) => {
      const countriesInContinent = board.countries.filter(
        (c) => c.continentId === continent,
      );
      return (
        new Set(countriesInContinent.map((c) => owners.get(c.id))).size === 1
      );
    });
    if (!full) break;
    if (distributionAttempts === 1000)
      throw new Error(
        'Preparation RNG did not produce a deal without complete continents',
      );
  }
  const state: PreparationState = {
    kind: 'reconquista-preparation',
    scope: 'development',
    players: [...players],
    circle: ranked.order,
    ranking: ranked.rounds,
    remainderRecipients,
    distributionAttempts,
    territories,
    stage: 'placement',
    passIndex: 0,
    playerIndex: 0,
  };
  assertPreparation(board, state);
  return state;
}

function validateTerritories(
  board: PreparationBoard,
  territories: readonly ReconquistaTerritory[],
): void {
  const known = new Set(board.countries.map((c) => c.id));
  if (known.size !== 72 || territories.length !== known.size)
    throw new Error('Incomplete board occupation');
  unique(territories.map((t) => t.id));
  for (const t of territories) {
    if (!known.has(t.id)) throw new Error('Unknown territory');
    const occupants =
      t.ownership.kind === 'exclusive'
        ? [t.ownership.playerId]
        : t.ownership.playerIds;
    if (
      !['exclusive', 'shared'].includes(t.ownership.kind) ||
      occupants.length !== (t.ownership.kind === 'exclusive' ? 1 : 2)
    )
      throw new Error('Invalid occupation');
    occupants.forEach(text);
    unique(occupants);
    unique(t.forces.map((f) => f.playerId));
    if (t.forces.length !== occupants.length)
      throw new Error('Occupation/forces mismatch');
    for (const force of t.forces) {
      if (!occupants.includes(force.playerId))
        throw new Error('Unknown occupant force');
      integer(force.armies, 1);
      integer(force.missiles);
    }
  }
}
export function assertPreparation(
  board: PreparationBoard,
  state: PreparationState,
): void {
  if (state.kind !== 'reconquista-preparation' || state.scope !== 'development')
    throw new Error('Not a development preparation');
  initialBudgets(state.players.length);
  state.players.forEach(text);
  unique(state.players);
  unique(state.circle);
  if (
    state.circle.length !== state.players.length ||
    state.circle.some((id) => !state.players.includes(id))
  )
    throw new Error('Invalid circle');
  validateTerritories(board, state.territories);
  for (const t of state.territories) {
    if (
      t.ownership.kind !== 'exclusive' ||
      !state.players.includes(t.ownership.playerId)
    )
      throw new Error('Preparation requires exclusive occupation');
  }
  if (integer(state.distributionAttempts, 1) > 1000)
    throw new Error('Invalid distribution attempts');
  integer(state.passIndex);
  integer(state.playerIndex);
  const passes = initialBudgets(state.players.length);
  if (state.stage === 'placement') {
    if (
      state.passIndex >= passes.length ||
      state.playerIndex >= state.circle.length
    )
      throw new Error('Invalid placement cursor');
  } else if (
    state.stage !== 'awaiting-rules' ||
    state.passIndex !== passes.length ||
    state.playerIndex !== 0
  )
    throw new Error('Invalid preparation boundary');
}

/** Complete one player's pass atomically. D17: no initial blockade check. */
export function placeInitialArmies(
  board: PreparationBoard,
  state: PreparationState,
  actorId: string,
  placements: Readonly<Record<string, number>>,
  missileConversions: Readonly<Record<string, number>> = {},
): PreparationState {
  assertPreparation(board, state);
  if (state.stage !== 'placement')
    throw new Error('Preparation awaits unresolved rules');
  if (state.circle[state.playerIndex] !== actorId)
    throw new Error('Not this player’s placement');
  const territories = placeReconquistaForces(
    board,
    state.territories,
    actorId,
    initialBudgets(state.players.length)[state.passIndex]!,
    placements,
    missileConversions,
  );
  const nextPlayer = (state.playerIndex + 1) % state.circle.length;
  const nextPass = state.passIndex + (nextPlayer === 0 ? 1 : 0);
  const next: PreparationState = {
    ...state,
    playerIndex: nextPlayer,
    passIndex: nextPass,
    stage:
      nextPass === initialBudgets(state.players.length).length
        ? 'awaiting-rules'
        : 'placement',
    territories,
  };
  assertPreparation(board, next);
  return next;
}

/** Exact-budget conversion shared by initial and extra development placement. Caller enforces turn/blockade. */
export function placeReconquistaForces(
  board: PreparationBoard,
  territories: readonly ReconquistaTerritory[],
  actorId: string,
  budget: number,
  placements: Readonly<Record<string, number>>,
  missileConversions: Readonly<Record<string, number>> = {},
): readonly ReconquistaTerritory[] {
  validateTerritories(board, territories);
  integer(budget);
  const entries = Object.entries(
    object(
      placements,
      board.countries.map((c) => c.id),
    ),
  );
  let total = 0;
  for (const [id, count] of entries) {
    integer(count, 1);
    const t = territories.find((t) => t.id === id);
    if (t?.ownership.kind !== 'exclusive' || t.ownership.playerId !== actorId)
      throw new Error('Place only in your own country');
    total += integer(count, 1);
  }
  if (total !== budget) throw new Error(`Expected exactly ${budget} armies`);
  // S01 R08/D23: conversion may spend existing plus newly placed armies.
  const conversions = Object.entries(
    object(
      missileConversions,
      board.countries.map((c) => c.id),
    ),
  );
  for (const [id, count] of conversions) {
    integer(count, 1);
    const territory = territories.find((t) => t.id === id);
    if (
      territory?.ownership.kind !== 'exclusive' ||
      territory.ownership.playerId !== actorId
    )
      throw new Error('Convert only your own forces');
    const force = territory.forces[0]!;
    const added = Object.hasOwn(placements, id) ? placements[id]! : 0;
    const cost = integer(count, 1) * 6;
    if (!Number.isSafeInteger(cost) || force.armies + added - cost < 1)
      throw new Error('Missile conversion must preserve one occupying army');
  }
  const result = territories.map((t) => {
    const count = Object.hasOwn(placements, t.id) ? placements[t.id]! : 0;
    const missiles = Object.hasOwn(missileConversions, t.id)
      ? missileConversions[t.id]!
      : 0;
    return count === 0 && missiles === 0
      ? t
      : {
          ...t,
          forces: t.forces.map((f) => ({
            ...f,
            armies: f.armies + count - missiles * 6,
            missiles: f.missiles + missiles,
          })),
        };
  });
  validateTerritories(board, result);
  return result;
}

export function preparationNeighbors(
  circle: readonly string[],
  playerId: string,
) {
  unique(circle);
  const i = circle.indexOf(playerId);
  if (circle.length < 2 || i < 0) throw new Error('Unknown player in circle');
  return {
    right: circle[(i + 1) % circle.length]!,
    left: circle[(i + circle.length - 1) % circle.length]!,
  };
}

const BONUSES: Readonly<Record<string, number>> = {
  asia: 8,
  europe: 8,
  north_america: 6,
  south_america: 4,
  africa: 4,
  central_america: 3,
  oceania: 3,
};
/** D13/D15: presence grants counts/bonus; exclusive control grants card eligibility only. */
export function occupationSummary(
  board: PreparationBoard,
  territories: readonly ReconquistaTerritory[],
  playerId: string,
) {
  text(playerId);
  validateTerritories(board, territories);
  const occupied = new Set(
    territories
      .filter((t) => t.forces.some((f) => f.playerId === playerId))
      .map((t) => t.id),
  );
  const exclusive = new Set(
    territories
      .filter(
        (t) =>
          t.ownership.kind === 'exclusive' && t.ownership.playerId === playerId,
      )
      .map((t) => t.id),
  );
  const continentIds = [...new Set(board.countries.map((c) => c.continentId))];
  if (continentIds.some((id) => BONUSES[id] === undefined))
    throw new Error('Unknown continent');
  const presenceContinents = continentIds.filter((id) =>
    board.countries
      .filter((c) => c.continentId === id)
      .every((c) => occupied.has(c.id)),
  );
  return {
    countryIds: board.countries
      .filter((c) => occupied.has(c.id))
      .map((c) => c.id),
    islandIds: board.countries
      .filter((c) => c.island && occupied.has(c.id))
      .map((c) => c.id),
    countryReinforcements:
      occupied.size === 0
        ? 0
        : occupied.size < 6
          ? 4
          : Math.floor(occupied.size / 2),
    continentBonuses: presenceContinents.map((id) => ({
      continentId: id,
      armies: BONUSES[id]!,
    })),
    exclusiveContinentIds: continentIds.filter((id) =>
      board.countries
        .filter((c) => c.continentId === id)
        .every((c) => exclusive.has(c.id)),
    ),
    // D18: candidate only; victory timing and secret objectives are deliberately not evaluated.
    meetsCommonOccupationThreshold: occupied.size >= 45,
  };
}
