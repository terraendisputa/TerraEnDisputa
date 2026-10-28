import type { PreparationBoard } from './preparation.js';
import type { Campaign, CampaignTerritory, Pact } from './campaign-types.js';
export const turnActor = (s: Campaign) => s.order[s.turnIndex]!;
export const territory = (s: Campaign, id: string) => {
  const t = s.territories.find((t) => t.id === id);
  if (!t) throw Error('Unknown country');
  return t;
};
export const force = (t: CampaignTerritory, id: string) =>
  t.forces.find((f) => f.playerId === id);
/** Continents and borders looked up once per board: bots ask for them all the time. */
const lookups = new WeakMap<
  PreparationBoard,
  { continents: Map<string, string>; borders: Set<string> }
>();
function lookup(board: PreparationBoard) {
  let known = lookups.get(board);
  if (!known) {
    known = {
      continents: new Map(board.countries.map((c) => [c.id, c.continentId])),
      borders: new Set(
        board.connections.flatMap(({ endpoints: [x, y] }) => [
          `${x}|${y}`,
          `${y}|${x}`,
        ]),
      ),
    };
    lookups.set(board, known);
  }
  return known;
}
export const continent = (board: PreparationBoard, id: string) => {
  const c = lookup(board).continents.get(id);
  if (c === undefined) throw Error('Unknown country');
  return c;
};
export const adjacent = (board: PreparationBoard, a: string, b: string) =>
  a !== b && lookup(board).borders.has(`${a}|${b}`);
export function blockedCountry(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  id: string,
): boolean {
  if (
    s.territories.filter((t) => force(t, actor)).length === 1 &&
    s.lastCountryLiberated.includes(actor)
  )
    return false;
  const neighbors = board.connections
    .filter((e) => e.endpoints.includes(id))
    .map((e) =>
      territory(
        s,
        e.endpoints.find((x) => x !== id)!,
      ),
    );
  if (neighbors.length < 3) return false;
  const first = neighbors[0]!.ownership;
  return (
    first.kind === 'exclusive' &&
    first.playerId !== actor &&
    neighbors.every(
      (t) =>
        t.ownership.kind === 'exclusive' &&
        t.ownership.playerId === first.playerId &&
        t.forces[0]!.armies >= 2,
    )
  );
}
function between(p: Pact, a: string, b: string) {
  return (
    (p.proposerId === a && p.partnerId === b) ||
    (p.proposerId === b && p.partnerId === a)
  );
}
const graphDistances = new WeakMap<
  PreparationBoard,
  Map<string, Map<string, number>>
