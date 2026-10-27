import type { GameState, PlayerId, PlayerState } from '@game/game-engine';
import { humanSeats } from '@game/game-engine';
import { sameNickname } from '@game/protocol';

import type { CommitResult, DurableGame } from '../persistence/types.js';
import { PerGameCoordinator } from '../games/per-game-coordinator.js';
import {
  generateRecoveryCode,
  generateSessionToken,
  hashRecoveryCode,
  hashSessionToken,
  verifyRecoveryCode,
  verifySessionToken,
} from './crypto.js';
import {
  CURRENT_AUTH_SCHEMA_VERSION,
  type ActiveSession,
  type AdminAuthState,
  type GameAuthState,
  type IssuedSession,
  type PlayerAuthRecord,
  type TransportClass,
} from './types.js';

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000;

export class AuthenticationOperationError extends Error {
  constructor(
    readonly code:
      | 'GAME_NOT_FOUND'
      | 'PLAYER_NOT_FOUND'
      | 'INVALID_LIFECYCLE_STATE'
      | 'INVALID_GAME_COMMAND'
      | 'COLOR_ALREADY_IN_USE'
      | 'NICKNAME_ALREADY_IN_USE',
  ) {
    super(code);
    this.name = 'AuthenticationOperationError';
  }
}

interface Clock {
  now(): Date;
}

interface AuthenticationStore {
  loadAdminAuth(): Promise<AdminAuthState | undefined>;
  commitAdminAuth(
    candidate: AdminAuthState,
    expectedGeneration: number | null,
  ): Promise<CommitResult>;
  loadGame(gameId: string): Promise<DurableGame | undefined>;
  commitGame(
    candidate: DurableGame,
    expected?: {
      readonly authGeneration?: number;
      readonly revision?: number | null;
    },
  ): Promise<CommitResult>;
}

interface PlayerCredentials {
  readonly sessionToken: string;
}

const systemClock: Clock = { now: () => new Date() };

function nextAdminGeneration(generation: number): number {
  if (generation >= Number.MAX_SAFE_INTEGER)
    throw new Error('Administrator authentication generation is exhausted');
  return generation + 1;
}

function issueSession(
  transportClass: TransportClass,
  now: Date,
): IssuedSession {
  const token = generateSessionToken();
  return {
    token,
    session: {
      verifier: hashSessionToken(token),
      transportClass,
      lastActiveAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
    },
  };
}

const validSession = (
  session: ActiveSession | undefined,
  token: string,
  transportClass: TransportClass,
  now: Date,
) =>
  session !== undefined &&
  session.transportClass === transportClass &&
  Date.parse(session.expiresAt) > now.getTime() &&
  verifySessionToken(token, session.verifier);

function withPlayers(
  game: GameState,
  players: GameState['players'],
): GameState {
  switch (game.status) {
    case 'LOBBY':
      return { ...game, players };
    case 'SETUP':
      return { ...game, players };
    case 'ACTIVE':
      return { ...game, players };
    case 'FINISHED':
      return { ...game, players };
  }
}

function withController(
  game: GameState,
  playerId: PlayerId,
  controller: 'controlled' | 'controllerless_reassignment',
): GameState {
  return withPlayers(
    game,
    game.players.map((player) =>
      player.id === playerId ? { ...player, controller } : player,
    ),
  );
}

class AuthenticationTransitions {
  constructor(private readonly clock: Clock) {}

  async createAdmin(generation: number): Promise<{
    readonly state: AdminAuthState;
    readonly recoveryCode: string;
  }> {
    const recoveryCode = generateRecoveryCode();
    return {
      state: {
        authSchemaVersion: CURRENT_AUTH_SCHEMA_VERSION,
        generation,
        recovery: await hashRecoveryCode(recoveryCode),
      },
      recoveryCode,
    };
  }

  async loginAdmin(
    state: AdminAuthState,
    recoveryCode: string,
    transportClass: TransportClass,
  ): Promise<
    | { readonly state: AdminAuthState; readonly sessionToken: string }
    | undefined
  > {
    if (!(await verifyRecoveryCode(recoveryCode, state.recovery)))
      return undefined;
    const issued = issueSession(transportClass, this.clock.now());
    return {
      state: {
        ...state,
        generation: nextAdminGeneration(state.generation),
        session: issued.session,
      },
      sessionToken: issued.token,
    };
  }

