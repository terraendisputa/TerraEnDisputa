import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const WebSocket = createRequire(
  new URL('../apps/server/package.json', import.meta.url),
)('ws');
import {
  CLASSIC_GAME_DEFINITION as classic,
  resolveGameDefinition,
  resolveGameRuntime,
  UnsupportedGameDefinitionError,
  TERRITORY_IDS,
} from '../packages/game-engine/dist/index.js';
import {
  PROTOCOL_VERSION,
  createGameBodySchema,
  updateGameConfigurationBodySchema,
  clientCommandSchema,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
import {
  decodeGame,
  encodeGame,
  UnsupportedSchemaError,
} from '../apps/server/dist/persistence/schema.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import {
  hashRecoveryCode,
  hashSessionToken,
  verifyRecoveryCode,
  verifySessionToken,
} from '../apps/server/dist/auth/crypto.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import {
  projectGameFor,
  projectGameForAdmin,
} from '../apps/server/dist/games/projection.js';
import { buildServer } from '../apps/server/dist/app.js';
import {
  boardPatch,
  gameId,
  id,
  normalRound,
  players,
  prepared,
  random,
  setup,
  step,
  withCards,
} from './classic-test-support.mjs';

const token = 'fixture-session-only-in-temporary-data';
const recoveryCode = '23456-ABCDE-FGHJK-LMNPQ-RSTUV';
const recovery = await hashRecoveryCode(recoveryCode);
const session = {
  verifier: hashSessionToken(token),
  transportClass: 'HTTP',
  expiresAt: '2099-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
};
function durable(state) {
  return encodeGame({
    state,
    revision: 42,
    recentCommands: [
      {
        commandId: id(99),
        fingerprint: 'legacy-fingerprint',
        committedRevision: 41,
      },
    ],
    auth: {
      authSchemaVersion: 1,
      generation: 17,
      players: Object.fromEntries(
        state.players.map((p, index) => [
          p.id,
          {
            playerId: p.id,
            session: {
              ...session,
              verifier: hashSessionToken(
                index === 0 ? token : `${token}-${index}`,
              ),
            },
            ...(index === 0 ? { recovery } : {}),
          },
        ]),
      ),
    },
  }).game;
}
function legacyEnvelope(game, version) {
  return downgrade(encodeGame(game), version);
}
function downgrade(envelope, version) {
  envelope.gameSchemaVersion = version;
  // Undo the fields added after schema 6: edition identity (12) and the
  // explicit mode and setup round indexes (7).
  const state = envelope.game.state;
  delete state.definition;
  delete state.mode;
  if (state.setup?.kind === 'card_deal_4_to_6') {
    state.setup.reinforcementRound =
      state.setup.reinforcementRound === 1 ? 5 : 3;
    delete state.setup.additionalArmiesByPlayerContinent;
  }
  return envelope;
}
function releasedSeats() {
  const game = durable(normalRound());
  game.state.players = game.state.players.map((p) =>
    [id(2), id(3)].includes(p.id)
      ? { ...p, controller: 'controllerless_reassignment' }
      : p,
  );
  game.auth.players[id(2)] = { playerId: id(2) };
  game.auth.players[id(3)] = {
    playerId: id(3),
    claim: { verifier: recovery, expiresAt: session.expiresAt },
  };
  return game;
}
function pending() {
  let s = withCards(
    boardPatch(prepared(), {
      alaska: { ownerId: id(1), armies: 5 },
      yukon: { ownerId: id(2), armies: 1 },
    }),
    id(1),
    ['spain', 'india'],
    3,
  );
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === id(1)
        ? {
            ...p,
            cards: p.cards.map((c) => ({ ...c, territoryBonusClaimed: true })),
          }
        : p,
    ),
  };
  s = step(s, {
    type: 'propose_pact',
    proposalId: id(90),
    recipientId: id(3),
    terms: { kind: 'general_non_aggression' },
    playerId: id(1),
  });
  s = step(s, {
    type: 'accept_pact',
    proposalId: id(90),
    pactId: id(91),
    playerId: id(3),
  });
  s = step(s, { type: 'withdraw_pact', pactId: id(91), playerId: id(1) });
  return step(
    s,
    { type: 'attack', from: 'alaska', to: 'yukon' },
    random([6, 6, 6, 1]),
  );
}
const badDefinitions = [
  undefined,
  null,
  {},
  { ...classic, editionId: 'reconquista' },
  { ...classic, boardId: 'reconquista' },
  { ...classic, rulesVersion: 2 },
  { ...classic, extra: true },
];
void test('Definition: solo la combinación clásica implementada; contrato no admite combinaciones inventadas', () => {
  assert.deepEqual(resolveGameDefinition({ ...classic }), classic);
  assert.equal(resolveGameRuntime(classic).board.territoryIds.length, 50);
  for (const definition of badDefinitions)
    assert.throws(
      () => resolveGameRuntime(definition),
      UnsupportedGameDefinitionError,
    );
  assert.ok(
    createGameBodySchema.safeParse({ configuredPlayerCount: 4 }).success,
  );
  assert.ok(
    createGameBodySchema.safeParse({
      configuredPlayerCount: 4,
      definition: classic,
    }).success,
  );
  for (const definition of badDefinitions.slice(1))
    assert.equal(
      createGameBodySchema.safeParse({ configuredPlayerCount: 4, definition })
        .success,
      false,
    );
  assert.equal(
    updateGameConfigurationBodySchema.safeParse({
      configuredPlayerCount: 4,
      definition: classic,
    }).success,
    false,
  );
});

