/** Copies the project site's how-to-play pages into the web build, served at /como-jugar/. */
import { cp } from 'node:fs/promises';
import { join, relative } from 'node:path';

const site = join(import.meta.dirname, '../site');
// The site's home pages are left out: the server redirects them to the game's start page.
const homePages = new Set(['index.html', join('en', 'index.html')]);
await cp(site, join(import.meta.dirname, '../apps/web/dist/como-jugar'), {
  recursive: true,
  filter: (source) => !homePages.has(relative(site, source)),
});
