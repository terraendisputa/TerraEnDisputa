import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const ownerSchema = z.strictObject({
  pid: z.number().int().positive(),
  token: z.string().uuid(),
  processInstanceId: z.string().min(1).optional(),
});

type DataDirectoryLockFaultPoint =
  | 'before-candidate-create'
  | 'before-candidate-owner-write'
  | 'before-candidate-owner-sync'
  | 'before-candidate-heartbeat-write'
  | 'before-candidate-heartbeat-sync'
  | 'before-release-move';

interface DataDirectoryLockOptions {
  readonly staleAfterMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly disableHeartbeat?: boolean;
  readonly isProcessAlive?: (pid: number) => Promise<boolean>;
  readonly processInstanceId?: (pid: number) => Promise<string | undefined>;
  readonly fault?: (point: DataDirectoryLockFaultPoint) => void | Promise<void>;
  readonly readOwnerFile?: (path: string, encoding: 'utf8') => Promise<string>;
  readonly statLease?: (path: string) => Promise<{ readonly mtimeMs: number }>;
}

class DataDirectoryLockedError extends Error {
  constructor(path: string) {
    super(`Game Server is already running with data directory: ${path}`);
    this.name = 'DataDirectoryLockedError';
  }
}

class DataDirectoryLockOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirectoryLockOwnershipError';
  }
}

export class DataDirectoryLock {
  private closed = false;
  private heartbeatFailure: unknown;
  private heartbeat?: NodeJS.Timeout;

  private constructor(
    private readonly lockPath: string,
    private readonly token: string,
    private readonly options: DataDirectoryLockOptions,
  ) {
    if (!options.disableHeartbeat) {
      this.heartbeat = setInterval(
        () => void this.pulse(),
        options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      );
      this.heartbeat.unref();
    }
  }

