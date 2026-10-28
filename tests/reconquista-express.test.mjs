import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import {
  newSetupJournal,
  loadSetupJournal,
  commitLoadedSetupCommand,
} from '../packages/game-engine/dist/reconquista/session.js';
import { campaignLegal } from '../packages/game-engine/dist/reconquista/campaign.js';
import {
  reconquistaActivationKey,
  reconquistaActor,
  reconquistaDeclines,
  reconquistaTimeoutMove,
} from '../packages/game-engine/dist/reconquista/express.js';
import { buildServer } from '../apps/server/dist/app.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { registerReconquista } from '../apps/server/dist/reconquista/routes.js';
import {
  RECONQUISTA_PROTOCOL,
  reconquistaViewSchema,
} from '../packages/protocol/dist/reconquista.js';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(
    join(root, 'apps/server/assets/reconquista/catalog.json'),
    'utf8',
  ),
);
const board = preparationBoard(catalog);
const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
function rng(seed = 7) {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
let ids = 0;
const commit = (loaded, actorId, action, random) =>
  commitLoadedSetupCommand(
    catalog,
    loaded,
    actorId,
    `c${++ids}`,
    loaded.revision,
    action,
    random,
  );

/** Timeouts mixed with random attacks, so occupations and turns of every kind expire. */
function play(n, seed, rounds) {
  const random = rng(seed);
  const players = colors
    .slice(0, n)
    .map((color, i) => ({ id: `p${i}`, color }));
  let loaded = newSetupJournal(catalog, players, random);
  for (let step = 0; step < 20000; step++) {
    const c = loaded.state.campaign;
    if (c && (c.round > rounds || c.phase === 'finished')) break;
    const actor = reconquistaActor(board, loaded.state);
    assert(actor, 'an unfinished game waits for someone');
    if (c && c.phase === 'attack' && !c.pending && !c.activeAllianceId) {
      const attacks = campaignLegal(board, c, actor).attacks;
      if (attacks.length && random() < 0.6) {
        const route = attacks[Math.floor(random() * attacks.length)];
        loaded = commit(
          loaded,
          actor,
          { kind: 'campaign', action: { kind: 'attack-country', ...route } },
          random,
        );
        continue;
      }
    }
    const before = reconquistaActivationKey(loaded.state);
    let moves = 0;
    while (reconquistaActivationKey(loaded.state) === before) {
      const move = reconquistaTimeoutMove(board, loaded.state, random);
      assert(move, `timeout has a move at ${before}`);
      loaded = commit(loaded, move.actorId, move.action, random);
      assert(++moves < 500, 'timeout ends its activation');
    }
  }
  return loaded;
}

void test('timeouts finish every kind of activation and replay from the journal', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const played = play(n, 11 + n, 5);
    assert(played.state.campaign, `${n} players reach full turns`);
    const replayed = loadSetupJournal(catalog, played.journal);
    assert.deepEqual(replayed.state, played.state);
  }
});

void test('the time limit finishes by countries, then armies, exchanges and cards', () => {
  const played = play(3, 5, 2);
  const random = rng(3);
  const finished = commit(played, 'clock', { kind: 'time-limit' }, random);
  const c = finished.state.campaign;
  assert.equal(c.phase, 'finished');
  assert.equal(c.timeLimit, true);
  const metrics = (id) => {
    const owned = c.territories.filter((t) =>
      t.forces.some((f) => f.playerId === id),
    );
    return [
      owned.length,
      owned.reduce(
        (sum, t) => sum + t.forces.find((f) => f.playerId === id).armies,
        0,
      ),
      c.cards.exchanges[id] ?? 0,
      c.cards.hands[id].length,
    ];
  };
  const ranked = c.players
    .map((p) => ({ id: p.id, m: metrics(p.id) }))
    .sort((a, b) => {
      for (let i = 0; i < 4; i++) if (a.m[i] !== b.m[i]) return b.m[i] - a.m[i];
      return 0;
    });
  const tie = ranked[0].m.every((v, i) => v === ranked[1].m[i]);
  assert.deepEqual(c.winners, tie ? [] : [ranked[0].id]);
  assert.deepEqual(
    loadSetupJournal(catalog, finished.journal).state,
    finished.state,
  );
  assert.throws(() =>
    commit(finished, 'clock', { kind: 'time-limit' }, random),
  );
});