for (const version of [5, 6]) {
  void test(`Schema ${version}: migración exacta en lobby, preparación, turno, traslado pendiente y final`, () => {
    let won = boardPatch(
      prepared(2),
      Object.fromEntries(
        TERRITORY_IDS.map((t) => [
          t,
          {
            ownerId: t === 'yukon' ? id(2) : id(1),
            armies: t === 'alaska' ? 5 : 1,
          },
        ]),
      ),
    );
    won = step(
      won,
      { type: 'attack', from: 'alaska', to: 'yukon' },
      random([6, 6, 6, 1]),
    );
    assert.equal(won.status, 'FINISHED');
    const lobby = {
      id: gameId,
      definition: classic,
      mode: 'classic',
      status: 'LOBBY',
      configuredPlayerCount: 4,
      players: [],
      readyPlayerIds: [],
    };
    for (const state of [
      lobby,
      setup(3),
      setup(6),
      normalRound(),
      pending(),
      won,
    ]) {
      const original = durable(state);
      const old = legacyEnvelope(original, version);
      const before = JSON.stringify(old);
      const decoded = decodeGame(old);
      assert.equal(decoded.gameSchemaVersion, 12);
      assert.equal(decoded.persistenceGeneration, old.persistenceGeneration);
      assert.deepEqual(decoded.game, original);
      assert.equal(
        JSON.stringify(old),
        before,
        'reader must not mutate its input',
      );
    }
    const released = releasedSeats();
    assert.deepEqual(
      decodeGame(legacyEnvelope(released, version)).game,
      released,
    );
  });
  void test(`Schema ${version}: carga real, continuación, deduplicación, reinicio y backup/restore`, async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), 'ted-reconquista-definition-test-'),
    );
    let store;
    try {
      const original = durable(pending());
      const data = join(temporary, 'data');
      store = await FileGameStore.open(data);
      await store.commitGame(original, { revision: null });
      const admin = { authSchemaVersion: 1, generation: 1, recovery, session };
      await store.commitAdminAuth(admin, null);
      await store.close();
      store = undefined;
      const filename = (await readdir(join(data, 'games'))).find(
        (n) => n.endsWith('.json') && n !== 'admin-auth.json',
      );
      const snapshot = join(data, 'games', filename);
      const old = JSON.parse(await readFile(snapshot, 'utf8'));
      downgrade(old, version);
      await writeFile(snapshot, JSON.stringify(old));
      store = await FileGameStore.open(data);
      assert.deepEqual(await store.loadGame(gameId), original);
      assert.equal((await store.discoverGames()).failures.length, 0);
      const service = new GameService(store);
      const command = {
        type: 'COMMAND',
        protocolVersion: PROTOCOL_VERSION,
        commandId: id(100),
        baseRevision: 42,
        command: { type: 'complete_conquest_transfer', armies: 1 },
      };
      const authorize = (game) =>
        verifySessionToken(token, game.auth.players[id(1)].session.verifier);
      const outcome = await service.process(gameId, id(1), command, authorize);
      assert.equal(outcome.kind, 'COMMITTED');
      assert.equal(outcome.revision, 43);
      const continued = outcome.durable;
      assert.equal(continued.state.pendingAction, undefined);
      assert.equal(continued.state.territories.yukon.armies, 1);
      assert.deepEqual(continued.auth, original.auth);
      assert.deepEqual(continued.state.players, original.state.players);
      assert.deepEqual(continued.state.pacts, original.state.pacts);
      assert.deepEqual(continued.state.cardDeck, original.state.cardDeck);
      assert.deepEqual(continued.recentCommands[0], original.recentCommands[0]);
      assert.equal(
        JSON.parse(await readFile(snapshot, 'utf8')).gameSchemaVersion,
        12,
      );
      await store.close();
      store = await FileGameStore.open(data);
      assert.deepEqual(await store.loadGame(gameId), continued);
      assert.equal(
        (
          await new GameService(store).process(
            gameId,
            id(1),
            command,
            authorize,
          )
        ).kind,
        'DUPLICATE',
      );
      assert.equal(
        (
          await new GameService(store).process(
            gameId,
            id(1),
            {
              ...command,
              command: { type: 'complete_conquest_transfer', armies: 2 },
            },
            authorize,
          )
        ).code,
        'COMMAND_ID_REUSED',
      );
      assert.equal(
        (
          await new GameService(store).process(
            gameId,
            id(1),
            { ...command, commandId: id(101) },
            authorize,
          )
        ).code,
        'STALE_REVISION',
      );
      assert.equal(
        (
          await new GameService(store).process(
            gameId,
            id(1),
            { ...command, commandId: id(102), baseRevision: 43 },
            () => false,
          )
        ).code,
        'UNAUTHORIZED',
      );
      const backup = join(temporary, 'backup.json');
      await store.createBackup(backup);
      await store.close();
      store = undefined;
      const restored = join(temporary, 'restored');
      await FileGameStore.restoreBackup(restored, backup);
      store = await FileGameStore.open(restored);
      const restoredGame = await store.loadGame(gameId);
      assert.deepEqual(restoredGame, continued);
      assert.deepEqual(await store.loadAdminAuth(), admin);
      assert.ok(
        verifySessionToken(
          token,
          restoredGame.auth.players[id(1)].session.verifier,
        ),
      );
      assert.ok(
        await verifyRecoveryCode(
          recoveryCode,
          restoredGame.auth.players[id(1)].recovery,
        ),
      );
      assert.equal(
        (
          await new GameService(store).process(
            gameId,
            id(1),
            command,
            authorize,
          )
        ).kind,
        'DUPLICATE',
      );
    } finally {
      if (store) await store.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });
  for (const backupVersion of [1, 2])
    void test(`Backup ${backupVersion} con schema ${version}: restaura clásico sin pérdida`, async () => {
      const temporary = await mkdtemp(
        join(tmpdir(), 'ted-reconquista-legacy-backup-'),
      );
      let store;
      try {
        const original = durable(normalRound());
        const path = join(temporary, 'old.json');
        await writeFile(
          path,
          JSON.stringify({
            format: 'ted-backup',
            manifest: {
              backupFormatVersion: backupVersion,
              serverVersion: '1.0.0',
              createdAt: '2026-01-01T00:00:00.000Z',
              gameCount: 1,
            },
            games: [legacyEnvelope(original, version)],
          }),
        );
        const restored = join(temporary, 'restored');
        await FileGameStore.restoreBackup(restored, path);
        store = await FileGameStore.open(restored);
        assert.deepEqual(await store.loadGame(gameId), original);
      } finally {
        if (store) await store.close();
        await rm(temporary, { recursive: true, force: true });
      }
    });
}

