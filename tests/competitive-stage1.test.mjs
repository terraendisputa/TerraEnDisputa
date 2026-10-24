import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClassicSetup,
  applySetupCommand,
  applyCommand,
  assertClassicInvariants,
  deriveLegalActions,
  TERRITORY_IDS,
  TERRITORIES,
  PLAYER_COLORS,
} from '../packages/game-engine/dist/index.js';
import {
  PROTOCOL_VERSION,
  createGameBodySchema,
  updateGameConfigurationBodySchema,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import {
  projectGameFor,
  projectGameForAdmin,
} from '../apps/server/dist/games/projection.js';
import { buildServer } from '../apps/server/dist/app.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';

const players = (n) =>
  Array.from({ length: n }, (_, seatIndex) => ({
    id: `00000000-0000-4000-8000-${String(seatIndex).padStart(12, '0')}`,
    nickname: `Player ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
function rng(seed = 1) {
  let roll = 0;
  const calls = [];
  return {
    calls,
    rollDie: () => {
      const value = (++roll % 6) + 1;
      calls.push(['roll', value]);
      return value;
    },
    shuffle: (items) => {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const j = seed % (i + 1);
        [result[i], result[j]] = [result[j], result[i]];
      }
      calls.push(['shuffle', result]);
      return result;
    },
  };
}
const owned = (state, id) =>
  TERRITORY_IDS.filter((t) => state.territories[t].ownerId === id);
function allocation(state) {
  const id = state.setup.currentPlayerId;
  let due =
    state.setup.kind === 'card_deal_4_to_6'
      ? state.setup.armiesRemainingInActivation
      : state.setup.additionalArmiesRemainingByPlayer[id];
  const placements = {};
  const counts = {
    ...(state.setup.additionalArmiesByPlayerContinent?.[id] ?? {}),
  };
  for (const territory of owned(state, id)) {
    const c = TERRITORIES[territory].continentId;
    const amount = Math.min(
      due,
      state.mode === 'competitive' ? 4 - (counts[c] ?? 0) : due,
    );
    if (amount > 0) {
      placements[territory] = amount;
      counts[c] = (counts[c] ?? 0) + amount;
      due -= amount;
    }
    if (!due) break;
  }
  assert.equal(due, 0);
  return placements;
}
const place = (state, placements) =>
  applySetupCommand(state, {
    type: 'place_setup_armies',
    playerId: state.setup.currentPlayerId,
    placements,
  });
const durable = (state) => ({
  state,
  revision: 0,
  recentCommands: [],
  auth: {
    ...emptyGameAuthState(),
    players: Object.fromEntries(
      state.players.map((p) => [
        p.id,
        {
          playerId: p.id,
          session: {
            verifier: { algorithm: 'sha256', digest: 'a'.repeat(64) },
            transportClass: 'HTTP',
            expiresAt: '2099-01-01T00:00:00.000Z',
            lastActiveAt: '2026-10-12T00:00:00.000Z',
          },
        },
      ]),
    ),
  },
});
function complete(state) {
  let activations = 0;
  while (state.status === 'SETUP') {
    assertClassicInvariants(state);
    const result = place(state, allocation(state));
    assert.equal(result.ok, true);
    state = result.state;
    activations++;
  }
  assertClassicInvariants(state);
  return { state, activations };
}

void test('creation/configuration contracts reject manipulated modes and counts', () => {
  assert.equal(
    createGameBodySchema.parse({ configuredPlayerCount: 2 }).mode,
    'classic',
  );
  for (const count of [2, 3, 3.5, 7, NaN])
    assert.equal(
      createGameBodySchema.safeParse({
        mode: 'competitive',
        configuredPlayerCount: count,
      }).success,
      false,
    );
  for (const count of [4, 5, 6])
    assert.equal(
      createGameBodySchema.safeParse({
        mode: 'competitive',
        configuredPlayerCount: count,
      }).success,
      true,
    );
  assert.equal(
    createGameBodySchema.safeParse({ mode: 'bogus', configuredPlayerCount: 4 })
      .success,
    false,
  );
  assert.equal(
    updateGameConfigurationBodySchema.safeParse({
      mode: 'classic',
      configuredPlayerCount: 4,
    }).success,
    false,
  );
});

void test('Classic retains 5+3, small variants and first actor', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const state = createClassicSetup('classic', players(n), rng());
    const start = state.setup.startingPlayerId;
    if (n >= 4) assert.equal(state.setup.armiesRemainingInActivation, 5);
    const result = complete(state);
    assert.equal(result.activations, n * (n >= 4 ? 2 : 1));
    assert.equal(result.state.turn.playerId, start);
    for (const p of state.players)
      assert.equal(
        owned(result.state, p.id).reduce(
          (sum, id) => sum + result.state.territories[id].armies - 1,
          0,
        ),
        n === 2 ? 12 : 8,
      );
    if (n <= 3) assert.ok(state.players.every((p) => !p.secretObjectiveId));
  }
  const state = createClassicSetup('classic', players(4), rng());
  assert.equal(
    place(state, { [owned(state, state.setup.currentPlayerId)[0]]: 1 }).ok,
    false,
  );
});

void test('Competitive completes distinct 4+4 activations, objectives and two-continent deals across seeds', () => {
  for (const n of [4, 5, 6])
    for (let seed = 1; seed <= 30; seed++) {
      let state = createClassicSetup(
        'competitive',
        players(n),
        rng(seed),
        'competitive',
      );
      assertClassicInvariants(state);
      for (const p of state.players) {
        assert.ok(
          new Set(owned(state, p.id).map((t) => TERRITORIES[t].continentId))
            .size >= 2,
        );
        if (n === 4) assert.ok(!p.secretObjectiveId.startsWith('destroy_'));
        if (p.secretObjectiveId.startsWith('destroy_')) {
          assert.ok(
            state.players.some(
              (target) =>
                target.id !== p.id &&
                target.color === p.secretObjectiveId.slice(8),
            ),
          );
        }
      }
      assert.equal(
        new Set(state.players.map((p) => p.secretObjectiveId)).size,
        n,
      );
      const first = state.setup.currentPlayerId;
      for (let i = 0; i < n; i++) state = place(state, allocation(state)).state;
      assert.equal(state.setup.reinforcementRound, 2);
      assert.equal(state.setup.currentPlayerId, first);
      assert.equal(state.setup.armiesRemainingInActivation, 4);
      const done = complete(state).state;
      assert.equal(done.turn.playerId, first);
      for (const p of done.players)
        assert.equal(
          owned(done, p.id).reduce(
            (sum, t) => sum + done.territories[t].armies - 1,
            0,
          ),
          8,
        );
    }
});

void test('partial lots, continent accumulation, rejected batches and persisted counters', () => {
  let state = createClassicSetup(
    'competitive',
    players(4),
    rng(),
    'competitive',
  );
  const actor = state.setup.currentPlayerId;
  const countries = owned(state, actor);
  const first = countries[0],
    c = TERRITORIES[first].continentId;
  const second = countries.find(
    (t) => t !== first && TERRITORIES[t].continentId === c,
  );
  const other = countries.find((t) => TERRITORIES[t].continentId !== c);
  assert.ok(second && other);
  state = place(state, { [first]: 2, [second]: 1 }).state;
  assertClassicInvariants(state);
  assert.equal(state.setup.additionalArmiesByPlayerContinent[actor][c], 3);
  assert.equal(state.setup.armiesRemainingInActivation, 1);
  state = decodeGame(encodeGame(durable(state))).game.state;
  state = place(state, { [other]: 1 }).state;
  while (state.setup.currentPlayerId !== actor)
    state = place(state, allocation(state)).state;
  const original = structuredClone(state);
  assert.equal(place(state, { [first]: 2, [other]: 2 }).ok, false);
  assert.deepEqual(state, original);
  for (const invalid of [
    { bogus: 4 },
    { [first]: -1 },
    { [first]: 1.5 },
    { [first]: 5 },
    { [owned(state, state.players.find((p) => p.id !== actor).id)[0]]: 4 },
  ])
    assert.equal(place(state, invalid).ok, false);
  const accepted = place(state, { [first]: 1, [other]: 3 });
  assert.equal(accepted.ok, true);
  assert.equal(
    accepted.state.setup.additionalArmiesByPlayerContinent[actor][c],
    4,
  );
  assertClassicInvariants(accepted.state);
});

void test('historical schema 5/6 mid-setup migration retains actor, board and progression; rejects future schemas', () => {
  for (const schema of [5, 6])
    for (const round of [1, 2]) {
      let state = createClassicSetup('legacy', players(4), rng());
      for (let i = 0; i < (round === 1 ? 1 : 5); i++)
        state = place(state, allocation(state)).state;
      const envelope = encodeGame(durable(state));
      envelope.gameSchemaVersion = schema;
      delete envelope.game.state.definition;
      delete envelope.game.state.mode;
      envelope.game.state.setup.reinforcementRound = round === 1 ? 5 : 3;
      delete envelope.game.state.setup.additionalArmiesByPlayerContinent;
      const restored = decodeGame(envelope).game.state;
      assert.equal(restored.mode, 'classic');
      assert.equal(restored.setup.reinforcementRound, round);
      assert.equal(restored.setup.currentPlayerId, state.setup.currentPlayerId);
      assert.deepEqual(restored.territories, state.territories);
      complete(restored);
    }
  const state = createClassicSetup('legacy-lobby', players(2), rng());
  const envelope = encodeGame(durable(state));
  envelope.gameSchemaVersion = 99;
  assert.throws(() => decodeGame(envelope), /newer/);
  const current = encodeGame(durable(state));
  delete current.game.state.mode;
  assert.throws(() => decodeGame(current));
  for (const status of ['LOBBY', 'ACTIVE']) {
    const s =
      status === 'LOBBY'
        ? {
            id: 'lobby',
            definition: {
              editionId: 'classic',
              boardId: 'classic',
              rulesVersion: 1,
            },
            mode: 'classic',
            status,
            configuredPlayerCount: 4,
            players: [],
            readyPlayerIds: [],
          }
        : complete(createClassicSetup('active', players(4), rng())).state;
    const e = encodeGame(durable(s));
    e.gameSchemaVersion = 6;
    delete e.game.state.definition;
    delete e.game.state.mode;
    assert.equal(decodeGame(e).game.state.mode, 'classic');
  }
});

void test('four players cannot propose or accept pacts; five and six permit the shared pact types', () => {
  for (const n of [4, 5, 6]) {
    const state = complete(
      createClassicSetup('pacts', players(n), rng(), 'competitive'),
    ).state;
    const actor = state.turn.playerId;
    const recipient = state.players.find((p) => p.id !== actor).id;
    const proposal = {
      type: 'propose_pact',
      playerId: actor,
      proposalId: 'proposal',
      recipientId: recipient,
      terms: { kind: 'general_non_aggression' },
    };
    const result = applyCommand(state, proposal);
    assert.equal(result.ok, n !== 4);
    assert.equal(
      deriveLegalActions(state, actor).actions.includes('propose_pact'),
      n !== 4,
    );
    if (n === 4)
      assert.equal(
        applyCommand(state, {
          type: 'accept_pact',
          playerId: recipient,
          proposalId: 'proposal',
          pactId: 'pact',
        }).error.code,
        'INVALID_PACT',
      );
  }
});

function defectiveDeal() {
  const asia = TERRITORY_IDS.filter(
    (t) => TERRITORIES[t].continentId === 'asia',
  ).slice(0, 10);
  const others = TERRITORY_IDS.filter((t) => !asia.includes(t));
  return Array.from({ length: 50 }, (_, i) =>
    i % 5 === 0 ? asia[i / 5] : others.shift(),
  );
}

void test('bounded deal retries recover or fail atomically without changing the lobby', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-deal-'));
  const store = await FileGameStore.open(directory);
  try {
    let attempts = 0;
    const source = rng();
    source.shuffle = (items) =>
      items.length === 50 ? (++attempts, defectiveDeal()) : [...items];
    const lifecycle = new GameLifecycleService(
      store,
      new PerGameCoordinator(),
      source,
      () => 'atomic',
    );
    const id = await lifecycle.create(5, 'competitive');
    const lobby = await store.loadGame(id);
    const ready = {
      ...lobby,
      ...durable({
        ...lobby.state,
        players: players(5),
        readyPlayerIds: players(5).map((p) => p.id),
      }),
    };
    await store.commitGame(ready, { revision: 0 });
    await assert.rejects(lifecycle.start(id), /SETUP_DEAL_EXHAUSTED/);
    assert.equal(attempts, 128);
    assert.deepEqual(await store.loadGame(id), ready);
    attempts = 0;
    source.shuffle = (items) =>
      items.length === 50 && ++attempts === 1 ? defectiveDeal() : [...items];
    await lifecycle.start(id);
    assert.equal((await store.loadGame(id)).state.status, 'SETUP');
    assert.equal(attempts, 3); // rejected deal, accepted deal, deck
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('durable lifecycle, restart, idempotency and simultaneous tabs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-restart-'));
  let store = await FileGameStore.open(directory);
  try {
    const coordinator = new PerGameCoordinator();
    const lifecycle = new GameLifecycleService(
      store,
      coordinator,
      rng(),
      randomUUID,
    );
    await assert.rejects(lifecycle.create(3, 'competitive'));
    await assert.rejects(lifecycle.create(4, 'unknown'));
    const id = await lifecycle.create(4, 'competitive');
    await assert.rejects(lifecycle.configure(id, 3));
    await lifecycle.configure(id, 5);
    assert.equal((await store.loadGame(id)).state.mode, 'competitive');
    const state = createClassicSetup(id, players(4), rng(), 'competitive');
    await store.commitGame(durable(state), { revision: 1 });
    const service = new GameService(store, coordinator);
    const actor = state.setup.currentPlayerId;
    const t = owned(state, actor)[0],
      c = TERRITORIES[t].continentId;
    const command = {
      type: 'COMMAND',
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      baseRevision: 0,
      command: { type: 'place_setup_armies', placements: { [t]: 3 } },
    };
    const same = await Promise.all([
      service.process(id, actor, command),
      service.process(id, actor, command),
    ]);
    assert.deepEqual(
      same.map((r) => r.kind),
      ['COMMITTED', 'DUPLICATE'],
    );
    const one = {
      ...command,
      commandId: randomUUID(),
      baseRevision: 1,
      command: { type: 'place_setup_armies', placements: { [t]: 1 } },
    };
    const race = await Promise.all([
      service.process(id, actor, one),
      service.process(id, actor, { ...one, commandId: randomUUID() }),
    ]);
    assert.deepEqual(
      race.map((r) => r.kind),
      ['COMMITTED', 'REJECTED'],
    );
    assert.equal(race[1].code, 'STALE_REVISION');
    const before = await store.loadGame(id);
    await store.close();
    store = await FileGameStore.open(directory);
    const after = await store.loadGame(id);
    assert.deepEqual(after, before);
    assert.equal(
      after.state.setup.additionalArmiesByPlayerContinent[actor][c],
      4,
    );
    const view = projectGameFor(after.state, after.revision, actor);
    assert.equal(view.mode, 'competitive');
    assert.ok(
      view.players.every((p) => !('cards' in p) && !('secretObjectiveId' in p)),
    );
    assert.ok(
      projectGameForAdmin(after.state, 2).players.every(
        (p) => !('secretObjectiveId' in p),
      ),
    );
    assert.equal(
      serverMessageSchema.safeParse({
        type: 'STATE',
        protocolVersion: PROTOCOL_VERSION,
        state: view,
      }).success,
      true,
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('HTTP rejects competitive counts, mode mutation, and returns mode in admin list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-api-'));
  const store = await FileGameStore.open(directory);
  const code = await new AuthenticationService(store).initializeAdmin();
  const server = buildServer({
    store,
    logger: false,
    publicOrigin: 'http://localhost:43219',
    rateLimitPolicies: { 'admin-login': { limit: 1000, windowMs: 60000 } },
  });
  try {
    const login = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'http://localhost:43219' },
      payload: { recoveryCode: code },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      origin: 'http://localhost:43219',
      cookie: (Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie']
        : [login.headers['set-cookie']]
      )
        .map((value) => value.split(';')[0])
        .join('; '),
    };
    for (const payload of [
      { mode: 'competitive', configuredPlayerCount: 2 },
      { mode: 'competitive', configuredPlayerCount: 3 },
      { mode: 'unknown', configuredPlayerCount: 4 },
    ]) {
      assert.equal(
        (
          await server.inject({
            method: 'POST',
            url: '/api/admin/games',
            headers,
            payload,
          })
        ).statusCode,
        400,
      );
    }
    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/games',
      headers,
      payload: { mode: 'competitive', configuredPlayerCount: 4 },
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().gameId;
    for (const payload of [
      { configuredPlayerCount: 3 },
      { configuredPlayerCount: 4, mode: 'classic' },
    ]) {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/admin/games/${id}`,
        headers,
        payload,
      });
      assert.equal(response.statusCode, payload.mode ? 400 : 409);
    }
    assert.equal((await store.loadGame(id)).state.mode, 'competitive');
    const listed = await server.inject({
      method: 'GET',
      url: '/api/admin/games',
      headers,
    });
    assert.equal(
      listed.json().games.find((game) => game.gameId === id).mode,
      'competitive',
    );
    for (const count of [5, 6])
      assert.equal(
        (
          await server.inject({
            method: 'POST',
            url: '/api/admin/games',
            headers,
            payload: { mode: 'competitive', configuredPlayerCount: count },
          })
        ).statusCode,
        201,
      );
    const classic = await server.inject({
      method: 'POST',
      url: '/api/admin/games',
      headers,
      payload: { configuredPlayerCount: 2 },
    });
    assert.equal(
      (await store.loadGame(classic.json().gameId)).state.mode,
      'classic',
    );
  } finally {
    await server.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('continent cap never limits ordinary reinforcement or exchanges', () => {
  const state = complete(
    createClassicSetup('ordinary', players(4), rng(), 'competitive'),
  ).state;
  const id = state.turn.playerId,
    territory = owned(state, id)[0];
  for (const phase of ['territory_reinforcement', 'ordinary_exchange']) {
    const active = {
      ...state,
      turn: {
        ...state.turn,
        phase,
        reinforcementArmiesRemaining: 7,
        round: {
          kind: 'normal',
          roundNumber: 1,
          pass: 'incorporation',
          orderPlayerIds: state.players.map((p) => p.id),
          actorIndex: state.players.findIndex((p) => p.id === id),
        },
      },
    };
    const result = applyCommand(active, {
      type: 'place_reinforcements',
      playerId: id,
      placements: { [territory]: 7 },
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.state.territories[territory].armies,
      state.territories[territory].armies + 7,
    );
  }
});

void test('Classic matches frozen ac2482b setup states and RNG trace', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/classic-ac2482b.json', import.meta.url),
      'utf8',
    ),
  );
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const hash = (value) =>
    createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  for (const baseline of fixture.games) {
    const source = rng(baseline.seed);
    let state = createClassicSetup(
      'classic-baseline',
      players(baseline.count),
      source,
    );
    const hashes = [];
    while (true) {
      const normalized = structuredClone(state);
      delete normalized.mode;
      delete normalized.definition;
      if (normalized.setup?.kind === 'card_deal_4_to_6') {
        normalized.setup.reinforcementRound =
          normalized.setup.reinforcementRound === 1 ? 5 : 3;
        delete normalized.setup.additionalArmiesByPlayerContinent;
      }
      hashes.push(hash(normalized));
      if (state.status === 'ACTIVE') break;
      state = place(state, allocation(state)).state;
    }
    assert.deepEqual(hashes, baseline.states);
    assert.equal(hash(source.calls), baseline.rngTrace);
  }
});
