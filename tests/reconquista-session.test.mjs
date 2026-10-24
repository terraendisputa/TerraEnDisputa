import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import {
  newSetupJournal,
  commitSetupCommand,
  loadSetupJournal,
  projectReconquistaSession,
  firstHostilityCandidates,
  reconquistaLegalActions,
  blockedReconquistaCountry,
  applyReconquistaSetup,
} from '../packages/game-engine/dist/reconquista/session.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const board = preparationBoard(catalog);
const players = ['white', 'black', 'red', 'blue', 'yellow', 'green'].map(
  (color, i) => ({ id: `p${i}`, color }),
);
function rng(seed = 123) {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
function completed(n, seed = 123) {
  const random = rng(seed);
  let current = newSetupJournal(catalog, players.slice(0, n), random);
  let k = 0;
  while (current.state.stage === 'initial-placement') {
    const id =
      current.state.preparation.circle[current.state.preparation.playerIndex];
    const legal = reconquistaLegalActions(board, current.state, id);
    current = commitSetupCommand(
      catalog,
      current.journal,
      id,
      `cmd-${k++}`,
      current.revision,
      {
        kind: 'place',
        placements: { [legal.placementCountryIds[0]]: legal.budget },
        conversions: {},
      },
      random,
    );
  }
  // The last initial placement draws the first situation automatically.
  assert.notEqual(current.state.stage, 'reveal-situation');
  return current;
}
void test('Integrated 2–6-player setup reaches first situation without public admission; private projections omit deck and other secrets', () => {
  for (let n = 2; n <= 6; n++) {
    const current = completed(n);
    assert(
      ['first-hostility', 'extra-placement'].includes(current.state.stage),
    );
    const admin = projectReconquistaSession(board, current.state, null);
    assert(!('self' in admin));
    assert(!('objectives' in admin));
    assert(!('cycle' in admin));
    assert(!('ranking' in admin));
    for (const p of players.slice(0, n)) {
      const view = projectReconquistaSession(board, current.state, p.id);
      assert.equal(view.self.objectives.length, n === 2 ? 2 : 1);
      assert(!('removedObjectiveIds' in view));
    }
    assert.throws(() =>
      projectReconquistaSession(board, current.state, 'intruder'),
    );
    assert.deepEqual(
      loadSetupJournal(catalog, JSON.parse(JSON.stringify(current.journal)))
        .state,
      current.state,
    );
  }
});
void test('Every first situation is activatable; extra round places exact floor(n/2) before hostility and ordinary refills are absent', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200 && seen.size < 13; seed++) {
    let c = completed(6, seed);
    seen.add(c.state.cycle.active.typeId);
    if (c.state.stage === 'extra-placement') {
      const budgets = [...c.state.extraBudgets];
      assert.deepEqual(budgets, [6, 6, 6, 6, 6, 6]);
      const initial = c.state.preparation.territories
        .flatMap((t) => t.forces)
        .reduce((s, f) => s + f.armies, 0);
      while (c.state.stage === 'extra-placement') {
        const actor = c.state.preparation.circle[c.state.extraIndex];
        const legal = reconquistaLegalActions(board, c.state, actor);
        c = commitSetupCommand(
          catalog,
          c.journal,
          actor,
          `extra-${c.revision}`,
          c.revision,
          {
            kind: 'extra',
            placements: { [legal.placementCountryIds[0]]: legal.budget },
            conversions: {},
          },
          rng(seed),
        );
      }
      assert.equal(c.state.stage, 'first-hostility');
      assert.equal(
        c.state.preparation.territories
          .flatMap((t) => t.forces)
          .reduce((s, f) => s + f.armies, 0) - initial,
        36,
      );
    }
    const actor = c.state.preparation.circle[0];
    if (c.state.activation.restingPlayerId === actor)
      assert.deepEqual(firstHostilityCandidates(board, c.state, actor), []);
    assert.deepEqual(
      firstHostilityCandidates(board, c.state, 'not-player'),
      [],
    );
  }
  assert.equal(seen.size, 13);
});
void test('Setup journal: rejects wrong actors, stale/conflicting commands and corrupt/incompatible formats; retry consumes no random draws', () => {
  const current = newSetupJournal(catalog, players.slice(0, 4), rng());
  const actor = current.state.preparation.circle[0];
  const own = reconquistaLegalActions(board, current.state, actor)
    .placementCountryIds[0];
  const action = { kind: 'place', placements: { [own]: 8 }, conversions: {} };
  const next = commitSetupCommand(
    catalog,
    current.journal,
    actor,
    'one',
    0,
    action,
    rng(),
  );
  assert.deepEqual(
    commitSetupCommand(catalog, next.journal, actor, 'one', 0, action, () => {
      throw Error('No reroll');
    }).state,
    next.state,
  );
  assert.throws(
    () =>
      commitSetupCommand(catalog, next.journal, actor, 'two', 0, action, rng()),
    /Stale/,
  );
  assert.throws(
    () =>
      commitSetupCommand(
        catalog,
        next.journal,
        actor,
        'one',
        0,
        { ...action, placements: { [own]: 7 } },
        rng(),
      ),
    /Conflicting/,
  );
  assert.throws(() =>
    commitSetupCommand(
      catalog,
      current.journal,
      'intruder',
      'one',
      0,
      action,
      rng(),
    ),
  );
  const changedCatalog = structuredClone(catalog);
  changedCatalog.territories[0].name += ' changed';
  assert.throws(
    () => loadSetupJournal(changedCatalog, next.journal),
    /Incompatible/,
  );
  for (const mutate of [
    (j) => (j.version = 2),
    (j) => (j.kind = 'classic'),
    (j) => (j.extra = true),
    (j) => j.initialDraws.pop(),
    (j) => j.initialDraws.push(0.5),
    (j) => (j.commands[0].expectedRevision = 1),
    (j) => (j.commands[0].action.unexpected = 1),
    (j) => j.commands[0].draws.push(0.1),
  ]) {
    const bad = structuredClone(next.journal);
    mutate(bad);
    assert.throws(() => loadSetupJournal(catalog, bad));
  }
});
void test('Discardable file restart preserves ownership, secrets, deck position, crisis and revision, with exact retry after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ted-reconquista-session-'));
  try {
    let current;
    for (let seed = 1; seed <= 100; seed++) {
      current = completed(4, seed);
      if (current.state.cycle.active.typeId === 'crisis') break;
    }
    assert.equal(current.state.cycle.active.typeId, 'crisis');
    const file = join(directory, 'development.json');
    await writeFile(file, JSON.stringify(current.journal));
    const restored = loadSetupJournal(
      catalog,
      JSON.parse(await readFile(file, 'utf8')),
    );
    assert.deepEqual(restored.state, current.state);
    assert.equal(restored.revision, current.revision);
    const command = current.journal.commands.at(-1);
    const retry = commitSetupCommand(
      catalog,
      restored.journal,
      command.actorId,
      command.commandId,
      command.expectedRevision,
      command.action,
      () => {
        throw Error('No draw after restart');
      },
    );
    assert(retry.duplicate);
    assert.deepEqual(retry.state, current.state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('D28: extra reinforcements reject both new forces and conversion of existing forces in blocked countries', () => {
  let current;
  for (let seed = 1; seed < 100; seed++) {
    current = completed(6, seed);
    if (current.state.stage === 'extra-placement') break;
  }
  assert.equal(current.state.stage, 'extra-placement');
  const actor = current.state.preparation.circle[0];
  const rival = current.state.players.find((p) => p.id !== actor).id;
  const country = board.countries.find(
    (c) =>
      board.connections.filter((e) => e.endpoints.includes(c.id)).length >= 3,
  );
  const neighbors = new Set(
    board.connections
      .filter((e) => e.endpoints.includes(country.id))
      .flatMap((e) => e.endpoints)
      .filter((id) => id !== country.id),
  );
  const other = board.countries.find(
    (c) => c.id !== country.id && !neighbors.has(c.id),
  );
  const territories = current.state.preparation.territories.map((t) => {
    const playerId = t.id === country.id || t.id === other.id ? actor : rival;
    return {
      id: t.id,
      ownership: { kind: 'exclusive', playerId },
      forces: [{ playerId, armies: t.id === country.id ? 7 : 2, missiles: 0 }],
    };
  });
  const state = {
    ...current.state,
    preparation: { ...current.state.preparation, territories },
  };
  const before = structuredClone(state);
  assert(blockedReconquistaCountry(board, territories, actor, country.id));
  const budget = state.extraBudgets[0];
  assert.throws(
    () =>
      applyReconquistaSetup(
        board,
        state,
        actor,
        {
          kind: 'extra',
          placements: { [country.id]: budget },
          conversions: {},
        },
        rng(),
      ),
    /Blocked/,
  );
  assert.throws(
    () =>
      applyReconquistaSetup(
        board,
        state,
        actor,
        {
          kind: 'extra',
          placements: { [other.id]: budget },
          conversions: { [country.id]: 1 },
        },
        rng(),
      ),
    /Missiles are unavailable before full turns/,
  );
  assert.deepEqual(state, before);
  const last = territories.map((t) =>
    t.id === other.id
      ? {
          ...t,
          ownership: { kind: 'exclusive', playerId: rival },
          forces: [{ playerId: rival, armies: 2, missiles: 0 }],
        }
      : t,
  );
  assert.equal(
    blockedReconquistaCountry(board, last, actor, country.id),
    false,
  );
});

void test('Idempotent placement treats reordered JSON keys as the same content but rejects changed allocations', () => {
  const current = newSetupJournal(catalog, players.slice(0, 4), rng());
  const actor = current.state.preparation.circle[0];
  const own = reconquistaLegalActions(
    board,
    current.state,
    actor,
  ).placementCountryIds;
  const action = {
    kind: 'place',
    placements: { [own[0]]: 4, [own[1]]: 4 },
    conversions: {},
  };
  const committed = commitSetupCommand(
    catalog,
    current.journal,
    actor,
    'canonical-placement',
    0,
    action,
    rng(),
  );
  const reordered = {
    conversions: {},
    placements: { [own[1]]: 4, [own[0]]: 4 },
    kind: 'place',
  };
  const retry = commitSetupCommand(
    catalog,
    committed.journal,
    actor,
    'canonical-placement',
    0,
    reordered,
    () => {
      throw Error('Retry must not draw');
    },
  );
  assert(retry.duplicate);
  assert.deepEqual(retry.state, committed.state);
  assert.throws(
    () =>
      commitSetupCommand(
        catalog,
        committed.journal,
        actor,
        'canonical-placement',
        0,
        { ...action, placements: { [own[0]]: 5, [own[1]]: 3 } },
        rng(),
      ),
    /Conflicting/,
  );
});
