import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../packages/protocol/dist/index.js';

const root = resolve(import.meta.dirname, '..');
const WebSocket = createRequire(join(root, 'apps/server/package.json'))('ws');
const children = new Set();
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const target = `${process.platform === 'win32' ? 'windows' : 'linux'}-x64`;
const directoryName = `ted-${manifest.version}-${target}`;
const releaseRoot = join(root, 'release');
const archiveName = `${directoryName}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
const archive = join(releaseRoot, archiveName);
const temporary = await mkdtemp(join(tmpdir(), 'ted-packaged-smoke-'));
const application = join(temporary, directoryName);
const data = join(temporary, 'durable-data');

const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
const checksums = await readFile(join(releaseRoot, 'SHA256SUMS'), 'utf8');
if (checksums !== `${digest}  ${archiveName}\n`)
  throw new Error('SHA256SUMS does not match the release archive');
const releaseManifest = JSON.parse(
  await readFile(join(releaseRoot, `manifest-${target}.json`), 'utf8'),
);
if (
  releaseManifest.version !== manifest.version ||
  releaseManifest.platform !== target.split('-')[0] ||
  releaseManifest.architecture !== 'x64' ||
  releaseManifest.artifact !== archiveName ||
  releaseManifest.sha256 !== digest
)
  throw new Error('Release manifest does not match the release archive');

execFileSync(
  'tar',
  process.platform === 'win32'
    ? ['-xf', archive, '-C', temporary]
    : ['-xzf', archive, '-C', temporary],
);
for (const required of [
  'LICENSE',
  'THIRD_PARTY_LICENSES',
  'README.txt',
  'SELF_HOSTING.md',
  'INSTALLING.md',
  'UPDATING.md',
  'app/server.mjs',
  'app/assets/reconquista/catalog.json',
  'web/index.html',
  process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/node',
  process.platform === 'win32' ? 'ted.cmd' : 'ted',
])
  await stat(join(application, required)).catch(() => {
    throw new Error(`Release archive is missing ${required}`);
  });

const reservePort = async () =>
  new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string')
        return reject(new Error('No port'));
      socket.close(() => resolvePort(address.port));
    });
  });
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;

const launch = (dataDirectory = data) => {
  const command =
    process.platform === 'win32'
      ? join(application, 'runtime', 'node.exe')
      : join(application, 'ted');
  const prefix =
    process.platform === 'win32'
      ? [join(application, 'app', 'server.mjs')]
      : [];
  const child = spawn(
    command,
    [
      ...prefix,
      '--bind',
      '127.0.0.1',
      '--port',
      String(port),
      '--data-dir',
      dataDirectory,
      '--no-open',
    ],
    {
      cwd: temporary,
      env: {
        ...process.env,
        PATH: process.platform === 'win32' ? process.env.PATH : '',
        ...(process.platform === 'win32'
          ? { GAME_WEB_ROOT: join(application, 'web') }
          : {}),
      },
    },
  );
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
};
const runPackaged = (arguments_) => {
  const command =
    process.platform === 'win32'
      ? join(application, 'runtime', 'node.exe')
      : join(application, 'ted');
  const prefix =
    process.platform === 'win32'
      ? [join(application, 'app', 'server.mjs')]
      : [];
  return execFileSync(command, [...prefix, ...arguments_], {
    cwd: temporary,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: process.platform === 'win32' ? process.env.PATH : '',
      ...(process.platform === 'win32'
        ? { GAME_WEB_ROOT: join(application, 'web') }
        : {}),
    },
  });
};
const waitForStart = async (child, recoveryExpected) => {
  let output = '';
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  let lastFailure = 'no response';
  // Slow hosts (small VPS) can need well over five seconds after listening.
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Packaged server exited: ${output}`);
    const ready = await fetch(`${origin}/health`)
      .then((response) => {
        if (!response.ok) lastFailure = `HTTP ${response.status}`;
        return response.ok;
      })
      .catch((error) => {
        lastFailure = String(error?.cause?.code ?? error?.message ?? error);
        return false;
      });
    if (ready) {
      const recovery =
        /(?:Administrator access code|Código de acceso del administrador): ([A-Z0-9-]+)/.exec(
          output,
        )?.[1];
      if (recoveryExpected && !recovery)
        throw new Error(`Missing first-run recovery code: ${output}`);
      return recovery;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(
    `Packaged server did not answer /health (${lastFailure}): ${output}`,
  );
};
const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Packaged server did not stop')),
      10_000,
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null)
        reject(new Error(`Packaged server exited ${code}`));
      else resolveExit();
    });
  });
};

