import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createClassicSetup,
  assertClassicInvariants,
  PLAYER_COLORS,
} from '../packages/game-engine/dist/index.js';
import { dealInitialObjectives } from '../packages/game-engine/dist/reconquista/objectives.js';
import {
  newSetupJournal,
  loadSetupJournal,
} from '../packages/game-engine/dist/reconquista/session.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import { buildServer } from '../apps/server/dist/app.js';
import { registerReconquista } from '../apps/server/dist/reconquista/routes.js';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(
    join(root, 'apps/server/assets/reconquista/catalog.json'),
    'utf8',
  ),
);
/** Small deterministic generator, so each seed deals differently. */
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const shuffler = (seed) => {
  const random = seeded(seed);
  return {
    shuffle: (items) => {
      const list = [...items];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    },
    rollDie: () => Math.floor(random() * 6) + 1,
  };
};
const classicPlayers = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    seatIndex,
    nickname: `Jugador ${seatIndex + 1}`,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));

function auth(list) {
  return {
    ...emptyGameAuthState(),
    players: Object.fromEntries(
      list.map((p) => [
        p.id,
        {
          playerId: p.id,
          session: {
            verifier: { algorithm: 'sha256', digest: 'a'.repeat(64) },
            transportClass: 'HTTP',
            expiresAt: '2099-01-01T00:00:00.000Z',
            lastActiveAt: '2026-10-13T00:00:00.000Z',
          },
        },
      ]),
    ),
  };
}

void test('Classic occupation-only games deal no destruction objective', () => {
  let destructionWithoutOption = 0;
  for (const count of [4, 5, 6])
    for (let seed = 1; seed <= 40; seed++) {
      const players = classicPlayers(count);
      const only = createClassicSetup(
        randomUUID(),
        players,
        shuffler(seed),
        'classic',
        undefined,
        true,
      );
      assert.ok(
        only.players.every((p) => !p.secretObjectiveId.startsWith('destroy_')),
      );
      assertClassicInvariants({ ...only, classicOccupationOnly: true });
      const all = createClassicSetup(
        randomUUID(),
        players,
        shuffler(seed),
        'classic',
      );
      destructionWithoutOption += all.players.filter((p) =>
        p.secretObjectiveId.startsWith('destroy_'),
      ).length;
    }
  // Without the option the destruction cards are still dealt.
  assert.ok(destructionWithoutOption > 0);
});

