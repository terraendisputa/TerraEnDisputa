import {
  resolveGameRuntime,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  pauseCompetitiveClock,
  selectCompetitiveTerritory,
  requestCompetitiveBot,
  hasGameClock,
  markCompetitiveInactive,
  competitiveActor,
  chooseBotCommand,
  applyBotCommand,
  assignCompetitiveBot,
  type GameState,
  type GameplayCommand,
  type PlayerId,
} from '@game/game-engine';
import type { ClientCommand, CommandPayload } from '@game/protocol';
import {
  PersistenceFailedError,
  PersistenceIndeterminateError,
} from '../persistence/atomic-file.js';
import type {
  CommitResult,
  CommittedCommandRecord,
  DurableGame,
} from '../persistence/types.js';
import {
  StaleAuthenticationStateError,
  StaleGameRevisionError,
} from '../persistence/file-game-store.js';
import { RECENT_COMMAND_RETENTION } from '../persistence/types.js';
import { commandFingerprint } from './canonical-command.js';
import { PerGameCoordinator } from './per-game-coordinator.js';
import { secureGameRandomness } from './randomness.js';

interface CommandGameStore {
  loadGame(gameId: string): Promise<DurableGame | undefined>;
  commitGame(
    candidate: DurableGame,
    expected?: {
      readonly authGeneration?: number;
      readonly revision?: number | null;
    },
  ): Promise<CommitResult>;
}

type CommandOutcome =
  | {
      readonly kind: 'COMMITTED' | 'DUPLICATE';
      readonly revision: number;
      readonly durable: DurableGame;
    }
  | {
      readonly kind: 'REJECTED';
      readonly code: string;
      readonly message: string;
      readonly revision?: number;
      readonly stateChanged?: boolean;
    }
  | {
      readonly kind: 'FAILED' | 'INDETERMINATE';
      readonly code: 'PERSISTENCE_FAILURE' | 'GAME_UNAVAILABLE';
      readonly message: string;
    };

function validateTerritories(
  command: CommandPayload,
  territoryIds: ReadonlySet<string>,
): boolean {
  const values: string[] = [];
  if ('territoryId' in command && typeof command.territoryId === 'string')
    values.push(command.territoryId);
  if ('from' in command) values.push(command.from, command.to);
  if ('cardId' in command) values.push(command.cardId);
  if ('cardIds' in command) values.push(...command.cardIds);
  if ('placements' in command) values.push(...Object.keys(command.placements));
  if ('terms' in command) {
    if (command.terms.kind === 'border_non_aggression')
      values.push(...command.terms.territoryIds);
    if (command.terms.kind === 'international_zone')
      values.push(command.terms.territoryId);
  }
  return values.every((value) => territoryIds.has(value));
}

function execute(
  state: GameState,
  playerId: PlayerId,
  payload: CommandPayload,
) {
  const runtime = resolveGameRuntime(state.definition);
  if (
    !validateTerritories(payload, new Set<string>(runtime.board.territoryIds))
  )
    return {
      ok: false as const,
      error: {
        code: 'INVALID_TERRITORY',
        message: 'Invalid territory identifier',
      },
    };
  if (payload.type === 'select_reinforcement_country') {
    try {
      return {
        ok: true as const,
        state: selectCompetitiveTerritory(
          state,
          playerId,
          payload.territoryId as import('@game/game-engine').TerritoryId,
        ),
      };
    } catch {
      return {
        ok: false as const,
        error: { code: 'INVALID_PLACEMENT', message: 'Invalid selection' },
      };
    }
  }
  if (state.competitiveClock?.pauseReason)
    return {
      ok: false as const,
      error: { code: 'GAME_PAUSED', message: 'Game is paused' },
    };
  if (payload.type === 'request_bot') {
    try {
      return {
        ok: true as const,
        state: requestCompetitiveBot(state, playerId),
      };
    } catch {
      return {
        ok: false as const,
        error: { code: 'INVALID_PHASE', message: 'A bot cannot take over now' },
      };
    }
  }
  if (state.players.find((p) => p.id === playerId)?.disqualified)
    return {
      ok: false as const,
      error: { code: 'PLAYER_DISQUALIFIED', message: 'Player is disqualified' },
    };
  if (state.players.find((p) => p.id === playerId)?.bot)
    return {
      ok: false as const,
      error: { code: 'BOT_CONTROLLED', message: 'A bot plays this seat' },
    };
  if (payload.type === 'set_ready') {
    if (state.status !== 'LOBBY')
      return {
        ok: false as const,
        error: {
          code: 'INVALID_LIFECYCLE_STATE',
          message: 'Ready state is lobby-only',
        },
      };
    const ready = new Set(state.readyPlayerIds);
    if (payload.ready) ready.add(playerId);
    else ready.delete(playerId);
    return {
      ok: true as const,
      state: { ...state, readyPlayerIds: [...ready] },
    };
  }
  if (state.status === 'SETUP') {
    if (payload.type !== 'place_setup_armies')
      return {
        ok: false as const,
        error: {
          code: 'INVALID_PHASE',
          message: 'Command is not valid during setup',
        },
      };
    return runtime.applySetupCommand(state, { ...payload, playerId });
  }
  return runtime.applyCommand(
    state,
    { ...payload, playerId } as GameplayCommand,
    {
      dice: secureGameRandomness,
      shuffle: secureGameRandomness,
    },
  );
}