async function markReady(gameId, cookie) {
  await new Promise((resolveReady, rejectReady) => {
    const socket = new WebSocket(
      `${origin.replace('http:', 'ws:')}/api/games/${gameId}/live`,
      `classic-v${PROTOCOL_VERSION}`,
      { headers: { origin, cookie } },
    );
    const commandId = randomUUID();
    let submitted = false;
    const finish = (error) => {
      clearTimeout(timeout);
      socket.terminate();
      if (error)
        rejectReady(error instanceof Error ? error : new Error(String(error)));
      else resolveReady();
    };
    const timeout = setTimeout(
      () => finish(new Error('Player ready timed out')),
      10_000,
    );
    socket.on('error', finish);
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'STATE' && !submitted) {
        submitted = true;
        socket.send(
          JSON.stringify({
            type: 'COMMAND',
            protocolVersion: PROTOCOL_VERSION,
            commandId,
            baseRevision: message.state.revision,
            command: { type: 'set_ready', ready: true },
          }),
        );
      }
      if (message.commandId === commandId) {
        if (message.type === 'COMMAND_RESULT') finish();
        else if (message.type === 'COMMAND_REJECTED')
          finish(new Error(`Ready rejected: ${message.code}`));
      }
    });
  });
}
async function reconquista(path, cookie, body) {
  const response = await fetch(`${origin}/api/reconquista${path}`, {
    ...(body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body) }),
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  if (!response.ok)
    throw new Error(`Reconquista ${path} failed: ${response.status}`);
  return response;
}
async function verifyReconquista(table) {
  for (const cookie of table.playerCookies) {
    const view = await (
      await reconquista(`/games/${table.gameId}/state`, cookie)
    ).json();
    if (view.stage !== 'initial-placement' || !view.self)
      throw new Error('Reconquista game did not survive');
  }
}
async function verifyTable(table) {
  for (const cookie of table.playerCookies) {
    const response = await fetch(`${origin}/api/games/${table.gameId}/state`, {
      headers: { origin, cookie },
    });
    if (!response.ok) throw new Error(`${table.mode} session did not survive`);
    const { state } = await response.json();
    if (state.mode !== table.mode || state.status !== 'SETUP')
      throw new Error(`${table.mode} preparation did not survive`);
  }
}