  createPlayer(
    state: GameAuthState,
    playerId: PlayerId,
    transportClass: TransportClass,
  ): {
    readonly state: GameAuthState;
    readonly credentials: PlayerCredentials;
  } {
    if (state.players[playerId]) throw new Error('Player auth already exists');
    const issued = issueSession(transportClass, this.clock.now());
    return {
      state: this.withPlayer(state, playerId, {
        playerId,
        session: issued.session,
      }),
      credentials: { sessionToken: issued.token },
    };
  }

  private withPlayer(
    state: GameAuthState,
    playerId: PlayerId,
    player: PlayerAuthRecord,
  ): GameAuthState {
    return {
      ...state,
      generation: state.generation + 1,
      players: { ...state.players, [playerId]: player },
    };
  }
}

export class AuthenticationService {
  private readonly transitions: AuthenticationTransitions;
  private adminQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: AuthenticationStore,
    private readonly clock: Clock = systemClock,
    private readonly coordinator = new PerGameCoordinator(),
  ) {
    this.transitions = new AuthenticationTransitions(clock);
  }

  initializeAdmin(): Promise<string> {
    return this.serializeAdmin(async () => {
      if (await this.store.loadAdminAuth())
        throw new Error('Administrator authentication already exists');
      const candidate = await this.transitions.createAdmin(1);
      await this.store.commitAdminAuth(candidate.state, null);
      return candidate.recoveryCode;
    });
  }

  resetAdmin(): Promise<string> {
    return this.serializeAdmin(async () => {
      const state = await this.store.loadAdminAuth();
      if (!state)
        throw new Error('Administrator authentication does not exist');
      const candidate = await this.transitions.createAdmin(
        nextAdminGeneration(state.generation),
      );
      await this.store.commitAdminAuth(candidate.state, state.generation);
      return candidate.recoveryCode;
    });
  }

  loginAdmin(
    recoveryCode: string,
    transportClass: TransportClass,
  ): Promise<string | undefined> {
    return this.serializeAdmin(async () => {
      const state = await this.store.loadAdminAuth();
      if (!state) return undefined;
      const candidate = await this.transitions.loginAdmin(
        state,
        recoveryCode,
        transportClass,
      );
      if (!candidate) return undefined;
      await this.store.commitAdminAuth(candidate.state, state.generation);
      return candidate.sessionToken;
    });
  }

  async authenticateAdmin(
    token: string,
    transportClass: TransportClass,
  ): Promise<boolean> {
    const state = await this.store.loadAdminAuth();
    return (
      state !== undefined &&
      validSession(state.session, token, transportClass, this.clock.now())
    );
  }

  joinPlayer(
    gameId: string,
    player: PlayerState,
    transportClass: TransportClass,
    existingToken?: string,
  ): Promise<PlayerCredentials> {
    return this.requireMutation(
      this.mutateGame(gameId, (current) => {
        if (
          existingToken &&
          current.state.players.some(({ id }) =>
            this.isPlayerAuthorityValid(
              current,
              id,
              existingToken,
              transportClass,
            ),
          )
        )
          throw new AuthenticationOperationError('INVALID_GAME_COMMAND');
        if (current.state.status !== 'LOBBY')
          throw new AuthenticationOperationError('INVALID_LIFECYCLE_STATE');
        if (player.controller !== 'controlled')
          throw new Error('A joining player must control the new seat');
        if (current.state.players.some(({ id }) => id === player.id))
          throw new AuthenticationOperationError('INVALID_GAME_COMMAND');
        if (current.state.players.some(({ color }) => color === player.color))
          throw new AuthenticationOperationError('COLOR_ALREADY_IN_USE');
        if (
          current.state.players.some(({ nickname }) =>
            sameNickname(nickname, player.nickname),
          )
        )
          throw new AuthenticationOperationError('NICKNAME_ALREADY_IN_USE');
        if (current.state.players.length >= humanSeats(current.state))
          throw new AuthenticationOperationError('INVALID_GAME_COMMAND');
        const candidate = this.transitions.createPlayer(
          current.auth,
          player.id,
          transportClass,
        );
        const seatedPlayer = {
          ...player,
          seatIndex: Array.from(
            { length: current.state.configuredPlayerCount },
            (_, index) => index,
          ).find(
            (index) =>
              !current.state.players.some(
                (seated) => seated.seatIndex === index,
              ),
          )!,
        };
        return {
          durable: {
            ...current,
            state: {
              ...current.state,
              players: [...current.state.players, seatedPlayer],
            },
            auth: candidate.state,
            revision: current.revision + 1,
          },
          result: candidate.credentials,
        };
      }),
    );
  }

  /** Release requires the current session inside the same atomic mutation. */
  releasePlayer(
    gameId: string,
    token: string,
    transport: TransportClass,
  ): Promise<boolean> {
    return this.mutateGame(gameId, (current) => {
      const player = current.state.players.find(({ id }) =>
        this.isPlayerAuthorityValid(current, id, token, transport),
      );
      if (!player) return undefined;
      const lobby = current.state.status === 'LOBBY';
      const authPlayers = { ...current.auth.players };
      if (lobby) delete authPlayers[player.id];
      else authPlayers[player.id] = { playerId: player.id };
      const state =
        current.state.status === 'LOBBY'
          ? {
              ...current.state,
              players: current.state.players.filter(
                ({ id }) => id !== player.id,
              ),
              readyPlayerIds: current.state.readyPlayerIds.filter(
                (id) => id !== player.id,
              ),
            }
          : withController(
              current.state,
              player.id,
              'controllerless_reassignment',
            );
      return {
        durable: {
          ...current,
          state,
          revision: current.revision + 1,
          auth: {
            ...current.auth,
            generation: current.auth.generation + 1,
            players: authPlayers,
          },
        },
        result: true,
      };
    }).then((result) => result ?? false);
  }

  /** Public-link takeover is allowed only after an explicit release, never disconnect. */
  takeAvailableSeat(
    gameId: string,
    playerId: PlayerId,
    transport: TransportClass,
    existingToken?: string,
  ): Promise<string | undefined> {
    return this.mutateGame(gameId, (current) => {
      if (
        existingToken &&
        current.state.players.some(({ id }) =>
          this.isPlayerAuthorityValid(current, id, existingToken, transport),
        )
      )
        return undefined;
      const player = current.state.players.find(({ id }) => id === playerId);
      const record = current.auth.players[playerId];
      if (
        player?.controller !== 'controllerless_reassignment' ||
        !record ||
        record.claim ||
        record.session ||
        record.recovery
      )
        return undefined;
      const issued = issueSession(transport, this.clock.now());
      return {
        durable: {
          ...current,
          state: withController(current.state, playerId, 'controlled'),
          revision: current.revision + 1,
          auth: {
            ...current.auth,
            generation: current.auth.generation + 1,
            players: {
              ...current.auth.players,
              [playerId]: { playerId, session: issued.session },
            },
          },
        },
        result: issued.token,
      };
    });
  }

  leaveLobbySeat(gameId: string, playerId: PlayerId): Promise<boolean> {
    return this.mutateGame(gameId, (current) => {
      if (current.state.status !== 'LOBBY')
        throw new AuthenticationOperationError('INVALID_LIFECYCLE_STATE');
      if (!current.state.players.some(({ id }) => id === playerId))
        throw new AuthenticationOperationError('PLAYER_NOT_FOUND');
      const players = current.state.players.filter(({ id }) => id !== playerId);
      const authPlayers = { ...current.auth.players };
      delete authPlayers[playerId];
      return {
        durable: {
          ...current,
          state: {
            ...current.state,
            players,
            readyPlayerIds: current.state.readyPlayerIds.filter(
              (id) => id !== playerId,
            ),
          },
          auth: {
            ...current.auth,
            generation: current.auth.generation + 1,
            players: authPlayers,
          },
          revision: current.revision + 1,
        },
        result: true,
      };
    }).then((result) => result ?? false);
  }

  isPlayerAuthorityValid(
    current: DurableGame,
    playerId: PlayerId,
    token: string,
    transportClass: TransportClass,
  ): boolean {
    const player = current.state.players.find(({ id }) => id === playerId);
    return (
      player?.controller === 'controlled' &&
      validSession(
        current.auth.players[playerId]?.session,
        token,
        transportClass,
        this.clock.now(),
      )
    );
  }

  private serializeAdmin<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.adminQueue.then(operation, operation);
    this.adminQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private mutateGame<T>(
    gameId: string,
    transition: (
      current: DurableGame,
    ) =>
      | Promise<
          { readonly durable: DurableGame; readonly result: T } | undefined
        >
      | { readonly durable: DurableGame; readonly result: T }
      | undefined,
  ): Promise<T | undefined> {
    return this.coordinator.run(gameId, async () => {
      const current = await this.store.loadGame(gameId);
      if (!current) throw new AuthenticationOperationError('GAME_NOT_FOUND');
      const candidate = await transition(current);
      if (!candidate) return undefined;
      await this.store.commitGame(candidate.durable, {
        authGeneration: current.auth.generation,
        revision: current.revision,
      });
      return candidate.result;
    });
  }

  private async requireMutation<T>(value: Promise<T | undefined>): Promise<T> {
    const result = await value;
    if (result === undefined)
      throw new Error('Authentication transition failed');
    return result;
  }
}
