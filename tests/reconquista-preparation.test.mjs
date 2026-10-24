import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  preparationBoard,
  rankPreparationPlayers,
  createPreparation,
  placeInitialArmies,
  initialBudgets,
  preparationNeighbors,
  occupationSummary,
} from '../packages/game-engine/dist/reconquista/preparation.js';
import { resolveGameDefinition } from '../packages/game-engine/dist/index.js';

const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const board = preparationBoard(catalog);
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
function randomSequence(values, fallback = 0.125) {
  let i = 0;
  return () => values[i++] ?? fallback;
}
function prepared(n) {
  return createPreparation(
    board,
    ids.slice(0, n),
    randomSequence([0.9, 0.8, 0.7, 0.6, 0.5, 0.4]),
  );
}
function owners(state, id) {
  return state.territories.filter((t) => t.ownership.playerId === id);
}
function armies(state, id) {
  return state.territories
    .flatMap((t) => t.forces)
    .filter((f) => f.playerId === id)
    .reduce((n, f) => n + f.armies, 0);
}

void test('D10: reroll only tied players, preserving both higher and lower resolved places', () => {
  const result = rankPreparationPlayers(
    ids.slice(0, 5),
    randomSequence([0.9, 0.5, 0.5, 0.1, 0.5, 0.4, 0.8, 0.4, 0.6, 0.2]),
  );
  assert.deepEqual(result.order, ['a', 'c', 'b', 'e', 'd']);
  assert.deepEqual(
    result.rounds.map((r) => r.playerIds),
    [
      ['a', 'b', 'c', 'd', 'e'],
      ['b', 'c', 'e'],
      ['b', 'e'],
    ],
  );
  assert.throws(
    () => rankPreparationPlayers(['a', 'b'], () => 0.5),
    /resolve ties/,
  );
  assert.throws(() => rankPreparationPlayers(['a', 'a'], () => 0.5));
  for (const bad of [-1, 1, NaN, Infinity])
    assert.throws(() => rankPreparationPlayers(['a', 'b'], () => bad));
});

void test('D10/D19: one ranking awards the two leftovers to distinct top players and fixes initiative', () => {
  const state = createPreparation(
    board,
    ids.slice(0, 5),
    randomSequence([0.3, 0.8, 0.5, 0.9, 0.1]),
  );
  assert.deepEqual(state.circle, ['d', 'b', 'c', 'a', 'e']);
  assert.deepEqual(state.remainderRecipients, ['d', 'b']);
  assert.deepEqual(
    state.players.map((id) => owners(state, id).length),
    [14, 15, 14, 15, 14],
  );
  assert.equal(state.ranking.length, 1);
  assert.equal(new Set(state.territories.map((t) => t.id)).size, 72);
  assert(
    state.territories.every(
      (t) =>
        t.forces.length === 1 &&
        t.forces[0].armies === 1 &&
        t.forces[0].missiles === 0,
    ),
  );
});

void test('D12/D16: all 2–6 preparations place exact budgets in order, then stop before unresolved situations', () => {
  for (let n = 2; n <= 6; n++) {
    let state = prepared(n);
    const original = structuredClone(state);
    const initial = state.players.map((id) => armies(state, id));
    for (const budget of initialBudgets(n))
      for (const id of state.circle) {
        assert.equal(state.circle[state.playerIndex], id);
        state = placeInitialArmies(board, state, id, {
          [owners(state, id)[0].id]: budget,
        });
      }
    assert.equal(state.stage, 'awaiting-rules');
    assert.deepEqual(
      state.players.map((id) => armies(state, id)),
      initial.map((v) => v + (n === 2 ? 18 : 12)),
    );
    assert.deepEqual(original, prepared(n));
    assert.throws(
      () => placeInitialArmies(board, state, 'a', {}),
      /awaits unresolved/,
    );
    assert.throws(() =>
      resolveGameDefinition({
        editionId: 'reconquista',
        boardId: 'reconquista',
        rulesVersion: 1,
      }),
    );
  }
});

