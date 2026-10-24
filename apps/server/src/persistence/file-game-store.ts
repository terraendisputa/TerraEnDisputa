import { UnsupportedGameDefinitionError } from '@game/game-engine';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { AdminAuthState } from '../auth/types.js';

import {
  atomicWriteFile,
  establishInstalledBoundary,
  PersistenceFailedError,
  PersistenceIndeterminateError,
  syncDirectoryDurably,
  writeSyncedTemporary,
  type AtomicWriteFaultPoint,
  type AtomicWriteOptions,
} from './atomic-file.js';
import { DataDirectoryLock } from './data-directory-lock.js';
import {
  adminAuthSchema,
  decodeBackup,
  decodeGame,
  encodeGame,
  UnsupportedSchemaError,
} from './schema.js';
import {
  CURRENT_BACKUP_FORMAT_VERSION,
  CURRENT_MARKER_FORMAT_VERSION,
  type BackupManifest,
  type CommitResult,
  type DiscoveryResult,
  type DurableGame,
  type GameLoadFailure,
  type GameStorageStatus,
  type PersistedGameEnvelope,
  type PersistedAdminAuthEnvelope,
} from './types.js';

type StoreFaultPoint =
  | 'before-delete-artifact'
  | 'before-delete-sync'
  | 'after-candidate-installed'
  | 'after-candidate-boundary'
  | 'before-marker-write'
  | 'after-marker-installed'
  | 'after-marker-boundary'
  | 'before-committed-cleanup';

type RestoreFaultPoint =
  | 'before-staging-game'
  | 'before-preserve-old'
  | 'before-preservation-sync'
  | 'before-install-staged'
  | 'before-install-sync'
  | 'before-staging-cleanup';

interface FileGameStoreOptions {
  readonly atomicWrite?: AtomicWriteOptions;
  readonly serverVersion?: string;
  readonly now?: () => Date;
  readonly fault?: (point: StoreFaultPoint) => void | Promise<void>;
  readonly syncDirectory?: (directory: string) => Promise<void>;
  readonly rename?: (source: string, destination: string) => Promise<void>;
}

interface RestoreOptions {
  readonly atomicWrite?: AtomicWriteOptions;
  readonly restoreBoundaryFault?: (
    boundary: 'preserved' | 'installed',
    point: AtomicWriteFaultPoint,
  ) => void | Promise<void>;
  readonly fault?: (point: RestoreFaultPoint) => void | Promise<void>;
  readonly syncDirectory?: (directory: string) => Promise<void>;
  readonly now?: () => Date;
  readonly rename?: (source: string, destination: string) => Promise<void>;
  /** Writes the backup's Reconquista games into a new directory; without it they are left as they are. */
  readonly reconquista?: (
    directory: string,
    games: readonly unknown[],
  ) => Promise<void>;
}

const fileNameForGame = (gameId: string) =>
  `${Buffer.from(gameId, 'utf8').toString('base64url')}.json`;
