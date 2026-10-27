import { randomUUID } from 'node:crypto';

import {
  CLASSIC_GAME_DEFINITION,
  COMPETITIVE_BOT_NAMES,
  humanSeats,
  PLAYER_COLORS,
  type PlayerId,
  type PlayerState,
  resolveGameDefinition,
  resolveGameRuntime,
  startCompetitiveClock,
  SetupDealExhaustedError,
  type GameId,
  type GameMode,
  validPlayerCount,
  type SetupRandomness,
} from '@game/game-engine';
import { sameNickname } from '@game/protocol';

import { emptyGameAuthState } from '../auth/types.js';
import {
  StaleGameRevisionError,
  type FileGameStore,
} from '../persistence/file-game-store.js';
import { PerGameCoordinator } from './per-game-coordinator.js';

export class LifecycleOperationError extends Error {
  constructor(
    readonly code:
      | 'GAME_NOT_FOUND'
      | 'INVALID_LIFECYCLE_STATE'
      | 'INVALID_GAME_COMMAND'
      | 'STALE_REVISION'
      | 'SETUP_DEAL_EXHAUSTED',
  ) {
    super(code);
    this.name = 'LifecycleOperationError';
  }
}

export class GameLifecycleService {
  constructor(
    private readonly store: FileGameStore,
    private readonly coordinator: PerGameCoordinator,
    private readonly randomness: SetupRandomness,
    private readonly generateGameId: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  async create(
    configuredPlayerCount: 2 | 3 | 4 | 5 | 6,
    mode: GameMode = 'classic',
    requestedDefinition: unknown = CLASSIC_GAME_DEFINITION,
  ): Promise<GameId> {
    const definition = resolveGameDefinition(requestedDefinition);
    if (!validPlayerCount(mode, configuredPlayerCount))
      throw new LifecycleOperationError('INVALID_GAME_COMMAND');
    for (let attempt = 0; attempt < 8; attempt++) {
      const gameId = this.generateGameId() as GameId;
      try {
        await this.store.commitGame(
          {
            state: {
              id: gameId,
              definition,
              status: 'LOBBY',
              mode,
              configuredPlayerCount,
              players: [],
              readyPlayerIds: [],
            },
            revision: 0,
            recentCommands: [],
            auth: emptyGameAuthState(),
          },
          { revision: null },
        );
        return gameId;
      } catch (error) {
        if (!(error instanceof StaleGameRevisionError)) throw error;
      }
    }
    throw new LifecycleOperationError('STALE_REVISION');
  }

  configure(
    gameId: string,
    configuredPlayerCount: 2 | 3 | 4 | 5 | 6,
    competitiveDurationMinutes?: 60 | 80,
    competitiveBotSeats?: 2,
  ): Promise<number> {
    return this.coordinator.run(gameId, async () => {
      const current = await this.requireGame(gameId);
      if (current.state.status !== 'LOBBY')
        throw new LifecycleOperationError('INVALID_LIFECYCLE_STATE');
      if (
        !validPlayerCount(current.state.mode, configuredPlayerCount) ||
        humanSeats({ configuredPlayerCount, competitiveBotSeats }) <
          current.state.players.length ||
        (competitiveDurationMinutes !== undefined &&
          current.state.mode !== 'competitive') ||
        (competitiveBotSeats !== undefined &&
          (current.state.mode !== 'competitive' ||
            configuredPlayerCount !== 6 ||
            competitiveDurationMinutes === 60))
      )
        throw new LifecycleOperationError('INVALID_GAME_COMMAND');
      const revision = current.revision + 1;
      // A bot table always plays 1:20 h, so it drops an earlier Express choice.
      const {
        competitiveBotSeats: _seats,
        competitiveDurationMinutes: _minutes,
        ...rest
      } = current.state;
      void _seats;
      void _minutes;
      const previousMinutes = competitiveBotSeats
        ? undefined
        : (competitiveDurationMinutes ?? _minutes);
      await this.store.commitGame(
        {
          ...current,
          state: {
            ...rest,
            configuredPlayerCount,
            ...(previousMinutes
              ? { competitiveDurationMinutes: previousMinutes }
              : {}),
            ...(competitiveBotSeats ? { competitiveBotSeats } : {}),
          },
          revision,
        },
        {
          authGeneration: current.auth.generation,
          revision: current.revision,
        },
      );
      return revision;
    });
  }

  start(gameId: string): Promise<number> {
    return this.coordinator.run(gameId, async () => {
      const current = await this.requireGame(gameId);
      if (current.state.status !== 'LOBBY')
        throw new LifecycleOperationError('INVALID_LIFECYCLE_STATE');
      if (
        current.state.players.length !== humanSeats(current.state) ||
        current.state.readyPlayerIds.length !== current.state.players.length
      )
        throw new LifecycleOperationError('INVALID_GAME_COMMAND');
      const revision = current.revision + 1;
      const players = [
        ...current.state.players,
        ...this.tableBots(
          current.state.players,
          current.state.competitiveBotSeats ?? 0,
        ),
      ];
      const state = (() => {
        try {
          const setup = resolveGameRuntime(
            current.state.definition,
          ).createSetup(
            current.state.id,
            players,
            this.randomness,
            current.state.mode,
            current.state.competitiveBotSeats,
          );
          return current.state.competitiveDurationMinutes
            ? {
                ...setup,
                competitiveDurationMinutes:
                  current.state.competitiveDurationMinutes,
              }
            : setup;
        } catch (error) {
          if (error instanceof SetupDealExhaustedError)
            throw new LifecycleOperationError('SETUP_DEAL_EXHAUSTED');
          throw error;
        }
      })();
      await this.store.commitGame(
        {
          ...current,
          state: startCompetitiveClock(state, this.now()),
          revision,
        },
        {
          authGeneration: current.auth.generation,
          revision: current.revision,
        },
      );
      return revision;
    });
  }

  /**
   * The bots that complete a four plus two table: free seats and colors, and
   * names from the list at random that no person at the table uses.
   */
  private tableBots(
    people: readonly PlayerState[],
    count: number,
  ): PlayerState[] {
    if (!count) return [];
    const names = this.randomness
      .shuffle(COMPETITIVE_BOT_NAMES)
      .filter((name) => !people.some((p) => sameNickname(p.nickname, name)));
    const colors = this.randomness
      .shuffle(PLAYER_COLORS)
      .filter((color) => !people.some((p) => p.color === color));
    const seats = [0, 1, 2, 3, 4, 5].filter(
      (seat) => !people.some((p) => p.seatIndex === seat),
    );
    return Array.from({ length: count }, (_, i) => ({
      id: randomUUID() as PlayerId,
      seatIndex: seats[i]!,
      nickname: names[i]!,
      color: colors[i]!,
      controller: 'controlled' as const,
      eliminated: false,
      cards: [],
      completedExchangeCount: 0,
      bot: 'table' as const,
    }));
  }

  delete(gameId: string): Promise<void> {
    return this.coordinator.run(gameId, async () => {
      if (!(await this.store.deleteGame(gameId)))
        throw new LifecycleOperationError('GAME_NOT_FOUND');
    });
  }

  private async requireGame(gameId: string) {
    const current = await this.store.loadGame(gameId);
    if (!current) throw new LifecycleOperationError('GAME_NOT_FOUND');
    return current;
  }
}