void test('Preparation rejects wrong actors, hostile countries and malformed or incomplete placement without mutation', () => {
  const state = prepared(4);
  const before = structuredClone(state);
  const own = owners(state, 'a')[0].id;
  const hostile = owners(state, 'b')[0].id;
  for (const [actor, placements] of [
    ['b', { [hostile]: 8 }],
    ['a', { [hostile]: 8 }],
    ['a', { unknown: 8 }],
    ['a', { [own]: 7 }],
    ['a', { [own]: 9 }],
    ['a', { [own]: NaN }],
    ['a', { [own]: 1.5 }],
    ['a', { [own]: -8 }],
  ])
    assert.throws(() => placeInitialArmies(board, state, actor, placements));
  assert.deepEqual(state, before);
  assert.equal(
    armies(placeInitialArmies(board, state, 'a', { [own]: 8 }), 'a'),
    26,
  );
  const split = owners(state, 'a')
    .slice(0, 2)
    .map((t) => t.id);
  assert.equal(
    armies(
      placeInitialArmies(board, state, 'a', { [split[0]]: 3, [split[1]]: 5 }),
      'a',
    ),
    26,
  );
});

void test('D17: a country surrounded by one adversary can receive initial armies', () => {
  for (const n of [2, 3]) {
    const state = prepared(n);
    const target = 'albania';
    const territories = state.territories.map((t) => ({
      id: t.id,
      ownership: { kind: 'exclusive', playerId: t.id === target ? 'a' : 'b' },
      forces: [
        {
          playerId: t.id === target ? 'a' : 'b',
          armies: t.id === target ? 1 : 2,
          missiles: 0,
        },
      ],
    }));
    const fixture = { ...state, territories };
    const next = placeInitialArmies(board, fixture, 'a', {
      [target]: n === 2 ? 18 : 8,
    });
    assert.equal(
      next.territories.find((t) => t.id === target).forces[0].armies,
      n === 2 ? 19 : 9,
    );
  }
});

void test('D11: neighbors stay fixed when the round starts from a different seat', () => {
  const circle = prepared(4).circle;
  assert.deepEqual(preparationNeighbors(circle, 'a'), {
    right: 'b',
    left: 'd',
  });
  const startAtB = [...circle.slice(1), circle[0]];
  assert.deepEqual(
    preparationNeighbors(startAtB, 'a'),
    preparationNeighbors(circle, 'a'),
  );
  assert.throws(() => preparationNeighbors(circle, 'unknown'));
});

void test('D13/D15: shared Japan counts for both players; presence grants Asia bonus but no exclusive continent card', () => {
  const territories = board.countries.map((c) => ({
    id: c.id,
    ownership:
      c.id === 'japon'
        ? { kind: 'shared', playerIds: ['a', 'b'] }
        : { kind: 'exclusive', playerId: c.continentId === 'asia' ? 'a' : 'b' },
    forces: (c.id === 'japon'
      ? ['a', 'b']
      : [c.continentId === 'asia' ? 'a' : 'b']
    ).map((playerId) => ({ playerId, armies: 1, missiles: 0 })),
  }));
  const a = occupationSummary(board, territories, 'a');
  const b = occupationSummary(board, territories, 'b');
  assert.equal(a.countryIds.length, 16);
  assert.equal(a.countryReinforcements, 8);
  assert(a.islandIds.includes('japon'));
  assert(b.islandIds.includes('japon'));
  assert.deepEqual(a.continentBonuses, [{ continentId: 'asia', armies: 8 }]);
  assert(!a.exclusiveContinentIds.includes('asia'));
  assert(!b.exclusiveContinentIds.includes('asia'));
  const exclusive = structuredClone(territories);
  const japan = exclusive.find((t) => t.id === 'japon');
  japan.ownership = { kind: 'exclusive', playerId: 'a' };
  japan.forces = [{ playerId: 'a', armies: 2, missiles: 0 }];
  assert(
    occupationSummary(board, exclusive, 'a').exclusiveContinentIds.includes(
      'asia',
    ),
  );
  assert(!occupationSummary(board, exclusive, 'b').islandIds.includes('japon'));
  const invalid = structuredClone(territories);
  invalid.find((t) => t.id === 'japon').forces[0].playerId = 'c';
  assert.throws(() => occupationSummary(board, invalid, 'a'));
});