void test('Schema: versiones e identidades desconocidas fallan sin adivinar Classic', () => {
  const original = durable(prepared());
  for (const version of [1, 4])
    assert.throws(
      () => decodeGame({ ...encodeGame(original), gameSchemaVersion: version }),
      /no migration exists/,
    );
  for (const version of [13, 999])
    assert.throws(
      () => decodeGame({ ...encodeGame(original), gameSchemaVersion: version }),
      UnsupportedSchemaError,
    );
  for (const definition of badDefinitions) {
    const envelope = encodeGame(original);
    envelope.game.state.definition = definition;
    assert.throws(() => decodeGame(envelope), UnsupportedGameDefinitionError);
  }
  const old = legacyEnvelope(original, 5);
  // Pre-12 snapshots never carry a definition; one that does was written by a
  // Reconquista development build with its former independent numbering.
  for (const definition of [classic, { ...classic, rulesVersion: 2 }]) {
    old.game.state.definition = definition;
    assert.throws(() => decodeGame(old), UnsupportedSchemaError);
  }
  // Historical empty-auth input remains readable only through the legacy reader.
  const anonymous = legacyEnvelope(durable(setup(2)), 6);
  delete anonymous.game.auth;
  assert.deepEqual(decodeGame(anonymous).game.auth, {
    authSchemaVersion: 1,
    generation: 0,
    players: {},
  });
  const modern = encodeGame(original);
  delete modern.game.auth;
  assert.throws(() => decodeGame(modern));
});