>();
function unprotectedDistances(
  board: PreparationBoard,
  start: string,
): Map<string, number> {
  let cache = graphDistances.get(board);
  if (!cache) {
    cache = new Map();
    graphDistances.set(board, cache);
  }
  const found = cache.get(start);
  if (found) return found;
  const result = new Map([[start, 0]]),
    queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!,
      n = result.get(id)!;
    for (const e of board.connections) {
      if (!e.endpoints.includes(id)) continue;
      const next = e.endpoints.find((v) => v !== id)!;
      if (!result.has(next)) {
        result.set(next, n + 1);
        queue.push(next);
      }
    }
  }
  cache.set(start, result);
  return result;
}
export function edgeProtected(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  a: string,
  b: string,
): boolean {
  return s.pacts.some((p) => {
    if (p.status !== 'active' || ![p.proposerId, p.partnerId].includes(actor))
      return false;
    if (p.kind === 'countries' || p.kind === 'origin') {
      if (p.countryIds.length !== 2) return false;
      const [start, end] = p.countryIds as [string, string],
        left = unprotectedDistances(board, start),
        right = unprotectedDistances(board, end),
        distance = left.get(end);
      return (
        distance !== undefined &&
        distance <= 3 &&
        ((left.get(a) ?? 100) + 1 + (right.get(b) ?? 100) === distance ||
          (left.get(b) ?? 100) + 1 + (right.get(a) ?? 100) === distance)
      );
    }
    const from = territory(s, a),
      to = territory(s, b);
    if (!(
      (force(from, p.proposerId) && force(to, p.partnerId)) ||
      (force(from, p.partnerId) && force(to, p.proposerId))
    ))
      return false;
    if (p.kind === 'world') return true;
    if (p.kind === 'continent')
      return (
        p.continentIds.includes(continent(board, a)) &&
        p.continentIds.includes(continent(board, b))
      );
    return (
      p.kind === 'intercontinental' &&
      p.continentIds.includes(continent(board, a)) &&
      p.continentIds.includes(continent(board, b)) &&
      continent(board, a) !== continent(board, b)
    );
  });
}
export function attackProtected(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  defender: string,
  origin: string,
  target: string,
): boolean {
  return s.pacts.some(
    (p) =>
      p.status === 'active' &&
      between(p, actor, defender) &&
      (p.kind === 'world' ||
        (p.kind === 'internal' &&
          origin === target &&
          p.countryIds.includes(target)) ||
        ((p.kind === 'countries' || p.kind === 'origin') &&
          p.countryIds.includes(origin) &&
          p.countryIds.includes(target)) ||
        (p.kind === 'continent' &&
          p.continentIds.includes(continent(board, origin)) &&
          p.continentIds.includes(continent(board, target))) ||
        (p.kind === 'intercontinental' &&
          p.continentIds.includes(continent(board, origin)) &&
          p.continentIds.includes(continent(board, target)) &&
          continent(board, origin) !== continent(board, target))),
  );
}
/** D55: shortest legal path, not a user-chosen detour. */
export function permittedMissileDistance(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  origin: string,
  target: string,
): number | null {
  if (origin === target) return null;
  const distances = new Map([[origin, 0]]),
    queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!,
      d = distances.get(id)!;
    if (d === 3) continue;
    for (const e of board.connections) {
      if (!e.endpoints.includes(id)) continue;
      const next = e.endpoints.find((v) => v !== id)!;
      if (!distances.has(next) && !edgeProtected(board, s, actor, id, next)) {
        if (next === target) return d + 1;
        distances.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return null;
}
/** Continent pairs [a's, b's] where a country of a borders a country of b. */
export function borderPairs(
  board: PreparationBoard,
  s: Campaign,
  a: string,
  b: string,
): [string, string][] {
  const pairs = new Set<string>();
  for (const { endpoints } of board.connections) {
    const [x, y] = endpoints;
    const cx = continent(board, x);
    const cy = continent(board, y);
    if (cx === cy) continue;
    const tx = territory(s, x);
    const ty = territory(s, y);
    if (force(tx, a) && force(ty, b)) pairs.add(`${cx}|${cy}`);
    if (force(tx, b) && force(ty, a)) pairs.add(`${cy}|${cx}`);
  }
  return [...pairs].sort().map((pair) => pair.split('|') as [string, string]);
}
export function endInvalidPacts(board: PreparationBoard, s: Campaign): void {
  const alive = (id: string) => !s.eliminations[id];
  s.pacts = s.pacts.filter((p) => {
    if (!alive(p.proposerId) || !alive(p.partnerId)) return false;
    if (p.kind === 'countries' || p.kind === 'origin')
      return p.countryIds.every(
        (id, i) =>
          !!force(territory(s, id), i === 0 ? p.proposerId : p.partnerId),
      );
    if (p.kind === 'internal')
      return p.countryIds.every(
        (id) =>
          force(territory(s, id), p.proposerId) &&
          force(territory(s, id), p.partnerId),
      );
    if (p.kind === 'zone')
      return territory(s, p.countryIds[0]!).forces.every((f) =>
        [p.proposerId, p.partnerId].includes(f.playerId),
      );
    // A pact between borders ends when no border between them is left there.
    if (p.kind === 'intercontinental')
      return borderPairs(board, s, p.proposerId, p.partnerId).some(
        (pair) =>
          [...pair].sort().join('|') === [...p.continentIds].sort().join('|'),
      );
    return (
      p.continentIds.every((id) =>
        board.countries.some((c) => c.continentId === id),
      ) || p.kind === 'world'
    );
  });
}
export function assertPoliticalIds(s: Campaign): void {
  const ids = [...s.pacts.map((p) => p.id), ...s.alliances.map((a) => a.id)];
  if (new Set(ids).size !== ids.length)
    throw Error('Duplicate agreement identity');
}