void test('Occupation thresholds preserve the unusual 5→4 / 6→3 reinforcement rule and D18 45-country candidate', () => {
  for (const count of [0, 1, 5, 6, 7, 19, 44, 45]) {
    const territories = board.countries.map((c, i) => ({
      id: c.id,
      ownership: { kind: 'exclusive', playerId: i < count ? 'a' : 'b' },
      forces: [{ playerId: i < count ? 'a' : 'b', armies: 1, missiles: 0 }],
    }));
    const summary = occupationSummary(board, territories, 'a');
    assert.equal(
      summary.countryReinforcements,
      count === 0 ? 0 : count < 6 ? 4 : Math.floor(count / 2),
    );
    assert.equal(summary.meetsCommonOccupationThreshold, count >= 45);
  }
});

void test('D23: initial missiles cost six armies, preserve occupation and have no physical stock limit', () => {
  let state = prepared(2);
  const own = owners(state, 'a')[0].id;
  const hostile = owners(state, 'b')[0].id;
  const before = structuredClone(state);
  for (const conversions of [
    { [own]: 4 },
    { [hostile]: 1 },
    { unknown: 1 },
    { [own]: 0.5 },
    { [own]: -1 },
  ])
    assert.throws(() =>
      placeInitialArmies(board, state, 'a', { [own]: 18 }, conversions),
    );
  assert.deepEqual(state, before);
  state = placeInitialArmies(board, state, 'a', { [own]: 18 }, { [own]: 3 });
  assert.deepEqual(state.territories.find((t) => t.id === own).forces, [
    { playerId: 'a', armies: 1, missiles: 3 },
  ]);
  const b = owners(state, 'b')[0].id;
  state = placeInitialArmies(board, state, 'b', { [b]: 18 }, { [b]: 3 });
  assert.equal(state.stage, 'awaiting-rules');
  assert.equal(
    state.territories
      .flatMap((t) => t.forces)
      .reduce((n, f) => n + f.armies + 6 * f.missiles, 0),
    108,
  );
});

void test('D30: retry full country deal without reranking, changing quotas or starting with any complete continent', () => {
  const source = board.countries.map((c) => c.id);
  const target = board.countries
    .filter((c) => c.continentId === 'oceania')
    .map((c) => c.id);
  const desired = Array(72);
  target.forEach((id, i) => {
    desired[i * 2] = id;
  });
  let k = 0;
  for (const id of source.filter((id) => !target.includes(id))) {
    while (desired[k]) k++;
    desired[k] = id;
  }
  const work = [...source],
    shuffleDraws = [];
  for (let i = 71; i > 0; i--) {
    const j = work.indexOf(desired[i]);
    shuffleDraws.push((j + 0.25) / (i + 1));
    [work[i], work[j]] = [work[j], work[i]];
  }
  assert.deepEqual(work, desired);
  const state = createPreparation(
    board,
    ['a', 'b'],
    randomSequence([0.9, 0.8, ...shuffleDraws]),
  );
  assert(state.distributionAttempts >= 2);
  assert.equal(state.ranking.length, 1);
  assert.deepEqual(state.circle, ['a', 'b']);
  assert.deepEqual(
    state.players.map((id) => owners(state, id).length),
    [36, 36],
  );
  for (const id of state.players)
    assert.deepEqual(
      occupationSummary(board, state.territories, id).exclusiveContinentIds,
      [],
    );
  let draw = 0;
  assert.throws(
    () =>
      createPreparation(board, ['a', 'b'], () => {
        const current = draw++;
        if (current < 2) return current === 0 ? 0.9 : 0.8;
        return shuffleDraws[(current - 2) % 71];
      }),
    /without complete continents/,
  );
});