void test('the Classic lobby keeps the option, starts with it and saves it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'occupation-only-'));
  const store = await FileGameStore.open(directory);
  try {
    const lifecycle = new GameLifecycleService(
      store,
      new PerGameCoordinator(),
      shuffler(7),
      randomUUID,
      () => 5_000,
    );
    const competitive = await lifecycle.create(4, 'competitive');
    await assert.rejects(
      lifecycle.configure(
        competitive,
        4,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    );
    const id = await lifecycle.create(4, 'classic');
    await lifecycle.configure(
      id,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    // Other lobby changes keep it.
    await lifecycle.configure(id, 5);
    await lifecycle.configure(id, 4, undefined, undefined, undefined, true);
    const lobby = await store.loadGame(id);
    assert.equal(lobby.state.classicOccupationOnly, true);
    const seated = classicPlayers(4);
    await store.commitGame(
      {
        ...lobby,
        state: {
          ...lobby.state,
          players: seated,
          readyPlayerIds: seated.map((p) => p.id),
        },
        auth: { ...auth(seated), generation: lobby.auth.generation + 1 },
        revision: lobby.revision + 1,
      },
      { authGeneration: lobby.auth.generation, revision: lobby.revision },
    );
    await lifecycle.start(id);
    const started = (await store.loadGame(id)).state;
    assert.equal(started.classicOccupationOnly, true);
    assert.ok(
      started.players.every((p) => !p.secretObjectiveId.startsWith('destroy_')),
    );
    assertClassicInvariants(started);
    const saved = await store.loadGame(id);
    assert.equal(
      decodeGame(encodeGame(saved)).game.state.classicOccupationOnly,
      true,
    );
    // Turning it off removes it.
    const free = await lifecycle.create(4, 'classic');
    await lifecycle.configure(
      free,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    await lifecycle.configure(
      free,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );
    assert.equal(
      (await store.loadGame(free)).state.classicOccupationOnly,
      undefined,
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Retake occupation-only deals leave every destruction card out', () => {
  const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
  const destruction = new Set(
    catalog.objectives.filter((o) => o.kind === 'destruction').map((o) => o.id),
  );
  for (let n = 2; n <= 6; n++)
    for (let seed = 1; seed <= 20; seed++) {
      const players = colors.slice(0, n).map((color, i) => ({
        id: `p${i}`,
        color,
      }));
      const deal = dealInitialObjectives(
        catalog,
        players,
        players.map((p) => p.id),
        seeded(seed),
        true,
      );
      for (const secret of deal.secrets)
        for (const objective of secret.objectives) {
          assert.ok(!destruction.has(objective.objectiveId));
          assert.equal(objective.targetPlayerId, undefined);
        }
      assert.ok(
        [...destruction].every((id) => deal.excludedObjectiveIds.includes(id)),
      );
    }
});

void test('a Retake journal replays its occupation-only deal', () => {
  const players = ['white', 'black', 'red', 'blue', 'yellow', 'green'].map(
    (color, i) => ({ id: randomUUID(), color, index: i }),
  );
  const seats = players.map(({ id, color }) => ({ id, color }));
  const started = newSetupJournal(catalog, seats, seeded(3), true);
  assert.equal(started.journal.occupationOnly, true);
  const replayed = loadSetupJournal(
    catalog,
    JSON.parse(JSON.stringify(started.journal)),
  );
  assert.equal(replayed.journal.occupationOnly, true);
  assert.deepEqual(replayed.state.objectives, started.state.objectives);
  // Without the option the journal carries nothing new, as before.
  const plain = newSetupJournal(catalog, seats, seeded(3));
  assert.equal('occupationOnly' in plain.journal, false);
  assert.throws(() =>
    loadSetupJournal(catalog, { ...plain.journal, occupationOnly: false }),
  );
});

void test('the Retake lobby keeps the option across a restart and deals with it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'occupation-only-rq-'));
  const open = async () => {
    const classicStore = await FileGameStore.open(join(directory, 'classic'));
    const app = buildServer({
      logger: false,
      store: classicStore,
      webRoot: join(root, 'apps/web/dist'),
      onClose: () => classicStore.close(),
    });
    const store = await registerReconquista(app, {
      dataDirectory: directory,
      classicStore,
      clockTicks: false,
    });
    await app.ready();
    return { app, store };
  };
  let { app, store } = await open();
  try {
    const { gameId } = await store.create(4);
    await store.configure(gameId, { occupationOnly: true, bots: 3 });
    await store.configure(gameId, { express: true });
    assert.equal((await store.load(gameId)).occupationOnly, true);
    await app.close();
    ({ app, store } = await open());
    assert.equal((await store.load(gameId)).occupationOnly, true);
    const { token } = await store.join(gameId, {
      nickname: 'Ana',
      color: 'white',
    });
    await store.ready(gameId, token);
    await store.start(gameId);
    const started = await store.load(gameId);
    assert.equal(started.journal.occupationOnly, true);
    const { state } = store.replay(started);
    const destruction = new Set(
      catalog.objectives
        .filter((o) => o.kind === 'destruction')
        .map((o) => o.id),
    );
    assert.ok(
      state.objectives.secrets.every((s) =>
        s.objectives.every((o) => !destruction.has(o.objectiveId)),
      ),
    );
    // Turning it off before starting removes it.
    const other = await store.create(4);
    await store.configure(other.gameId, { occupationOnly: true });
    await store.configure(other.gameId, { occupationOnly: false });
    assert.equal((await store.load(other.gameId)).occupationOnly, undefined);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
