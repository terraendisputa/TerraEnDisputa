/** Reconquista store: one command journal per game, with Classic's durable-write and lock primitives. */
import { mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  newSetupJournal,
  loadSetupJournal,
  commitLoadedSetupCommand,
  type SetupJournal,
} from '@game/game-engine/reconquista';
import {
  RECONQUISTA_DEFINITION,
  reconquistaJoinSchema,
  reconquistaCreateSchema,
  sameNickname,
  type ReconquistaAction,
} from '@game/protocol/reconquista';
import { randomInt, randomUUID } from 'node:crypto';
import {
  generateSessionToken,
  hashSessionToken,
  verifySessionToken,
} from '../auth/crypto.js';
import {
  atomicWriteFile,
  PersistenceFailedError,
  PersistenceIndeterminateError,
  type AtomicWriteOptions,
} from '../persistence/atomic-file.js';
import { DataDirectoryLock } from '../persistence/data-directory-lock.js';
import { PerGameCoordinator } from '../games/per-game-coordinator.js';
const random = () => randomInt(0, 2 ** 48 - 1) / (2 ** 48 - 1);
const definitionSchema = z.strictObject({
  editionId: z.literal('reconquista'),
  boardId: z.literal('reconquista'),
  rulesVersion: z.literal(1),
});
const playerSchema = z.strictObject({
  id: z.string().uuid(),
  nickname: reconquistaJoinSchema.shape.nickname,
  color: reconquistaJoinSchema.shape.color,
  ready: z.boolean(),
  session: z.strictObject({
    algorithm: z.literal('sha256'),
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  expiresAt: z.string().datetime(),
});
const envelopeSchema = z.strictObject({
  format: z.literal('reconquista-snapshot'),
  schemaVersion: z.literal(1),
  definition: definitionSchema,
  gameId: z.string().uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  baseRevision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
  playerCount: reconquistaCreateSchema.shape.playerCount,
  players: z.array(playerSchema).max(6),
  journal: z.unknown(),
});
export interface ReconquistaEnvelope extends Omit<
  z.infer<typeof envelopeSchema>,
  'journal'
> {
  readonly journal: SetupJournal | null;
}
export class ReconquistaOperationError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ReconquistaOperationError';
  }
}
const MARKER_NAME = 'reconquista.marker';
const MARKER = 'reconquista-store-1\n';
const incompatible = (cause?: unknown) =>
  new ReconquistaOperationError(
    'INCOMPATIBLE_SNAPSHOT',
    cause === undefined ? undefined : { cause },
  );