const gameIdFromFileName = (fileName: string) => {
  const encoded = fileName.slice(0, -'.json'.length);
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  return fileNameForGame(decoded) === fileName ? decoded : undefined;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const markerSuffix = '.commit';
const markerSchema = new RegExp(
  `^\\{"format":"ted-commit","markerFormatVersion":${CURRENT_MARKER_FORMAT_VERSION},"generation":"([0-9a-f-]{36})"\\}\\n$`,
);

export class StaleAuthenticationStateError extends Error {
  constructor(gameId: string) {
    super(`Authentication state changed concurrently for game ${gameId}`);
    this.name = 'StaleAuthenticationStateError';
  }
}

export class StaleGameRevisionError extends Error {
  constructor(gameId: string) {
    super(`Game revision changed concurrently for game ${gameId}`);
    this.name = 'StaleGameRevisionError';
  }
}

class StaleAdministratorAuthenticationStateError extends Error {
  constructor() {
    super('Administrator authentication state changed concurrently');
    this.name = 'StaleAdministratorAuthenticationStateError';
  }
}

export class FileGameStore {
  readonly dataDirectory: string;
  private readonly gamesDirectory: string;
  private readonly failedCommitErrors = new Map<string, string>();
  private readonly indeterminateCommitErrors = new Map<string, string>();
  private readonly unavailableErrors = new Map<string, string>();
  private adminAuthIndeterminateError?: string;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    dataDirectory: string,
    private readonly lock: DataDirectoryLock,
    private readonly options: FileGameStoreOptions,
  ) {
    this.dataDirectory = dataDirectory;
    this.gamesDirectory = join(dataDirectory, 'games');
  }

  static async open(
    dataDirectory: string,
    options: FileGameStoreOptions = {},
  ): Promise<FileGameStore> {
    const absolute = resolve(dataDirectory);
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(absolute, 0o700);
    const lock = await DataDirectoryLock.acquire(absolute);
    try {
      await mkdir(join(absolute, 'games'), { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32')
        await chmod(join(absolute, 'games'), 0o700);
      return new FileGameStore(absolute, lock, options);
    } catch (error) {
      await lock.close();
      throw error;
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Game store is closed'));
    const guarded = async () => {
      await this.lock.assertOwned();
      return operation();
    };
    const result = this.queue.then(guarded, guarded);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async discoverGames(): Promise<DiscoveryResult> {
    return this.serialized(async () => this.discoverWithoutQueue(true));
  }

  async loadAdminAuth(): Promise<AdminAuthState | undefined> {
    return this.serialized(async () => {
      if (this.adminAuthIndeterminateError)
        throw new PersistenceIndeterminateError(
          'Administrator authentication state requires restart recovery',
          this.adminAuthIndeterminateError,
        );
      try {
        const contents = await readFile(
          join(this.gamesDirectory, 'admin-auth.json'),
          'utf8',
        );
        return adminAuthSchema.parse(JSON.parse(contents))
          .auth as AdminAuthState;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return undefined;
        throw error;
      }
    });
  }

  async commitAdminAuth(
    candidate: AdminAuthState,
    expectedGeneration: number | null,
  ): Promise<CommitResult> {
    return this.serialized(async () => {
      if (this.adminAuthIndeterminateError)
        throw new PersistenceIndeterminateError(
          'Administrator authentication state requires restart recovery',
          this.adminAuthIndeterminateError,
        );
      const current = await this.readAdminAuthWithoutQueue();
      if ((current?.generation ?? null) !== expectedGeneration)
        throw new StaleAdministratorAuthenticationStateError();
      if (candidate.generation !== (expectedGeneration ?? 0) + 1)
        throw new Error(
          'Administrator authentication generation must advance exactly once',
        );
      const envelope: PersistedAdminAuthEnvelope = {
        format: 'classic-admin-auth',
        authSchemaVersion: candidate.authSchemaVersion,
        auth: candidate,
      };
      const validated = adminAuthSchema.parse(envelope);
      const outcome = await atomicWriteFile(
        join(this.gamesDirectory, 'admin-auth.json'),
        `${JSON.stringify(validated, null, 2)}\n`,
        this.atomicOptions(),
      );
      if (outcome.outcome === 'COMMITTED') return { outcome: 'COMMITTED' };
      if (outcome.outcome === 'INDETERMINATE') {
        this.adminAuthIndeterminateError = messageOf(outcome.error);
        throw new PersistenceIndeterminateError(
          'Administrator authentication persistence is indeterminate',
          outcome.error,
        );
      }
      throw new PersistenceFailedError(
        'Administrator authentication persistence failed',
        outcome.error,
      );
    });
  }

  async loadGame(gameId: string): Promise<DurableGame | undefined> {
    return this.serialized(async () => {
      try {
        if (this.indeterminateCommitErrors.has(gameId))
          throw new PersistenceIndeterminateError(
            `Game ${gameId} requires restart recovery before it can be reloaded`,
            this.indeterminateCommitErrors.get(gameId),
          );
        const loaded = await this.loadManagedGame(gameId);
        return loaded;
      } catch (error) {
        this.unavailableErrors.set(gameId, messageOf(error));
        throw error;
      }
    });
  }

  private async readAdminAuthWithoutQueue(): Promise<
    AdminAuthState | undefined
  > {
    try {
      const contents = await readFile(
        join(this.gamesDirectory, 'admin-auth.json'),
        'utf8',
      );
      return adminAuthSchema.parse(JSON.parse(contents)).auth as AdminAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Durably commits a candidate before returning it to the authoritative caller. */
  async commitGame(
    candidate: DurableGame,
    expected:
      | number
      | {
          readonly authGeneration?: number;
          readonly revision?: number | null;
        }
      | undefined = undefined,
  ): Promise<CommitResult> {
    return this.serialized(async () => {
      const gameId = candidate.state.id;
      if (this.indeterminateCommitErrors.has(gameId))
        throw new PersistenceIndeterminateError(
          `Game ${gameId} requires restart recovery before mutation`,
          this.indeterminateCommitErrors.get(gameId),
        );
      try {
        if (this.unavailableErrors.has(gameId))
          throw new Error(
            `Refusing to replace unavailable persisted game ${gameId}`,
          );
        // Never rely on a prior discovery pass for overwrite protection.
        // Resolve and fully validate any managed state before changing layout.
        const existing = await this.resolveManagedGame(gameId);
        const expectedAuthGeneration =
          typeof expected === 'number' ? expected : expected?.authGeneration;
        const expectedRevision =
          typeof expected === 'object' ? expected.revision : undefined;
        if (
          expectedAuthGeneration !== undefined &&
          existing?.envelope.game.auth.generation !== expectedAuthGeneration
        )
          throw new StaleAuthenticationStateError(gameId);
        if (
          expectedRevision !== undefined &&
          (existing?.envelope.game.revision ?? null) !== expectedRevision
        )
          throw new StaleGameRevisionError(gameId);
        if (
          expectedAuthGeneration !== undefined &&
          candidate.auth.generation !== expectedAuthGeneration &&
          candidate.auth.generation !== expectedAuthGeneration + 1
        )
          throw new Error(
            'Authentication generation must remain unchanged or advance exactly once',
          );
        if (
          expectedAuthGeneration !== undefined &&
          candidate.auth.generation === expectedAuthGeneration &&
          JSON.stringify(candidate.auth) !==
            JSON.stringify(existing?.envelope.game.auth)
        )
          throw new Error(
            'Authentication state cannot change without advancing its generation',
          );
        const generation = randomUUID();
        const envelope = encodeGame(candidate, generation);
        const atomicOptions = this.atomicOptions();
        const candidateTemporary = await writeSyncedTemporary(
          this.gamePath(gameId),
          `${JSON.stringify(envelope, null, 2)}\n`,
          atomicOptions,
        );
        try {
          if (existing?.path === this.gamePath(gameId)) {
            await rename(this.gamePath(gameId), `${this.gamePath(gameId)}.old`);
            await establishInstalledBoundary(
              `${this.gamePath(gameId)}.old`,
              this.gamesDirectory,
              atomicOptions,
            );
          }
          await rename(candidateTemporary, this.gamePath(gameId));
          await this.options.fault?.('after-candidate-installed');
          await establishInstalledBoundary(
            this.gamePath(gameId),
            this.gamesDirectory,
            atomicOptions,
          );
          await this.options.fault?.('after-candidate-boundary');
          await this.options.fault?.('before-marker-write');
          const markerTemporary = await writeSyncedTemporary(
            this.markerPath(gameId),
            `${JSON.stringify({ format: 'ted-commit', markerFormatVersion: CURRENT_MARKER_FORMAT_VERSION, generation })}\n`,
            atomicOptions,
          );
          await rename(markerTemporary, this.markerPath(gameId));
          await this.options.fault?.('after-marker-installed');
          await establishInstalledBoundary(
            this.markerPath(gameId),
            this.gamesDirectory,
            atomicOptions,
          );
          await this.options.fault?.('after-marker-boundary');
        } catch (error) {
          throw new PersistenceIndeterminateError(
            `Persistence outcome is indeterminate for game ${gameId}`,
            error,
          );
        }
        this.failedCommitErrors.delete(gameId);
        this.unavailableErrors.delete(gameId);
        let cleanupError: string | undefined;
        try {
          await this.options.fault?.('before-committed-cleanup');
          await this.cleanupCommittedResidue(gameId);
        } catch (error) {
          cleanupError = messageOf(error);
        }
        return cleanupError === undefined
          ? { outcome: 'COMMITTED' }
          : { outcome: 'COMMITTED', cleanupError };
      } catch (error) {
        if (error instanceof StaleAuthenticationStateError) throw error;
        if (error instanceof PersistenceIndeterminateError)
          this.indeterminateCommitErrors.set(gameId, messageOf(error));
        else this.failedCommitErrors.set(gameId, messageOf(error));
        throw error;
      }
    });
  }

  storageStatus(gameId: string): GameStorageStatus {
    const indeterminate = this.indeterminateCommitErrors.get(gameId);
    const failed = this.failedCommitErrors.get(gameId);
    const lastError =
      indeterminate ?? failed ?? this.unavailableErrors.get(gameId);
    return lastError === undefined
      ? { writable: true }
      : {
          writable: false,
          outcome: indeterminate ? 'INDETERMINATE' : 'FAILED',
          lastError,
        };
  }

  async deleteGame(gameId: string): Promise<boolean> {
    return this.serialized(async () => {
      if (this.indeterminateCommitErrors.has(gameId))
        throw new PersistenceIndeterminateError(
          `Game ${gameId} requires restart recovery before mutation`,
          this.indeterminateCommitErrors.get(gameId),
        );
      // Normal deletion is intentionally available only for a readable,
      // supported, invariant-valid managed game.
      let loaded: DurableGame | undefined;
      try {
        loaded = await this.loadManagedGame(gameId);
      } catch (error) {
        this.unavailableErrors.set(gameId, messageOf(error));
        throw new Error(
          `Refusing to delete unavailable persisted game ${gameId}`,
          {
            cause: error,
          },
        );
      }
      if (!loaded) return false;
      const baseName = fileNameForGame(gameId);
      const entries = await readdir(this.gamesDirectory, {
        withFileTypes: true,
      });
      const managed = entries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name === baseName ||
              entry.name === `${baseName}.old` ||
              entry.name === `${baseName}${markerSuffix}` ||
              entry.name.startsWith(`${baseName}${markerSuffix}.`) ||
              entry.name.startsWith(`${baseName}.tmp-`) ||
              entry.name.startsWith(`${baseName}.failed-`) ||
              entry.name.startsWith(`${baseName}.deleting-`)),
        )
        .map((entry) => join(this.gamesDirectory, entry.name));
      const deletionToken = randomUUID();
      const quarantined: { original: string; deleted: string }[] = [];
      let destructiveRenameAttempted = false;
      try {
        for (const [index, artifact] of managed.entries()) {
          await this.options.fault?.('before-delete-artifact');
          const deleted = `${this.gamePath(gameId)}.deleting-${deletionToken}-${index}`;
          destructiveRenameAttempted = true;
          await (this.options.rename ?? rename)(artifact, deleted);
          quarantined.push({ original: artifact, deleted });
        }
        await this.options.fault?.('before-delete-sync');
        if (process.platform === 'win32') {
          for (const { deleted } of quarantined)
            await establishInstalledBoundary(
              deleted,
              this.gamesDirectory,
              this.atomicOptions(),
            );
        } else await this.syncDirectory(this.gamesDirectory);
      } catch (error) {
        this.unavailableErrors.set(gameId, messageOf(error));
        if (destructiveRenameAttempted) {
          const indeterminate = new PersistenceIndeterminateError(
            'Game deletion outcome is indeterminate',
            error,
          );
          this.indeterminateCommitErrors.set(gameId, messageOf(indeterminate));
          throw indeterminate;
        }
        throw new PersistenceFailedError('Game deletion failed', error);
      }
      try {
        for (const { deleted } of quarantined) await unlink(deleted);
        if (process.platform !== 'win32')
          await this.syncDirectory(this.gamesDirectory);
      } catch {
        // The deletion boundary is already committed. Residue remains
        // quarantined and must not revoke the completed deletion.
      }
      this.failedCommitErrors.delete(gameId);
      this.unavailableErrors.delete(gameId);
      return true;
    });
  }

  async createBackup(
    outputPath: string,
    reconquista: readonly unknown[] = [],
  ): Promise<BackupManifest> {
    return this.serialized(async () => {
      if (this.adminAuthIndeterminateError)
        throw new PersistenceIndeterminateError(
          'Cannot back up indeterminate administrator authentication state',
          this.adminAuthIndeterminateError,
        );
      const absoluteOutput = await canonicalizeForCreation(outputPath);
      const canonicalData = await realpath(this.dataDirectory);
      if (isWithin(canonicalData, absoluteOutput))
        throw new Error(
          'Backup destination must be outside the managed data directory',
        );
      const discovery = await this.discoverWithoutQueue(false);
      if (discovery.failures.length)
        throw new Error(
          `Cannot back up while persisted games are unavailable: ${discovery.failures.map(({ fileName }) => fileName).join(', ')}`,
        );
      const games = [...discovery.games.values()]
        .sort((a, b) => a.state.id.localeCompare(b.state.id))
        .map((game) => encodeGame(game));
      const manifest: BackupManifest = {
        backupFormatVersion: CURRENT_BACKUP_FORMAT_VERSION,
        serverVersion: this.options.serverVersion ?? 'development',
        createdAt: (this.options.now ?? (() => new Date()))().toISOString(),
        gameCount: games.length,
        reconquistaGameCount: reconquista.length,
      };
      let adminAuth: PersistedAdminAuthEnvelope | undefined;
      try {
        adminAuth = adminAuthSchema.parse(
          JSON.parse(
            await readFile(
              join(this.gamesDirectory, 'admin-auth.json'),
              'utf8',
            ),
          ),
        ) as PersistedAdminAuthEnvelope;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(dirname(absoluteOutput), { recursive: true });
      const outcome = await atomicWriteFile(
        absoluteOutput,
        `${JSON.stringify({ format: 'ted-backup', manifest, games, reconquista, ...(adminAuth ? { adminAuth } : {}) }, null, 2)}\n`,
      );
      if (outcome.outcome !== 'COMMITTED') throw outcome.error;
      return manifest;
    });
  }

  private async discoverWithoutQueue(
    updateStatus: boolean,
  ): Promise<DiscoveryResult> {
    const games = new Map<string, DurableGame>();
    const failures: GameLoadFailure[] = [];
    const entries = await readdir(this.gamesDirectory, { withFileTypes: true });
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === 'admin-auth.json') continue;
      const currentName = entry.name.endsWith('.json.old')
        ? entry.name.slice(0, -'.old'.length)
        : entry.name;
      const snapshotName = currentName.endsWith(`${markerSuffix}`)
        ? currentName.slice(0, -markerSuffix.length)
        : currentName;
      if (!snapshotName.endsWith('.json')) continue;
      const gameId = gameIdFromFileName(snapshotName);
      if (gameId) ids.add(gameId);
      else if (entry.name.endsWith('.json'))
        failures.push({
          fileName: entry.name,
          code: 'CORRUPT',
          message: 'Invalid managed game filename',
        });
    }
    for (const gameId of [...ids].sort()) {
      try {
        if (this.indeterminateCommitErrors.has(gameId))
          throw new PersistenceIndeterminateError(
            `Game ${gameId} requires restart recovery`,
            this.indeterminateCommitErrors.get(gameId),
          );
        const loaded = await this.loadManagedGame(gameId);
        if (loaded) games.set(gameId, loaded);
      } catch (error) {
        const code = classifyLoadFailure(error);
        failures.push({
          fileName: fileNameForGame(gameId),
          gameId,
          code,
          message: messageOf(error),
        });
        if (updateStatus) this.unavailableErrors.set(gameId, messageOf(error));
      }
    }
    return { games, failures };
  }

  private async loadManagedGame(
    gameId: string,
  ): Promise<DurableGame | undefined> {
    return (await this.resolveManagedGame(gameId))?.envelope.game;
  }

  private async resolveManagedGame(
    gameId: string,
  ): Promise<{ path: string; envelope: PersistedGameEnvelope } | undefined> {
    const current = this.gamePath(gameId);
    const previous = `${current}.old`;
    const marker = this.markerPath(gameId);
    const anySnapshot =
      (await pathExists(current)) || (await pathExists(previous));
    if (!(await pathExists(marker))) {
      if (!anySnapshot) return undefined;
      // Preserve useful corrupt/future/invariant classification while still
      // refusing a valid but unproven snapshot.
      if (await pathExists(current))
        await readValidatedEnvelope(current, gameId);
      throw new Error('Committed-generation marker is missing');
    }
    const match = markerSchema.exec(await readFile(marker, 'utf8'));
    if (!match) throw new Error('Committed-generation marker is corrupt');
    const generation = match[1]!;
    const matching = [];
    for (const path of [current, previous])
      if ((await readGeneration(path)) === generation) matching.push(path);
    if (!matching.length)
      throw new Error('Committed generation has no complete matching snapshot');
    let validationError: unknown;
    for (const path of matching)
      try {
        return {
          path,
          envelope: await readValidatedEnvelope(path, gameId),
        };
      } catch (error) {
        validationError = error;
      }
    throw validationError;
  }

  private atomicOptions(): AtomicWriteOptions {
    const syncDirectory =
      this.options.atomicWrite?.syncDirectory ?? this.options.syncDirectory;
    return syncDirectory
      ? { ...this.options.atomicWrite, syncDirectory }
      : { ...this.options.atomicWrite };
  }

  private async cleanupCommittedResidue(gameId: string): Promise<void> {
    const previous = `${this.gamePath(gameId)}.old`;
    if (!(await pathExists(previous))) return;
    await unlink(previous);
    if (process.platform !== 'win32')
      await this.syncDirectory(this.gamesDirectory);
  }

  private gamePath(gameId: string): string {
    if (!gameId) throw new Error('Game ID must not be empty');
    return join(this.gamesDirectory, fileNameForGame(gameId));
  }

  private markerPath(gameId: string): string {
    return `${this.gamePath(gameId)}${markerSuffix}`;
  }

  private async syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32')
      throw new Error('Windows directory sync is not a supported primitive');
    await (this.options.syncDirectory ?? syncDirectoryDurably)(directory);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.queue;
    this.closed = true;
    await this.lock.close();
  }

  static async restoreBackup(
    dataDirectory: string,
    backupPath: string,
    options: RestoreOptions = {},
  ): Promise<string> {
    const absolute = resolve(dataDirectory);
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(absolute, 0o700);
    const lock = await DataDirectoryLock.acquire(absolute);
    const gamesDirectory = join(absolute, 'games');
    const staging = join(absolute, `.restore-staging-${randomUUID()}`);
    const reconquistaDirectory = join(absolute, 'reconquista');
    const reconquistaStaging = join(
      absolute,
      `.restore-staging-reconquista-${randomUUID()}`,
    );
    const timestamp = (options.now ?? (() => new Date()))()
      .toISOString()
      .replaceAll(':', '-');
    const preserved = join(
      absolute,
      `pre-restore-${timestamp}-${randomUUID()}`,
    );
    const syncRestoreBoundary = async (
      directory: string,
      boundaryKind: 'preserved' | 'installed',
    ) => {
      if (process.platform !== 'win32') {
        await (options.syncDirectory ?? syncDirectoryDurably)(absolute);
        return;
      }
      const boundary = join(directory, '.restore-boundary');
      const fault = options.restoreBoundaryFault
        ? (point: AtomicWriteFaultPoint) =>
            options.restoreBoundaryFault!(boundaryKind, point)
        : options.atomicWrite?.fault;
      const outcome = await atomicWriteFile(
        boundary,
        `${JSON.stringify({ format: 'ted-restore-boundary', token: randomUUID() })}\n`,
        fault
          ? { ...options.atomicWrite, fault, platform: 'win32' }
          : { ...options.atomicWrite, platform: 'win32' },
      );
      if (outcome.outcome !== 'COMMITTED') throw outcome.error;
    };
    let hadCurrent = false;
    let replacementRenameAttempted = false;
    try {
      const decoded = decodeBackup(
        JSON.parse(await readFile(resolve(backupPath), 'utf8')),
      );
      const ids = decoded.games.map(({ game }) => game.state.id);
      if (new Set(ids).size !== ids.length)
        throw new Error('Backup contains duplicate game IDs');
      await mkdir(staging, { mode: 0o700 });
      for (const envelope of decoded.games) {
        await options.fault?.('before-staging-game');
        const snapshotPath = join(
          staging,
          fileNameForGame(envelope.game.state.id),
        );
        const snapshotOutcome = await atomicWriteFile(
          snapshotPath,
          `${JSON.stringify(envelope, null, 2)}\n`,
          options.atomicWrite,
        );
        if (snapshotOutcome.outcome !== 'COMMITTED')
          throw snapshotOutcome.error;
        const markerOutcome = await atomicWriteFile(
          `${snapshotPath}${markerSuffix}`,
          `${JSON.stringify({ format: 'ted-commit', markerFormatVersion: CURRENT_MARKER_FORMAT_VERSION, generation: envelope.persistenceGeneration })}\n`,
          options.atomicWrite,
        );
        if (markerOutcome.outcome !== 'COMMITTED') throw markerOutcome.error;
      }
      if (decoded.adminAuth) {
        const adminEnvelope: PersistedAdminAuthEnvelope = {
          format: 'classic-admin-auth',
          authSchemaVersion: decoded.adminAuth.authSchemaVersion,
          auth: decoded.adminAuth,
        };
        const adminOutcome = await atomicWriteFile(
          join(staging, 'admin-auth.json'),
          `${JSON.stringify(adminEnvelope, null, 2)}\n`,
          options.atomicWrite,
        );
        if (adminOutcome.outcome !== 'COMMITTED') throw adminOutcome.error;
      }
      for (const envelope of decoded.games)
        await readValidatedGame(
          join(staging, fileNameForGame(envelope.game.state.id)),
          envelope.game.state.id,
        );
      await options.reconquista?.(reconquistaStaging, decoded.reconquista);
      try {
        hadCurrent = (await stat(gamesDirectory)).isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (hadCurrent) {
        await options.fault?.('before-preserve-old');
        replacementRenameAttempted = true;
        await (options.rename ?? rename)(gamesDirectory, preserved);
        await options.fault?.('before-preservation-sync');
        await syncRestoreBoundary(preserved, 'preserved');
      }
      await options.fault?.('before-install-staged');
      replacementRenameAttempted = true;
      await (options.rename ?? rename)(staging, gamesDirectory);
      await options.fault?.('before-install-sync');
      await syncRestoreBoundary(gamesDirectory, 'installed');
      if (!options.reconquista) return hadCurrent ? preserved : '';
      // Previous Reconquista games are kept inside the preserved folder.
      const hadReconquista = await pathExists(reconquistaDirectory);
      if (hadReconquista) {
        if (!hadCurrent) await mkdir(preserved, { mode: 0o700 });
        await (options.rename ?? rename)(
          reconquistaDirectory,
          join(preserved, 'reconquista'),
        );
      }
      await (options.rename ?? rename)(
        reconquistaStaging,
        reconquistaDirectory,
      );
      await syncRestoreBoundary(reconquistaDirectory, 'installed');
      return hadCurrent || hadReconquista ? preserved : '';
    } catch (error) {
      if (!replacementRenameAttempted) {
        let cleanupFailure: unknown;
        try {
          await cleanupStaging(staging, options);
          await cleanupStaging(reconquistaStaging, options);
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
        throw new PersistenceFailedError(
          'Restore failed before installation',
          error,
          cleanupFailure,
        );
      }
      throw new PersistenceIndeterminateError(
        'Restore outcome is indeterminate; preserved datasets require recovery',
        error,
      );
    } finally {
      await lock.close();
    }
  }
}

async function cleanupStaging(
  staging: string,
  options: RestoreOptions,
): Promise<void> {
  if (!(await pathExists(staging))) return;
  await options.fault?.('before-staging-cleanup');
  await rm(staging, { recursive: true });
}

async function readValidatedGame(
  path: string,
  expectedId: string,
): Promise<DurableGame> {
  const envelope = await readValidatedEnvelope(path, expectedId);
  return envelope.game;
}

async function readValidatedEnvelope(
  path: string,
  expectedId: string,
): Promise<PersistedGameEnvelope> {
  const envelope = decodeGame(JSON.parse(await readFile(path, 'utf8')));
  if (envelope.game.state.id !== expectedId)
    throw new Error('Filename game ID does not match persisted state ID');
  return envelope;
}

async function readGeneration(path: string): Promise<string | undefined> {
  if (!(await pathExists(path))) return undefined;
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return typeof value.persistenceGeneration === 'string'
      ? value.persistenceGeneration
      : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function classifyLoadFailure(error: unknown): GameLoadFailure['code'] {
  if (
    error instanceof UnsupportedSchemaError ||
    error instanceof UnsupportedGameDefinitionError
  )
    return 'UNSUPPORTED_SCHEMA';
  if (messageOf(error).startsWith('Classic invariant violation:'))
    return 'INVALID_STATE';
  return 'CORRUPT';
}

async function canonicalizeForCreation(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const missing: string[] = [];
  let cursor = absolute;
  while (true) {
    try {
      const existing = await realpath(cursor);
      return resolve(existing, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(cursor.slice(parent.length + 1));
      cursor = parent;
    }
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return (
    difference === '' ||
    (!difference.startsWith('..') && !isAbsolute(difference))
  );
}

export type { PersistedGameEnvelope };