try {
  if (
    runPackaged(['--version']).trim() !== `Terra en disputa ${manifest.version}`
  )
    throw new Error('Packaged --version does not match package.json');
  let child = launch();
  const recoveryCode = await waitForStart(child, true);
  const shell = await fetch(`${origin}/admin`);
  const html = await shell.text();
  if (
    !shell.ok ||
    !html.includes('<div id="root"></div>') ||
    !html.includes('<title>Terra en disputa</title>')
  )
    throw new Error('Packaged browser shell or public identity was not served');
  const stylesheet = html.match(/href="([^" ]+\.css)"/);
  if (!stylesheet) throw new Error('Packaged stylesheet reference is missing');
  const cssResponse = await fetch(new URL(stylesheet[1], origin));
  if (!cssResponse.ok) throw new Error('Packaged stylesheet could not load');
  const css = await cssResponse.text();
  const image = css.match(
    /url\(["']?(?:\/assets\/)?(landing-atlas[^)"']+)["']?\)/,
  );
  if (!image) throw new Error('Packaged landing artwork reference is missing');
  const artwork = await fetch(new URL(`/assets/${image[1]}`, origin));
  if (!artwork.ok) throw new Error('Packaged landing artwork could not load');
  const bytes = new Uint8Array(await artwork.arrayBuffer());
  const tag = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (tag(0, 4) !== 'RIFF' || tag(8, 12) !== 'WEBP')
    throw new Error('Packaged landing artwork is not a WebP image');
  const login = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ recoveryCode }),
  });
  if (!login.ok)
    throw new Error(`Packaged admin login failed: ${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('ted_admin_session_http='))
    throw new Error('Administrator cookie does not use the TED namespace');
  const tables = [];
  for (const [mode, count] of [
    ['classic', 2],
    ['competitive', 4],
  ]) {
    const created = await fetch(`${origin}/api/admin/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      body: JSON.stringify({ configuredPlayerCount: count, mode }),
    });
    if (created.status !== 201) throw new Error(`Cannot create ${mode}`);
    const { gameId } = await created.json();
    const playerCookies = [];
    for (const color of ['blue', 'red', 'black', 'yellow'].slice(0, count)) {
      const joined = await fetch(`${origin}/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ nickname: `TED ${color}`, color }),
      });
      if (joined.status !== 201) throw new Error(`Cannot join ${mode}`);
      const playerCookie = joined.headers.get('set-cookie')?.split(';')[0];
      if (!playerCookie?.startsWith('ted_player_'))
        throw new Error('Missing TED player cookie');
      await markReady(gameId, playerCookie);
      playerCookies.push(playerCookie);
    }
    const started = await fetch(`${origin}/api/admin/games/${gameId}/start`, {
      method: 'POST',
      headers: { origin, cookie },
    });
    if (!started.ok) throw new Error(`Cannot start ${mode}`);
    tables.push({ gameId, mode, playerCookies });
    await verifyTable(tables.at(-1));
  }
  // Reconquista: board, map art, a two-player game started from the host session.
  const board = await (await reconquista('/board')).json();
  if (board.countries.length !== 72)
    throw new Error('Packaged Reconquista board is incomplete');
  for (const theme of ['light', 'dark'])
    if (!(await (await reconquista(`/art/${theme}`)).text()).startsWith('<svg'))
      throw new Error('Packaged Reconquista map art is missing');
  const { gameId: reconquistaId } = await (
    await reconquista('/games', cookie, { playerCount: 2 })
  ).json();
  const reconquistaTable = { gameId: reconquistaId, playerCookies: [] };
  for (const color of ['blue', 'red']) {
    const joined = await reconquista(`/games/${reconquistaId}/join`, '', {
      nickname: `TED ${color}`,
      color,
    });
    const playerCookie = joined.headers.get('set-cookie')?.split(';')[0];
    if (!playerCookie?.startsWith('ted_player_'))
      throw new Error('Missing Reconquista player cookie');
    await reconquista(`/games/${reconquistaId}/ready`, playerCookie, {});
    reconquistaTable.playerCookies.push(playerCookie);
  }
  await reconquista(`/games/${reconquistaId}/start`, cookie, {});
  const page = await fetch(`${origin}/game/${reconquistaId}`);
  if (!page.ok || !(await page.text()).includes('<div id="root"></div>'))
    throw new Error('Reconquista game page was not served');
  await verifyReconquista(reconquistaTable);
  await stop(child);
  child = launch();
  const restartedCode = await waitForStart(child, true);
  if (restartedCode === recoveryCode)
    throw new Error('Restart did not rotate the administrator access code');
  const oldLogin = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ recoveryCode }),
  });
  if (oldLogin.status !== 401)
    throw new Error('Old administrator code remained valid after restart');
  const oldSession = await fetch(`${origin}/api/admin/games`, {
    headers: { cookie },
  });
  if (oldSession.status !== 401)
    throw new Error('Old administrator session remained valid after restart');
  const secondLogin = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ recoveryCode: restartedCode }),
  });
  if (!secondLogin.ok)
    throw new Error('Restarted administrator code did not authenticate');
  const secondCookie = secondLogin.headers.get('set-cookie')?.split(';')[0];
  const games = await fetch(`${origin}/api/admin/games`, {
    headers: { cookie: secondCookie },
  });
  const body = await games.json();
  if (
    !games.ok ||
    tables.some(({ gameId }) => !JSON.stringify(body).includes(gameId))
  )
    throw new Error('Packaged game did not survive restart');
  for (const table of tables) await verifyTable(table);
  await verifyReconquista(reconquistaTable);
  await stop(child);
  const backup = join(temporary, 'ted-backup.json');
  runPackaged(['backup', '--data-dir', data, '--output', backup]);
  const backupBody = JSON.parse(await readFile(backup, 'utf8'));
  if (
    backupBody.manifest?.serverVersion !== manifest.version ||
    backupBody.manifest?.gameCount !== 2 ||
    backupBody.manifest?.reconquistaGameCount !== 1 ||
    backupBody.reconquista?.[0]?.gameId !== reconquistaId ||
    backupBody.format !== 'ted-backup' ||
    !backupBody.games.every((game) => game.format === 'ted-snapshot')
  )
    throw new Error('Packaged backup metadata is incorrect');
  const restored = join(temporary, 'restored-data');
  runPackaged([
    'restore',
    '--input',
    backup,
    '--data-dir',
    restored,
    '--confirm',
  ]);
  child = launch(restored);
  await waitForStart(child, true);
  for (const table of tables) await verifyTable(table);
  await verifyReconquista(reconquistaTable);
  await stop(child);
  process.stdout.write(
    `Packaged ${target} archive, checksum, manifest, runtime, Classic/Competitive/Reconquista sessions/start/restart, TED backup/restore smoke passed outside the repository\n`,
  );
} finally {
  for (const child of children) await stop(child);
  await rm(temporary, { recursive: true, force: true });
}