void test('Projection: identidad pública; cartas, objetivos y credenciales conservan privacidad', () => {
  const game = durable(withCards(prepared(), id(1), ['spain'], 2));
  const first = projectGameFor(game.state, game.revision, id(1));
  const second = projectGameFor(game.state, game.revision, id(2));
  const admin = projectGameForAdmin(game.state, game.revision);
  for (const view of [first, second, admin]) {
    assert.deepEqual(view.definition, classic);
    assert.ok(
      view.players.every(
        (p) =>
          !('cards' in p) &&
          !('secretObjectiveId' in p) &&
          !('effectiveDestructionTargetPlayerId' in p),
      ),
    );
    assert.equal('auth' in view, false);
    assert.equal(JSON.stringify(view).includes(session.verifier.digest), false);
  }
  assert.equal(first.private.cards[0].cardId, 'spain');
  assert.equal(second.private.cards.length, 0);
  assert.equal(
    first.private.secretObjectiveId,
    game.state.players[0].secretObjectiveId,
  );
  assert.equal('private' in admin, false);
  assert.equal('cardDeck' in first, false);
  assert.equal(
    serverMessageSchema.safeParse({
      type: 'STATE',
      protocolVersion: PROTOCOL_VERSION,
      state: first,
    }).success,
    true,
  );
  assert.equal(
    serverMessageSchema.safeParse({
      type: 'STATE',
      protocolVersion: 7,
      state: first,
    }).success,
    false,
  );
  assert.equal(
    clientCommandSchema.safeParse({
      type: 'COMMAND',
      protocolVersion: 7,
      commandId: id(101),
      baseRevision: 42,
      command: { type: 'advance_phase' },
    }).success,
    false,
  );
  first.definition.editionId = 'modified';
  assert.equal(game.state.definition.editionId, 'classic');
  assert.throws(
    () =>
      projectGameForAdmin(
        { ...game.state, definition: { ...classic, editionId: 'reconquista' } },
        42,
      ),
    UnsupportedGameDefinitionError,
  );
});

void test('Command boundary: tablero por partida, autoridad y coordinación antes del commit', async () => {
  let game = durable(normalRound());
  let commits = 0;
  const store = {
    loadGame: () => Promise.resolve(game),
    commitGame: (candidate) => {
      game = candidate;
      commits++;
      return Promise.resolve({ outcome: 'COMMITTED' });
    },
  };
  const service = new GameService(store);
  const actor = game.state.turn.playerId;
  const command = {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: id(103),
    baseRevision: 42,
    command: {
      type: 'place_reinforcements',
      placements: { new_reconquista_country: 1 },
    },
  };
  assert.equal(
    (await service.process(gameId, actor, command)).code,
    'INVALID_TERRITORY',
  );
  assert.equal(commits, 0);
  const target = TERRITORY_IDS.find(
    (t) => game.state.territories[t].ownerId === actor,
  );
  const valid = {
    ...command,
    command: {
      type: 'place_reinforcements',
      placements: { [target]: game.state.turn.reinforcementArmiesRemaining },
    },
  };
  assert.equal(
    (await service.process(gameId, id(1), valid)).code,
    'NOT_YOUR_TURN',
  );
  const results = await Promise.all([
    service.process(gameId, actor, valid),
    service.process(gameId, actor, { ...valid, commandId: id(104) }),
  ]);
  assert.equal(results[0].kind, 'COMMITTED');
  assert.equal(results[1].code, 'STALE_REVISION');
  assert.equal(commits, 1);
  assert.equal(game.revision, 43);
});

