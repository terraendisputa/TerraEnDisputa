// Builds the desktop app installers from the release stage made by
// scripts/release-build.mjs: AppImage, deb and tar.gz on Linux, an NSIS
// installer and a zip on Windows. Output goes to release/desktop.
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { build as bundle } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const desktop = join(root, 'apps/desktop');
// electron-builder is a dependency of the desktop package only.
const { build } = createRequire(join(desktop, 'package.json'))(
  'electron-builder',
);
const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const { version: electronVersion } = JSON.parse(
  await readFile(join(desktop, 'node_modules/electron/package.json'), 'utf8'),
);
const windows = process.platform === 'win32';
const stage = join(
  root,
  'release',
  `ted-${version}-${windows ? 'windows' : 'linux'}-x64`,
);
await stat(join(stage, 'app', 'server.mjs')).catch(() => {
  throw new Error(`Run pnpm release:build first: ${stage} is missing`);
});

await rm(join(desktop, 'dist'), { recursive: true, force: true });
await bundle({
  entryPoints: [join(desktop, 'src/main.ts')],
  outfile: join(desktop, 'dist/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
});

const summary = 'Turn-based strategy game for 2 to 6 players';
await build({
  projectDir: desktop,
  publish: 'never',
  config: {
    appId: 'io.github.terraendisputa.TerraEnDisputa',
    productName: 'Terra en disputa',
    executableName: 'terra-en-disputa',
    copyright: 'AGPL-3.0-only',
    // Updates come from new releases, not from an auto-updater.
    publish: null,
    electronVersion,
    npmRebuild: false,
    nodeGypRebuild: false,
    directories: {
      output: join(root, 'release/desktop'),
      buildResources: 'build',
    },
    files: ['dist/main.cjs', 'package.json'],
    extraMetadata: {
      name: 'terra-en-disputa',
      version,
      homepage: 'https://terraendisputa.github.io/TerraEnDisputa/',
      repository: 'https://github.com/terraendisputa/TerraEnDisputa',
      // Lets desktops match the running window to its launcher entry.
      desktopName: 'io.github.terraendisputa.TerraEnDisputa.desktop',
      author: {
        name: 'Terra en disputa',
        email: 'terraendisputa@users.noreply.github.com',
      },
    },
    // The server, the web client and the icon live outside app.asar; the
    // app runs server.mjs with Electron's own Node runtime.
    extraResources: [
      { from: join(stage, 'app'), to: 'server' },
      { from: join(stage, 'web'), to: 'web' },
      { from: 'build/icon.png', to: 'icon.png' },
      { from: join(stage, 'THIRD_PARTY_LICENSES'), to: 'THIRD_PARTY_LICENSES' },
      { from: join(root, 'LICENSE'), to: 'LICENSE.ted' },
    ],
    artifactName: 'terra-en-disputa-${version}-${os}-${arch}.${ext}',
    linux: {
      target: ['AppImage', 'deb', 'tar.gz'],
      category: 'Game;StrategyGame',
      syncDesktopName: true,
      icon: 'build/icon.png',
      synopsis: summary,
      description: summary,
      desktop: {
        entry: {
          Name: 'Terra en disputa',
          Comment: summary,
          'Comment[es]': 'Juego de estrategia por turnos para 2 a 6 jugadores',
        },
      },
    },
    deb: { packageCategory: 'games' },
    win: {
      target: ['nsis', 'zip'],
      icon: 'build/icon.png',
    },
    // Installing for all users asks for administrator rights once, which the
    // firewall rule in build/installer.nsh needs.
    nsis: {
      oneClick: false,
      perMachine: true,
      include: 'build/installer.nsh',
      allowToChangeInstallationDirectory: true,
      shortcutName: 'Terra en disputa',
      deleteAppDataOnUninstall: false,
    },
  },
});
const output = join(root, 'release/desktop');
const installers = (await readdir(output)).filter((file) =>
  /\.(AppImage|deb|tar\.gz|exe|zip)$/.test(file),
);
const sums = [];
for (const file of installers.sort())
  sums.push(
    `${createHash('sha256')
      .update(await readFile(join(output, file)))
      .digest('hex')}  ${file}`,
  );
await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
process.stdout.write(`${installers.join('\n')}\n`);
