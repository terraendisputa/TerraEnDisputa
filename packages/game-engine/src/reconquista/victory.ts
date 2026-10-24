/** Objective witness evaluation, including islands and D60 extras without double-counting. */
import type { PreparationBoard } from './preparation.js';
import type { InitialSecret } from './objectives.js';
export interface VictoryObjective {
  id: string;
  kind: string;
  requirements?: Record<string, number | 'all'>;
  minTerritories?: number;
  islands?: { count: number; minContinents: number };
}
export function occupationWitness(
  board: PreparationBoard,
  occupiedIds: readonly string[],
  objective: VictoryObjective,
): string[] | null {
  const owned = new Set(occupiedIds);
  if (objective.minTerritories) {
    return occupiedIds.length >= objective.minTerritories
      ? [...occupiedIds].slice(0, objective.minTerritories)
      : null;
  }
  const req = objective.requirements ?? {};
  const requiredIslands = objective.islands?.count ?? 0,
    requiredContinents = objective.islands?.minContinents ?? 0;
  let dp = new Map<string, string[]>([['0:0', []]]);
  const continents = [...new Set(board.countries.map((c) => c.continentId))];
  for (const continent of continents) {
    const all = board.countries.filter((c) => c.continentId === continent);
    const own = all.filter((c) => owned.has(c.id));
    const quota = req[continent] === 'all' ? all.length : (req[continent] ?? 0);
    if (own.length < quota) return null;
    const islands = own.filter((c) => c.island),
      other = own.filter((c) => !c.island);
    const next = new Map<string, string[]>();
    for (const [key, witness] of dp) {
      const [have, spread] = key.split(':').map(Number) as [number, number];
      for (
        let k = 0;
        k <= Math.min(islands.length, Math.max(quota, requiredIslands));
        k++
      ) {
        const non = Math.max(0, quota - k);
        if (non > other.length) continue;
        const chosen = [...islands.slice(0, k), ...other.slice(0, non)].map(
          (c) => c.id,
        );
        const nkey = `${Math.min(requiredIslands, have + k)}:${Math.min(requiredContinents, spread + (k > 0 ? 1 : 0))}`;
        const total = [...witness, ...chosen];
        if (!next.has(nkey) || next.get(nkey)!.length > total.length)
          next.set(nkey, total);
      }
    }
    dp = next;
  }
  return dp.get(`${requiredIslands}:${requiredContinents}`) ?? null;
}
export function meetsVictory(
  board: PreparationBoard,
  catalog: unknown,
  occupied: readonly string[],
  secrets: readonly InitialSecret[],
  playerCount: number,
  playerId: string,
  eliminations: Readonly<Record<string, string>>,
): boolean {
  if (occupied.length >= 45) return true;
  const objectives = (catalog as { objectives: VictoryObjective[] }).objectives;
  return (
    secrets.length > 0 &&
    secrets.every((secret) => {
      const o = objectives.find((o) => o.id === secret.objectiveId);
      if (!o) throw Error('Unknown victory objective');
      if (o.kind === 'destruction') {
        const credit = eliminations[secret.targetPlayerId!];
        return (
          credit === playerId || (credit !== undefined && occupied.length >= 45)
        );
      }
      const witness = occupationWitness(board, occupied, o);
      return (
        witness !== null &&
        (playerCount !== 3 || occupied.length - witness.length >= 10)
      );
    })
  );
}
