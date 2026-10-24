/** Reconquista catalog, fixture and crisis contracts. */
const RECONQUISTA_MANUAL_SHA256 =
  'e6b3f6b021f86e577bc1c1c50f84ad39c99385cf4bfff737678c3715269a8047';
const RECONQUISTA_CONTINENTS = [
  'north_america',
  'central_america',
  'south_america',
  'europe',
  'asia',
  'africa',
  'oceania',
] as const;
export const RECONQUISTA_COLORS = [
  'white',
  'black',
  'red',
  'blue',
  'yellow',
  'green',
] as const;

/** D09: explicit digital decision, not a list attributed to S01. */
const RECONQUISTA_DIGITAL_ISLAND_IDS = [
  'cuba',
  'jamaica',
  'japon',
  'madagascar',
  'isla_victoria',
  'labrador',
  'groenlandia',
  'islandia',
  'irlanda',
  'gran_bretana',
  'sumatra',
  'filipinas',
  'tonga',
  'australia',
  'tasmania',
  'nueva_zelanda',
] as const;

function fail(message: string): never {
  throw new Error(`Reconquista: ${message}`);
}
export function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('expected object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((k) => !keys.includes(k)))
    fail('unexpected field');
  return result;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail('expected nonempty string');
  return value;
}
export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail('expected array');
  return value as readonly unknown[];
}
export function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    fail('invalid integer');
  return value;
}
export function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail('duplicate identity');
}
function exact(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${String(expected)}`);
}
function evidence(value: unknown): void {
  text(value);
}

/** Structural integrity is not certification of the photographed graph or rules. */
export function validateReconquistaCatalog(value: unknown) {
  const c = object(value, [
    'kind',
    'version',
    'readiness',
    'sources',
    'continents',
    'territories',
    'connections',
    'nonConnections',
    'pendingConnections',
    'graphReview',
    'islandReview',
    'islandDecision',
    'objectives',
    'reserveObjective',
    'situationTypes',
    'situationCopiesSource',
    'standaloneWildcardCount',
  ]);
  exact(c.kind, 'reconquista-catalog');
  exact(c.version, 1);
  exact(c.readiness, 'partial');
  exact(c.graphReview, 'transcribed');
  if (c.islandReview !== 'pending' && c.islandReview !== 'adopted')
    fail('unknown island review');
  if (c.islandReview === 'adopted') {
    const decision = object(c.islandDecision, ['id', 'evidence', 'countryIds']);
    exact(decision.id, 'D09');
    evidence(decision.evidence);
    const approvedIds = list(decision.countryIds).map(text);
    unique(approvedIds);
    exact(approvedIds.length, RECONQUISTA_DIGITAL_ISLAND_IDS.length);
    if (
      approvedIds.some(
        (id) =>
          !(RECONQUISTA_DIGITAL_ISLAND_IDS as readonly string[]).includes(id),
      )
    )
      fail('island decision differs from D09');
  } else if (c.islandDecision !== undefined)
    fail('pending islands cannot carry an adopted decision');
  const sources = object(c.sources, ['manualSha256', 'photos', 'declarations']);
  exact(sources.manualSha256, RECONQUISTA_MANUAL_SHA256);
  evidence(sources.photos);
  list(sources.declarations).forEach(evidence);
  const continents = list(c.continents).map((v) => {
    const r = object(v, ['id', 'territoryCount', 'evidence']);
    const id = text(r.id);
    if (!(RECONQUISTA_CONTINENTS as readonly string[]).includes(id))
      fail('unknown continent');
    evidence(r.evidence);
    return { id, count: integer(r.territoryCount, 1) };
  });
  unique(continents.map((c) => c.id));
  exact(continents.length, 7);
  const territories = list(c.territories).map((v) => {
    const r = object(v, [
      'id',
      'name',
      'continentId',
      'printedSymbols',
      'cardEvidence',
      'boardEvidence',
      'island',
    ]);
    const id = text(r.id);
    text(r.name);
    evidence(r.cardEvidence);
    evidence(r.boardEvidence);
    exact(
      r.island,
      c.islandReview === 'pending'
        ? 'unreviewed'
        : (RECONQUISTA_DIGITAL_ISLAND_IDS as readonly string[]).includes(id),
    );
    const continentId = text(r.continentId);
    if (!continents.some((c) => c.id === continentId))
      fail('unknown territory continent');
    const symbol = text(r.printedSymbols);
    if (
      !['plane', 'ship', 'tank_grenade', 'soldier', 'triple'].includes(symbol)
    )
      fail('unknown printed symbols');
    return { id, continentId, symbol, island: r.island };
  });
  exact(territories.length, 72);
  unique(territories.map((t) => t.id));
  for (const c of continents)
    exact(territories.filter((t) => t.continentId === c.id).length, c.count);
  for (const [symbol, count] of Object.entries({
    plane: 21,
    ship: 21,
    tank_grenade: 21,
    soldier: 4,
    triple: 5,
  }))
    exact(territories.filter((t) => t.symbol === symbol).length, count);
  const ids = new Set(territories.map((t) => t.id));
  function pair(v: unknown, connection: boolean): string {
    const r = object(
      v,
      connection
        ? ['endpoints', 'kind', 'evidence']
        : ['endpoints', 'evidence'],
    );
    evidence(r.evidence);
    if (connection && !['border', 'bridge'].includes(text(r.kind)))
      fail('unknown edge kind');
    const ends = list(r.endpoints).map(text);
    exact(ends.length, 2);
    unique(ends);
    if (ends.some((id) => !ids.has(id))) fail('unknown edge endpoint');
    return ends.toSorted().join('|');
  }
  const edges = list(c.connections).map((v) => pair(v, true));
  unique(edges);
  const denied = list(c.nonConnections).map((v) => pair(v, false));
  unique(denied);
  const pending = list(c.pendingConnections).map((v) => {
    const r = object(v, ['endpoints', 'question']);
    text(r.question);
    return pair({ endpoints: r.endpoints, evidence: r.question }, false);
  });
  unique(pending);
  if (pending.some((p) => edges.includes(p) || denied.includes(p)))
    fail('unresolved edge cannot be asserted');
  const adjacency = new Map([...ids].map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    const [a, b] = edge.split('|');
    adjacency.get(a!)!.add(b!);
    adjacency.get(b!)!.add(a!);
  }
  const reached = new Set<string>();
  const visit = [territories[0]!.id];
  while (visit.length) {
    const id = visit.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    visit.push(...adjacency.get(id)!);
  }
  if (reached.size !== ids.size) fail('disconnected transcribed graph');
  if (denied.some((p) => edges.includes(p)))
    fail('edge contradicts negative evidence');
  if (
    !edges.includes('bielorrusia|polonia') ||
    !denied.includes('finlandia|polonia')
  )
    fail('missing S07 ruling');
  const objectives = list(c.objectives).map((v) => {
    const r = object(v, [
      'id',
      'kind',
      'requirements',
      'islands',
      'minTerritories',
      'target',
      'initialImpossibleFallback',
      'evidence',
    ]);
    evidence(r.evidence);
    const id = text(r.id);
    if (r.kind === 'occupation') {
      if (r.target !== undefined || r.initialImpossibleFallback !== undefined)
        fail('mixed objective');
      const requirements = object(r.requirements, RECONQUISTA_CONTINENTS);
      for (const [cid, n] of Object.entries(requirements))
        if (n !== 'all') {
          if (
            integer(n, 1) > (continents.find((c) => c.id === cid)?.count ?? 0)
          )
            fail('impossible continent quota');
        }
      if (r.islands !== undefined) {
        const i = object(r.islands, ['count', 'minContinents']);
        integer(i.count, 1);
        if (integer(i.minContinents, 1) > 7) fail('invalid island continents');
        if (c.islandReview === 'adopted') {
          const islands = territories.filter((t) => t.island === true);
          if (
            integer(i.count, 1) > islands.length ||
            integer(i.minContinents, 1) >
              new Set(islands.map((t) => t.continentId)).size
          )
            fail('impossible island quota');
        }
      }
      if (r.minTerritories !== undefined && integer(r.minTerritories, 1) > 72)
        fail('impossible territory quota');
      if (
        !Object.keys(requirements).length &&
        r.islands === undefined &&
        r.minTerritories === undefined
      )
        fail('empty objective');
    } else if (r.kind === 'destruction') {
      if (
        r.requirements !== undefined ||
        r.islands !== undefined ||
        r.minTerritories !== undefined
      )
        fail('mixed objective');
      const target = text(r.target);
      if (![...RECONQUISTA_COLORS, 'left_neighbor'].includes(target))
        fail('invalid destruction target');
      if (target !== 'left_neighbor')
        exact(r.initialImpossibleFallback, 'right_neighbor');
      else if (r.initialImpossibleFallback !== undefined)
        fail('unexpected neighbor fallback');
    } else fail('unknown objective kind');
    return id;
  });
  unique(objectives);
  exact(objectives.length, 19);
  const expectedObjectives = [
    ...Array.from(
      { length: 12 },
      (_, i) => `occupation_${String(i + 1).padStart(2, '0')}`,
    ),
    ...RECONQUISTA_COLORS.map((c) => `destroy_${c}`),
    'destroy_left_neighbor',
  ];
  if (objectives.some((id) => !expectedObjectives.includes(id)))
    fail('unknown playable objective');
  const reserve = object(c.reserveObjective, ['playable', 'evidence']);
  exact(reserve.playable, false);
  evidence(reserve.evidence);
  const types = list(c.situationTypes).map((v) => {
    const r = object(v, ['id', 'effect', 'color', 'manualCopies', 'evidence']);
    evidence(r.evidence);
    const effect = text(r.effect);
    const id = text(r.id);
    if (effect === 'rest') {
      if (!(RECONQUISTA_COLORS as readonly unknown[]).includes(r.color))
        fail('invalid rest color');
      exact(id, `rest_${text(r.color)}`);
      exact(r.manualCopies, 1);
    } else {
      if (
        ![
          'classic_combat',
          'snow',
          'tailwind',
          'crisis',
          'extra_reinforcements',
          'open_borders',
          'closed_borders',
        ].includes(effect) ||
        r.color !== undefined
      )
        fail('invalid situation');
      exact(id, effect);
      exact(r.manualCopies, effect === 'classic_combat' ? 20 : 4);
    }
    return { id, copies: integer(r.manualCopies, 1) };
  });
  exact(types.length, 13);
  unique(types.map((t) => t.id));
  exact(c.situationCopiesSource, 'S01-only');
  exact(c.standaloneWildcardCount, 1);
  return {
    countryCount: territories.length,
    continentCount: continents.length,
    objectiveCount: objectives.length,
    situationTypeCount: types.length,
    manualSituationCopies: types.reduce((n, t) => n + t.copies, 0),
    verifiedEdgeCount: edges.length,
    pendingEdgeCount: pending.length,
    islandReview: c.islandReview,
    islandCount:
      c.islandReview === 'adopted'
        ? territories.filter((t) => t.island === true).length
        : null,
    connected: true as const,
    readyForRuntime: false as const,
  };
}

export type ReconquistaOwnership =
  | { readonly kind: 'exclusive'; readonly playerId: string }
  | { readonly kind: 'shared'; readonly playerIds: readonly [string, string] };
export interface ReconquistaForce {
  readonly playerId: string;
  readonly armies: number;
  readonly missiles: number;
}
export interface ReconquistaTerritory {
  readonly id: string;
  readonly ownership: ReconquistaOwnership;
  readonly forces: readonly ReconquistaForce[];
}
export interface ReconquistaCrisis {
  readonly kind: 'crisis';
  readonly participants: readonly string[];
  readonly rolls: readonly number[];
  readonly affectedPlayerIds: readonly string[];
  /** D77: tied players roll again, in participant order, until one remains. */
  readonly tiebreaks?: readonly (readonly number[])[];
}
interface ReconquistaFixture {
  readonly kind: 'reconquista-fixture';
  readonly version: 1;
  readonly scope: 'partial';
  readonly players: readonly string[];
  readonly territories: readonly ReconquistaTerritory[];
  readonly crisis: ReconquistaCrisis;
}

export const CRISIS_TIEBREAK_LIMIT = 20;
/**
 * Explicit rolls: this does not choose deck frequencies or advance a turn.
 * Without tiebreaks every tied player is affected (manual p. 10, older games);
 * with them, the tied players' rerolls decide a single one (D77).
 */
export function resolveReconquistaCrisis(
  participants: readonly string[],
  rolls: readonly number[],
  tiebreaks?: readonly (readonly number[])[],
): ReconquistaCrisis {
  participants.forEach(text);
  unique(participants);
  if (
    participants.length < 2 ||
    participants.length > 6 ||
    rolls.length !== participants.length
  )
    fail('invalid crisis participants');
  rolls.forEach((n) => {
    if (integer(n, 1) > 6) fail('invalid die');
  });
  const lowest = (ids: readonly string[], dice: readonly number[]) =>
    ids.filter((_, i) => dice[i] === Math.min(...dice));
  let affected = lowest(participants, rolls);
  if (!tiebreaks)
    return {
      kind: 'crisis',
      participants: [...participants],
      rolls: [...rolls],
      affectedPlayerIds: affected,
    };
  for (const dice of tiebreaks) {
    if (affected.length < 2 || dice.length !== affected.length)
      fail('invalid crisis tiebreak');
    dice.forEach((n) => {
      if (integer(n, 1) > 6) fail('invalid die');
    });
    affected = lowest(affected, dice);
  }
  // A broken random source cannot loop forever: after the last reroll the manual's rule applies.
  if (affected.length !== 1 && tiebreaks.length !== CRISIS_TIEBREAK_LIMIT)
    fail('unresolved crisis tie');
  return {
    kind: 'crisis',
    participants: [...participants],
    rolls: [...rolls],
    affectedPlayerIds: affected,
    tiebreaks: tiebreaks.map((dice) => [...dice]),
  };
}
export function crisisBlocksCountryCard(
  crisis: ReconquistaCrisis,
  playerId: string,
): boolean {
  const verified = resolveReconquistaCrisis(
    crisis.participants,
    crisis.rolls,
    crisis.tiebreaks,
  );
  if (!verified.participants.includes(playerId))
    fail('unknown crisis participant');
  return verified.affectedPlayerIds.includes(playerId);
}
export function exclusiveController(
  territory: ReconquistaTerritory,
): string | undefined {
  return territory.ownership.kind === 'exclusive'
    ? territory.ownership.playerId
    : undefined;
}
export function parseReconquistaFixture(value: unknown): ReconquistaFixture {
  const f = object(value, [
    'kind',
    'version',
    'scope',
    'players',
    'territories',
    'crisis',
  ]);
  exact(f.kind, 'reconquista-fixture');
  exact(f.version, 1);
  exact(f.scope, 'partial');
  const players = list(f.players).map(text);
  unique(players);
  if (players.length < 2 || players.length > 6) fail('invalid player set');
  const territories: ReconquistaTerritory[] = list(f.territories).map((v) => {
    const t = object(v, ['id', 'ownership', 'forces']);
    const id = text(t.id);
    const o = object(t.ownership, ['kind', 'playerId', 'playerIds']);
    let ownership: ReconquistaOwnership;
    if (o.kind === 'exclusive') {
      if (o.playerIds !== undefined) fail('mixed ownership');
      ownership = { kind: 'exclusive', playerId: text(o.playerId) };
    } else if (o.kind === 'shared') {
      if (o.playerId !== undefined) fail('shared ownership collapsed to owner');
      const owners = list(o.playerIds).map(text);
      exact(owners.length, 2);
      unique(owners);
      ownership = { kind: 'shared', playerIds: [owners[0]!, owners[1]!] };
    } else fail('invalid ownership');
    const owners =
      ownership.kind === 'exclusive'
        ? [ownership.playerId]
        : ownership.playerIds;
    if (owners.some((p) => !players.includes(p))) fail('unknown owner');
    const forces = list(t.forces).map((v) => {
      const r = object(v, ['playerId', 'armies', 'missiles']);
      const playerId = text(r.playerId);
      if (!owners.includes(playerId)) fail('foreign forces');
      return {
        playerId,
        armies: integer(r.armies, 1),
        missiles: integer(r.missiles),
      };
    });
    unique(forces.map((f) => f.playerId));
    exact(forces.length, owners.length);
    return { id, ownership, forces };
  });
  unique(territories.map((t) => t.id));
  if (!territories.length) fail('empty partial territory set');
  const c = object(f.crisis, [
    'kind',
    'participants',
    'rolls',
    'affectedPlayerIds',
  ]);
  exact(c.kind, 'crisis');
  const crisis = resolveReconquistaCrisis(
    list(c.participants).map(text),
    list(c.rolls).map((n) => integer(n, 1)),
  );
  if (
    crisis.participants.length !== players.length ||
    crisis.participants.some((p) => !players.includes(p))
  )
    fail('crisis player set mismatch');
  const affected = list(c.affectedPlayerIds).map(text);
  unique(affected);
  if (
    affected.length !== crisis.affectedPlayerIds.length ||
    affected.some((p) => !crisis.affectedPlayerIds.includes(p))
  )
    fail('inconsistent crisis result');
  return {
    kind: 'reconquista-fixture',
    version: 1,
    scope: 'partial',
    players,
    territories,
    crisis,
  };
}
/** Isolated JSON experiment, not a game snapshot, backup or transport message. */
export function encodeReconquistaFixture(fixture: unknown): string {
  return JSON.stringify(parseReconquistaFixture(fixture));
}
export function decodeReconquistaFixture(
  serialized: string,
): ReconquistaFixture {
  return parseReconquistaFixture(JSON.parse(serialized) as unknown);
}
export function confirmedMissileDamage(distance: number): number {
  if (![1, 2, 3].includes(distance)) fail('distance must be 1, 2 or 3');
  return 4 - distance;
}

/** Compare the catalog with the separately recorded visual country review.
 * Missing pairs remain unasserted; this never creates negative evidence.
 */
export function validateReconquistaBoardReview(
  catalog: unknown,
  value: unknown,
) {
  const summary = validateReconquistaCatalog(catalog);
  const c = catalog as Record<string, unknown>;
  const r = object(value, [
    'kind',
    'version',
    'scope',
    'boardSha256',
    'countries',
  ]);
  exact(r.kind, 'reconquista-board-review');
  exact(r.version, 1);
  exact(r.scope, 'partial');
  exact(
    r.boardSha256,
    '164fc18e58e8ff9caceffcd4a94911d515c7f2bd09cfd5876f8acf9585ab375e',
  );
  const territories = list(c.territories).map((v) =>
    object(v, [
      'id',
      'name',
      'continentId',
      'printedSymbols',
      'cardEvidence',
      'boardEvidence',
      'island',
    ]),
  );
  const byId = new Map(
    territories.map((t) => [text(t.id), text(t.continentId)]),
  );
  const directed = new Set<string>();
  const reviewedIds = list(r.countries).map((v) => {
    const country = object(v, [
      'id',
      'continentId',
      'borders',
      'bridges',
      'evidence',
    ]);
    const id = text(country.id);
    if (!byId.has(id)) fail('unknown reviewed country');
    exact(country.continentId, byId.get(id));
    evidence(country.evidence);
    const neighbors: string[] = [];
    for (const [field, kind] of [
      ['borders', 'border'],
      ['bridges', 'bridge'],
    ] as const) {
      for (const neighbor of list(country[field]).map(text)) {
        if (neighbor === id || !byId.has(neighbor))
          fail('invalid reviewed neighbor');
        neighbors.push(neighbor);
        directed.add(`${id}|${neighbor}|${kind}`);
      }
    }
    unique(neighbors);
    return id;
  });
  unique(reviewedIds);
  exact(reviewedIds.length, byId.size);
  for (const entry of directed) {
    const [from, to, kind] = entry.split('|');
    if (!directed.has(`${to}|${from}|${kind}`))
      fail('asymmetric country review');
  }
  const catalogDirected = new Set<string>();
  let borderCount = 0;
  let bridgeCount = 0;
  let crossContinentCount = 0;
  for (const v of list(c.connections)) {
    const edge = object(v, ['endpoints', 'kind', 'evidence']);
    const [a, b] = list(edge.endpoints).map(text);
    const kind = text(edge.kind);
    catalogDirected.add(`${a}|${b}|${kind}`);
    catalogDirected.add(`${b}|${a}|${kind}`);
    if (kind === 'border') borderCount++;
    else bridgeCount++;
    if (byId.get(a!) !== byId.get(b!)) crossContinentCount++;
  }
  if (
    directed.size !== catalogDirected.size ||
    [...directed].some((e) => !catalogDirected.has(e))
  )
    fail('catalog differs from country review');
  return {
    ...summary,
    reviewedCountryCount: reviewedIds.length,
    borderCount,
    bridgeCount,
    crossContinentCount,
  };
}
