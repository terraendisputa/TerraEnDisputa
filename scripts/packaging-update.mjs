// After a release is published, points the AUR and Flathub packages at its
// Linux desktop archive: version, URL and checksum from the release's
// SHA256SUMS. Usage: node scripts/packaging-update.mjs [version]
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version =
  process.argv[2] ??
  JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`Not a release version: ${version}`);
const archive = `terra-en-disputa-${version}-linux-x64.tar.gz`;
const releaseUrl = `https://github.com/terraendisputa/TerraEnDisputa/releases/download/v${version}`;

const response = await fetch(`${releaseUrl}/SHA256SUMS`);
if (!response.ok)
  throw new Error(
    `Release v${version} has no SHA256SUMS yet (HTTP ${response.status})`,
  );
const sha256 = (await response.text())
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .find(([, file]) => file === archive)?.[0];
if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
  throw new Error(`SHA256SUMS of v${version} does not list ${archive}`);

const edit = async (path, change) => {
  const file = join(root, path);
  await writeFile(file, change(await readFile(file, 'utf8')));
};

await edit('packaging/aur/PKGBUILD', (text) =>
  text
    .replace(/^pkgver=.*$/m, `pkgver=${version}`)
    .replace(/^pkgrel=.*$/m, 'pkgrel=1')
    .replace(/^sha256sums=.*$/m, `sha256sums=('${sha256}')`),
);
const pkgbuild = await readFile(join(root, 'packaging/aur/PKGBUILD'), 'utf8');
const field = (name) => pkgbuild.match(new RegExp(`^${name}=(.*)$`, 'm'))[1];
const list = (name) => [...field(name).matchAll(/'([^']*)'/g)].map((m) => m[1]);
const lines = [
  `pkgbase = ${field('pkgname')}`,
  `\tpkgdesc = ${list('pkgdesc')[0]}`,
  `\tpkgver = ${version}`,
  '\tpkgrel = 1',
  `\turl = ${list('url')[0]}`,
  ...list('arch').map((value) => `\tarch = ${value}`),
  ...list('license').map((value) => `\tlicense = ${value}`),
  ...list('depends').map((value) => `\tdepends = ${value}`),
  ...list('provides').map((value) => `\tprovides = ${value}`),
  ...list('conflicts').map((value) => `\tconflicts = ${value}`),
  ...list('options').map((value) => `\toptions = ${value}`),
  `\tsource = ${releaseUrl}/${archive}`,
  `\tsha256sums = ${sha256}`,
  '',
  `pkgname = ${field('pkgname')}`,
];
await writeFile(join(root, 'packaging/aur/.SRCINFO'), `${lines.join('\n')}\n`);

await edit(
  'packaging/flathub/io.github.terraendisputa.TerraEnDisputa.yml',
  (text) =>
    text
      .replace(
        /^(\s+url: ).*linux-x64\.tar\.gz$/m,
        `$1${releaseUrl}/${archive}`,
      )
      .replace(/^(\s+sha256: ).*$/m, `$1'${sha256}'`),
);

process.stdout.write(
  `AUR and Flathub now point at ${archive}\nsha256 ${sha256}\n`,
);