/** Checks a saved game, replaying its journal; `id` is the file it came from. */
function decodeSnapshot(
  catalog: unknown,
  decoded: unknown,
  id?: string,
  replayed?: (loaded: ReturnType<typeof loadSetupJournal>) => void,
): ReconquistaEnvelope {
  const parsed = envelopeSchema.safeParse(decoded);
  if (!parsed.success) throw incompatible(parsed.error);
  const value = parsed.data;
  if (
    (id !== undefined && value.gameId !== id) ||
    value.players.length > value.playerCount ||
    new Set(value.players.map((p) => p.id)).size !== value.players.length ||
    new Set(value.players.map((p) => p.color)).size !== value.players.length
  )
    throw incompatible();
  if (value.journal === null) {
    // Each join, ready and host removal adds one revision.
    if (
      value.baseRevision !== null ||
      value.revision <
        value.players.length + value.players.filter((p) => p.ready).length
    )
      throw incompatible();
    return { ...value, journal: null };
  }
  if (
    value.baseRevision === null ||
    value.baseRevision < value.playerCount * 2 + 1 ||
    value.players.length !== value.playerCount ||
    value.players.some((p) => !p.ready)
  )
    throw incompatible();
  let loaded: ReturnType<typeof loadSetupJournal>;
  try {
    loaded = loadSetupJournal(catalog, value.journal);
  } catch (error) {
    throw incompatible(error);
  }
  if (
    value.revision !== value.baseRevision + loaded.revision ||
    JSON.stringify(loaded.state.players) !==
      JSON.stringify(value.players.map(({ id, color }) => ({ id, color })))
  )
    throw incompatible();
  replayed?.(loaded);
  return { ...value, journal: loaded.journal };
}
export class ReconquistaStore {
  private readonly coordinator = new PerGameCoordinator();
  /** Each started game replayed once; commands then apply only themselves. */
  private readonly sessions = new Map<
    string,
    ReturnType<typeof loadSetupJournal>
  >();
  private readonly unavailable = new Set<string>();
  private readonly committed = new Map<string, ReconquistaEnvelope>();
  private constructor(
    readonly directory: string,
    readonly catalog: unknown,
    private readonly lock: DataDirectoryLock,
    private readonly options: AtomicWriteOptions,
    private readonly randomness: () => number,
  ) {}
  static async open(
    directory: string,
    catalog: unknown,
    options: AtomicWriteOptions = {},
    randomness: () => number = random,
  ): Promise<ReconquistaStore> {
    const target = resolve(directory);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const lock = await DataDirectoryLock.acquire(await realpath(target));
    try {
      const store = new ReconquistaStore(
        target,
        catalog,
        lock,
        options,
        randomness,
      );
      const marker = join(target, MARKER_NAME);
      try {
        if ((await readFile(marker, 'utf8')) !== MARKER)
          throw new Error('Incompatible Reconquista directory');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const entries = (await readdir(target)).filter(
          (n) => !n.startsWith('.owner-lock'),
        );
        if (entries.length)
          throw new Error('Unmarked nonempty Reconquista directory', {
            cause: error,
          });
        const result = await atomicWriteFile(marker, MARKER);
        if (result.outcome !== 'COMMITTED')
          throw new AggregateError(
            [error, result.error],
            'Reconquista marker could not be committed',
            { cause: error },
          );
      }
      return store;
    } catch (error) {
      await lock.close();
      throw error;
    }
  }
  async close() {
    await this.lock.close();
  }
  private file(id: string) {
    if (!z.string().uuid().safeParse(id).success)
      throw new ReconquistaOperationError('NOT_FOUND');
    return join(this.directory, id + '.json');
  }
  async load(id: string): Promise<ReconquistaEnvelope> {
    await this.lock.assertOwned();
    if (this.unavailable.has(id))
      throw new ReconquistaOperationError('UNAVAILABLE_UNTIL_RESTART');
    const cached = this.committed.get(id);
    if (cached) return structuredClone(cached);
    let decoded: unknown;
    try {
      decoded = JSON.parse(await readFile(this.file(id), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ReconquistaOperationError('NOT_FOUND');
      throw new ReconquistaOperationError('INCOMPATIBLE_SNAPSHOT', {
        cause: error,
      });
    }
    // The check already replays the journal; keep it for the next command.
    const current = decodeSnapshot(this.catalog, decoded, id, (loaded) =>
      this.sessions.set(id, loaded),
    );
    this.committed.set(id, structuredClone(current));
    return current;
  }
  private async ids() {
    await this.lock.assertOwned();
    return (await readdir(this.directory))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((id) => z.string().uuid().safeParse(id).success)
      .sort();
  }
  /** Every saved game for a backup; one unreadable game stops it, as in Classic. */
  async snapshot(): Promise<ReconquistaEnvelope[]> {
    const games = [];
    for (const id of await this.ids()) games.push(await this.load(id));
    return games;
  }
  /** Writes validated backup games into an empty directory that will replace the store's. */
  static async stage(
    directory: string,
    catalog: unknown,
    games: readonly unknown[],
    options: AtomicWriteOptions = {},
  ): Promise<void> {
    const decoded = games.map((game) => decodeSnapshot(catalog, game));
    if (new Set(decoded.map((g) => g.gameId)).size !== decoded.length)
      throw new Error('Backup contains duplicate Reconquista game IDs');
    await mkdir(directory, { mode: 0o700 });
    for (const [path, text] of [
      [join(directory, MARKER_NAME), MARKER],
      ...decoded.map((g) => [
        join(directory, g.gameId + '.json'),
        JSON.stringify(g),
      ]),
    ] as const) {
      const result = await atomicWriteFile(path, text, options);
      if (result.outcome !== 'COMMITTED') throw result.error;
    }
  }
  /** Saved games for the host panel; unreadable files are skipped, not repaired. */
  async list(): Promise<
    {
      gameId: string;
      playerCount: number;
      players: number;
      started: boolean;
      finished: boolean;
    }[]
  > {
    const games = [];
    for (const id of await this.ids()) {
      try {
        const current = await this.load(id);
        games.push({
          gameId: current.gameId,
          playerCount: current.playerCount,
          players: current.players.length,
          started: current.journal !== null,
          finished:
            current.journal !== null &&
            (this.replay(current).state.campaign?.winners.length ?? 0) > 0,
        });
      } catch {
        continue;
      }
    }
    return games;
  }
  private async persist(value: ReconquistaEnvelope) {
    await this.lock.assertOwned();
    const result = await atomicWriteFile(
      this.file(value.gameId),
      JSON.stringify(value),
      this.options,
    );
    if (result.outcome === 'FAILED')
      throw new PersistenceFailedError(
        'Reconquista write failed',
        result.error,
      );
    if (result.outcome === 'INDETERMINATE') {
      this.unavailable.add(value.gameId);
      throw new PersistenceIndeterminateError(
        'Reconquista write uncertain',
        result.error,
      );
    }
    this.committed.set(value.gameId, structuredClone(value));
  }
  async create(
    playerCount: ReconquistaEnvelope['playerCount'],
  ): Promise<ReconquistaEnvelope> {
    const parsed = reconquistaCreateSchema.parse({ playerCount });
    const value: ReconquistaEnvelope = {
      format: 'reconquista-snapshot',
      schemaVersion: 1,
      definition: RECONQUISTA_DEFINITION,
      gameId: randomUUID(),
      revision: 0,
      baseRevision: null,
      playerCount: parsed.playerCount,
      players: [],
      journal: null,
    };
    await this.persist(value);
    return value;
  }
  async join(id: string, input: unknown) {
    return this.coordinator.run(id, async () => {
      const body = reconquistaJoinSchema.parse(input);
      const current = await this.load(id);
      if (current.journal || current.players.length >= current.playerCount)
        throw new ReconquistaOperationError('LOBBY_CLOSED');
      if (current.players.some((p) => p.color === body.color))
        throw new ReconquistaOperationError('COLOR_IN_USE');
      if (current.players.some((p) => sameNickname(p.nickname, body.nickname)))
        throw new ReconquistaOperationError('NICKNAME_IN_USE');
      const token = generateSessionToken();
      const player = {
        id: randomUUID(),
        ...body,
        ready: false,
        session: hashSessionToken(token),
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };
      const candidate = {
        ...current,
        revision: current.revision + 1,
        players: [...current.players, player],
      };
      await this.persist(candidate);
      return { playerId: player.id, token, expiresAt: player.expiresAt };
    });
  }
  authenticate(
    current: ReconquistaEnvelope,
    token: string | undefined,
  ): string | undefined {
    if (!token || token.length > 128) return undefined;
    return current.players.find(
      (p) =>
        Date.parse(p.expiresAt) > Date.now() &&
        verifySessionToken(token, p.session),
    )?.id;
  }
  async ready(id: string, token: string | undefined) {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      const actor = this.authenticate(current, token);
      if (!actor) throw new ReconquistaOperationError('UNAUTHORIZED');
      if (current.journal) throw new ReconquistaOperationError('LOBBY_CLOSED');
      if (current.players.find((p) => p.id === actor)!.ready) return current;
      const candidate = {
        ...current,
        revision: current.revision + 1,
        players: current.players.map((p) =>
          p.id === actor ? { ...p, ready: true } : p,
        ),
      };
      await this.persist(candidate);
      return candidate;
    });
  }
  /** Host change of the required players before the game starts, as in Classic's lobby. */
  async configure(id: string, input: unknown) {
    return this.coordinator.run(id, async () => {
      const { playerCount } = reconquistaCreateSchema.parse(input);
      const current = await this.load(id);
      if (current.journal) throw new ReconquistaOperationError('LOBBY_CLOSED');
      if (playerCount < current.players.length)
        throw new ReconquistaOperationError('PLAYER_COUNT_TOO_LOW');
      if (playerCount === current.playerCount) return current;
      const candidate = {
        ...current,
        revision: current.revision + 1,
        playerCount,
      };
      await this.persist(candidate);
      return candidate;
    });
  }
  /** Host removal of a seat before the game starts, as in Classic's lobby. */
  async removePlayer(id: string, playerId: string) {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      if (current.journal) throw new ReconquistaOperationError('LOBBY_CLOSED');
      if (!current.players.some((p) => p.id === playerId))
        throw new ReconquistaOperationError('NOT_FOUND');
      const candidate = {
        ...current,
        revision: current.revision + 1,
        players: current.players.filter((p) => p.id !== playerId),
      };
      await this.persist(candidate);
      return candidate;
    });
  }
  async remove(id: string) {
    return this.coordinator.run(id, async () => {
      await this.load(id);
      await this.lock.assertOwned();
      await rm(this.file(id));
      this.committed.delete(id);
      this.sessions.delete(id);
    });
  }
  async start(id: string) {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      if (current.journal) return current;
      if (
        current.players.length !== current.playerCount ||
        current.players.some((p) => !p.ready)
      )
        throw new ReconquistaOperationError('PLAYERS_NOT_READY');
      const setup = newSetupJournal(
        this.catalog,
        current.players.map(({ id, color }) => ({ id, color })),
        this.randomness,
      );
      const candidate = {
        ...current,
        revision: current.revision + 1,
        baseRevision: current.revision + 1,
        journal: setup.journal,
      };
      await this.persist(candidate);
      return candidate;
    });
  }
  /** A started game's replayed journal; the replay runs only when the cache is behind. */
  replay(current: ReconquistaEnvelope) {
    if (!current.journal || current.baseRevision === null)
      throw new ReconquistaOperationError('NOT_STARTED');
    const cached = this.sessions.get(current.gameId);
    if (cached && current.baseRevision + cached.revision === current.revision)
      return cached;
    const loaded = loadSetupJournal(this.catalog, current.journal);
    this.sessions.set(current.gameId, loaded);
    return loaded;
  }
  async command(
    id: string,
    token: string | undefined,
    command: { commandId: string; revision: number; action: ReconquistaAction },
  ) {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      const actor = this.authenticate(current, token);
      if (!actor) throw new ReconquistaOperationError('UNAUTHORIZED');
      if (!current.journal || current.baseRevision === null)
        throw new ReconquistaOperationError('NOT_STARTED');
      let result;
      try {
        result = commitLoadedSetupCommand(
          this.catalog,
          this.replay(current),
          actor,
          command.commandId,
          command.revision - current.baseRevision,
          command.action,
          this.randomness,
        );
      } catch (error) {
        // A rejected command must not leave a half-applied game behind.
        this.sessions.delete(id);
        throw error;
      }
      const candidate = {
        ...current,
        revision: current.baseRevision + result.revision,
        journal: result.journal,
      };
      if (!result.duplicate) {
        await this.persist(candidate);
        this.sessions.set(id, result);
      }
      return { envelope: candidate, duplicate: result.duplicate };
    });
  }
}
