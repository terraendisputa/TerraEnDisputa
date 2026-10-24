/** First-hostility actions. Alliances, pacts, rewards and victory remain later gates. */
import {
  integer,
  text,
  unique,
  type ReconquistaTerritory,
} from './contracts.js';
import type { PreparationBoard, PreparationRandom } from './preparation.js';
import { permitsDiceAttack, resolveReconquistaCombat } from './round.js';
export interface FirstHostility {
  readonly actorId: string;
  readonly phase: 'attack' | 'regroup';
  readonly territories: readonly ReconquistaTerritory[];
  readonly fixedMissiles: Readonly<Record<string, number>>;
  readonly lastMissile: {
    readonly originId: string;
    readonly targetId: string;
    readonly distance: number;
    readonly damage: number;
  } | null;
  readonly fixedArmies: Readonly<Record<string, number>>;
  readonly pendingConquest: {
    readonly originId: string;
    readonly targetId: string;
    readonly minimum: 1;
    readonly maximum: number;
  } | null;
  readonly lastCombat:
    | ({ readonly originId: string; readonly targetId: string } & ReturnType<
        typeof resolveReconquistaCombat
      >)
    | null;
}
export type HostilityAction =
  | {
      readonly kind: 'fire-missile';
      readonly originId: string;
      readonly targetId: string;
    }
  | {
      readonly kind: 'regroup-missiles';
      readonly originId: string;
      readonly targetId: string;
      readonly missiles: number;
    }
  | {
      readonly kind: 'attack';
      readonly originId: string;
      readonly targetId: string;
    }
  | { readonly kind: 'transfer'; readonly armies: number }
  /** Ends the attacks so the turn moves on to regrouping. */
  | { readonly kind: 'finish-attacks' }
  | {
      readonly kind: 'regroup';
      readonly originId: string;
      readonly targetId: string;
      readonly armies: number;
    };
