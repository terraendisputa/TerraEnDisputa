import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildServer } from '../apps/server/dist/app.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { registerReconquista } from '../apps/server/dist/reconquista/routes.js';

const { WebSocket } = createRequire(
  join(import.meta.dirname, '../apps/server/package.json'),
)('ws');

const cookies = (response) =>
  response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

async function start(options = {}) {
  const origin = options.publicOrigin ?? 'http://127.0.0.1:3001';
  const directory = await mkdtemp(join(tmpdir(), 'ted-security-test-'));
  const store = await FileGameStore.open(directory);
  const code = await new AuthenticationService(store).initializeAdmin();
  const server = buildServer({
    logger: false,
    store,
    onClose: () => store.close(),
    ...options,
  });
  await registerReconquista(server, {
    dataDirectory: directory,
    classicStore: store,
  });
  await server.ready();
  const request = (method, url, payload, headers = {}) =>
    server.inject({
      method,
      url,
      headers: { host: '127.0.0.1:3001', origin, ...headers },
      ...(payload === undefined ? {} : { payload }),
    });
  const login = await request('POST', '/api/admin/login', {
    recoveryCode: code,
  });
  assert.equal(login.statusCode, 200, login.body);
  const admin = cookies(login);
  return {
    server,
    request,
    admin,
    async close() {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

void test('Requests addressed to a foreign name are refused (DNS rebinding)', async () => {
  const app = await start({ publicOrigin: 'https://ted.example.org' });
  try {
    for (const host of [
      '127.0.0.1:3001',
      'localhost:3001',
      '[::1]:3001',
      '192.168.0.20:3001',
      'casa.local:3001',
      'ted.example.org',
    ])
      assert.notEqual(
        (
          await app.request('GET', '/api/reconquista/board', undefined, {
            host,
          })
        ).statusCode,
        421,
        host,
      );
    for (const host of [
      'attacker.example.com:3001',
      'ted.example.org.evil.com',
    ]) {
      const refused = await app.request(
        'GET',
        '/api/reconquista/board',
        undefined,
        {
          host,
        },
      );
      assert.equal(refused.statusCode, 421, host);
      assert.equal(refused.json().code, 'HOST_NOT_ALLOWED');
    }
  } finally {
    await app.close();
  }
});

void test('A trusted proxy decides the names itself', async () => {
  const app = await start({ trustedProxy: '127.0.0.1' });
  try {
    const response = await app.request(
      'GET',
      '/api/reconquista/board',
      undefined,
      {
        host: 'juego.example.net',
      },
    );
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

void test('Nicknames are unique per game and carry no hidden characters, in Classic and Reconquista', async () => {
  const app = await start();
  try {
    const classic = await app.request(
      'POST',
      '/api/admin/games',
      { configuredPlayerCount: 3 },
      { cookie: app.admin },
    );
    assert.equal(classic.statusCode, 201, classic.body);
    const join = (nickname, color) =>
      app.request('POST', `/api/games/${classic.json().gameId}/join`, {
        nickname,
        color,
      });
    assert.equal((await join('Ana', 'blue')).statusCode, 201);
    const repeated = await join(' ana ', 'red');
    assert.equal(repeated.statusCode, 409, repeated.body);
    assert.equal(repeated.json().code, 'NICKNAME_ALREADY_IN_USE');
    for (const disguised of ['Ana\u200b', '\u202eanA', 'B\u0007', 'An\u2028a'])
      assert.equal((await join(disguised, 'red')).statusCode, 400, disguised);
    assert.equal(
      (await join('\u00c1n\u00e4 \u{1f642}', 'red')).statusCode,
      201,
    );

    const created = await app.request(
      'POST',
      '/api/reconquista/games',
      { playerCount: 3 },
      { cookie: app.admin },
    );
    assert.equal(created.statusCode, 200, created.body);
    const enter = (nickname, color) =>
      app.request(
        'POST',
        `/api/reconquista/games/${created.json().gameId}/join`,
        {
          nickname,
          color,
        },
      );
    assert.equal((await enter('Bruno', 'white')).statusCode, 200);
    const twin = await enter('BRUNO', 'black');
    assert.equal(twin.statusCode, 409);
    assert.equal(twin.json().code, 'NICKNAME_IN_USE');
    assert.equal((await enter('Bru\u200dno', 'black')).statusCode, 400);
  } finally {
    await app.close();
  }
});

void test('how-to-play pages are served and their home pages lead back to the game', async () => {
  const app = await start({
    webRoot: join(import.meta.dirname, '../apps/web/dist'),
  });
  try {
    for (const url of [
      '/como-jugar',
      '/como-jugar/',
      '/como-jugar/index.html',
      '/como-jugar/en',
      '/como-jugar/en/',
      '/como-jugar/en/index.html',
    ]) {
      const response = await app.request('GET', url);
      assert.equal(response.statusCode, 302, url);
      assert.equal(response.headers.location, '/', url);
    }
    for (const url of [
      '/como-jugar/wiki/',
      '/como-jugar/wiki/tutorial.html',
      '/como-jugar/en/wiki/',
      '/como-jugar/estilo.css',
    ])
      assert.equal((await app.request('GET', url)).statusCode, 200, url);
    for (const url of [
      '/como-jugar//example.com',
      '/como-jugar/../package.json',
    ])
      assert.equal((await app.request('GET', url)).statusCode, 404, url);
  } finally {
    await app.close();
  }
});

void test('console language follows the system locale', async () => {
  const { consoleLanguage } =
    await import('../apps/server/dist/console-language.js');
  assert.equal(consoleLanguage({ LANG: 'es_AR.UTF-8' }), 'es');
  assert.equal(consoleLanguage({ LC_ALL: 'es' }), 'es');
  assert.equal(consoleLanguage({ LANG: 'en_US.UTF-8' }), 'en');
  assert.equal(consoleLanguage({ LANG: 'C' }), 'en');
  assert.equal(consoleLanguage({ LANG: 'est_EE.UTF-8' }), 'en');
  assert.equal(consoleLanguage({ LC_ALL: 'en_GB', LANG: 'es_ES' }), 'en');
});

void test('The host can sign out, and the access code still signs in again', async () => {
  const app = await start();
  try {
    const forged = await app.request('POST', '/api/admin/logout', undefined, {
      cookie: app.admin,
      origin: 'http://evil.invalid',
    });
    assert.equal(forged.statusCode, 403);
    assert.equal(
      (
        await app.request('GET', '/api/admin/games', undefined, {
          cookie: app.admin,
        })
      ).statusCode,
      200,
    );
    const out = await app.request('POST', '/api/admin/logout', undefined, {
      cookie: app.admin,
    });
    assert.equal(out.statusCode, 204);
    assert.equal(out.cookies[0].value, '');
    for (const url of ['/api/admin/games', '/api/reconquista/games'])
      assert.equal(
        (await app.request('GET', url, undefined, { cookie: app.admin }))
          .statusCode,
        401,
        url,
      );
  } finally {
    await app.close();
  }
});

void test('Broken, oversized or foreign bodies are the client error in both servers', async () => {
  const app = await start();
  try {
    const created = await app.request(
      'POST',
      '/api/reconquista/games',
      { playerCount: 2 },
      { cookie: app.admin },
    );
    for (const url of [
      '/api/admin/login',
      `/api/reconquista/games/${created.json().gameId}/join`,
    ]) {
      const broken = await app.request('POST', url, '{"nickname":', {
        'content-type': 'application/json',
      });
      assert.equal(broken.statusCode, 400, url);
      const huge = await app.request(
        'POST',
        url,
        JSON.stringify({ nickname: 'a'.repeat(2_000_000) }),
        { 'content-type': 'application/json' },
      );
      assert.equal(huge.statusCode, 413, url);
      const form = await app.request('POST', url, 'nickname=a', {
        'content-type': 'application/x-www-form-urlencoded',
      });
      assert.equal(form.statusCode, 415, url);
    }
  } finally {
    await app.close();
  }
});

void test('Retake live connections close when their seat or their game goes away', async () => {
  const app = await start();
  try {
    const created = await app.request(
      'POST',
      '/api/reconquista/games',
      { playerCount: 3 },
      { cookie: app.admin },
    );
    const gameId = created.json().gameId;
    const seats = [];
    for (const [nickname, color] of [
      ['Ana', 'white'],
      ['Beto', 'black'],
    ]) {
      const joined = await app.request(
        'POST',
        `/api/reconquista/games/${gameId}/join`,
        { nickname, color },
      );
      seats.push({ id: joined.json().playerId, cookie: cookies(joined) });
    }
    const address = await app.server.listen({ host: '127.0.0.1', port: 0 });
    const listen = async (cookie) => {
      const socket = new WebSocket(
        `${address.replace('http', 'ws')}/api/reconquista/games/${gameId}/live`,
        { headers: { origin: address, cookie } },
      );
      socket.closed = new Promise((done) =>
        socket.on('close', (code, reason) => done(`${code} ${reason}`)),
      );
      await new Promise((done, fail) => {
        socket.on('open', done);
        socket.on('error', fail);
      });
      return socket;
    };
    const [ana, beto] = [
      await listen(seats[0].cookie),
      await listen(seats[1].cookie),
    ];
    const removed = await app.request(
      'DELETE',
      `/api/reconquista/games/${gameId}/players/${seats[1].id}`,
      undefined,
      { cookie: app.admin },
    );
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(await beto.closed, '1008 SESSION_REVOKED');
    assert.equal(ana.readyState, WebSocket.OPEN);
    const deleted = await app.request(
      'DELETE',
      `/api/reconquista/games/${gameId}`,
      undefined,
      { cookie: app.admin },
    );
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(await ana.closed, '1008 GAME_DELETED');
  } finally {
    await app.close();
  }
});
