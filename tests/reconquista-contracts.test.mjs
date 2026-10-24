import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateReconquistaCatalog,
  validateReconquistaBoardReview,
  parseReconquistaFixture,
  resolveReconquistaCrisis,
  crisisBlocksCountryCard,
  exclusiveController,
  encodeReconquistaFixture,
  decodeReconquistaFixture,
  confirmedMissileDamage,
} from '../packages/game-engine/dist/reconquista/contracts.js';
import { resolveGameDefinition } from '../packages/game-engine/dist/index.js';
import { decodeGame } from '../apps/server/dist/persistence/schema.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const fixture = JSON.parse(
  await readFile(
    new URL(
      '../tests/fixtures/reconquista/shared-crisis.partial.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const changed = (value, mutate) => {
  const copy = structuredClone(value);
  mutate(copy);
  return copy;
};

void test('Reconquista contracts: catalog coverage and S01/S05/S06 counts without playable admission', () => {
  assert.deepEqual(validateReconquistaCatalog(catalog), {
    countryCount: 72,
    continentCount: 7,
    objectiveCount: 19,
    situationTypeCount: 13,
    manualSituationCopies: 50,
    verifiedEdgeCount: 134,
    pendingEdgeCount: 0,
    islandReview: 'adopted',
    islandCount: 16,
    connected: true,
    readyForRuntime: false,
  });
  assert.throws(() =>
    resolveGameDefinition({
      editionId: 'reconquista',
      boardId: 'reconquista',
      rulesVersion: 1,
    }),
  );
  assert.throws(() =>
    validateReconquistaCatalog(
      changed(catalog, (c) => {
        c.readiness = 'complete';
      }),
    ),
  );
  assert.throws(() =>
    validateReconquistaCatalog(
      changed(catalog, (c) => {
        c.sources.manualSha256 = 'unverified';
      }),
    ),
  );
});
void test('Reconquista contracts: rejects duplicate countries, missing coverage, incorrect symbols and continents', () => {
  for (const mutate of [
    (c) => {
      c.territories[1].id = c.territories[0].id;
    },
    (c) => {
      c.territories.pop();
    },
    (c) => {
      c.territories[0].printedSymbols = 'soldier';
    },
    (c) => {
      c.territories[0].continentId = 'unknown';
    },
    (c) => {
      c.continents[0].territoryCount++;
    },
    (c) => {
      c.territories[0].island = !c.territories[0].island;
    },
  ])
    assert.throws(() => validateReconquistaCatalog(changed(catalog, mutate)));
});
void test('Reconquista contracts: graph rejects unknown/self/duplicate edges and S07 contradiction', () => {
  for (const endpoints of [
    ['unknown', 'polonia'],
    ['polonia', 'polonia'],
    ['polonia', 'finlandia'],
    ['polonia', 'bielorrusia'],
    ['bielorrusia', 'alemania'],
    ['china', 'india'],
    ['francia', 'croacia'],
    ['egipto', 'angola'],
    ['ucrania', 'siberia'],
    ['mexico', 'tonga'],
  ]) {
    assert.throws(() =>
      validateReconquistaCatalog(
        changed(catalog, (c) => {
          c.connections.push({ endpoints, kind: 'border', evidence: 'test' });
        }),
      ),
    );
  }
  assert.throws(() =>
    validateReconquistaCatalog(
      changed(catalog, (c) => {
        c.nonConnections = [];
      }),
    ),
  );
  assert.throws(() =>
    validateReconquistaCatalog(
      changed(catalog, (c) => {
        c.pendingConnections = [
          { endpoints: ['china', 'india'], question: 'unresolved test case' },
        ];
      }),
    ),
  );
  assert.throws(() =>
    validateReconquistaCatalog(
      changed(catalog, (c) => {
        c.connections = c.connections.filter(
          (e) => !e.endpoints.includes('nueva_york'),
        );
      }),
    ),
  );
});
void test('Reconquista contracts: objective reserve, quotas, situation colors/frequencies and wildcard are distinct', () => {
  for (const mutate of [
    (c) => {
      c.reserveObjective.playable = true;
    },
    (c) => {
      c.objectives[0].requirements.north_america = 73;
    },
    (c) => {
      c.objectives[0].target = 'red';
    },
    (c) => {
      c.situationTypes[0].manualCopies = 1;
    },
    (c) => {
      c.situationTypes[7].color = 'magenta';
    },
    (c) => {
      c.standaloneWildcardCount = 2;
    },
  ])
    assert.throws(() => validateReconquistaCatalog(changed(catalog, mutate)));
});
void test('Reconquista contracts: shared ownership preserves forces and has no exclusive controller', () => {
  const parsed = parseReconquistaFixture(fixture);
  assert.equal(exclusiveController(parsed.territories[0]), undefined);
  assert.equal(exclusiveController(parsed.territories[1]), 'C');
  assert.deepEqual(parsed.territories[0].forces, [
    { playerId: 'A', armies: 3, missiles: 0 },
    { playerId: 'B', armies: 2, missiles: 0 },
  ]);
  for (const mutate of [
    (f) => {
      f.territories[0].ownerId = 'A';
    },
    (f) => {
      f.territories[0].ownership.playerId = 'A';
    },
    (f) => {
      f.territories[0].ownership.playerIds.push('C');
    },
    (f) => {
      f.territories[0].forces[1].playerId = 'A';
    },
    (f) => {
      f.territories[0].forces[1].playerId = 'C';
    },
    (f) => {
      f.territories[0].forces[1].armies = 0;
    },
    (f) => {
      f.territories[1].forces[0].missiles = -1;
    },
  ])
    assert.throws(() => parseReconquistaFixture(changed(fixture, mutate)));
});
void test('Reconquista contracts: crisis minimum ties, all ties and invalid rolls/participants', () => {
  const c = resolveReconquistaCrisis(['A', 'B', 'C', 'D'], [1, 4, 1, 6]);
  assert.deepEqual(c.affectedPlayerIds, ['A', 'C']);
  assert.equal(crisisBlocksCountryCard(c, 'A'), true);
  assert.equal(crisisBlocksCountryCard(c, 'B'), false);
  assert.deepEqual(
    resolveReconquistaCrisis(['A', 'B'], [3, 3]).affectedPlayerIds,
    ['A', 'B'],
  );
  assert.throws(() => crisisBlocksCountryCard(c, 'unknown'));
  for (const rolls of [
    [0, 4, 1, 6],
    [1, 7, 1, 6],
    [1.5, 4, 1, 6],
    [1, 4],
  ])
    assert.throws(() => resolveReconquistaCrisis(c.participants, rolls));
  assert.throws(() => resolveReconquistaCrisis(['A', 'A'], [1, 2]));
  assert.throws(() =>
    parseReconquistaFixture(
      changed(fixture, (f) => {
        f.crisis.affectedPlayerIds = ['B'];
      }),
    ),
  );
});

void test('Reconquista contracts: a third occupant can be represented without inheriting the expelled forces', async () => {
  const replacement = JSON.parse(
    await readFile(
      new URL(
        '../tests/fixtures/reconquista/shared-replaced-occupant.partial.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const parsed = decodeReconquistaFixture(
    encodeReconquistaFixture(replacement),
  );
  assert.deepEqual(parsed.territories[0].ownership, {
    kind: 'shared',
    playerIds: ['A', 'C'],
  });
  assert.deepEqual(parsed.territories[0].forces, [
    { playerId: 'A', armies: 3, missiles: 0 },
    { playerId: 'C', armies: 1, missiles: 0 },
  ]);
  assert.equal(
    parsed.territories[0].forces.some((f) => f.playerId === 'B'),
    false,
  );
  assert.equal(exclusiveController(parsed.territories[0]), undefined);
});
void test('Reconquista contracts: isolated file roundtrip keeps shared forces and crisis rolls, never Classic snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ted-reconquista-contracts-'));
  try {
    const encoded = encodeReconquistaFixture(fixture);
    await writeFile(join(dir, 'fixture.json'), encoded);
    const decoded = decodeReconquistaFixture(
      await readFile(join(dir, 'fixture.json'), 'utf8'),
    );
    assert.deepEqual(decoded, fixture);
    assert.equal(crisisBlocksCountryCard(decoded.crisis, 'C'), true);
    assert.throws(() => decodeGame(decoded));
    assert.throws(() =>
      decodeReconquistaFixture(
        JSON.stringify({
          format: 'classic-game-snapshot',
          gameSchemaVersion: 7,
        }),
      ),
    );
    assert.throws(() =>
      decodeReconquistaFixture(
        encodeReconquistaFixture(fixture).replace('"version":1', '"version":2'),
      ),
    );
    assert.throws(() => decodeReconquistaFixture('{'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('Reconquista contracts: confirmed missile damage table only; no firing or route interpretation', () => {
  assert.deepEqual([1, 2, 3].map(confirmedMissileDamage), [3, 2, 1]);
  for (const d of [0, 4, 1.5, NaN])
    assert.throws(() => confirmedMissileDamage(d));
});

const boardReview = JSON.parse(
  await readFile(
    new URL(
      '../tests/fixtures/reconquista/board-review.partial.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
void test('Reconquista contracts: country review detects omitted connected edges, wrong bridge kinds and continental assignments', () => {
  const result = validateReconquistaBoardReview(catalog, boardReview);
  assert.equal(result.reviewedCountryCount, 72);
  assert.equal(result.borderCount, 95);
  assert.equal(result.bridgeCount, 39);
  assert.equal(
    catalog.connections.some(
      (edge) =>
        edge.endpoints.includes('china') && edge.endpoints.includes('vietnam'),
    ),
    false,
  );
  assert.equal(
    catalog.nonConnections.some(
      (edge) =>
        edge.endpoints.includes('china') &&
        edge.endpoints.includes('vietnam') &&
        edge.evidence.includes('S10'),
    ),
    true,
  );
  assert.equal(result.crossContinentCount, 20);
  assert.equal(result.readyForRuntime, false);
  const missing = changed(catalog, (c) => {
    c.connections = c.connections.filter(
      (e) => !e.endpoints.includes('alaska') || !e.endpoints.includes('canada'),
    );
  });
  assert.equal(validateReconquistaCatalog(missing).connected, true);
  assert.throws(
    () => validateReconquistaBoardReview(missing, boardReview),
    /catalog differs from country review/,
  );
  assert.throws(() =>
    validateReconquistaBoardReview(
      changed(catalog, (c) => {
        c.connections[0].kind = 'bridge';
      }),
      boardReview,
    ),
  );
  for (const mutate of [
    (r) => {
      r.countries.pop();
    },
    (r) => {
      r.countries[0].borders = [];
    },
    (r) => {
      r.countries[0].continentId = 'asia';
    },
    (r) => {
      r.countries[0].bridges.push('unknown');
    },
    (r) => {
      r.countries[0].bridges.push('chukchi');
    },
    (r) => {
      r.boardSha256 = 'different-photo';
    },
  ])
    assert.throws(() =>
      validateReconquistaBoardReview(catalog, changed(boardReview, mutate)),
    );
});
void test('Reconquista contracts: D09 classifies 16 islands across six continents without ownership or victory evaluation', () => {
  assert.equal(
    catalog.territories.find((t) => t.id === 'australia').island,
    true,
  );
  const islands = catalog.territories.filter((t) => t.island);
  assert.equal(islands.length, 16);
  assert.equal(new Set(islands.map((t) => t.continentId)).size, 6);
  for (const mutate of [
    (c) => {
      delete c.islandDecision;
    },
    (c) => {
      c.islandDecision.countryIds[0] = 'alaska';
    },
    (c) => {
      c.islandDecision.countryIds.pop();
    },
    (c) => {
      c.territories.find((t) => t.id === 'australia').island = false;
    },
    (c) => {
      c.objectives.find((o) => o.id === 'occupation_11').islands.count = 17;
    },
    (c) => {
      c.objectives.find((o) => o.id === 'occupation_11').islands.minContinents =
        7;
    },
  ])
    assert.throws(() => validateReconquistaCatalog(changed(catalog, mutate)));
  const historicalPending = changed(catalog, (c) => {
    c.islandReview = 'pending';
    delete c.islandDecision;
    for (const t of c.territories) t.island = 'unreviewed';
  });
  assert.equal(validateReconquistaCatalog(historicalPending).islandCount, null);
  assert.equal(
    validateReconquistaCatalog(historicalPending).readyForRuntime,
    false,
  );
});

void test('D22: confirmed border corrections preserve explicit negative evidence and prevent Finland-Poland regression', () => {
  const key = (ends) => [...ends].sort().join('|');
  const positives = new Map(
    catalog.connections.map((edge) => [key(edge.endpoints), edge]),
  );
  const negatives = new Map(
    catalog.nonConnections.map((edge) => [key(edge.endpoints), edge]),
  );
  const removed = [
    ['albania', 'croacia'],
    ['albania', 'serbia'],
    ['arabia', 'irak'],
    ['chechenia', 'chukchi'],
    ['china', 'irak'],
    ['china', 'iran'],
    ['china', 'israel'],
    ['chukchi', 'rusia'],
    ['chukchi', 'siberia'],
    ['kamchatka', 'rusia'],
  ];
  const added = [
    ['alemania', 'italia'],
    ['croacia', 'polonia'],
    ['chechenia', 'china'],
    ['china', 'chukchi'],
    ['china', 'siberia'],
    ['irak', 'turquia'],
    ['iran', 'turquia'],
    ['rusia', 'turquia'],
  ];
  for (const endpoints of [...removed, ['finlandia', 'polonia']]) {
    assert(!positives.has(key(endpoints)), key(endpoints));
    assert.match(negatives.get(key(endpoints))?.evidence ?? '', /S11/);
    assert.throws(
      () =>
        validateReconquistaCatalog(
          changed(catalog, (copy) => {
            copy.connections.push({
              endpoints,
              kind: 'border',
              evidence: 'invalid regression',
            });
          }),
        ),
      /negative evidence/,
    );
  }
  for (const endpoints of added) {
    assert.equal(positives.get(key(endpoints))?.kind, 'border');
    assert.match(positives.get(key(endpoints))?.evidence ?? '', /S11/);
  }
  assert.equal(validateReconquistaCatalog(catalog).verifiedEdgeCount, 134);
  assert.equal(
    validateReconquistaBoardReview(catalog, boardReview).borderCount,
    95,
  );
});
