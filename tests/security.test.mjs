import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../apps/server/dist/app.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { registerReconquista } from '../apps/server/dist/reconquista/routes.js';

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