  static async acquire(
    dataDirectory: string,
    options: DataDirectoryLockOptions = {},
  ): Promise<DataDirectoryLock> {
    const lockPath = join(dataDirectory, '.owner-lock');
    const token = randomUUID();
    const processInstanceId = await (
      options.processInstanceId ?? readProcessInstanceId
    )(process.pid);
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidatePath = `${lockPath}.candidate-${token}`;
      try {
        await options.fault?.('before-candidate-create');
        await mkdir(candidatePath, { mode: 0o700 });
        const owner = await open(
          join(candidatePath, 'owner.json'),
          'wx',
          0o600,
        );
        try {
          await options.fault?.('before-candidate-owner-write');
          await owner.writeFile(
            JSON.stringify({ pid: process.pid, token, processInstanceId }),
            'utf8',
          );
          await options.fault?.('before-candidate-owner-sync');
          await owner.sync();
        } finally {
          await owner.close();
        }
        const heartbeat = await open(
          join(candidatePath, 'heartbeat'),
          'wx',
          0o600,
        );
        try {
          await options.fault?.('before-candidate-heartbeat-write');
          await heartbeat.writeFile(token, 'utf8');
          await options.fault?.('before-candidate-heartbeat-sync');
          await heartbeat.sync();
        } finally {
          await heartbeat.close();
        }
      } catch (error) {
        await rm(candidatePath, { recursive: true, force: true }).catch(
          () => undefined,
        );
        throw error;
      }
      try {
        await rename(candidatePath, lockPath);
        return new DataDirectoryLock(lockPath, token, options);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const windowsCollision =
          process.platform === 'win32' &&
          (code === 'EPERM' || code === 'EACCES') &&
          (await pathExists(lockPath));
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && !windowsCollision) {
          await rm(candidatePath, { recursive: true, force: true }).catch(
            () => undefined,
          );
          throw error;
        }
        await rm(candidatePath, { recursive: true, force: true }).catch(
          () => undefined,
        );
        if (!(await lockOwnerCanBeReplaced(lockPath, options)))
          throw new DataDirectoryLockedError(dataDirectory);
        const stalePath = `${lockPath}.stale-${randomUUID()}`;
        try {
          await rename(lockPath, stalePath);
        } catch (renameError) {
          if ((renameError as NodeJS.ErrnoException).code === 'ENOENT')
            continue;
          throw renameError;
        }
        await rm(stalePath, { recursive: true, force: true });
      }
    }
    throw new DataDirectoryLockedError(dataDirectory);
  }

  private async pulse(): Promise<void> {
    if (this.closed) return;
    let heartbeat: FileHandle | undefined;
    try {
      // Open the heartbeat first. If takeover moves this lock directory after
      // the ownership check, the update remains attached to the old inode and
      // can never make the newer owner's lease appear fresh.
      heartbeat = await open(join(this.lockPath, 'heartbeat'), 'r+');
      const owner = ownerSchema.parse(
        JSON.parse(await readFile(join(this.lockPath, 'owner.json'), 'utf8')),
      );
      if (owner.token !== this.token) {
        this.heartbeatFailure = new DataDirectoryLockOwnershipError(
          'Data-directory lock ownership changed',
        );
        if (this.heartbeat) clearInterval(this.heartbeat);
        return;
      }
      const now = new Date();
      await heartbeat.utimes(now, now);
      this.heartbeatFailure = undefined;
    } catch (error) {
      this.heartbeatFailure = error;
    } finally {
      await heartbeat?.close();
    }
  }

  async assertOwned(): Promise<void> {
    if (this.closed)
      throw new DataDirectoryLockOwnershipError(
        'Data-directory lock is closed',
      );
    if (this.heartbeatFailure)
      throw new DataDirectoryLockOwnershipError(
        `Data-directory lock heartbeat failed: ${messageOf(this.heartbeatFailure)}`,
      );
    const owner = ownerSchema.parse(
      JSON.parse(await readFile(join(this.lockPath, 'owner.json'), 'utf8')),
    );
    if (owner.token !== this.token)
      throw new DataDirectoryLockOwnershipError(
        'Data-directory lock ownership changed',
      );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    const releasePath = `${this.lockPath}.release-${this.token}-${randomUUID()}`;
    try {
      await this.options.fault?.('before-release-move');
      await rename(this.lockPath, releasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const movedOwner = ownerSchema.parse(
      JSON.parse(await readFile(join(releasePath, 'owner.json'), 'utf8')),
    );
    if (movedOwner.token !== this.token) {
      try {
        await rename(releasePath, this.lockPath);
      } catch (restoreError) {
        throw new DataDirectoryLockOwnershipError(
          `Release moved a newer owner's lock and could not restore it: ${messageOf(restoreError)}`,
        );
      }
      throw new DataDirectoryLockOwnershipError(
        'Data-directory lock ownership changed before release',
      );
    }
    await rm(releasePath, { recursive: true });
  }
}

async function lockOwnerCanBeReplaced(
  lockPath: string,
  options: DataDirectoryLockOptions,
): Promise<boolean> {
  let rawOwner: string;
  try {
    rawOwner = await (options.readOwnerFile ?? readFile)(
      join(lockPath, 'owner.json'),
      'utf8',
    );
  } catch {
    return lockLeaseIsStale(lockPath, options);
  }
  let owner: z.infer<typeof ownerSchema>;
  try {
    owner = ownerSchema.parse(JSON.parse(rawOwner));
  } catch {
    return lockLeaseIsStale(lockPath, options);
  }
  const alive = await (options.isProcessAlive ?? isProcessAlive)(owner.pid);
  if (!alive) return true;
  const observedInstance = await (
    options.processInstanceId ?? readProcessInstanceId
  )(owner.pid);
  if (owner.processInstanceId && observedInstance)
    return owner.processInstanceId !== observedInstance;
  // A live PID without comparable instance identity is ambiguous. Refuse
  // takeover rather than risk concurrent writers.
  return false;
}

async function lockLeaseIsStale(
  lockPath: string,
  options: DataDirectoryLockOptions,
): Promise<boolean> {
  const { staleAfterMs } = options;
  if (staleAfterMs === undefined || staleAfterMs < 0) return false;
  try {
    const heartbeat = await (options.statLease ?? stat)(
      join(lockPath, 'heartbeat'),
    );
    return Date.now() - heartbeat.mtimeMs > staleAfterMs;
  } catch {
    // Missing or unreadable lease evidence has unknown freshness. It is not
    // proof that the existing owner is dead.
    return false;
  }
}

function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH')
      return Promise.resolve(false);
    if ((error as NodeJS.ErrnoException).code === 'EPERM')
      return Promise.resolve(true);
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

async function readProcessInstanceId(pid: number): Promise<string | undefined> {
  if (process.platform === 'win32') return readWindowsProcessInstanceId(pid);
  if (process.platform !== 'linux') return undefined;
  try {
    const [bootId, processStat] = await Promise.all([
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readFile(`/proc/${pid}/stat`, 'utf8'),
    ]);
    const afterCommand = processStat.slice(processStat.lastIndexOf(')') + 2);
    const fields = afterCommand.split(' ');
    const startTime = fields[19];
    return startTime ? `linux:${bootId.trim()}:${startTime}` : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Windows has no /proc start tick. Process.StartTime is a stable per-process
 * instance value and avoids the substantially heavier CIM/WMI query path. */
async function readWindowsProcessInstanceId(
  pid: number,
): Promise<string | undefined> {
  try {
    const script = `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().ToString('o')`;
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5_000 },
    );
    const creation = stdout.trim();
    return creation ? `windows:${creation}` : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ESRCH') return undefined;
    // Probe timeout, access denial, unavailable PowerShell, or process exit
    // leaves identity unknown. Callers must treat that as non-replaceable for
    // any live PID, preserving exclusive ownership.
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
