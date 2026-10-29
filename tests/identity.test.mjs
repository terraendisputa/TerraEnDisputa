import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { build } from 'esbuild';
import { defaultDataDirectory } from '../apps/server/dist/persistence/data-directory.js';
import {
  sessionCookieName,
  readSessionCookie,
} from '../apps/server/dist/auth/cookies.js';

const root = resolve(import.meta.dirname, '..');
const themeBuild = await build({
  entryPoints: [join(root, 'apps/web/src/theme-preference.ts')],
  bundle: true,
  write: false,
  format: 'esm',
});
const { readThemePreference } = await import(
  `data:text/javascript;base64,${Buffer.from(themeBuild.outputFiles[0].text).toString('base64')}`
);

await test('TED theme preference reads light and dark, with a dark default', () => {
  for (const [value, expected] of [
    [null, 'dark'],
    ['light', 'light'],
    ['dark', 'dark'],
    ['invalid', 'dark'],
  ]) {
    assert.equal(
      readThemePreference({
        getItem: (key) => {
          assert.equal(key, 'ted-theme');
          return value;
        },
      }),
      expected,
    );
  }
});

await test('TED data directories and session cookies for HTTP/HTTPS', () => {
  assert.equal(
    defaultDataDirectory('linux', { XDG_DATA_HOME: '/tmp/ted-data-test' }),
    resolve('/tmp/ted-data-test', 'ted'),
  );
  assert.equal(
    defaultDataDirectory('win32', { LOCALAPPDATA: '/tmp/ted-data-test' }),
    resolve('/tmp/ted-data-test', 'TED', 'data'),
  );
  for (const authority of [
    { kind: 'admin' },
    { kind: 'player', gameId: 'disposable-game' },
  ]) {
    for (const transport of ['HTTP', 'HTTPS']) {
      const name = sessionCookieName(authority, transport);
      assert.match(name, /ted_.*_session_(http|https)$/);
      assert.equal(name.startsWith('__Host-'), transport === 'HTTPS');
      assert.equal(
        readSessionCookie({ [name]: 'existing-session' }, authority, transport),
        'existing-session',
      );
    }
  }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ted-identity-'));
  const source = join(dir, 'source');
  const bin = join(dir, 'bin');
  mkdirSync(join(source, 'scripts'), { recursive: true });
  mkdirSync(bin);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'scripts/release-build.mjs',
    'scripts/release-smoke.mjs',
  ])
    writeFileSync(join(source, file), '');
  writeFileSync(
    join(source, 'scripts/update-game.sh'),
    '#!/bin/bash\nexit 91\n',
  );
  const executable = (name, contents) =>
    writeFileSync(join(bin, name), `#!/bin/bash\n${contents}\n`, {
      mode: 0o755,
    });
  executable(
    'pnpm',
    'if [[ $1 == --version ]]; then echo 10.15.0; else echo "$NODE_OPTIONS" >> "$TED_TEST_LOG"; fi',
  );
  return {
    dir,
    source,
    bin,
    executable,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TED_TEST_LOG: join(dir, 'build.log'),
      TED_BUILD_MEMORY_MB: '',
    },
  };
}

for (const [
  label,
  env,
  expected,
] of /** @type {[string, Record<string, string>, string][]} */ ([
  ['default', {}, '512'],
  ['configured memory', { TED_BUILD_MEMORY_MB: '768' }, '768'],
]))
  await test(
    `build memory: ${label}`,
    { skip: process.platform === 'win32' },
    () => {
      const f = fixture();
      try {
        const result = spawnSync(
          'bash',
          [join(root, 'scripts/update-game.sh'), '--build', '--dir', f.source],
          { env: { ...f.env, ...env }, encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          readFileSync(f.env.TED_TEST_LOG, 'utf8'),
          `--max-old-space-size=${expected}\n`.repeat(2),
        );
      } finally {
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
  );

await test(
  'invalid memory setting fails before any build',
  { skip: process.platform === 'win32' },
  () => {
    const f = fixture();
    try {
      const result = spawnSync(
        'bash',
        [join(root, 'scripts/update-game.sh'), '--build', '--dir', f.source],
        {
          env: {
            ...f.env,
            TED_BUILD_MEMORY_MB: 'invalid',
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /TED_BUILD_MEMORY_MB/);
      assert.equal(existsSync(f.env.TED_TEST_LOG), false);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

for (const scenario of ['ted-other-scope']) {
  await test(
    `installer refuses duplicate service before touching data: ${scenario}`,
    { skip: process.platform !== 'linux' || process.getuid?.() === 0 },
    () => {
      const f = fixture();
      try {
        f.executable(
          'systemctl',
          `
user=false
if [[ $1 == --user ]]; then user=true; shift; fi
case "$1" in
  show-environment) exit 0 ;;
  show)
    state=not-found
    [[ $2 == ted.service && $TED_TEST_SCENARIO == ted-other-scope && $user == false ]] && state=loaded
    echo "$state"; exit 0 ;;
  is-active)
    exit 1 ;;
esac
exit 90`,
        );
        for (const command of ['systemd-analyze', 'journalctl', 'curl'])
          f.executable(command, 'exit 92');
        const install = join(f.dir, 'app');
        const data = join(f.dir, 'data');
        const result = spawnSync(
          'bash',
          [
            join(root, 'scripts/install-game.sh'),
            '--user-service',
            '--dir',
            f.source,
            '--install-dir',
            install,
            '--data-dir',
            data,
          ],
          {
            env: {
              ...f.env,
              XDG_CONFIG_HOME: join(f.dir, 'config'),
              TED_TEST_SCENARIO: scenario,
              LC_ALL: 'es_AR.UTF-8',
            },
            encoding: 'utf8',
          },
        );
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /ted.service en el otro ámbito/);
        for (const path of [
          install,
          data,
          `${install}-backups`,
          join(f.dir, 'config'),
        ])
          assert.equal(existsSync(path), false);
      } finally {
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
  );
}
