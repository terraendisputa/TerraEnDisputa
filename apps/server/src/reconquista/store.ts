/** Reconquista store: one command journal per game, with Classic's durable-write and lock primitives. */
import { mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  newSetupJournal,
  loadSetupJournal,
  commitLoadedSetupCommand,
  preparationBoard,
  chooseReconquistaBotMove,
  reconquistaActivationKey,
  reconquistaActivationMs,
  reconquistaActor,
  reconquistaDeclines,
  reconquistaExpressDurationMs,
  reconquistaTimeoutMove,
  type PreparationBoard,
  type ReconquistaBotMemory,
  type SetupAction,
  type SetupJournal,
} from '@game/game-engine/reconquista';
import { COMPETITIVE_BOT_NAMES } from '@game/game-engine';
import {
  RECONQUISTA_DEFINITION,
  reconquistaJoinSchema,
  reconquistaCreateSchema,
  reconquistaConfigureSchema,
  reconquistaBotLevelSchema,
  reconquistaBotsSchema,
  reconquistaTakeSeatSchema,
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
import { BOT_MOVE_GAP_MS } from '../games/game-service.js';
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
  bot: z.enum(['table', 'admin', 'absent']).optional(),
  free: z.literal(true).optional(),
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
  /** Express: the game runs on a clock, as Classic Express does. */
  express: z.literal(true).optional(),
  clock: z
    .strictObject({
      updatedAtMs: z.number().int().nonnegative(),
      elapsedMs: z.number().int().nonnegative(),
      activationKey: z.string().max(80),
      activationRemainingMs: z.number().int().nonnegative(),
      finalRound: z.number().int().positive().optional(),
      pauseReason: z.enum(['admin', 'restart', 'disconnection']).optional(),
      disconnectedPlayerId: z.string().uuid().optional(),
      technicalRemainingMs: z.number().int().nonnegative().optional(),
      absentPlayerIds: z.array(z.string().uuid()).max(6),
    })
    .optional(),
  /** Bots, as in Classic: seats they take at the start, level and absences. */
  botSeats: z.number().int().min(1).max(5).optional(),
  botLevel: reconquistaBotLevelSchema.optional(),
  botsReplaceAbsent: z.literal(false).optional(),
  botMemory: z
    .record(
      z.string().uuid(),
      z.strictObject({
        offeredTurn: z.string().max(40).optional(),
        brokeTurn: z.string().max(40).optional(),
      }),
    )
    .optional(),
  journal: z.unknown(),
});
/** Waiting for a disconnected player, as in Classic Express. */
export const RECONQUISTA_TECHNICAL_WAIT_MS = 300_000;
/** Clock-only progress is written to disk at most this often. */
const CLOCK_SAVE_MS = 10_000;
/** A timeout of a long joint attack stays bounded. */
const TIMEOUT_MOVES = 2_000;
export type ReconquistaClockState = NonNullable<
  z.infer<typeof envelopeSchema>['clock']
