import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildServer } from '../apps/server/dist/app.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import {
  loadReconquistaAssets,
  registerReconquista,
} from '../apps/server/dist/reconquista/routes.js';
import { ReconquistaStore } from '../apps/server/dist/reconquista/store.js';
import { reconquistaViewSchema } from '../packages/protocol/dist/reconquista.js';
const root = resolve(import.meta.dirname, '..');
const { WebSocket } = createRequire(join(root, 'apps/server/package.json'))(
  'ws',
);
const prefix = '/api/reconquista';
const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
function random(seed = 1) {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
function cookies(response) {
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
async function start(directory, options = {}) {
  const classicStore = await FileGameStore.open(directory);
  const auth = new AuthenticationService(classicStore);
  const code = (await classicStore.loadAdminAuth())
    ? await auth.resetAdmin()
    : await auth.initializeAdmin();
  const server = buildServer({
    logger: false,
    store: classicStore,
    webRoot: join(root, 'apps/web/dist'),
    onClose: () => classicStore.close(),
  });
  await registerReconquista(server, {
    dataDirectory: directory,
    classicStore,
    ...options,
  });
  await server.ready();
  const request = (method, url, cookie = '', payload = undefined, extra = {}) =>
    server.inject({
      method,
      url,
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const login = await request('POST', '/api/admin/login', '', {
    recoveryCode: code,
  });
  assert.equal(login.statusCode, 200, login.body);
  return { server, request, classicStore, admin: cookies(login) };
}
async function lobby(app, n) {
  const created = await app.request('POST', prefix + '/games', app.admin, {
    playerCount: n,
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().gameId;
  const players = [];
  for (let i = 0; i < n; i++) {
    const joined = await app.request('POST', `${prefix}/games/${id}/join`, '', {
      nickname: `Jugador ${i}`,
      color: colors[i],
    });
    assert.equal(joined.statusCode, 200, joined.body);
    const player = { id: joined.json().playerId, cookie: cookies(joined) };
    players.push(player);
    const ready = await app.request(
      'POST',
      `${prefix}/games/${id}/ready`,
      player.cookie,
      {},
    );
    assert.equal(ready.statusCode, 200, ready.body);
  }
  const started = await app.request(
    'POST',
    `${prefix}/games/${id}/start`,
    app.admin,
    {},
  );
  assert.equal(started.statusCode, 200, started.body);
  return { id, players, view: reconquistaViewSchema.parse(started.json()) };
}
async function state(app, id, cookie) {
  const result = await app.request(
    'GET',
    `${prefix}/games/${id}/state`,
    cookie,
  );
  assert.equal(result.statusCode, 200, result.body);
  return reconquistaViewSchema.parse(result.json());
}
async function command(
  app,
  id,
  player,
  view,
  action,
  commandId = randomUUID(),
) {
  const payload = {
    protocolVersion: 4,
    commandId,
    revision: view.revision,
    action,
  };
  const result = await app.request(
    'POST',
    `${prefix}/games/${id}/commands`,
    player.cookie,
    payload,
  );
  assert.equal(result.statusCode, 200, result.body);
  return {
    state: reconquistaViewSchema.parse(result.json().state),
    payload,
    result,
  };
}
async function prepare(app, game) {
  let v = game.view;
  let first;
  while (v.stage === 'initial-placement' || v.stage === 'extra-placement') {
    const views = await Promise.all(
      game.players.map((p) => state(app, game.id, p.cookie)),
    );
    const index = views.findIndex((s) => s.self.legal.canPlace);
    assert(index >= 0);
    const p = game.players[index];
    const view = views[index];
    let destination = view.self.legal.placementCountryIds[0];
    if (!first) {
      const board = (await app.request('GET', prefix + '/board')).json();
      const catalog = JSON.parse(
        await readFile(
          join(root, 'apps/server/assets/reconquista/catalog.json'),
          'utf8',
        ),
      );
      destination =
        view.self.legal.placementCountryIds.find((id) =>
          catalog.connections.some(
            (e) =>
              e.endpoints.includes(id) &&
              e.endpoints.some(
                (t) =>
                  view.territories.find((c) => c.id === t).forces[0]
                    .playerId !== p.id,
              ),
          ),
        ) ?? destination;
      first = { id: p.id, destination };
      assert.equal(board.countries.length, 72);
    } else if (
      first.id === p.id &&
      view.self.legal.placementCountryIds.includes(first.destination)
    )
      destination = first.destination;
    v = (
      await command(app, game.id, p, view, {
        kind: v.stage === 'extra-placement' ? 'extra' : 'place',
        placements: { [destination]: view.self.legal.budget },
        conversions: {},
      })
    ).state;
  }
  if (v.stage === 'reveal-situation') {
    const actor = game.players.find((p) => p.id === v.circle[0]);
    v = (
      await command(
        app,
        game.id,
        actor,
        await state(app, game.id, actor.cookie),
        { kind: 'reveal' },
      )
    ).state;
  }
  while (v.stage === 'extra-placement') {
    const views = await Promise.all(
      game.players.map((p) => state(app, game.id, p.cookie)),
    );
    const index = views.findIndex((s) => s.self.legal.canPlace);
    const p = game.players[index],
      view = views[index];
    v = (
      await command(app, game.id, p, view, {
        kind: 'extra',
        placements: {
          [view.self.legal.placementCountryIds[0]]: view.self.legal.budget,
        },
        conversions: {},
      })
    ).state;
  }
  assert.equal(v.stage, 'first-hostility');
  return v;
}
void test('Application integration: 2–6 players create/join/ready/setup/activate, private DTOs and unchanged Classic public admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ted-reconquista-test-app-'));
  let app;
  try {
    app = await start(directory, { randomness: random() });
    assert.equal(
      (await app.request('POST', prefix + '/games', '', { playerCount: 4 }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.request(
          'POST',
          prefix + '/games',
          app.admin,
          { playerCount: 4 },
          { origin: 'http://evil.invalid' },
        )
      ).statusCode,
      403,
    );
    for (let n = 2; n <= 6; n++) {
      const game = await lobby(app, n);
      const after = await prepare(app, game);
      const observer = await state(app, game.id, app.admin);
      assert(!('self' in observer));
      assert(!JSON.stringify(observer).includes('objectiveId'));
      assert(!JSON.stringify(observer).includes('digest'));
      for (const p of game.players) {
        const own = await state(app, game.id, p.cookie);
        assert.equal(own.self.playerId, p.id);
        assert.equal(own.self.objectives.length, n === 2 ? 2 : 1);
        assert(!('journal' in own));
        assert(!('cycle' in own));
        assert(!('ranking' in own));
      }
      assert.equal(after.territories.length, 72);
      assert.equal(after.definition.editionId, 'reconquista');
      const unknown = await app.request(
        'GET',
        `${prefix}/games/${game.id}/state?actorId=${game.players[0].id}`,
      );
      assert.equal(unknown.statusCode, 401);
      const other = game.players.find((p) => p.id !== after.circle[0]);
      const rejected = await app.request(
        'POST',
        `${prefix}/games/${game.id}/commands`,
        other.cookie,
        {
          protocolVersion: 4,
          commandId: randomUUID(),
          revision: after.revision,
          action: { kind: 'reveal' },
        },
      );
      assert.equal(rejected.statusCode, 409);
    }
    const classic = await app.request('POST', '/api/admin/games', app.admin, {
      configuredPlayerCount: 4,
      definition: {
        editionId: 'reconquista',
        boardId: 'reconquista',
        rulesVersion: 1,
      },
    });
    assert.equal(classic.statusCode, 400);
    assert.equal((await app.classicStore.discoverGames()).games.size, 0);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
async function onTurn(app, game) {
  const actorId = (await state(app, game.id, game.players[0].cookie)).self.legal
    .actorId;
  return [
    game.players.find((p) => p.id === actorId),
    game.players.find((p) => p.id !== actorId),
  ];
}
void test('Selection shared by the player on turn reaches the others, stays out of the journal and accepts only real countries', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-focus-'),
  );
  let app;
  try {
    app = await start(directory, { randomness: random() });
    const game = await lobby(app, 2);
    const [a, b] = await onTurn(app, game);
    const focus = (cookie, payload) =>
      app.request('POST', `${prefix}/games/${game.id}/focus`, cookie, payload);
    assert.equal((await focus('', { originId: 'nigeria' })).statusCode, 401);
    const waiting = await focus(b.cookie, { originId: 'nigeria' });
    assert.equal(waiting.statusCode, 409);
    assert.equal(waiting.json().code, 'NOT_YOUR_TURN');
    assert.notEqual(
      (await focus(a.cookie, { originId: 'atlantida' })).statusCode,
      200,
    );
    const shared = await focus(a.cookie, {
      originId: 'nigeria',
      targetId: 'sahara',
    });
    assert.equal(shared.statusCode, 200, shared.body);
    const seen = await state(app, game.id, b.cookie);
    assert.deepEqual(seen.focus, {
      playerId: a.id,
      originId: 'nigeria',
      targetId: 'sahara',
    });
    assert.equal(seen.revision, game.view.revision);
    await focus(a.cookie, {});
    assert.deepEqual((await state(app, game.id, b.cookie)).focus, {
      playerId: a.id,
    });
    await app.server.close();
    app = await start(directory, { randomness: random() });
    assert.equal((await state(app, game.id, b.cookie)).focus, undefined);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('Real application attacks and mandatory transfer survive restart, exact retry and authenticated privacy', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-combat-'),
  );
  let app;
  try {
    let dice = null;
    const setupRandom = random(1);
    const randomness = () => (dice ? dice.shift() : setupRandom());
    app = await start(directory, { randomness });
    const game = await lobby(app, 2);
    await prepare(app, game);
    const observer = await state(app, game.id, app.admin);
    assert.equal(observer.situation.typeId, 'classic_combat');
    const actor = game.players.find((p) => p.id === observer.circle[0]);
    const view = await state(app, game.id, actor.cookie);
    const attack = view.self.legal.attacks.find(
      (a) =>
        view.territories.find((t) => t.id === a.targetId).forces[0].armies ===
        1,
    );
    assert(attack);
    dice = [0.99, 0.99, 0.99, 0];
    const attacked = await command(app, game.id, actor, view, {
      kind: 'attack',
      ...attack,
    });
    assert(attacked.state.hostility.pendingConquest);
    assert.equal(dice.length, 0);
    const snapshot = await readFile(
      join(directory, 'reconquista', game.id + '.json'),
      'utf8',
    );
    assert(!snapshot.includes(actor.cookie.split('=')[1]));
    await app.server.close();
    app = null;
    app = await start(directory, {
      randomness: () => {
        throw Error('Replay must not draw');
      },
    });
    const restored = await state(app, game.id, actor.cookie);
    assert.deepEqual(restored, attacked.state);
    const retry = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      attacked.payload,
    );
    assert.equal(retry.statusCode, 200, retry.body);
    assert(retry.json().duplicate);
    assert.equal(
      await readFile(join(directory, 'reconquista', game.id + '.json'), 'utf8'),
      snapshot,
    );
    const blocked = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      {
        ...attacked.payload,
        commandId: randomUUID(),
        revision: restored.revision,
      },
    );
    assert.equal(blocked.statusCode, 409);
    const transferred = await command(app, game.id, actor, restored, {
      kind: 'transfer',
      armies: 1,
    });
    assert.equal(transferred.state.hostility.pendingConquest, null);
    assert.equal(
      transferred.state.territories.find((t) => t.id === attack.targetId)
        .forces[0].armies,
      1,
    );
    const duplicate = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      transferred.payload,
    );
    assert(duplicate.json().duplicate);
    const old = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      { ...attacked.payload, commandId: randomUUID() },
    );
    assert.equal(old.statusCode, 409);
    const incompatible = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      { ...transferred.payload, protocolVersion: 9 },
    );
    assert.equal(incompatible.statusCode, 400);
    const hidden = await state(app, game.id, app.admin);
    assert(!hidden.self);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('Reconquista persistence never confirms failed writes; indeterminate writes block until validated restart; incompatible files remain intact', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-fault-'),
  );
  let app;
  try {
    let faultPoint = null;
    const writeOptions = {
      fault: (point) => {
        if (point === faultPoint) throw Error('Injected Reconquista failure');
      },
    };
    app = await start(directory, { randomness: random(), writeOptions });
    const game = await lobby(app, 2);
    const first = game.players.find((p) => p.id === game.view.circle[0]);
    const before = await state(app, game.id, first.cookie);
    const country = before.self.legal.placementCountryIds[0];
    const payload = {
      protocolVersion: 4,
      commandId: randomUUID(),
      revision: before.revision,
      action: { kind: 'place', placements: { [country]: 18 }, conversions: {} },
    };
    const path = join(directory, 'reconquista', game.id + '.json');
    const saved = await readFile(path, 'utf8');
    faultPoint = 'before-temporary-write';
    const failed = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      first.cookie,
      payload,
    );
    assert.equal(failed.statusCode, 503);
    assert.equal(await readFile(path, 'utf8'), saved);
    assert.equal(
      (await state(app, game.id, first.cookie)).revision,
      before.revision,
    );
    faultPoint = 'after-current-installed';
    const uncertain = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      first.cookie,
      payload,
    );
    assert.equal(uncertain.statusCode, 503);
    assert.notEqual(await readFile(path, 'utf8'), saved);
    const unavailable = await app.request(
      'GET',
      `${prefix}/games/${game.id}/state`,
      first.cookie,
    );
    assert.equal(unavailable.statusCode, 503);
    await app.server.close();
    app = null;
    app = await start(directory);
    const retry = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      first.cookie,
      payload,
    );
    assert.equal(retry.statusCode, 200, retry.body);
    assert(retry.json().duplicate);
    await app.server.close();
    app = null;
    const corrupt = JSON.parse(await readFile(path, 'utf8'));
    corrupt.schemaVersion = 999;
    const text = JSON.stringify(corrupt);
    await writeFile(path, text);
    app = await start(directory);
    const unsupported = await app.request(
      'GET',
      `${prefix}/games/${game.id}/state`,
      first.cookie,
    );
    assert.equal(unsupported.statusCode, 503, unsupported.body);
    const mutation = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      first.cookie,
      payload,
    );
    assert.equal(mutation.statusCode, 503);
    assert.equal(await readFile(path, 'utf8'), text);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Concurrent reads expose only the committed generation, and simultaneous commands cannot spend the same placement twice', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-concurrent-'),
  );
  let app;
  try {
    let suspend = false,
      installedResolve,
      releaseResolve;
    const installed = new Promise((resolve) => {
      installedResolve = resolve;
    });
    const release = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    const writeOptions = {
      fault: async (point) => {
        if (suspend && point === 'after-current-installed') {
          installedResolve();
          await release;
        }
      },
    };
    app = await start(directory, { randomness: random(), writeOptions });
    const game = await lobby(app, 2);
    const actor = game.players.find((p) => p.id === game.view.circle[0]);
    const before = await state(app, game.id, actor.cookie);
    const payload = {
      protocolVersion: 4,
      commandId: randomUUID(),
      revision: before.revision,
      action: {
        kind: 'place',
        placements: { [before.self.legal.placementCountryIds[0]]: 18 },
        conversions: {},
      },
    };
    suspend = true;
    const first = app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      payload,
    );
    await installed;
    const during = await state(app, game.id, actor.cookie);
    assert.deepEqual(during, before);
    const raced = app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      { ...payload, commandId: randomUUID() },
    );
    suspend = false;
    releaseResolve();
    assert.equal((await first).statusCode, 200);
    assert.equal((await raced).statusCode, 409);
    const after = await state(app, game.id, actor.cookie);
    assert.equal(after.revision, before.revision + 1);
    const replay = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      payload,
    );
    assert(replay.json().duplicate);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Reconquista games open at /game/:id and the live connection announces every change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ted-reconquista-test-live-'));
  let app;
  try {
    app = await start(directory, { randomness: random() });
    const game = await lobby(app, 2);
    const page = await app.request('GET', `/game/${game.id}`);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<div id="root">/);
    for (const url of [
      '/_development/reconquista',
      `/_development/reconquista/${game.id}`,
      '/api/development/reconquista/board',
    ])
      assert.equal((await app.request('GET', url)).statusCode, 404, url);
    const [actor] = await onTurn(app, game);
    const address = await app.server.listen({ host: '127.0.0.1', port: 0 });
    const socketUrl = `${address.replace('http', 'ws')}${prefix}/games/${game.id}/live`;
    const closed = (headers) =>
      new Promise((done) =>
        new WebSocket(socketUrl, { headers }).on('close', (code, reason) =>
          done(`${code} ${reason}`),
        ),
      );
    assert.equal(
      await closed({ origin: 'http://evil.invalid', cookie: actor.cookie }),
      '1008 UNAUTHORIZED',
    );
    // Without a seat or the host session nobody listens.
    assert.equal(await closed({ origin: address }), '1008 UNAUTHORIZED');
    const socket = new WebSocket(socketUrl, {
      headers: { origin: address, cookie: actor.cookie },
    });
    await new Promise((done, fail) => {
      socket.on('open', done);
      socket.on('error', fail);
    });
    const messages = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data))));
    const before = await state(app, game.id, actor.cookie);
    // A burst of selections is announced once.
    for (const originId of ['nigeria', 'sahara', 'nigeria']) {
      const focus = await app.request(
        'POST',
        `${prefix}/games/${game.id}/focus`,
        actor.cookie,
        { originId },
      );
      assert.equal(focus.statusCode, 200);
    }
    for (let i = 0; i < 50 && messages.length === 0; i++)
      await new Promise((done) => setTimeout(done, 10));
    await new Promise((done) => setTimeout(done, 200));
    assert.deepEqual(messages, [{ type: 'CHANGED' }]);
    // A notice carries nothing private: the view still comes from the player's own request.
    assert.equal(
      (await state(app, game.id, actor.cookie)).revision,
      before.revision,
    );
    // One seat may keep only a few tabs listening; the host listens too.
    const extra = [];
    for (let i = 0; i < 3; i++) {
      const tab = new WebSocket(socketUrl, {
        headers: { origin: address, cookie: actor.cookie },
      });
      await new Promise((done) => tab.on('open', done));
      extra.push(tab);
    }
    assert.equal(
      await closed({ origin: address, cookie: actor.cookie }),
      '1008 TOO_MANY_CONNECTIONS',
    );
    const host = new WebSocket(socketUrl, {
      headers: { origin: address, cookie: app.admin },
    });
    await new Promise((done) => host.on('open', done));
    for (const tab of [socket, host, ...extra]) tab.close();
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Backup and restore carry Reconquista games with Classic, and keep the previous ones aside', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-backup-'),
  );
  const restored = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-restored-'),
  );
  let app;
  try {
    app = await start(directory, { randomness: random() });
    const game = await lobby(app, 2);
    const before = await state(app, game.id, game.players[0].cookie);
    await app.server.close();
    app = null;
    const { catalog } = await loadReconquistaAssets();
    const classicStore = await FileGameStore.open(directory);
    const store = await ReconquistaStore.open(
      join(directory, 'reconquista'),
      catalog,
    );
    const backup = join(directory, '..', `${randomUUID()}-backup.json`);
    try {
      const manifest = await classicStore.createBackup(
        backup,
        await store.snapshot(),
      );
      assert.equal(manifest.reconquistaGameCount, 1);
    } finally {
      await store.close();
      await classicStore.close();
    }
    const written = JSON.parse(await readFile(backup, 'utf8'));
    assert.equal(written.manifest.backupFormatVersion, 3);
    assert.equal(written.reconquista[0].gameId, game.id);
    const stage = (target, games) =>
      ReconquistaStore.stage(target, catalog, games);
    // Restoring over existing data keeps the previous Reconquista games in the preserved folder.
    app = await start(restored);
    await lobby(app, 3);
    await app.server.close();
    app = null;
    const preserved = await FileGameStore.restoreBackup(restored, backup, {
      reconquista: stage,
    });
    assert.match(
      await readFile(
        join(preserved, 'reconquista', 'reconquista.marker'),
        'utf8',
      ),
      /reconquista-store-1/,
    );
    app = await start(restored);
    const after = await state(app, game.id, game.players[0].cookie);
    assert.deepEqual(after, before);
    const listed = await app.request('GET', prefix + '/games', app.admin);
    assert.deepEqual(
      listed.json().games.map((g) => g.gameId),
      [game.id],
    );
    await app.server.close();
    app = null;
    // A damaged Reconquista game stops the restore before anything is replaced.
    written.reconquista[0].revision += 1;
    await writeFile(backup, JSON.stringify(written));
    await assert.rejects(
      FileGameStore.restoreBackup(restored, backup, { reconquista: stage }),
    );
    app = await start(restored);
    assert.deepEqual(await state(app, game.id, game.players[0].cookie), before);
    await rm(backup, { force: true });
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
    await rm(restored, { recursive: true, force: true });
  }
});