void test('Unknown save: discovery clasifica incompatibilidad y no reemplaza el archivo', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-unknown-save-'),
  );
  let store;
  try {
    store = await FileGameStore.open(temporary);
    const game = durable(prepared());
    await store.commitGame(game, { revision: null });
    await store.close();
    store = undefined;
    const filename = (await readdir(join(temporary, 'games'))).find((n) =>
      n.endsWith('.json'),
    );
    const path = join(temporary, 'games', filename);
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    envelope.game.state.definition = { ...classic, rulesVersion: 999 };
    const contents = JSON.stringify(envelope);
    await writeFile(path, contents);
    store = await FileGameStore.open(temporary);
    const discovered = await store.discoverGames();
    assert.equal(discovered.games.size, 0);
    assert.equal(discovered.failures[0].code, 'UNSUPPORTED_SCHEMA');
    await assert.rejects(store.commitGame(game));
    assert.equal(await readFile(path, 'utf8'), contents);
  } finally {
    if (store) await store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('Lifecycle y HTTP: crea clásico, rechaza Reconquista/versiones, protocolo anterior cerrado', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ted-reconquista-http-test-'));
  const store = await FileGameStore.open(join(temporary, 'data'));
  const server = buildServer({ store, logger: false });
  try {
    const lifecycle = new GameLifecycleService(
      store,
      new PerGameCoordinator(),
      random(),
      () => gameId,
    );
    await assert.rejects(
      lifecycle.create(4, 'classic', { ...classic, editionId: 'reconquista' }),
      UnsupportedGameDefinitionError,
    );
    assert.equal((await store.discoverGames()).games.size, 0);
    const code = await new AuthenticationService(store).initializeAdmin();
    const login = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'http://localhost' },
      payload: { recoveryCode: code },
    });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = { origin: 'http://localhost', cookie };
    for (const definition of [
      { ...classic, editionId: 'reconquista' },
      { ...classic, boardId: 'reconquista' },
      { ...classic, rulesVersion: 2 },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/admin/games',
        headers,
        payload: { configuredPlayerCount: 4, definition },
      });
      assert.equal(response.statusCode, 400);
      assert.match(response.json().message, /supported definition/);
    }
    assert.equal((await store.discoverGames()).games.size, 0);
    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/games',
      headers,
      payload: { configuredPlayerCount: 4, definition: classic },
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdId = created.json().gameId;
    assert.deepEqual(
      (await store.loadGame(createdId)).state.definition,
      classic,
    );
    const lobby = (await store.loadGame(createdId)).state;
    const joined = durable({
      ...lobby,
      players: players(),
      readyPlayerIds: players().map((p) => p.id),
    });
    await store.commitGame(joined, { revision: 0 });
    const revision = await lifecycle.start(createdId);
    const started = await store.loadGame(createdId);
    assert.equal(revision, 43);
    assert.equal(started.state.status, 'SETUP');
    assert.deepEqual(started.state.definition, classic);
    assert.deepEqual(started.auth, joined.auth);
    assert.equal(started.state.cardDeck.drawPile.length, 50);
    const origin = await server.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(
      `${origin.replace('http:', 'ws:')}/api/games/${createdId}/live`,
      ['classic-v12'],
      { headers: { origin } },
    );
    const [closeCode, reason] = await once(ws, 'close');
    assert.equal(closeCode, 1008);
    assert.equal(reason.toString(), 'PROTOCOL_MISMATCH');
  } finally {
    await server.close();
    await store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