export function createFirstHostility(
  territories: readonly ReconquistaTerritory[],
  actorId: string,
): FirstHostility {
  return {
    actorId,
    phase: 'attack',
    territories: structuredClone(territories),
    fixedArmies: {},
    fixedMissiles: {},
    lastMissile: null,
    pendingConquest: null,
    lastCombat: null,
  };
}
export function assertFirstHostility(
  board: PreparationBoard,
  state: FirstHostility,
  playerIds: readonly string[],
): void {
  text(state.actorId);
  if (
    !playerIds.includes(state.actorId) ||
    !['attack', 'regroup'].includes(state.phase)
  )
    throw Error('Invalid first hostility actor or phase');
  const known = new Set(board.countries.map((c) => c.id));
  if (state.territories.length !== 72 || known.size !== 72)
    throw Error('Incomplete hostility board');
  unique(state.territories.map((t) => t.id));
  for (const t of state.territories) {
    if (
      !known.has(t.id) ||
      t.ownership.kind !== 'exclusive' ||
      !playerIds.includes(t.ownership.playerId) ||
      t.forces.length !== 1 ||
      t.forces[0]!.playerId !== t.ownership.playerId
    )
      throw Error('Invalid first hostility occupation');
    integer(
      t.forces[0]!.armies,
      state.pendingConquest?.targetId === t.id ? 0 : 1,
    );
    integer(t.forces[0]!.missiles);
    if (
      state.pendingConquest?.targetId === t.id &&
      (t.forces[0]!.armies !== 0 || t.ownership.playerId !== state.actorId)
    )
      throw Error('Invalid pending occupation');
  }
  for (const [id, count] of Object.entries(state.fixedArmies)) {
    const t = state.territories.find((t) => t.id === id);
    integer(count);
    if (
      !t ||
      t.forces[0]!.playerId !== state.actorId ||
      count > t.forces[0]!.armies
    )
      throw Error('Invalid moved armies');
  }
  for (const [id, count] of Object.entries(state.fixedMissiles)) {
    const t = state.territories.find((t) => t.id === id);
    integer(count);
    if (
      !t ||
      t.forces[0]!.playerId !== state.actorId ||
      count > t.forces[0]!.missiles
    )
      throw Error('Invalid moved missiles');
  }
  const shot = state.lastMissile;
  if (
    shot &&
    (!known.has(shot.originId) ||
      !known.has(shot.targetId) ||
      integer(shot.distance, 1) > 3 ||
      shot.damage !== 4 - shot.distance ||
      missileDistances(board, shot.originId).get(shot.targetId) !==
        shot.distance ||
      state.lastCombat !== null ||
      state.pendingConquest !== null)
  )
    throw Error('Invalid missile result');
  const pending = state.pendingConquest;
  if (pending) {
    const origin = state.territories.find((t) => t.id === pending.originId);
    if (
      state.phase !== 'attack' ||
      !origin ||
      origin.forces[0]!.playerId !== state.actorId ||
      pending.minimum !== 1 ||
      pending.maximum !== Math.min(3, origin.forces[0]!.armies - 1) ||
      pending.maximum < 1 ||
      !board.connections.some(
        (e) =>
          e.endpoints.includes(pending.originId) &&
          e.endpoints.includes(pending.targetId),
      )
    )
      throw Error('Invalid mandatory transfer');
  }
}
/** Graph distance ignores ownership: a missile may overfly countries. Pact gates are not enabled here. */
export function missileDistances(
  board: PreparationBoard,
  originId: string,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>([[originId, 0]]);
  const queue = [originId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const distance = distances.get(id)!;
    if (distance === 3) continue;
    for (const edge of board.connections) {
      if (!edge.endpoints.includes(id)) continue;
      const target = edge.endpoints.find((v) => v !== id)!;
      if (!distances.has(target)) {
        distances.set(target, distance + 1);
        queue.push(target);
      }
    }
  }
  return distances;
}
export function firstHostilityActions(
  board: PreparationBoard,
  state: FirstHostility,
  actorId: string,
  situationType: string,
  restingPlayerId: string | null,
) {
  const unavailable = {
    missileShots: [] as {
      originId: string;
      targetId: string;
      distance: number;
      damage: number;
    }[],
    missileRegroups: [] as {
      originId: string;
      targetId: string;
      maximum: number;
    }[],
    attacks: [] as { originId: string; targetId: string }[],
    regroups: [] as { originId: string; targetId: string; maximum: number }[],
    transfer: null as FirstHostility['pendingConquest'],
  };
  if (actorId !== state.actorId || restingPlayerId === actorId)
    return unavailable;
  if (state.pendingConquest)
    return { ...unavailable, transfer: { ...state.pendingConquest } };
  const own = state.territories.filter(
    (t) => t.forces[0]!.playerId === actorId,
  );
  const attacks =
    state.phase === 'attack'
      ? own.flatMap((origin) => {
          if (origin.forces[0]!.armies < 2) return [];
          return board.connections
            .filter((e) => e.endpoints.includes(origin.id))
            .flatMap((e) => {
              const targetId = e.endpoints.find((id) => id !== origin.id)!;
              const target = state.territories.find((t) => t.id === targetId)!;
              const from = board.countries.find((c) => c.id === origin.id)!;
              const to = board.countries.find((c) => c.id === targetId)!;
              return target.forces[0]!.playerId !== actorId &&
                permitsDiceAttack(
                  situationType,
                  from.continentId,
                  to.continentId,
                )
                ? [{ originId: origin.id, targetId }]
                : [];
            });
        })
      : [];
  const regroups = own.flatMap((origin) => {
    const maximum = Math.min(
      origin.forces[0]!.armies - 1,
      origin.forces[0]!.armies - (state.fixedArmies[origin.id] ?? 0),
    );
    if (maximum < 1) return [];
    return board.connections
      .filter((e) => e.endpoints.includes(origin.id))
      .flatMap((e) => {
        const targetId = e.endpoints.find((id) => id !== origin.id)!;
        return own.some((t) => t.id === targetId)
          ? [{ originId: origin.id, targetId, maximum }]
          : [];
      });
  });
  const missileShots =
    state.phase === 'attack'
      ? own.flatMap((origin) => {
          if (origin.forces[0]!.missiles === 0) return [];
          const distances = missileDistances(board, origin.id);
          return state.territories.flatMap((target) => {
            const distance = distances.get(target.id);
            if (
              !distance ||
              distance > 3 ||
              target.forces[0]!.playerId === actorId
            )
              return [];
            const damage = 4 - distance;
            const from = board.countries.find((c) => c.id === origin.id)!;
            const to = board.countries.find((c) => c.id === target.id)!;
            return target.forces[0]!.armies > damage &&
              origin.forces[0]!.missiles > target.forces[0]!.missiles &&
              permitsDiceAttack(situationType, from.continentId, to.continentId)
              ? [{ originId: origin.id, targetId: target.id, distance, damage }]
              : [];
          });
        })
      : [];
  const missileRegroups = own.flatMap((origin) => {
    const maximum =
      origin.forces[0]!.missiles - (state.fixedMissiles[origin.id] ?? 0);
    if (maximum < 1) return [];
    return board.connections
      .filter((e) => e.endpoints.includes(origin.id))
      .flatMap((e) => {
        const targetId = e.endpoints.find((id) => id !== origin.id)!;
        return own.some((t) => t.id === targetId)
          ? [{ originId: origin.id, targetId, maximum }]
          : [];
      });
  });
  return { attacks, regroups, missileShots, missileRegroups, transfer: null };
}
export function applyFirstHostility(
  board: PreparationBoard,
  state: FirstHostility,
  actorId: string,
  action: HostilityAction,
  situationType: string,
  restingPlayerId: string | null,
  players: readonly string[],
  random: PreparationRandom,
): FirstHostility {
  assertFirstHostility(board, state, players);
  const legal = firstHostilityActions(
    board,
    state,
    actorId,
    situationType,
    restingPlayerId,
  );
  let next: FirstHostility;
  if (action.kind === 'finish-attacks') {
    if (
      actorId !== state.actorId ||
      state.phase !== 'attack' ||
      state.pendingConquest !== null
    )
      throw Error('Attacks cannot be finished now');
    next = { ...state, phase: 'regroup' };
  } else if (action.kind === 'fire-missile') {
    const shot = legal.missileShots.find(
      (r) => r.originId === action.originId && r.targetId === action.targetId,
    );
    if (!shot) throw Error('Illegal missile shot');
    next = {
      ...state,
      lastCombat: null,
      lastMissile: { ...shot },
      territories: state.territories.map((t) =>
        t.id === action.originId
          ? {
              ...t,
              forces: [
                { ...t.forces[0]!, missiles: t.forces[0]!.missiles - 1 },
              ],
            }
          : t.id === action.targetId
            ? {
                ...t,
                forces: [
                  {
                    ...t.forces[0]!,
                    armies: t.forces[0]!.armies - shot.damage,
                  },
                ],
              }
            : t,
      ),
    };
  } else if (action.kind === 'regroup-missiles') {
    const route = legal.missileRegroups.find(
      (r) => r.originId === action.originId && r.targetId === action.targetId,
    );
    if (!route || integer(action.missiles, 1) > route.maximum)
      throw Error('Illegal missile regroup');
    next = {
      ...state,
      phase: 'regroup',
      fixedMissiles: {
        ...state.fixedMissiles,
        [action.targetId]:
          (state.fixedMissiles[action.targetId] ?? 0) + action.missiles,
      },
      territories: state.territories.map((t) =>
        t.id === action.originId
          ? {
              ...t,
              forces: [
                {
                  ...t.forces[0]!,
                  missiles: t.forces[0]!.missiles - action.missiles,
                },
              ],
            }
          : t.id === action.targetId
            ? {
                ...t,
                forces: [
                  {
                    ...t.forces[0]!,
                    missiles: integer(t.forces[0]!.missiles + action.missiles),
                  },
                ],
              }
            : t,
      ),
    };
  } else if (action.kind === 'attack') {
    if (
      !legal.attacks.some(
        (a) => a.originId === action.originId && a.targetId === action.targetId,
      )
    )
      throw Error('Illegal ordinary attack');
    const origin = state.territories.find((t) => t.id === action.originId)!;
    const target = state.territories.find((t) => t.id === action.targetId)!;
    const result = resolveReconquistaCombat(
      origin.forces[0]!.armies,
      target.forces[0]!.armies,
      situationType,
      random,
    );
    const conquered = target.forces[0]!.armies === result.defenseLoss;
    next = {
      ...state,
      lastMissile: null,
      lastCombat: { originId: origin.id, targetId: target.id, ...result },
      pendingConquest: conquered
        ? {
            originId: origin.id,
            targetId: target.id,
            minimum: 1,
            maximum: Math.min(
              3,
              origin.forces[0]!.armies - result.attackLoss - 1,
            ),
          }
        : null,
      territories: state.territories.map((t) =>
        t.id === origin.id
          ? {
              ...t,
              forces: [
                {
                  ...t.forces[0]!,
                  armies: t.forces[0]!.armies - result.attackLoss,
                },
              ],
            }
          : t.id === target.id
            ? {
                ...t,
                ownership: conquered
                  ? { kind: 'exclusive', playerId: actorId }
                  : t.ownership,
                forces: [
                  {
                    ...t.forces[0]!,
                    playerId: conquered ? actorId : t.forces[0]!.playerId,
                    armies: t.forces[0]!.armies - result.defenseLoss,
                  },
                ],
              }
            : t,
      ),
    };
  } else if (action.kind === 'transfer') {
    const pending = legal.transfer;
    if (!pending || integer(action.armies, 1) > pending.maximum)
      throw Error('Illegal conquest transfer');
    next = {
      ...state,
      pendingConquest: null,
      territories: state.territories.map((t) =>
        t.id === pending.originId
          ? {
              ...t,
              forces: [
                {
                  ...t.forces[0]!,
                  armies: t.forces[0]!.armies - action.armies,
                },
              ],
            }
          : t.id === pending.targetId
            ? { ...t, forces: [{ ...t.forces[0]!, armies: action.armies }] }
            : t,
      ),
    };
  } else {
    const route = legal.regroups.find(
      (r) => r.originId === action.originId && r.targetId === action.targetId,
    );
    if (!route || integer(action.armies, 1) > route.maximum)
      throw Error('Illegal ordinary regroup');
    next = {
      ...state,
      phase: 'regroup',
      fixedArmies: {
        ...state.fixedArmies,
        [action.targetId]:
          (state.fixedArmies[action.targetId] ?? 0) + action.armies,
      },
      territories: state.territories.map((t) =>
        t.id === action.originId
          ? {
              ...t,
              forces: [
                {
                  ...t.forces[0]!,
                  armies: t.forces[0]!.armies - action.armies,
                },
              ],
            }
          : t.id === action.targetId
            ? {
                ...t,
                forces: [
                  {
                    ...t.forces[0]!,
                    armies: t.forces[0]!.armies + action.armies,
                  },
                ],
              }
            : t,
      ),
    };
  }
  assertFirstHostility(board, next, players);
  return next;
}