>;
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
  private readonly board: PreparationBoard;
  /** When each Express game's clock was last written to disk. */
  private readonly clockSaved = new Map<string, number>();
  /** When a bot last moved in each game. */
  private readonly botMoves = new Map<string, number>();
  private constructor(
    readonly directory: string,
    readonly catalog: unknown,
    private readonly lock: DataDirectoryLock,
    private readonly options: AtomicWriteOptions,
    private readonly randomness: () => number,
  ) {
    this.board = preparationBoard(catalog);
  }
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
    let current = decodeSnapshot(this.catalog, decoded, id, (loaded) =>
      this.sessions.set(id, loaded),
    );
    // A running clock read from disk stops until the host resumes, as in Classic.
    if (current.clock && !this.finished(current))
      current = {
        ...current,
        clock: {
          ...current.clock,
          updatedAtMs: Date.now(),
          pauseReason: 'restart',
          disconnectedPlayerId: undefined,
        },
      };
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
          finished: this.finished(current),
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
      if (
        current.journal ||
        current.players.length >= current.playerCount - (current.botSeats ?? 0)
      )
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
      const body = reconquistaConfigureSchema.parse(input);
      const current = await this.load(id);
      if (current.journal) throw new ReconquistaOperationError('LOBBY_CLOSED');
      const playerCount = body.playerCount ?? current.playerCount;
      const express = body.express ?? current.express === true;
      const bots = body.bots ?? current.botSeats ?? 0;
      if (bots >= playerCount)
        throw new ReconquistaOperationError('TOO_MANY_BOTS');
      if (playerCount - bots < current.players.length)
        throw new ReconquistaOperationError('PLAYER_COUNT_TOO_LOW');
      if (
        playerCount === current.playerCount &&
        express === (current.express === true) &&
        bots === (current.botSeats ?? 0)
      )
        return current;
      const { express: _express, botSeats: _bots, ...rest } = current;
      void _express;
      void _bots;
      const candidate = {
        ...rest,
        revision: current.revision + 1,
        playerCount,
        ...(express ? { express: true as const } : {}),
        ...(bots ? { botSeats: bots } : {}),
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
      const bots = current.botSeats ?? 0;
      if (
        current.players.length + bots !== current.playerCount ||
        current.players.some((p) => !p.ready)
      )
        throw new ReconquistaOperationError('PLAYERS_NOT_READY');
      // Table bots sit at the start with the free colors and fun names.
      const names = COMPETITIVE_BOT_NAMES.filter(
        (name) => !current.players.some((p) => sameNickname(p.nickname, name)),
      );
      const colors = reconquistaJoinSchema.shape.color.options.filter(
        (color) => !current.players.some((p) => p.color === color),
      );
      const table = Array.from({ length: bots }, (_, i) => {
        const name = names.splice(randomInt(names.length), 1)[0]!;
        return {
          id: randomUUID(),
          nickname: name,
          color: colors[i]!,
          ready: true,
          session: hashSessionToken(generateSessionToken()),
          expiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          bot: 'table' as const,
        };
      });
      const players = [...current.players, ...table];
      const setup = newSetupJournal(
        this.catalog,
        players.map(({ id, color }) => ({ id, color })),
        this.randomness,
      );
      const candidate = {
        ...current,
        players,
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
      if (current.players.find((p) => p.id === actor)?.bot)
        throw new ReconquistaOperationError('BOT_CONTROLLED');
      if (
        current.clock?.pauseReason === 'admin' ||
        current.clock?.pauseReason === 'restart'
      )
        throw new ReconquistaOperationError('GAME_PAUSED');
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
      if (result.duplicate) return { envelope: current, duplicate: true };
      this.sessions.set(id, result);
      const candidate = this.settle(
        {
          ...current,
          revision: current.baseRevision + result.revision,
          journal: result.journal,
        },
        Date.now(),
      );
      await this.persist(candidate);
      return { envelope: candidate, duplicate: false };
    });
  }
  private finished(current: ReconquistaEnvelope) {
    return (
      current.journal !== null &&
      this.replay(current).state.campaign?.phase === 'finished'
    );
  }
  /** Started games the server moves: an Express clock or seats bots play. */
  async running(): Promise<string[]> {
    const ids = [];
    for (const id of await this.ids()) {
      const current = await this.load(id).catch(() => undefined);
      if (
        current?.journal &&
        (current.express || current.players.some((p) => p.bot)) &&
        !this.finished(current)
      )
        ids.push(id);
    }
    return ids;
  }
  /** Commits a server move (a timeout or the end by time) on a started game. */
  private apply(
    current: ReconquistaEnvelope,
    actorId: string,
    action: SetupAction,
  ): ReconquistaEnvelope {
    const loaded = this.replay(current);
    const result = commitLoadedSetupCommand(
      this.catalog,
      loaded,
      actorId,
      randomUUID(),
      loaded.revision,
      action,
      this.randomness,
    );
    this.sessions.set(current.gameId, result);
    return {
      ...current,
      revision: current.baseRevision! + result.revision,
      journal: result.journal,
    };
  }
  /**
   * Brings the Express clock up to date after the game changed: a new
   * activation gets its full time, the end of the final rounds finishes the
   * game and an absent seat rejects what it was offered.
   */
  private settle(current: ReconquistaEnvelope, now: number) {
    if (!current.express || !current.journal) return current;
    let next = current;
    const bots = new Set(next.players.filter((p) => p.bot).map((p) => p.id));
    // A bot answers for the seat it plays.
    for (const playerId of (next.clock?.absentPlayerIds ?? []).filter(
      (id) => !bots.has(id),
    ))
      for (const action of reconquistaDeclines(
        this.replay(next).state,
        playerId,
      )) {
        try {
          next = this.apply(next, playerId, action);
        } catch {
          this.sessions.delete(next.gameId);
          // Not answerable right now (an occupation is open): next time.
        }
      }
    let state = this.replay(next).state;
    const clock = next.clock;
    if (
      clock?.finalRound !== undefined &&
      state.campaign &&
      state.campaign.phase !== 'finished' &&
      state.campaign.round > clock.finalRound
    ) {
      next = this.apply(next, 'clock', { kind: 'time-limit' });
      state = this.replay(next).state;
    }
    const key = reconquistaActivationKey(state);
    if (clock?.activationKey === key) return next;
    return {
      ...next,
      clock: {
        elapsedMs: 0,
        absentPlayerIds: [],
        ...clock,
        updatedAtMs: Math.max(now, clock?.updatedAtMs ?? 0),
        activationKey: key,
        activationRemainingMs: reconquistaActivationMs(
          state,
          clock?.finalRound,
        ),
        technicalRemainingMs: undefined,
      },
    };
  }
  /** Plays out an activation whose time ran out, move by move. */
  private expire(current: ReconquistaEnvelope) {
    let next = current;
    const key = reconquistaActivationKey(this.replay(next).state);
    for (let i = 0; i < TIMEOUT_MOVES; i++) {
      const state = this.replay(next).state;
      if (reconquistaActivationKey(state) !== key) break;
      const move = reconquistaTimeoutMove(this.board, state, this.randomness);
      if (!move) break;
      next = this.apply(next, move.actorId, move.action);
    }
    return next;
  }
  /**
   * One second of a game the server moves, as Classic's clock tick: the turn
   * time runs, a disconnected player gets five minutes, an absent seat's turns
   * pass on their own or a bot plays them, and bots move every two seconds.
   * Returns whether screens should reload.
   */
  async tick(
    id: string,
    now: number,
    connected: (playerId: string) => boolean,
  ): Promise<boolean> {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      if (!current.journal || this.finished(current)) return false;
      let next = current;
      let changed = false;
      // A stopped clock waits for the host, people coming back included.
      if (
        current.clock?.pauseReason === 'admin' ||
        current.clock?.pauseReason === 'restart'
      )
        return false;
      // A person back at a seat a bot played for the absence takes it again.
      const returned = current.players.filter(
        (p) => p.bot === 'absent' && connected(p.id),
      );
      if (returned.length) {
        const ids = new Set(returned.map((p) => p.id));
        next = {
          ...next,
          players: next.players.map((p) => {
            if (!ids.has(p.id)) return p;
            const { bot: _bot, ...rest } = p;
            void _bot;
            return rest;
          }),
          ...(next.clock
            ? {
                clock: {
                  ...next.clock,
                  absentPlayerIds: next.clock.absentPlayerIds.filter(
                    (p) => !ids.has(p),
                  ),
                },
              }
            : {}),
        };
        changed = true;
      }
      if (next.express) {
        const clocked = this.clockTick(next, now, connected);
        if (clocked.changed) changed = true;
        next = clocked.next;
      }
      // Bots wait while the clock is stopped.
      if (
        !next.clock?.pauseReason &&
        now - (this.botMoves.get(id) ?? -Infinity) >= BOT_MOVE_GAP_MS
      ) {
        const moved = this.botMove(next);
        if (moved) {
          next = this.settle(moved, now);
          this.botMoves.set(id, now);
          changed = true;
        }
      }
      if (!next.express && !changed) return false;
      if (changed || next.revision !== current.revision) {
        await this.persist(next);
        this.clockSaved.set(id, now);
        return true;
      }
      if (now - (this.clockSaved.get(id) ?? 0) >= CLOCK_SAVE_MS) {
        await this.persist(next);
        this.clockSaved.set(id, now);
      } else this.committed.set(id, structuredClone(next));
      return false;
    });
  }
  /** The Express clock's second; `changed` is false when only the time ran. */
  private clockTick(
    current: ReconquistaEnvelope,
    now: number,
    connected: (playerId: string) => boolean,
  ): { next: ReconquistaEnvelope; changed: boolean } {
    if (!current.clock)
      return { next: this.settle(current, now), changed: true };
    let clock = current.clock;
    if (clock.pauseReason === 'admin' || clock.pauseReason === 'restart')
      return { next: current, changed: false };
    now = Math.max(now, clock.updatedAtMs);
    const state = this.replay(current).state;
    const delta = Math.max(0, now - clock.updatedAtMs);
    const actor = reconquistaActor(this.board, state)!;
    const seat = current.players.find((p) => p.id === actor);
    const present = connected(actor);
    // A bot never disconnects.
    const online = present || !!seat?.bot;
    let changed = false;
    // A returning player takes the seat back.
    if (present && clock.absentPlayerIds.includes(actor)) {
      clock = {
        ...clock,
        absentPlayerIds: clock.absentPlayerIds.filter((p) => p !== actor),
      };
      changed = true;
    }
    let next: ReconquistaEnvelope;
    if (clock.pauseReason === 'disconnection') {
      const technical = Math.max(
        0,
        (clock.technicalRemainingMs ?? RECONQUISTA_TECHNICAL_WAIT_MS) - delta,
      );
      clock = { ...clock, updatedAtMs: now, technicalRemainingMs: technical };
      // Once the wait is spent, the turn clock runs out the remaining time.
      if (technical === 0 || online) {
        clock = {
          ...clock,
          pauseReason: undefined,
          disconnectedPlayerId: undefined,
        };
        changed = true;
      }
      next = { ...current, clock };
    } else {
      const used = Math.min(delta, clock.activationRemainingMs);
      const elapsed = clock.elapsedMs + (state.campaign ? used : 0);
      clock = {
        ...clock,
        updatedAtMs: now,
        activationRemainingMs: clock.activationRemainingMs - used,
        elapsedMs: elapsed,
      };
      if (
        clock.finalRound === undefined &&
        state.campaign &&
        elapsed >= reconquistaExpressDurationMs(current.playerCount)
      ) {
        clock = { ...clock, finalRound: state.campaign.round + 2 };
        changed = true;
      }
      next = { ...current, clock };
      const absent = clock.absentPlayerIds.includes(actor);
      if (absent && !online) {
        next = this.expire(next);
        changed = true;
      } else if (
        !online &&
        (clock.technicalRemainingMs ?? RECONQUISTA_TECHNICAL_WAIT_MS) > 0
      ) {
        next = {
          ...next,
          clock: {
            ...clock,
            pauseReason: 'disconnection',
            disconnectedPlayerId: actor,
            technicalRemainingMs:
              clock.technicalRemainingMs ?? RECONQUISTA_TECHNICAL_WAIT_MS,
          },
        };
        changed = true;
      } else if (clock.activationRemainingMs === 0) {
        if (!online) {
          next = {
            ...next,
            clock: {
              ...clock,
              absentPlayerIds: [...clock.absentPlayerIds, actor],
            },
          };
          // A bot plays the absent seat's next turns, unless the host said no.
          if (current.botsReplaceAbsent !== false && !seat?.free)
            next = {
              ...next,
              players: next.players.map((p) =>
                p.id === actor ? { ...p, bot: 'absent' as const } : p,
              ),
            };
        }
        next = this.expire(next);
        changed = true;
      }
    }
    next = this.settle(next, now);
    return { next, changed: changed || next.revision !== current.revision };
  }
  /**
   * One bot move: answers to offers first, from any seat a bot plays, then
   * the bot on turn. A move the game rejects falls back to the timeout move.
   */
  private botMove(current: ReconquistaEnvelope): ReconquistaEnvelope | null {
    const bots = current.players.filter((p) => p.bot);
    if (!bots.length) return null;
    const state = this.replay(current).state;
    const actor = reconquistaActor(this.board, state);
    const level = current.botLevel ?? 'hard';
    const memory = structuredClone(current.botMemory ?? {}) as Record<
      string,
      ReconquistaBotMemory
    >;
    const answering = bots.find((p) => {
      if (p.id === actor) return false;
      const move = chooseReconquistaBotMove(
        this.board,
        state,
        p.id,
        level,
        this.randomness,
        {},
      );
      return (
        move?.kind === 'campaign' && move.action.kind.startsWith('respond')
      );
    });
    const player = answering ?? bots.find((p) => p.id === actor);
    if (!player) return null;
    const own = (memory[player.id] ??= {});
    const move = chooseReconquistaBotMove(
      this.board,
      state,
      player.id,
      level,
      this.randomness,
      own,
    );
    const withMemory = (next: ReconquistaEnvelope) => ({
      ...next,
      botMemory: memory,
    });
    if (move)
      try {
        return withMemory(this.apply(current, player.id, move));
      } catch {
        this.sessions.delete(current.gameId);
      }
    if (player.id !== actor) return null;
    const fallback = reconquistaTimeoutMove(
      this.board,
      this.replay(current).state,
      this.randomness,
    );
    if (!fallback) return null;
    try {
      return withMemory(this.apply(current, fallback.actorId, fallback.action));
    } catch {
      this.sessions.delete(current.gameId);
      return null;
    }
  }
  /** Host changes to bots: level, absences, or a bot in a seat. */
  async bots(id: string, input: unknown, now: number) {
    return this.coordinator.run(id, async () => {
      const change = reconquistaBotsSchema.parse(input);
      const current = await this.load(id);
      if (!current.journal || this.finished(current))
        throw new ReconquistaOperationError('INVALID_PHASE');
      let next: ReconquistaEnvelope;
      if ('playerId' in change) {
        const player = current.players.find((p) => p.id === change.playerId);
        const campaign = this.replay(current).state.campaign;
        if (!player || campaign?.eliminations[player.id])
          throw new ReconquistaOperationError('INVALID_PHASE');
        let players = current.players;
        let clock = current.clock;
        const without = () => {
          const { bot: _bot, ...rest } = player;
          void _bot;
          return rest;
        };
        if (player.bot === 'table') {
          // Express frees a table bot's seat; elsewhere table bots stay.
          if (change.enabled || !current.express || !clock)
            throw new ReconquistaOperationError('INVALID_PHASE');
          players = players.map((p) =>
            p.id === player.id ? { ...without(), free: true as const } : p,
          );
          // Its turns pass on their own until someone takes the seat.
          clock = {
            ...clock,
            absentPlayerIds: [...clock.absentPlayerIds, player.id],
          };
        } else if (change.enabled) {
          if (player.bot || player.free)
            throw new ReconquistaOperationError('INVALID_PHASE');
          players = players.map((p) =>
            p.id === player.id ? { ...p, bot: 'admin' as const } : p,
          );
          if (clock?.disconnectedPlayerId === player.id)
            clock = {
              ...clock,
              updatedAtMs: now,
              pauseReason: undefined,
              disconnectedPlayerId: undefined,
            };
        } else {
          if (!player.bot) throw new ReconquistaOperationError('INVALID_PHASE');
          players = players.map((p) => (p.id === player.id ? without() : p));
          if (clock)
            clock = {
              ...clock,
              absentPlayerIds: clock.absentPlayerIds.filter(
                (p) => p !== player.id,
              ),
            };
        }
        next = {
          ...current,
          players,
          ...(clock ? { clock } : {}),
        };
      } else {
        const {
          botLevel: _level,
          botsReplaceAbsent: _absent,
          ...rest
        } = current;
        void _level;
        void _absent;
        const level = change.level ?? current.botLevel ?? 'hard';
        const replace =
          change.replaceAbsent ?? current.botsReplaceAbsent !== false;
        next = {
          ...rest,
          ...(level !== 'hard' ? { botLevel: level } : {}),
          ...(replace ? {} : { botsReplaceAbsent: false as const }),
        };
      }
      await this.persist(next);
      return next;
    });
  }
  /** A person takes a seat a table bot left free, under their own name. */
  async takeSeat(id: string, input: unknown) {
    return this.coordinator.run(id, async () => {
      const body = reconquistaTakeSeatSchema.parse(input);
      const current = await this.load(id);
      const seat = current.players.find((p) => p.id === body.playerId);
      if (!seat?.free || this.finished(current))
        throw new ReconquistaOperationError('SEAT_TAKEN');
      if (
        current.players.some(
          (p) => p.id !== seat.id && sameNickname(p.nickname, body.nickname),
        )
      )
        throw new ReconquistaOperationError('NICKNAME_IN_USE');
      const token = generateSessionToken();
      const expiresAt = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const next: ReconquistaEnvelope = {
        ...current,
        players: current.players.map((p) =>
          p.id === seat.id
            ? {
                id: p.id,
                color: p.color,
                ready: true,
                nickname: body.nickname,
                session: hashSessionToken(token),
                expiresAt,
              }
            : p,
        ),
        ...(current.clock
          ? {
              clock: {
                ...current.clock,
                absentPlayerIds: current.clock.absentPlayerIds.filter(
                  (p) => p !== seat.id,
                ),
              },
            }
          : {}),
      };
      await this.persist(next);
      return { playerId: seat.id, token, expiresAt };
    });
  }
  /** The host stops or resumes the clock; a disconnection wait runs on its own. */
  async pause(id: string, paused: boolean, now: number) {
    return this.coordinator.run(id, async () => {
      const current = await this.load(id);
      if (!current.clock || this.finished(current))
        throw new ReconquistaOperationError('INVALID_PHASE');
      if (paused && current.clock.pauseReason === 'disconnection')
        throw new ReconquistaOperationError('INVALID_PHASE');
      const next = {
        ...current,
        clock: {
          ...current.clock,
          updatedAtMs: now,
          pauseReason: paused ? ('admin' as const) : undefined,
          disconnectedPlayerId: undefined,
        },
      };
      await this.persist(next);
      return next;
    });
  }
}
