import { randomUUID } from 'node:crypto';
import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

type PersistenceOutcome =
  | { readonly outcome: 'COMMITTED'; readonly cleanupError?: unknown }
  | { readonly outcome: 'FAILED'; readonly error: unknown }
  | { readonly outcome: 'INDETERMINATE'; readonly error: unknown };

export type AtomicWriteFaultPoint =
  | 'before-temporary-write'
  | 'before-temporary-sync'
  | 'after-temporary-synced'
  | 'after-current-installed'
  | 'after-install-synced'
  | 'before-old-cleanup'
  | 'before-cleanup-sync'
  | 'before-temporary-cleanup';

export interface AtomicWriteOptions {
  readonly fault?: (point: AtomicWriteFaultPoint) => void | Promise<void>;
  readonly syncDirectory?: (directory: string) => Promise<void>;
  readonly platform?: NodeJS.Platform;
}

export class PersistenceFailedError extends Error {
  readonly outcome = 'FAILED' as const;
  constructor(
    message: string,
    readonly failure: unknown,
    readonly cleanupFailure?: unknown,
  ) {
    super(message, { cause: failure });
    this.name = 'PersistenceFailedError';
  }
}

export class PersistenceIndeterminateError extends Error {
  readonly outcome = 'INDETERMINATE' as const;
  constructor(
    message: string,
    readonly primaryError: unknown,
  ) {
    super(message, { cause: primaryError });
    this.name = 'PersistenceIndeterminateError';
  }
}

class DirectorySyncUnsupportedError extends Error {
  constructor(
    path: string,
    readonly syncError: unknown,
  ) {
    super(`Directory metadata sync is unsupported for ${path}`, {
      cause: syncError,
    });
    this.name = 'DirectorySyncUnsupportedError';
  }
}

interface SyncableDirectoryHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

export async function syncDirectoryDurably(
  path: string,
  openDirectory: (path: string) => Promise<SyncableDirectoryHandle> = (value) =>
    open(value, 'r'),
): Promise<void> {
  let handle: SyncableDirectoryHandle | undefined;
  try {
    handle = await openDirectory(path);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (['ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(code ?? ''))
      throw new DirectorySyncUnsupportedError(path, error);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function flushInstalledFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function establishInstalledBoundary(
  path: string,
  directory: string,
  options: Pick<AtomicWriteOptions, 'platform' | 'syncDirectory'> = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    await flushInstalledFile(path);
    return;
  }
  await (options.syncDirectory ?? syncDirectoryDurably)(directory);
}

export async function writeSyncedTemporary(
  target: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<string> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await options.fault?.('before-temporary-write');
    await handle.writeFile(contents, 'utf8');
    await options.fault?.('before-temporary-sync');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await options.fault?.('after-temporary-synced');
    return temporary;
  } catch (error) {
    let cleanupFailure: unknown;
    try {
      await handle?.close();
      await options.fault?.('before-temporary-cleanup');
      await unlink(temporary);
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    throw new PersistenceFailedError(
      'Candidate creation failed',
      error,
      cleanupFailure,
    );
  }
}

export async function atomicWriteFile(
  target: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<PersistenceOutcome> {
  const directory = dirname(target);
  let temporary: string;
  try {
    temporary = await writeSyncedTemporary(target, contents, options);
  } catch (error) {
    return { outcome: 'FAILED', error };
  }
  try {
    await rename(temporary, target);
    await options.fault?.('after-current-installed');
    await establishInstalledBoundary(target, directory, options);
    await options.fault?.('after-install-synced');
    return { outcome: 'COMMITTED' };
  } catch (error) {
    return { outcome: 'INDETERMINATE', error };
  }
}