// Only these measurements may advance without invalidating a player's intent.
// Turn changes, pauses, inheritance, final announcements and every other field
// remain part of the comparison. Ranges are volatile: restart fails closed.
function clockOnlyChange(before: GameState, after: GameState): boolean {
  if (
    !hasGameClock(before) ||
    !before.competitiveClock ||
    !after.competitiveClock
  )
    return false;
  const context = (s: GameState) => {
    const {
      updatedAtMs,
      elapsedMs,
      activationRemainingMs,
      technicalRemainingMs,
      ...clock
    } = s.competitiveClock!;
    void updatedAtMs;
    void elapsedMs;
    void activationRemainingMs;
    void technicalRemainingMs;
    return { ...s, competitiveClock: clock };
  };
  return JSON.stringify(context(before)) === JSON.stringify(context(after));
}

/**
 * One move per clock tick for a seat the server plays, so everyone can follow
 * it on the map. A rejected move leaves the turn to its timer.
 */
function playBot(state: GameState, now: number): GameState {
  if (state.mode !== 'competitive' || state.competitiveClock?.pauseReason)
    return state;
  const actor = competitiveActor(state);
  if (!actor || !state.players.find((p) => p.id === actor)?.bot) return state;
  const command = chooseBotCommand(
    state,
    actor,
    state.competitiveBotLevel ?? 'hard',
    secureGameRandomness,
  );
  if (!command) return state;
  const result = applyBotCommand(state, command, {
    dice: secureGameRandomness,
    shuffle: secureGameRandomness,
  });
  return result.ok
    ? synchronizeCompetitiveClock(state, result.state, now)
    : state;
}

export class GameService {
  private readonly clockRevisionRanges = new Map<
    string,
    { first: number; last: number; authGeneration: number }
  >();
  constructor(
    private readonly store: CommandGameStore,
    private readonly coordinator = new PerGameCoordinator(),
    private readonly now: () => number = Date.now,
    private readonly connected: (
      gameId: string,
      playerId: PlayerId,
    ) => boolean = () => true,
  ) {}

