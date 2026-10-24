/** Writes .br and .gz next to each text asset so the server sends them ready-made. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const TEXT = /\.(?:html|js|css|svg|json|txt)$/;
const directory = join(import.meta.dirname, '../apps/web/dist');
for (const entry of await readdir(directory, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || !TEXT.test(entry.name)) continue;
  const path = join(entry.parentPath, entry.name);
  const source = await readFile(path);
  if (source.length < 1024) continue;
  const brotli = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  const gzip = gzipSync(source, { level: constants.Z_BEST_COMPRESSION });
  if (brotli.length < source.length) await writeFile(path + '.br', brotli);
  if (gzip.length < source.length) await writeFile(path + '.gz', gzip);
}