void test('an absent seat rejects the pacts it was offered', () => {
  const random = rng(4);
  let played = play(3, 9, 1);
  const c = played.state.campaign;
  const actor = c.order[c.turnIndex];
  const other = c.order.find((id) => id !== actor);
  assert.deepEqual(reconquistaDeclines(played.state, other), []);
  played = commit(
    played,
    actor,
    {
      kind: 'campaign',
      action: {
        kind: 'propose-pact',
        partnerId: other,
        pactKind: 'world',
        countryIds: [],
        continentIds: [],
      },
    },
    random,
  );
  const [decline] = reconquistaDeclines(played.state, other);
  assert.equal(decline.action.kind, 'respond-pact');
  assert.equal(decline.action.accept, false);
  played = commit(played, other, decline, random);
  assert.equal(
    played.state.campaign.pacts.filter((p) => p.status === 'proposed').length,
    0,
  );
});

async function server(directory) {
  const classicStore = await FileGameStore.open(directory);
  const auth = new AuthenticationService(classicStore);
  const code = await auth.initializeAdmin();
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
  const request = (method, url, cookie = '', payload = undefined) =>
    app.inject({
      method,
      url,
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        ...(cookie ? { cookie } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const login = await request('POST', '/api/admin/login', '', {
    recoveryCode: code,
  });
  const cookie = (r) => r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { app, store, request, admin: cookie(login), cookie };
}

void test('an Express game runs its clock: timeouts, disconnection, absence and pause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reconquista-express-'));
  const s = await server(directory);
  try {
    const prefix = '/api/reconquista';
    const created = await s.request('POST', prefix + '/games', s.admin, {
      playerCount: 2,
    });
    const id = created.json().gameId;
    const configured = await s.request(
      'PATCH',
      `${prefix}/games/${id}`,
      s.admin,
      { express: true },
    );
    assert.equal(configured.statusCode, 200, configured.body);
    const players = [];
    for (let i = 0; i < 2; i++) {
      const joined = await s.request('POST', `${prefix}/games/${id}/join`, '', {
        nickname: `Jugador ${i}`,
        color: colors[i],
      });
      players.push({ id: joined.json().playerId, cookie: s.cookie(joined) });
      await s.request(
        'POST',
        `${prefix}/games/${id}/ready`,
        players[i].cookie,
        {},
      );
    }
    const entry = await s.request('GET', `${prefix}/games/${id}/entry`);
    assert.equal(entry.json().express, true);
    const started = await s.request(
      'POST',
      `${prefix}/games/${id}/start`,
      s.admin,
      {},
    );
    assert.equal(started.statusCode, 200, started.body);
    const view = async () =>
      reconquistaViewSchema.parse(
        (
          await s.request(
            'GET',
            `${prefix}/games/${id}/state?observer=1`,
            s.admin,
          )
        ).json(),
      );
    let now = Date.now();
    const online = () => true;
    assert.equal(await s.store.tick(id, now, online), true);
    let v = await view();
    assert.equal(v.express, true);
    assert.equal(v.clock.activationRemainingMs, 120_000);
    assert.equal(v.clock.durationMs, 40 * 60_000);
    const revision = v.revision;
    // The placement time runs out: armies are spread and the next player starts.
    now += 121_000;
    assert.equal(await s.store.tick(id, now, online), true);
    v = await view();
    assert(v.revision > revision);
    assert.equal(v.clock.activationRemainingMs, 120_000);
    // A disconnected player gets five minutes, then the rest of the turn.
    now += 1_000;
    assert.equal(await s.store.tick(id, now, () => false), true);
    v = await view();
    assert.equal(v.clock.pauseReason, 'disconnection');
    const waiting = v.clock.disconnectedPlayerId;
    now += 300_000;
    await s.store.tick(id, now, () => false);
    v = await view();
    assert.equal(v.clock.pauseReason, undefined);
    now += 121_000;
    await s.store.tick(id, now, () => false);
    v = await view();
    assert(v.clock.absentPlayerIds.includes(waiting));
    // A bot plays the absent seat until the person comes back.
    assert.equal(v.players.find((p) => p.id === waiting).bot, 'absent');
    // The host pauses: commands wait and the clock stops.
    const paused = await s.request(
      'POST',
      `${prefix}/games/${id}/pause`,
      s.admin,
      {
        paused: true,
      },
    );
    assert.equal(paused.statusCode, 200, paused.body);
    const before = await view();
    now += 600_000;
    assert.equal(await s.store.tick(id, now, online), false);
    assert.equal((await view()).revision, before.revision);
    await s.request('POST', `${prefix}/games/${id}/pause`, s.admin, {
      paused: false,
    });
    // A returning player takes the seat back.
    now += 1_000;
    await s.store.tick(id, now, online);
    v = await view();
    assert.equal(v.clock.pauseReason, undefined);
    assert.equal(v.players.find((p) => p.id === waiting).bot, undefined);
  } finally {
    await s.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('bots take table seats, play seats the host gives them and free their seat in Express', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reconquista-bots-'));
  const s = await server(directory);
  try {
    const prefix = '/api/reconquista';
    const id = (
      await s.request('POST', prefix + '/games', s.admin, { playerCount: 3 })
    ).json().gameId;
    const patch = (body) =>
      s.request('PATCH', `${prefix}/games/${id}`, s.admin, body);
    assert.equal((await patch({ bots: 3 })).statusCode, 409);
    assert.equal((await patch({ bots: 2, express: true })).statusCode, 200);
    const joined = await s.request('POST', `${prefix}/games/${id}/join`, '', {
      nickname: 'Ana',
      color: 'red',
    });
    const human = { id: joined.json().playerId, cookie: s.cookie(joined) };
    const late = await s.request('POST', `${prefix}/games/${id}/join`, '', {
      nickname: 'Beto',
      color: 'blue',
    });
    assert.equal(late.statusCode, 409);
    await s.request('POST', `${prefix}/games/${id}/ready`, human.cookie, {});
    const started = await s.request(
      'POST',
      `${prefix}/games/${id}/start`,
      s.admin,
      {},
    );
    assert.equal(started.statusCode, 200, started.body);
    let entry = (await s.request('GET', `${prefix}/games/${id}/entry`)).json();
    const table = entry.players.filter((p) => p.bot === 'table');
    assert.equal(table.length, 2);
    assert.equal(new Set(entry.players.map((p) => p.color)).size, 3);
    assert(table.every((p) => /^Bot /.test(p.nickname)));
    assert.equal(entry.botLevel, 'hard');
    // The host puts a bot in the person's seat: the whole table plays alone.
    const bots = (body) =>
      s.request('POST', `${prefix}/games/${id}/bots`, s.admin, body);
    assert.equal(
      (await bots({ playerId: human.id, enabled: true })).statusCode,
      200,
    );
    assert.equal((await bots({ level: 'normal' })).statusCode, 200);
    const view = async () =>
      reconquistaViewSchema.parse(
        (
          await s.request(
            'GET',
            `${prefix}/games/${id}/state?observer=1`,
            s.admin,
          )
        ).json(),
      );
    const before = (await view()).revision;
    let now = Date.now();
    for (let i = 0; i < 200; i++) {
      now += 2_001;
      await s.store.tick(id, now, (p) => p === human.id);
    }
    const v = await view();
    assert(v.revision > before + 100, `bots moved ${v.revision - before}`);
    assert(v.campaign, 'bots reach full turns');
    // A seat a bot plays takes no commands from its person.
    const refused = await s.request(
      'POST',
      `${prefix}/games/${id}/commands`,
      human.cookie,
      {
        protocolVersion: RECONQUISTA_PROTOCOL,
        commandId: '00000000-0000-4000-8000-000000000001',
        revision: v.revision,
        action: { kind: 'reveal' },
      },
    );
    assert.equal(refused.json().code, 'BOT_CONTROLLED');
    // Express frees a table bot's seat for a person with the link.
    assert.equal(
      (await bots({ playerId: table[0].id, enabled: false })).statusCode,
      200,
    );
    entry = (await s.request('GET', `${prefix}/games/${id}/entry`)).json();
    assert(entry.players.find((p) => p.id === table[0].id).free);
    const taken = await s.request(
      'POST',
      `${prefix}/games/${id}/take-seat`,
      '',
      { playerId: table[0].id, nickname: 'Carla' },
    );
    assert.equal(taken.statusCode, 200, taken.body);
    entry = (await s.request('GET', `${prefix}/games/${id}/entry`)).json();
    const seat = entry.players.find((p) => p.id === table[0].id);
    assert.equal(seat.nickname, 'Carla');
    assert.equal(seat.free, undefined);
    const again = await s.request(
      'POST',
      `${prefix}/games/${id}/take-seat`,
      '',
      { playerId: table[0].id, nickname: 'Dani' },
    );
    assert.equal(again.json().code, 'SEAT_TAKEN');
  } finally {
    await s.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