  async recoverClock(gameId: string): Promise<void> {
    this.clockRevisionRanges.delete(gameId);
    await this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current) return;
      const timestamp = this.now();
      const initial =
        current.state.status === 'FINISHED' &&
        current.state.pendingInheritance &&
        current.state.competitiveClock
          ? {
              ...current.state,
              competitiveClock: {
                ...current.state.competitiveClock,
                updatedAtMs: timestamp,
                pauseReason: undefined,
              },
            }
          : current.state;
      const state =
        initial.status === 'FINISHED' && initial.pendingInheritance
          ? tickCompetitiveClock(
              initial,
              timestamp,
              false,
              secureGameRandomness,
            )
          : startCompetitiveClock(initial, timestamp, true);
      if (state === current.state) return;
      await this.store.commitGame(
        { ...current, state, revision: current.revision + 1 },
        { authGeneration: current.auth.generation, revision: current.revision },
      );
    });
  }
  async freezeClock(gameId: string): Promise<void> {
    this.clockRevisionRanges.delete(gameId);
    await this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current || !hasGameClock(current.state)) return;
      const now = this.now();
      const actor = competitiveActor(current.state);
      const accounted = tickCompetitiveClock(
        current.state,
        now,
        actor ? this.connected(gameId, actor) : true,
        secureGameRandomness,
      );
      const state = startCompetitiveClock(accounted, now, true);
      if (state === current.state) return;
      await this.store.commitGame(
        { ...current, state, revision: current.revision + 1 },
        { authGeneration: current.auth.generation, revision: current.revision },
      );
    });
  }
  async tick(gameId: string): Promise<boolean> {
    return this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current) {
        this.clockRevisionRanges.delete(gameId);
        return false;
      }
      const actor = competitiveActor(current.state);
      const now = this.now();
      const state = playBot(
        tickCompetitiveClock(
          current.state,
          now,
          actor ? this.connected(gameId, actor) : true,
          secureGameRandomness,
        ),
        now,
      );
      if (JSON.stringify(state) === JSON.stringify(current.state)) return false;
      const range = this.clockRevisionRanges.get(gameId);
      const measurementsOnly = clockOnlyChange(current.state, state);
      await this.store.commitGame(
        { ...current, state, revision: current.revision + 1 },
        { authGeneration: current.auth.generation, revision: current.revision },
      );
      if (measurementsOnly) {
        this.clockRevisionRanges.set(gameId, {
          first:
            range?.last === current.revision &&
            range.authGeneration === current.auth.generation
              ? range.first
              : current.revision,
          last: current.revision + 1,
          authGeneration: current.auth.generation,
        });
      } else this.clockRevisionRanges.delete(gameId);
      return true;
    });
  }
  /** Administrator changes to the bots of a Competitive game. */
  async updateBots(
    gameId: string,
    change:
      | {
          readonly level?: 'easy' | 'normal' | 'hard';
          readonly replaceAbsent?: boolean;
        }
      | { readonly playerId: string; readonly enabled: boolean }
      | { readonly playerId: string; readonly inactive: boolean },
  ): Promise<number> {
    this.clockRevisionRanges.delete(gameId);
    return this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current) throw new Error('GAME_NOT_FOUND');
      let state = current.state;
      if (state.mode !== 'competitive' || state.status === 'FINISHED')
        throw new Error('INVALID_PHASE');
      if ('playerId' in change) {
        const now = this.now();
        const actor = competitiveActor(state);
        state = tickCompetitiveClock(
          state,
          now,
          actor ? this.connected(gameId, actor) : true,
          secureGameRandomness,
        );
        state =
          'inactive' in change
            ? markCompetitiveInactive(
                state,
                change.playerId as PlayerId,
                change.inactive,
              )
            : assignCompetitiveBot(
                state,
                change.playerId as PlayerId,
                change.enabled,
              );
      } else
        state = {
          ...state,
          ...(change.level ? { competitiveBotLevel: change.level } : {}),
          ...(change.replaceAbsent !== undefined
            ? { competitiveBotsReplaceAbsent: change.replaceAbsent }
            : {}),
        };
      await this.store.commitGame(
        { ...current, state, revision: current.revision + 1 },
        { authGeneration: current.auth.generation, revision: current.revision },
      );
      return current.revision + 1;
    });
  }
  async pause(gameId: string, paused: boolean): Promise<number> {
    this.clockRevisionRanges.delete(gameId);
    return this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current) throw new Error('GAME_NOT_FOUND');
      const now = this.now();
      const actor = competitiveActor(current.state);
      const accounted = tickCompetitiveClock(
        current.state,
        now,
        actor ? this.connected(gameId, actor) : true,
        secureGameRandomness,
      );
      if (
        !paused &&
        accounted.players.some(
          (p) =>
            !p.eliminated &&
            !p.disqualified &&
            !p.absent &&
            !p.bot &&
            !this.connected(gameId, p.id),
        )
      )
        throw new Error('PLAYERS_UNAVAILABLE');
      const state = pauseCompetitiveClock(accounted, now, paused);
      await this.store.commitGame(
        { ...current, state, revision: current.revision + 1 },
        { authGeneration: current.auth.generation, revision: current.revision },
      );
      return current.revision + 1;
    });
  }
  process(
    gameId: string,
    playerId: PlayerId,
    command: ClientCommand,
    authorize: (durable: DurableGame) => boolean = () => true,
  ): Promise<CommandOutcome> {
    return this.coordinator.run(gameId, async () => {
      let current: DurableGame | undefined;
      try {
        current = await this.store.loadGame(gameId);
      } catch {
        return {
          kind: 'INDETERMINATE',
          code: 'GAME_UNAVAILABLE',
          message: 'Game is unavailable until restart recovery',
        };
      }
      if (!current)
        return {
          kind: 'REJECTED',
          code: 'GAME_NOT_FOUND',
          message: 'Game not found',
        };
      if (!current.state.players.some((player) => player.id === playerId))
        return {
          kind: 'REJECTED',
          code: 'UNAUTHORIZED',
          message: 'Player is not a member of this game',
        };
      if (!authorize(current))
        return {
          kind: 'REJECTED',
          code: 'UNAUTHORIZED',
          message: 'Player authority is no longer valid',
          revision: current.revision,
        };

      const fingerprint = commandFingerprint({
        baseRevision: command.baseRevision,
        command: command.command,
      });
      const prior = current.recentCommands.find(
        (record) => record.commandId === command.commandId,
      );
      if (prior)
        return prior.fingerprint === fingerprint
          ? {
              kind: 'DUPLICATE',
              revision: prior.committedRevision,
              durable: current,
            }
          : {
              kind: 'REJECTED',
              code: 'COMMAND_ID_REUSED',
              message: 'Command ID was already used for different contents',
              revision: current.revision,
            };
      const range = this.clockRevisionRanges.get(gameId);
      const clockOnlyRevision =
        hasGameClock(current.state) &&
        range?.last === current.revision &&
        range.authGeneration === current.auth.generation &&
        command.baseRevision >= range.first &&
        command.baseRevision <= range.last;
      if (command.baseRevision !== current.revision && !clockOnlyRevision)
        return {
          kind: 'REJECTED',
          code: 'STALE_REVISION',
          message: 'Command is based on an older game revision',
          revision: current.revision,
        };

      const timestamp = this.now();
      const initial = startCompetitiveClock(current.state, timestamp);
      const actor = competitiveActor(initial);
      const timed = tickCompetitiveClock(
        initial,
        timestamp,
        actor ? this.connected(gameId, actor) : true,
        secureGameRandomness,
      );
      const temporalBoundary =
        initial.competitiveClock?.activationKey !==
          timed.competitiveClock?.activationKey ||
        initial.competitiveClock?.pauseReason !==
          timed.competitiveClock?.pauseReason ||
        initial.competitiveClock?.finalRoundNumber !==
          timed.competitiveClock?.finalRoundNumber ||
        initial.status !== timed.status ||
        initial.players.some(
          (p, i) =>
            p.disqualified !== timed.players[i]?.disqualified ||
            p.absent !== timed.players[i]?.absent ||
            p.bot !== timed.players[i]?.bot,
        ) ||
        !!initial.pendingInheritance !== !!timed.pendingInheritance;
      if (temporalBoundary) {
        this.clockRevisionRanges.delete(gameId);
        try {
          await this.store.commitGame(
            { ...current, state: timed, revision: current.revision + 1 },
            {
              authGeneration: current.auth.generation,
              revision: current.revision,
            },
          );
        } catch (error) {
          return error instanceof PersistenceIndeterminateError
            ? {
                kind: 'INDETERMINATE',
                code: 'GAME_UNAVAILABLE',
                message: 'Clock commit is uncertain',
              }
            : error instanceof StaleGameRevisionError ||
                error instanceof StaleAuthenticationStateError
              ? {
                  kind: 'REJECTED',
                  code: 'STALE_REVISION',
                  message: 'Game changed concurrently',
                }
              : {
                  kind: 'FAILED',
                  code: 'PERSISTENCE_FAILURE',
                  message: 'Clock boundary was not committed',
                };
        }
        return {
          kind: 'REJECTED',
          code: 'STALE_REVISION',
          message: 'A clock boundary changed the game',
          revision: current.revision + 1,
          stateChanged: true,
        };
      }
      const transition = execute(timed, playerId, command.command);
      if (!transition.ok)
        return {
          kind: 'REJECTED',
          code: transition.error.code,
          message: transition.error.message,
          revision: current.revision,
        };
      const nextRevision = current.revision + 1;
      const record: CommittedCommandRecord = {
        commandId: command.commandId,
        fingerprint,
        committedRevision: nextRevision,
      };
      const candidate: DurableGame = {
        ...current,
        state: synchronizeCompetitiveClock(timed, transition.state, timestamp),
        revision: nextRevision,
        recentCommands: [...current.recentCommands, record].slice(
          -RECENT_COMMAND_RETENTION,
        ),
      };
      try {
        await this.store.commitGame(candidate, {
          authGeneration: current.auth.generation,
          revision: current.revision,
        });
        this.clockRevisionRanges.delete(gameId);
        return {
          kind: 'COMMITTED',
          revision: nextRevision,
          durable: candidate,
        };
      } catch (error) {
        if (
          error instanceof StaleGameRevisionError ||
          error instanceof StaleAuthenticationStateError
        ) {
          const latest = await this.store.loadGame(gameId);
          const committed = latest?.recentCommands.find(
            ({ commandId }) => commandId === command.commandId,
          );
          if (latest && committed?.fingerprint === fingerprint)
            return {
              kind: 'DUPLICATE',
              revision: committed.committedRevision,
              durable: latest,
            };
          return {
            kind: 'REJECTED',
            code: 'STALE_REVISION',
            message: 'Game authority changed concurrently',
            ...(latest ? { revision: latest.revision } : {}),
          };
        }
        if (error instanceof PersistenceIndeterminateError)
          return {
            kind: 'INDETERMINATE',
            code: 'GAME_UNAVAILABLE',
            message:
              'Persistence outcome is uncertain; the game is unavailable until restart',
          };
        if (error instanceof PersistenceFailedError)
          return {
            kind: 'FAILED',
            code: 'PERSISTENCE_FAILURE',
            message: 'The command could not be persisted',
          };
        return {
          kind: 'FAILED',
          code: 'PERSISTENCE_FAILURE',
          message: 'The command could not be committed',
        };
      }
    });
  }
}