void test('Saved Reconquista games reject foreign identity, hybrid fields, corrupt sessions and inconsistent history without changing their files', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-reject-'),
  );
  let app;
  try {
    app = await start(directory, { randomness: random() });
    const game = await lobby(app, 2);
    const file = join(directory, 'reconquista', game.id + '.json');
    const valid = JSON.parse(await readFile(file, 'utf8'));
    await app.server.close();
    app = null;
    for (const change of [
      (e) => (e.definition.editionId = 'classic'),
      (e) => (e.scope = 'public'),
      (e) => (e.gameId = randomUUID()),
      (e) => (e.gameSchemaVersion = 8),
      (e) => (e.players[0].session.digest = 'unknown'),
      (e) => e.baseRevision--,
      (e) => (e.journal.catalogContract = 'different'),
    ]) {
      const broken = structuredClone(valid);
      change(broken);
      const contents = JSON.stringify(broken);
      await writeFile(file, contents);
      app = await start(directory);
      const response = await app.request(
        'GET',
        `${prefix}/games/${game.id}/state`,
        game.players[0].cookie,
      );
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(await readFile(file, 'utf8'), contents);
      await app.server.close();
      app = null;
    }
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Real HTTP: no missiles before full turns', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-missile-'),
  );
  let app;
  try {
    app = await start(directory, { randomness: random(1) });
    const game = await lobby(app, 2);
    const views = await Promise.all(
      game.players.map((p) => state(app, game.id, p.cookie)),
    );
    const index = views.findIndex((s) => s.self.legal.canPlace);
    const player = game.players[index];
    const destination = views[index].self.legal.placementCountryIds[0];
    const rejected = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      player.cookie,
      {
        protocolVersion: 4,
        revision: views[index].revision,
        commandId: randomUUID(),
        action: {
          kind: 'place',
          placements: { [destination]: 18 },
          conversions: { [destination]: 1 },
        },
      },
    );
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.deepEqual(await state(app, game.id, player.cookie), views[index]);
    await prepare(app, game);
    const actor = game.players.find((p) => p.id === game.view.circle[0]);
    const v = await state(app, game.id, actor.cookie);
    assert.equal(v.stage, 'first-hostility');
    assert(v.territories.every((t) => t.forces.every((f) => f.missiles === 0)));
    assert.deepEqual(v.self.legal.missileShots, []);
    assert.deepEqual(v.self.legal.missileRegroups, []);
    const own = v.territories.find((t) => t.forces[0].playerId === actor.id);
    const fire = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      {
        protocolVersion: 4,
        revision: v.revision,
        commandId: randomUUID(),
        action: { kind: 'fire-missile', originId: own.id, targetId: own.id },
      },
    );
    assert.equal(fire.statusCode, 409, fire.body);
    assert.equal(
      (await state(app, game.id, actor.cookie)).revision,
      v.revision,
    );
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Stage4 full HTTP game: turns, live card deck, mandatory occupation, ordinary incorporation, victory and restart without leaking hands', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-campaign-'),
  );
  let app;
  const { combatDice } =
    await import('../packages/game-engine/dist/reconquista/round.js');
  const { isExchange } =
    await import('../packages/game-engine/dist/reconquista/cards.js');
  const { loadSetupJournal } =
    await import('../packages/game-engine/dist/reconquista/session.js');
  const catalog = JSON.parse(
    await readFile(
      join(root, 'apps/server/assets/reconquista/catalog.json'),
      'utf8',
    ),
  );
  const countries = catalog.territories;
  let dice = null;
  const rng = random(1);
  try {
    app = await start(directory, {
      randomness: () => (dice ? dice.shift() : rng()),
    });
    const game = await lobby(app, 2);
    await prepare(app, game);
    const first = game.players.find((p) => p.id === game.view.circle[0]);
    let result = await command(
      app,
      game.id,
      first,
      await state(app, game.id, first.cookie),
      { kind: 'start-campaign' },
    );
    assert.equal(result.state.stage, 'campaign');
    assert.equal(result.state.campaign.round, 1);
    assert(result.state.self.campaign);
    assert.equal(result.state.self.campaign.hand.length, 0);
    let v = result.state,
      last = result;
    let commands = 0,
      captures = 0,
      exchanges = 0,
      rounds = new Set();
    while (v.campaign.phase !== 'finished' && commands++ < 450) {
      const c = v.campaign;
      rounds.add(c.round);
      const player = game.players.find(
        (p) => p.id === (c.occupation?.arrivals[0]?.playerId ?? c.actorId),
      );
      v = await state(app, game.id, player.cookie);
      const legal = v.self.campaign.legal;
      let action;
      if (c.occupation) {
        action = {
          kind: 'occupy',
          armies: Math.min(3, legal.occupation.arrivals[0].maximum),
        };
        captures++;
      } else if (c.phase === 'incorporation') {
        const privateCards = v.self.campaign.hand;
        const continentIds = c.players.find(
          (p) => p.playerId === player.id,
        ).continentIds;
        let exchange = null;
        if (legal.canExchange) {
          for (
            let mask = 1;
            mask < 1 << (privateCards.length + continentIds.length);
            mask++
          ) {
            const selected = privateCards.filter((_, i) => mask & (1 << i));
            const continents = continentIds.filter(
              (_, i) => mask & (1 << (privateCards.length + i)),
            );
            if (isExchange(selected, continents)) {
              exchange = {
                kind: 'exchange',
                cardIds: selected.map((c) => c.id),
                continentIds: continents,
              };
              break;
            }
          }
        }
        if (exchange) {
          action = exchange;
          exchanges++;
        } else {
          const ids = legal.placementCountryIds;
          const frontier =
            ids.find((id) =>
              catalog.connections.some(
                (e) =>
                  e.endpoints.includes(id) &&
                  e.endpoints.some((other) =>
                    v.territories
                      .find((t) => t.id === other)
                      .forces.some((f) => f.playerId !== player.id),
                  ),
              ),
            ) ?? ids[0];
          const continentPlacements = {};
          for (const [id, n] of Object.entries(legal.continentBudgets)) {
            const country = ids.find(
              (t) => countries.find((c) => c.id === t).continentId === id,
            );
            assert(country, 'continent has a legal destination');
            continentPlacements[id] = { [country]: n };
          }
          action = {
            kind: 'reinforce',
            placements: legal.freeBudget
              ? { [frontier]: legal.freeBudget }
              : {},
            conversions: {},
            continentPlacements,
          };
        }
      } else if (c.phase === 'attack') {
        const attack =
          player.id === first.id
            ? legal.attacks.toSorted((a, b) => {
                const amount = (id) =>
                  v.territories.find((t) => t.id === id).forces[0].armies;
                return (
                  amount(a.targetId) - amount(b.targetId) ||
                  amount(b.originId) - amount(a.originId)
                );
              })[0]
            : null;
        if (attack) {
          const af = v.territories
            .find((t) => t.id === attack.originId)
            .forces.find((f) => f.playerId === player.id);
          const df = v.territories
            .find((t) => t.id === attack.targetId)
            .forces.find((f) => f.playerId === attack.defenderId);
          const counts = combatDice(af.armies, df.armies, v.situation.typeId);
          dice = [
            ...Array(counts.attack).fill(0.99),
            ...Array(counts.defense).fill(0),
          ];
          action = { kind: 'attack-country', ...attack };
        } else action = { kind: 'finish-regroup' };
      } else if (c.phase === 'regroup') action = { kind: 'finish-regroup' };
      else if (c.phase === 'closing') {
        if (legal.canClaimCountry) action = { kind: 'claim-country' };
        else if (legal.bonusCardIds.length)
          action = { kind: 'claim-bonus', cardId: legal.bonusCardIds[0] };
        else if (legal.continentIds.length)
          action = {
            kind: 'claim-continent',
            continentId: legal.continentIds[0],
          };
        else action = { kind: 'finish-turn', confirmForfeit: true };
      } else throw Error('Unexpected phase ' + c.phase);
      last = await command(app, game.id, player, v, {
        kind: 'campaign',
        action,
      });
      v = last.state;
      if (dice) {
        assert.equal(dice.length, 0);
        dice = null;
      }
      const observer = await state(app, game.id, app.admin);
      assert(!observer.self);
      assert(!('hands' in observer.campaign));
      assert(!JSON.stringify(observer).includes('bonusUsed'));
      if (captures === 1 && c.occupation) {
        const duplicated = await app.request(
          'POST',
          `${prefix}/games/${game.id}/commands`,
          player.cookie,
          last.payload,
        );
        assert(duplicated.json().duplicate);
        assert.deepEqual(duplicated.json().state, v);
      }
    }
    assert.equal(
      v.campaign.phase,
      'finished',
      `Game must reach victory, commands=${commands}`,
    );
    assert(v.campaign.winners.includes(first.id));
    assert(captures >= 1);
    assert(rounds.size >= 2);
    const saved = JSON.parse(
      await readFile(join(directory, 'reconquista', game.id + '.json'), 'utf8'),
    );
    const loaded = loadSetupJournal(catalog, saved.journal);
    assert.deepEqual(loaded.state.campaign.winners, v.campaign.winners);
    assert.equal(
      loaded.state.campaign.cards.drawPile.length +
        loaded.state.campaign.cards.discards.length +
        Object.values(loaded.state.campaign.cards.hands).flat().length,
      73,
    );
    await app.server.close();
    app = null;
    app = await start(directory);
    const after = await state(app, game.id, first.cookie);
    assert.equal(after.campaign.phase, 'finished');
    assert.deepEqual(after.campaign.winners, v.campaign.winners);
    const actor = game.players.find(
      (p) => p.cookie && p.id === loaded.journal.commands.at(-1).actorId,
    );
    const duplicate = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      actor.cookie,
      last.payload,
    );
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert(duplicate.json().duplicate);
    const forbidden = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      first.cookie,
      {
        protocolVersion: 4,
        commandId: randomUUID(),
        revision: after.revision,
        action: { kind: 'campaign', action: { kind: 'finish-regroup' } },
      },
    );
    assert.equal(forbidden.statusCode, 409);
    assert(exchanges >= 0);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Stage4 real HTTP alliance: out-of-turn acceptance, zero-army shared occupation checkpoint, private restart and allied regroup', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-alliance-'),
  );
  const catalog = JSON.parse(
    await readFile(
      join(root, 'apps/server/assets/reconquista/catalog.json'),
      'utf8',
    ),
  );
  let app,
    dice = null;
  const rng = random(1);
  try {
    app = await start(directory, {
      randomness: () => (dice ? dice.shift() : rng()),
    });
    const game = await lobby(app, 3);
    const leader = game.players.find((p) => p.id === game.view.circle[0]);
    const owner = (id) =>
      game.view.territories.find((t) => t.id === id).forces[0].playerId;
    let route;
    for (const target of game.view.territories) {
      if (owner(target.id) === leader.id) continue;
      const neighbors = catalog.connections
        .filter((e) => e.endpoints.includes(target.id))
        .map((e) => e.endpoints.find((id) => id !== target.id));
      const originId = neighbors.find((id) => owner(id) === leader.id);
      const allyOriginId = neighbors.find(
        (id) => owner(id) !== leader.id && owner(id) !== owner(target.id),
      );
      if (originId && allyOriginId) {
        route = {
          originId,
          allyOriginId,
          targetId: target.id,
          allyId: owner(allyOriginId),
          defenderId: owner(target.id),
        };
        break;
      }
    }
    assert(route);
    const ally = game.players.find((p) => p.id === route.allyId);
    let v = game.view;
    while (v.stage === 'initial-placement') {
      const views = await Promise.all(
        game.players.map((p) => state(app, game.id, p.cookie)),
      );
      const index = views.findIndex((v) => v.self.legal.canPlace);
      const p = game.players[index],
        current = views[index];
      const destination =
        p.id === leader.id
          ? route.originId
          : p.id === ally.id
            ? route.allyOriginId
            : current.self.legal.placementCountryIds.find(
                (id) => id !== route.targetId,
              );
      v = (
        await command(app, game.id, p, current, {
          kind: 'place',
          placements: { [destination]: current.self.legal.budget },
          conversions: {},
        })
      ).state;
    }
    // The last initial placement reveals the first situation by itself.
    assert.equal(v.situation.typeId, 'classic_combat');
    v = (await command(app, game.id, leader, v, { kind: 'start-campaign' }))
      .state;
    let result = await command(app, game.id, leader, v, {
      kind: 'campaign',
      action: {
        kind: 'propose-alliance',
        allyId: ally.id,
        originId: route.originId,
        allyOriginId: route.allyOriginId,
        targetId: route.targetId,
      },
    });
    v = result.state;
    const allianceId = v.campaign.alliances[0].id;
    const allyView = await state(app, game.id, ally.cookie);
    assert.equal(allyView.campaign.alliances[0].status, 'proposed');
    await command(app, game.id, ally, allyView, {
      kind: 'campaign',
      action: { kind: 'respond-alliance', allianceId, accept: true },
    });
    v = (
      await command(
        app,
        game.id,
        leader,
        await state(app, game.id, leader.cookie),
        { kind: 'campaign', action: { kind: 'start-alliance', allianceId } },
      )
    ).state;
    dice = [0.99, 0.99, 0.99, 0];
    result = await command(app, game.id, leader, v, {
      kind: 'campaign',
      action: {
        kind: 'attack-country',
        originId: route.originId,
        targetId: route.targetId,
        defenderId: route.defenderId,
      },
    });
    v = result.state;
    assert.equal(dice.length, 0);
    dice = null;
    assert(v.campaign.occupation.joint);
    assert.equal(
      v.territories
        .find((t) => t.id === route.targetId)
        .forces.filter((f) => f.armies === 0).length,
      2,
    );
    const hidden = await state(app, game.id, app.admin);
    assert(!hidden.self);
    assert(!('hand' in hidden.campaign));
    await app.server.close();
    app = null;
    app = await start(directory);
    const duplicate = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      leader.cookie,
      result.payload,
    );
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert(duplicate.json().duplicate);
    v = await state(app, game.id, leader.cookie);
    v = (
      await command(app, game.id, leader, v, {
        kind: 'campaign',
        action: { kind: 'occupy', armies: 2 },
      })
    ).state;
    assert.equal(v.campaign.occupation.arrivals[0].playerId, ally.id);
    const illegal = await app.request(
      'POST',
      `${prefix}/games/${game.id}/commands`,
      leader.cookie,
      {
        protocolVersion: 4,
        commandId: randomUUID(),
        revision: v.revision,
        action: { kind: 'campaign', action: { kind: 'occupy', armies: 1 } },
      },
    );
    assert.equal(illegal.statusCode, 409);
    v = (
      await command(
        app,
        game.id,
        ally,
        await state(app, game.id, ally.cookie),
        { kind: 'campaign', action: { kind: 'occupy', armies: 2 } },
      )
    ).state;
    assert.equal(
      v.territories.find((t) => t.id === route.targetId).ownership.kind,
      'shared',
    );
    v = (
      await command(
        app,
        game.id,
        leader,
        await state(app, game.id, leader.cookie),
        { kind: 'campaign', action: { kind: 'finish-regroup' } },
      )
    ).state;
    assert.equal(v.campaign.phase, 'ally-regroup');
    result = await command(
      app,
      game.id,
      ally,
      await state(app, game.id, ally.cookie),
      {
        kind: 'campaign',
        action: {
          kind: 'regroup-forces',
          originId: route.allyOriginId,
          targetId: route.targetId,
          armies: 1,
          missiles: 0,
        },
      },
    );
    v = result.state;
    const force = v.territories
      .find((t) => t.id === route.targetId)
      .forces.find((f) => f.playerId === ally.id);
    assert.equal(force.armies, 3);
    await app.server.close();
    app = null;
    app = await start(directory);
    const restored = await state(app, game.id, ally.cookie);
    assert.deepEqual(restored.campaign, v.campaign);
    assert.deepEqual(restored.self.campaign, v.self.campaign);
    v = (
      await command(app, game.id, ally, restored, {
        kind: 'campaign',
        action: { kind: 'finish-ally-regroup' },
      })
    ).state;
    assert.equal(v.campaign.phase, 'ally-closing');
    v = (
      await command(app, game.id, ally, v, {
        kind: 'campaign',
        action: { kind: 'finish-ally-regroup' },
      })
    ).state;
    assert.equal(v.campaign.phase, 'closing');
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('Host changes the required players before start, never below those seated, and starts with them', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-configure-'),
  );
  let app;
  try {
    app = await start(directory, { randomness: random() });
    const created = await app.request('POST', prefix + '/games', app.admin, {
      playerCount: 4,
    });
    const id = created.json().gameId;
    const configure = (cookie, playerCount) =>
      app.request('PATCH', `${prefix}/games/${id}`, cookie, { playerCount });
    assert.equal((await configure('', 3)).statusCode, 401);
    for (let i = 0; i < 2; i++) {
      const joined = await app.request(
        'POST',
        `${prefix}/games/${id}/join`,
        '',
        {
          nickname: `Jugador ${i}`,
          color: colors[i],
        },
      );
      const ready = await app.request(
        'POST',
        `${prefix}/games/${id}/ready`,
        cookies(joined),
        {},
      );
      assert.equal(ready.statusCode, 200, ready.body);
    }
    assert.equal(
      (await app.request('POST', `${prefix}/games/${id}/start`, app.admin, {}))
        .statusCode,
      409,
    );
    assert.equal((await configure(app.admin, 7)).statusCode, 400);
    assert.equal((await configure(app.admin, 1)).statusCode, 400);
    const entry = async () =>
      (await app.request('GET', `${prefix}/games/${id}/entry`)).json();
    assert.equal((await configure(app.admin, 6)).statusCode, 200);
    assert.equal((await entry()).playerCount, 6);
    assert.equal((await configure(app.admin, 2)).statusCode, 200);
    assert.equal((await entry()).playerCount, 2);
    const started = await app.request(
      'POST',
      `${prefix}/games/${id}/start`,
      app.admin,
      {},
    );
    assert.equal(started.statusCode, 200, started.body);
    assert.equal((await configure(app.admin, 3)).statusCode, 409);
    // The started game survives a reload from disk.
    await app.server.close();
    app = await start(directory, { randomness: random() });
    assert.equal((await entry()).stage, 'started');
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('Reconquista limits how often a seat sends commands and reads its view', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ted-reconquista-test-limits-'),
  );
  let app;
  const { DEFAULT_RATE_LIMIT_POLICIES } =
    await import('../apps/server/dist/security/rate-limiter.js');
  try {
    app = await start(directory, {
      randomness: random(),
      rateLimitPolicies: {
        ...DEFAULT_RATE_LIMIT_POLICIES,
        'game-command': {
          windowMs: 60_000,
          source: 2,
          target: 100,
          global: 100,
        },
        'game-read': { windowMs: 60_000, source: 3, target: 100, global: 100 },
      },
    });
    const game = await lobby(app, 2);
    const [actor, other] = game.players;
    const read = (cookie) =>
      app.request('GET', `${prefix}/games/${game.id}/state`, cookie);
    for (let i = 0; i < 3; i++)
      assert.equal((await read(actor.cookie)).statusCode, 200);
    const limited = await read(actor.cookie);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().code, 'RATE_LIMITED');
    // Each seat has its own allowance.
    assert.equal((await read(other.cookie)).statusCode, 200);
    const focus = () =>
      app.request('POST', `${prefix}/games/${game.id}/focus`, actor.cookie, {});
    await focus();
    await focus();
    assert.equal((await focus()).statusCode, 429);
  } finally {
    if (app) await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
