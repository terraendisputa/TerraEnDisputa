import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import {
  createFirstHostility,
  applyFirstHostility,
  firstHostilityActions,
  assertFirstHostility,
} from '../packages/game-engine/dist/reconquista/hostilities.js';
import {
  activateSituation,
  initialSituationCycle,
} from '../packages/game-engine/dist/reconquista/round.js';
import { createSituationDeck } from '../packages/game-engine/dist/reconquista/situations.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const board = preparationBoard(catalog);
function battlefield() {
  return createFirstHostility(
    board.countries.map((c) => ({
      id: c.id,
      ownership: {
        kind: 'exclusive',
        playerId: c.id === 'uruguay' ? 'b' : 'a',
      },
      forces: [
        {
          playerId: c.id === 'uruguay' ? 'b' : 'a',
          armies: c.id === 'argentina' ? 8 : 1,
          missiles: c.id === 'argentina' ? 2 : c.id === 'uruguay' ? 1 : 0,
        },
      ],
    })),
    'a',
  );
}
void test('Ordinary attack captures missiles, preserves origin missiles and requires exclusive mandatory transfer before any other action', () => {
  const before = battlefield();
  let i = 0;
  const rolls = [0.99, 0.99, 0.99, 0];
  const pending = applyFirstHostility(
    board,
    before,
    'a',
    { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
    'classic_combat',
    null,
    ['a', 'b'],
    () => rolls[i++],
  );
  assert.equal(i, 4);
  assert.equal(pending.pendingConquest.maximum, 3);
  const target = pending.territories.find((t) => t.id === 'uruguay');
  assert.equal(target.forces[0].armies, 0);
  assert.equal(target.forces[0].missiles, 1);
  assert.equal(target.ownership.playerId, 'a');
  assert.equal(
    pending.territories.find((t) => t.id === 'argentina').forces[0].missiles,
    2,
  );
  assert.deepEqual(
    firstHostilityActions(board, pending, 'a', 'classic_combat', null).attacks,
    [],
  );
  for (const action of [
    { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
    { kind: 'regroup', originId: 'argentina', targetId: 'brasil', armies: 1 },
    { kind: 'transfer', armies: 4 },
  ])
    assert.throws(() =>
      applyFirstHostility(
        board,
        pending,
        'a',
        action,
        'classic_combat',
        null,
        ['a', 'b'],
        () => {
          throw Error('Do not roll');
        },
      ),
    );
  assert.throws(() =>
    applyFirstHostility(
      board,
      pending,
      'b',
      { kind: 'transfer', armies: 1 },
      'classic_combat',
      null,
      ['a', 'b'],
      () => 0,
    ),
  );
  const done = applyFirstHostility(
    board,
    pending,
    'a',
    { kind: 'transfer', armies: 3 },
    'classic_combat',
    null,
    ['a', 'b'],
    () => {
      throw Error('No roll');
    },
  );
  assert.equal(done.pendingConquest, null);
  assert.equal(
    done.territories.find((t) => t.id === 'argentina').forces[0].armies,
    5,
  );
  assert.equal(
    done.territories.find((t) => t.id === 'uruguay').forces[0].armies,
    3,
  );
  assert.throws(() =>
    applyFirstHostility(
      board,
      done,
      'a',
      { kind: 'transfer', armies: 3 },
      'classic_combat',
      null,
      ['a', 'b'],
      () => 0,
    ),
  );
  assert.equal(
    before.territories.find((t) => t.id === 'uruguay').forces[0].playerId,
    'b',
  );
  assertFirstHostility(board, done, ['a', 'b']);
});
void test('First-hostility legality uses graph/continents/rest and rejects own, remote and foreign attacks without RNG', () => {
  const state = battlefield();
  const before = structuredClone(state);
  for (const [actor, action, situation, rest] of [
    [
      'a',
      { kind: 'attack', originId: 'argentina', targetId: 'brasil' },
      'classic_combat',
      null,
    ],
    [
      'a',
      { kind: 'attack', originId: 'alaska', targetId: 'uruguay' },
      'classic_combat',
      null,
    ],
    [
      'b',
      { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
      'classic_combat',
      null,
    ],
    [
      'a',
      { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
      'open_borders',
      null,
    ],
    [
      'a',
      { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
      'classic_combat',
      'a',
    ],
  ])
    assert.throws(() =>
      applyFirstHostility(
        board,
        state,
        actor,
        action,
        situation,
        rest,
        ['a', 'b'],
        () => {
          throw Error('Illegal action must not roll');
        },
      ),
    );
  assert.deepEqual(state, before);
});
void test('Regrouping fixes arrivals, retains occupation and irreversibly closes attack phase', () => {
  let state = battlefield();
  state = applyFirstHostility(
    board,
    state,
    'a',
    { kind: 'regroup', originId: 'argentina', targetId: 'brasil', armies: 6 },
    'classic_combat',
    null,
    ['a', 'b'],
    () => 0,
  );
  assert.equal(state.phase, 'regroup');
  assert.equal(state.fixedArmies.brasil, 6);
  const routes = firstHostilityActions(
    board,
    state,
    'a',
    'classic_combat',
    null,
  );
  assert.deepEqual(routes.attacks, []);
  assert.equal(
    routes.regroups.find(
      (r) => r.originId === 'brasil' && r.targetId === 'colombia',
    ).maximum,
    1,
  );
  assert.throws(() =>
    applyFirstHostility(
      board,
      state,
      'a',
      { kind: 'regroup', originId: 'brasil', targetId: 'colombia', armies: 2 },
      'classic_combat',
      null,
      ['a', 'b'],
      () => 0,
    ),
  );
  assert.throws(() =>
    applyFirstHostility(
      board,
      state,
      'a',
      { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
      'classic_combat',
      null,
      ['a', 'b'],
      () => 0,
    ),
  );
  state = applyFirstHostility(
    board,
    state,
    'a',
    { kind: 'regroup', originId: 'brasil', targetId: 'colombia', armies: 1 },
    'classic_combat',
    null,
    ['a', 'b'],
    () => 0,
  );
  assert.equal(
    state.territories.find((t) => t.id === 'brasil').forces[0].armies,
    6,
  );
});

function missileField(originId, targetId, armies = 8, defenderMissiles = 0) {
  const s = battlefield();
  return {
    ...s,
    territories: s.territories.map((t) => ({
      ...t,
      ownership: { kind: 'exclusive', playerId: t.id === targetId ? 'b' : 'a' },
      forces: [
        {
          playerId: t.id === targetId ? 'b' : 'a',
          armies: t.id === targetId ? armies : 1,
          missiles:
            t.id === originId ? 2 : t.id === targetId ? defenderMissiles : 0,
        },
      ],
    })),
  };
}
const noRandom = () => {
  throw Error('Missile actions must not roll dice');
};
const applyMissile = (
  s,
  action,
  situation = 'classic_combat',
  actor = 'a',
  rest = null,
) =>
  applyFirstHostility(
    board,
    s,
    actor,
    action,
    situation,
    rest,
    ['a', 'b'],
    noRandom,
  );
void test('D31/D33: missile shortest distances 1/2/3 cause full 3/2/1 losses, consume one missile without conquest or dice; distance4 rejected', () => {
  const pairs = [
    ['nueva_zelanda', 'tasmania', 1],
    ['nueva_zelanda', 'australia', 2],
    ['nueva_zelanda', 'sumatra', 3],
  ];
  // IDs are the catalog IDs; the graph, never artwork coordinates, defines reach.
  for (const [originId, targetId, distance] of pairs) {
    const s = missileField(originId, targetId);
    const action = { kind: 'fire-missile', originId, targetId };
    const before = structuredClone(s);
    const route = firstHostilityActions(
      board,
      s,
      'a',
      'classic_combat',
      null,
    ).missileShots.find((r) => r.targetId === targetId);
    assert.equal(route.distance, distance);
    const after = applyMissile(s, action);
    assert.deepEqual(s, before);
    assert.equal(
      after.territories.find((t) => t.id === originId).forces[0].missiles,
      1,
    );
    assert.equal(
      after.territories.find((t) => t.id === originId).forces[0].armies,
      1,
    );
    assert.equal(
      after.territories.find((t) => t.id === targetId).forces[0].armies,
      8 - (4 - distance),
    );
    assert.equal(
      after.territories.find((t) => t.id === targetId).ownership.playerId,
      'b',
    );
    assert.equal(after.pendingConquest, null);
    assert.equal(after.lastMissile.damage, 4 - distance);
    for (const armies of [
      ...new Set([4 - distance, Math.max(1, 3 - distance)]),
    ]) {
      const tooSmall = missileField(originId, targetId, armies);
      assert.throws(
        () => applyMissile(tooSmall, action),
        /Illegal missile shot/,
      );
    }
    const minimum = applyMissile(
      missileField(originId, targetId, 5 - distance),
      action,
    );
    assert.equal(
      minimum.territories.find((t) => t.id === targetId).forces[0].armies,
      1,
    );
  }
  assert.throws(
    () =>
      applyMissile(missileField('nueva_zelanda', 'india'), {
        kind: 'fire-missile',
        originId: 'nueva_zelanda',
        targetId: 'india',
      }),
    /Illegal missile shot/,
  );
});
void test('D32: strict missile superiority reevaluated after each shot, defender missiles unchanged; rest, wrong actor, pending transfer and regroup prohibit firing', () => {
  const action = {
    kind: 'fire-missile',
    originId: 'argentina',
    targetId: 'uruguay',
  };
  const s = missileField('argentina', 'uruguay', 8, 1);
  const after = applyMissile(s, action);
  assert.equal(
    after.territories.find((t) => t.id === 'uruguay').forces[0].missiles,
    1,
  );
  assert.throws(() => applyMissile(after, action));
  assert.throws(() =>
    applyMissile(missileField('argentina', 'uruguay', 8, 2), action),
  );
  assert.throws(() => applyMissile(s, action, 'classic_combat', 'b'));
  assert.throws(() => applyMissile(s, action, 'classic_combat', 'a', 'a'));
  assert.throws(() => applyMissile({ ...s, phase: 'regroup' }, action));
  const pending = applyFirstHostility(
    board,
    battlefield(),
    'a',
    { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
    'classic_combat',
    null,
    ['a', 'b'],
    (() => {
      const draws = [0.99, 0.99, 0.99, 0];
      return () => draws.shift();
    })(),
  );
  assert.throws(() => applyMissile(pending, action));
  assert.throws(() =>
    applyMissile(pending, {
      kind: 'regroup-missiles',
      originId: 'argentina',
      targetId: 'brasil',
      missiles: 1,
    }),
  );
});
void test('D34: open/closed situations filter missile endpoints, retaining distance3 and ignoring intermediate continents; wind/snow do not change missile damage', () => {
  // Same-continent endpoints connected through another continent: only endpoints constrain the shot.
  const custom = {
    ...board,
    connections: [
      { endpoints: ['argentina', 'egipto'] },
      { endpoints: ['egipto', 'brasil'] },
    ],
  };
  const s = missileField('argentina', 'brasil');
  const closed = firstHostilityActions(
    custom,
    s,
    'a',
    'closed_borders',
    null,
  ).missileShots;
  assert.equal(closed[0].distance, 2);
  assert.equal(
    firstHostilityActions(custom, s, 'a', 'open_borders', null).missileShots
      .length,
    0,
  );
  const cross = missileField('nueva_zelanda', 'india');
  // Real graph range is independently checked by the distance4 test above.
  assert.equal(
    firstHostilityActions(board, cross, 'a', 'closed_borders', null)
      .missileShots.length,
    0,
  );
  for (const type of ['snow', 'tailwind', 'crisis', 'extra_reinforcements']) {
    assert.equal(
      applyMissile(
        missileField('argentina', 'uruguay'),
        { kind: 'fire-missile', originId: 'argentina', targetId: 'uruguay' },
        type,
      ).lastMissile.damage,
      3,
    );
  }
  const crossClose = missileField('brasil', 'sahara');
  assert.equal(
    firstHostilityActions(board, crossClose, 'a', 'open_borders', null)
      .missileShots.length,
    1,
  );
  assert.equal(
    firstHostilityActions(board, crossClose, 'a', 'closed_borders', null)
      .missileShots.length,
    0,
  );
});
void test('D35: missile regroup is adjacent, closes attacks, fixes incoming missiles separately from armies and preserves occupation; captured missiles may fire immediately', () => {
  const s = missileField('argentina', 'uruguay');
  const before = structuredClone(s);
  const after = applyMissile(s, {
    kind: 'regroup-missiles',
    originId: 'argentina',
    targetId: 'brasil',
    missiles: 2,
  });
  assert.deepEqual(s, before);
  assert.equal(after.phase, 'regroup');
  assert.equal(after.fixedMissiles.brasil, 2);
  assert.equal(after.fixedArmies.brasil, undefined);
  assert.equal(
    after.territories.find((t) => t.id === 'argentina').forces[0].armies,
    1,
  );
  assert.equal(
    after.territories.find((t) => t.id === 'argentina').forces[0].missiles,
    0,
  );
  for (const action of [
    {
      kind: 'regroup-missiles',
      originId: 'brasil',
      targetId: 'sahara',
      missiles: 1,
    },
    { kind: 'fire-missile', originId: 'brasil', targetId: 'uruguay' },
    { kind: 'attack', originId: 'brasil', targetId: 'uruguay' },
  ])
    assert.throws(() => applyMissile(after, action));
  for (const missiles of [0, -1, 0.5, Infinity, 3])
    assert.throws(() =>
      applyMissile(s, {
        kind: 'regroup-missiles',
        originId: 'argentina',
        targetId: 'brasil',
        missiles,
      }),
    );
  assert.throws(() =>
    applyMissile(s, {
      kind: 'regroup-missiles',
      originId: 'argentina',
      targetId: 'uruguay',
      missiles: 1,
    }),
  );
  const capture = battlefield();
  const brasil = capture.territories.find((t) => t.id === 'brasil');
  brasil.ownership = { kind: 'exclusive', playerId: 'b' };
  brasil.forces = [{ playerId: 'b', armies: 8, missiles: 0 }];
  let i = 0;
  const conquered = applyFirstHostility(
    board,
    capture,
    'a',
    { kind: 'attack', originId: 'argentina', targetId: 'uruguay' },
    'classic_combat',
    null,
    ['a', 'b'],
    () => [0.99, 0.99, 0.99, 0][i++],
  );
  const occupied = applyMissile(conquered, { kind: 'transfer', armies: 1 });
  const fired = applyMissile(occupied, {
    kind: 'fire-missile',
    originId: 'uruguay',
    targetId: 'brasil',
  });
  assert.equal(
    fired.territories.find((t) => t.id === 'uruguay').forces[0].missiles,
    0,
  );
  assert.equal(
    fired.territories.find((t) => t.id === 'brasil').forces[0].armies,
    5,
  );
});

void test('Situation replacement expires the previous missile restriction instead of accumulating effects; active copy survives roundtrip', () => {
  const deck = createSituationDeck(catalog, () => 0.5);
  const types = ['closed_borders', 'open_borders', 'classic_combat'];
  const selected = types.map((type) =>
    deck.cards.find((c) => c.typeId === type),
  );
  let cycle = initialSituationCycle({
    ...deck,
    cards: [
      ...selected,
      ...deck.cards.filter((c) => !selected.some((s) => s.id === c.id)),
    ],
  });
  const same = missileField('argentina', 'uruguay');
  const cross = missileField('brasil', 'sahara');
  for (const type of types) {
    const activated = activateSituation(
      cycle,
      [
        { id: 'a', color: 'white' },
        { id: 'b', color: 'black' },
      ],
      noRandom,
    );
    cycle = JSON.parse(JSON.stringify(activated.cycle));
    assert.equal(cycle.active.typeId, type);
    assert.equal(
      firstHostilityActions(
        board,
        same,
        'a',
        cycle.active.typeId,
        activated.restingPlayerId,
      ).missileShots.length,
      type === 'open_borders' ? 0 : 1,
    );
    assert.equal(
      firstHostilityActions(
        board,
        cross,
        'a',
        cycle.active.typeId,
        activated.restingPlayerId,
      ).missileShots.length,
      type === 'closed_borders' ? 0 : 1,
    );
  }
  assert(cycle.discards.some((c) => c.typeId === 'closed_borders'));
  assert(cycle.discards.some((c) => c.typeId === 'open_borders'));
  assert.equal(cycle.active.typeId, 'classic_combat');
});

void test('Missile result invariants reject forged range/damage and moved-reserve overflow', () => {
  const fired = applyMissile(missileField('argentina', 'uruguay'), {
    kind: 'fire-missile',
    originId: 'argentina',
    targetId: 'uruguay',
  });
  for (const lastMissile of [
    { ...fired.lastMissile, damage: 1 },
    { ...fired.lastMissile, distance: 4 },
    { ...fired.lastMissile, targetId: 'unknown' },
  ]) {
    assert.throws(() =>
      assertFirstHostility(board, { ...fired, lastMissile }, ['a', 'b']),
    );
  }
  assert.throws(() =>
    assertFirstHostility(board, { ...fired, fixedMissiles: { argentina: 2 } }, [
      'a',
      'b',
    ]),
  );
});
void test('Finishing the attacks moves first hostility to regrouping, kept by the game', () => {
  const before = battlefield();
  const apply = (state, actor, action) =>
    applyFirstHostility(
      board,
      state,
      actor,
      action,
      'classic_combat',
      null,
      ['a', 'b'],
      () => {
        throw Error('Do not roll');
      },
    );
  assert.throws(() => apply(before, 'b', { kind: 'finish-attacks' }));
  const finished = apply(before, 'a', { kind: 'finish-attacks' });
  assert.equal(finished.phase, 'regroup');
  assert.deepEqual(
    firstHostilityActions(board, finished, 'a', 'classic_combat', null).attacks,
    [],
  );
  assert.throws(() => apply(finished, 'a', { kind: 'finish-attacks' }));
  assert.throws(() =>
    apply(finished, 'a', {
      kind: 'attack',
      originId: 'argentina',
      targetId: 'uruguay',
    }),
  );
});
