import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { resolveNativeNodeRuntime } from './native-node-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const version = packageJson.version;
const platform = process.platform;
const nativeRuntime = await resolveNativeNodeRuntime({
  platform,
  architecture: process.arch,
  execPath: process.execPath,
});
if (process.versions.node.split('.')[0] !== '24')
  throw new Error('Release builds require the pinned Node 24 runtime');
const target = platform === 'win32' ? 'windows-x64' : 'linux-x64';
const directoryName = `ted-${version}-${target}`;
const releaseRoot = join(root, 'release');
const stage = join(releaseRoot, directoryName);
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(join(stage, 'app'), { recursive: true });
await mkdir(join(stage, 'runtime'), { recursive: true });

for (const required of [
  'apps/web/dist/index.html',
  'apps/server/dist/main.js',
  'apps/server/assets/reconquista/catalog.json',
  'LICENSE',
]) {
  await stat(join(root, required)).catch(() => {
    throw new Error(`Required fresh build input is missing: ${required}`);
  });
}

const bundle = join(stage, 'app', 'server.mjs');
const result = await build({
  entryPoints: [join(root, 'apps/server/src/main.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: false,
  metafile: true,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
if (
  Object.keys(result.metafile.inputs).some((input) =>
    /tests[/\\]fixtures|docs[/\\]design/.test(input),
  )
)
  throw new Error('Test fixtures or design sources leaked into the release');
await cp(join(root, 'apps/web/dist'), join(stage, 'web'), { recursive: true });
// Board catalog and map art; the server finds them next to server.mjs.
await cp(
  join(root, 'apps/server/assets/reconquista'),
  join(stage, 'app', 'assets', 'reconquista'),
  { recursive: true },
);
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
for (const guide of ['SELF_HOSTING.md', 'INSTALLING.md', 'UPDATING.md'])
  await cp(join(root, 'docs', guide), join(stage, guide));
await cp(
  nativeRuntime.executablePath,
  join(stage, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
);
if (platform !== 'win32') await chmod(join(stage, 'runtime', 'node'), 0o755);

const packageRoots = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes(`${sep}node_modules${sep}`)) continue;
  let cursor = resolve(input);
  while (cursor !== root) {
    try {
      const manifest = JSON.parse(
        await readFile(join(cursor, 'package.json'), 'utf8'),
      );
      if (manifest.name && manifest.version) {
        packageRoots.add(cursor);
        break;
      }
    } catch {
      // Continue walking to the dependency package root.
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
const notices = [
  'Third-party software bundled with Terra en disputa',
  '',
  `Node.js ${process.version}`,
  '',
  nativeRuntime.license.trim(),
  '',
  '---',
  '',
];
for (const packageRoot of [...packageRoots].sort()) {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  );
  notices.push(
    `${manifest.name} ${manifest.version} — ${manifest.license ?? 'SEE PACKAGE'}`,
  );
  const files = await readdir(packageRoot);
  const license = files.find((file) =>
    /^(licen[sc]e|copying)(\..*)?$/i.test(file),
  );
  if (license)
    notices.push(
      '',
      (await readFile(join(packageRoot, license), 'utf8')).trim(),
    );
  notices.push('', '---', '');
}
await writeFile(join(stage, 'THIRD_PARTY_LICENSES'), `${notices.join('\n')}\n`);
await writeFile(
  join(stage, 'README.txt'),
  `Terra en disputa ${version}\n\nRun ${platform === 'win32' ? 'ted.cmd' : './ted'} and open the printed URL.\nRead SELF_HOSTING.md for operation, backup, networking, and source information.\nLicense: AGPL-3.0-only.\n`,
);

if (platform === 'win32') {
  await writeFile(
    join(stage, 'ted.cmd'),
    '@echo off\r\nsetlocal\r\nset "GAME_WEB_ROOT=%~dp0web"\r\n"%~dp0runtime\\node.exe" "%~dp0app\\server.mjs" %*\r\n',
  );
} else {
  await writeFile(
    join(stage, 'ted'),
    '#!/bin/sh\nAPP_DIR=${0%/*}\n[ "$APP_DIR" = "$0" ] && APP_DIR=.\nAPP_DIR=$(CDPATH= cd -- "$APP_DIR" && pwd) || exit 1\nGAME_WEB_ROOT="$APP_DIR/web" exec "$APP_DIR/runtime/node" "$APP_DIR/app/server.mjs" "$@"\n',
  );
  await chmod(join(stage, 'ted'), 0o755);
}

await mkdir(releaseRoot, { recursive: true });
const archive = join(
  releaseRoot,
  `${directoryName}.${platform === 'win32' ? 'zip' : 'tar.gz'}`,
);
await rm(archive, { force: true });
if (platform === 'win32')
  execFileSync('tar', ['-a', '-cf', archive, directoryName], {
    cwd: releaseRoot,
  });
else
  execFileSync('tar', ['-czf', archive, directoryName], { cwd: releaseRoot });
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(
  join(releaseRoot, 'SHA256SUMS'),
  `${digest}  ${basename(archive)}\n`,
);
await writeFile(
  join(releaseRoot, `manifest-${target}.json`),
  `${JSON.stringify({ version, platform: target.split('-')[0], architecture: 'x64', artifact: basename(archive), sha256: digest }, null, 2)}\n`,
);
process.stdout.write(`${relative(root, archive)}\n${digest}\n`);
