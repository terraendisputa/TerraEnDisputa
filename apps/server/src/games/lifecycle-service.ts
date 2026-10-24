import {
  CLASSIC_GAME_DEFINITION,
  resolveGameDefinition,
  resolveGameRuntime,
  startCompetitiveClock,
  SetupDealExhaustedError,
  type GameId,
  type GameMode,
  validPlayerCount,
  type SetupRandomness,
} from '@game/game-engine';

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
  ): Promise<number> {
    return this.coordinator.run(gameId, async () => {
      const current = await this.requireGame(gameId);
      if (current.state.status !== 'LOBBY')
        throw new LifecycleOperationError('INVALID_LIFECYCLE_STATE');
      if (
        !validPlayerCount(current.state.mode, configuredPlayerCount) ||
        configuredPlayerCount < current.state.players.length
      )
        throw new LifecycleOperationError('INVALID_GAME_COMMAND');
      const revision = current.revision + 1;
      await this.store.commitGame(
        {
          ...current,
          state: { ...current.state, configuredPlayerCount },
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
        current.state.players.length !== current.state.configuredPlayerCount ||
        current.state.readyPlayerIds.length !== current.state.players.length
      )
        throw new LifecycleOperationError('INVALID_GAME_COMMAND');
      const revision = current.revision + 1;
      const state = (() => {
        try {
          return resolveGameRuntime(current.state.definition).createSetup(
            current.state.id,
            current.state.players,
            this.randomness,
            current.state.mode,
          );
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
