import type { GameDefinition } from './game-definition.js';
import type {
  PlayerColor,
  SecretObjectiveId,
  TerritoryCardId,
  TerritoryId,
} from './classic-data.js';

declare const gameIdBrand: unique symbol;
declare const playerIdBrand: unique symbol;
declare const pactIdBrand: unique symbol;
declare const pactProposalIdBrand: unique symbol;
export type GameId = string & { readonly [gameIdBrand]: true };
export type PlayerId = string & { readonly [playerIdBrand]: true };
export type PactId = string & { readonly [pactIdBrand]: true };
export type PactProposalId = string & { readonly [pactProposalIdBrand]: true };

export interface TerritoryCardPossession {
  readonly cardId: TerritoryCardId;
  readonly territoryBonusClaimed: boolean;
}
export interface PlayerState {
  readonly id: PlayerId;
  readonly seatIndex: number;
  readonly nickname: string;
  readonly color: PlayerColor;
  readonly controller: 'controlled' | 'controllerless_reassignment';
  readonly eliminated: boolean;
  readonly disqualified?: boolean;
  /** Competitive: disconnected past the wait; turns pass on their own. */
  readonly absent?: boolean;
  /**
   * Competitive: the server plays this seat. `absent` replaces a disconnected
   * player until they return; `admin` was put by the administrator;
   * `requested` was asked for by the player with one country left in the
   * final rounds; `table` is one of the bots of a four plus two table.
   */
  readonly bot?: 'absent' | 'admin' | 'requested' | 'table';
  /** Competitive: a bot played this seat at some point. */
  readonly botPlayed?: true;
  /** Deciding Competitive game: left or absent, plays one-minute turns. */
  readonly inactive?: true;
  readonly cards: readonly TerritoryCardPossession[];
  readonly completedExchangeCount: number;
  readonly secretObjectiveId?: SecretObjectiveId;
  readonly effectiveDestructionTargetPlayerId?: PlayerId;
}
export interface TerritoryState {
  readonly ownerId?: PlayerId;
  readonly armies: number;
  readonly fixedArmiesThisTurn: number;
}
export interface CardDeckState {
  readonly drawPile: readonly TerritoryCardId[];
  readonly discardPile: readonly TerritoryCardId[];
}

export type CommonVictoryCondition =
  | { readonly kind: 'control_territories'; readonly territoryCount: 30 }
  | { readonly kind: 'control_all_territories'; readonly territoryCount: 50 };
export type VictoryReason =
  | { readonly kind: 'time_limit' | 'no_competitors' }
  | {
      readonly kind: 'secret_objective';
      readonly objectiveId: SecretObjectiveId;
    }
  | CommonVictoryCondition;
export interface CompetitiveElimination {
  readonly eliminatedPlayerId: PlayerId;
  readonly eliminatingPlayerId: PlayerId;
  readonly turnNumber: number;
}
export interface CompetitiveHistory {
  readonly complete: boolean;
  readonly eliminations: readonly CompetitiveElimination[];
}
export interface ExactPoints {
  readonly numerator: number;
  readonly denominator: number;
}
export interface CompetitiveResultRow {
  readonly playerId: PlayerId;
  /** A table bot, or a player a bot replaced at some point. */
  readonly bot?: 'table' | 'replacement';
  readonly status: 'survivor' | 'eliminated' | 'disqualified';
  readonly position?: number;
  readonly tiedPlayers: number;
  readonly metrics: {
    readonly territories: number;
    readonly armies: number;
    readonly exchanges: number;
    readonly cards: number;
    readonly fullContinents: readonly string[];
    readonly continentTerritories: number;
    readonly continentArmies: number;
  };
  readonly basePoints: ExactPoints;
  readonly objectiveBonus: number;
  readonly eliminationBonus: number;
  readonly eliminationPenalty: number;
  readonly totalPoints: ExactPoints;
}
export interface CompetitiveResults {
  readonly rulesVersion: 1;
  readonly eliminations: readonly {
    readonly eliminatedPlayerId: PlayerId;
    readonly eliminatingPlayerId: PlayerId;
    readonly turnNumber: number;
  }[];
  readonly historyComplete: boolean;
  readonly completedRounds?: number;
  readonly scoringEligible: boolean;
  readonly exclusions: readonly (
    | 'incomplete_history'
    | 'unknown_rounds'
    | 'minimum_rounds'
    | 'no_competitors'
    | 'pending_inheritance'
  )[];
  readonly rows: readonly CompetitiveResultRow[];
}

export interface FinishedGameResult {
  readonly winnerId?: PlayerId;
  readonly scoringEligible?: boolean;
  readonly victoryReason: VictoryReason;
}

export type TurnPhase =
  | 'ordinary_exchange'
  | 'territory_reinforcement'
  | 'continent_reinforcement'
  | 'attack'
  | 'regroup'
  | 'end_of_turn_cards';
export type RoundState =
  | {
      readonly kind: 'initial_hostility';
      readonly orderPlayerIds: readonly PlayerId[];
      readonly actorIndex: number;
    }
  | {
      readonly kind: 'normal';
      readonly roundNumber: number;
      readonly pass: 'incorporation' | 'hostility';
      readonly orderPlayerIds: readonly PlayerId[];
      readonly actorIndex: number;
    };
export interface TurnState {
  readonly playerId: PlayerId;
  readonly turnNumber: number;
  readonly phase: TurnPhase;
  readonly round: RoundState;
  readonly isFirstHostilityTurn: boolean;
  readonly firstHostilityStartingPlayerId?: PlayerId;
  readonly firstHostilityPlayerIdsRemaining?: readonly PlayerId[];
  readonly conqueredTerritoryIds: readonly TerritoryId[];
  readonly cardClaimEligible: boolean;
  readonly reinforcementArmiesRemaining?: number;
  readonly continentReinforcementsRemaining?: Readonly<
    Partial<Record<import('./classic-data.js').ContinentId, number>>
  >;
  readonly lastConqueredTerritoryId?: TerritoryId;
  readonly lastCombat?: {
    readonly fromTerritoryId: TerritoryId;
    readonly toTerritoryId: TerritoryId;
    readonly attackerDice: readonly number[];
    readonly defenderDice: readonly number[];
    readonly attackerLosses: number;
    readonly defenderLosses: number;
    readonly conquered: boolean;
  };
}
export interface ConquestTransferPendingState {
  readonly kind: 'conquest_transfer';
  readonly playerId: PlayerId;
  readonly fromTerritoryId: TerritoryId;
  readonly conqueredTerritoryId: TerritoryId;
  readonly maximumArmies: 1 | 2 | 3;
}
export type PendingAction = ConquestTransferPendingState;

export type PactTerms =
  | {
      readonly kind: 'border_non_aggression';
      readonly territoryIds: readonly [TerritoryId, TerritoryId];
    }
  | { readonly kind: 'general_non_aggression' }
  | {
      readonly kind: 'international_zone';
      readonly territoryId: TerritoryId;
      readonly firstExpectedConquerorId: PlayerId;
    };
export interface PactProposal {
  readonly id: PactProposalId;
  readonly proposerId: PlayerId;
  readonly recipientId: PlayerId;
  readonly terms: PactTerms;
}
export type PactWithdrawalState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'announced';
      readonly withdrawingPlayerId: PlayerId;
      readonly waitingForPlayerIds: readonly PlayerId[];
    };
export interface NonAggressionPact {
  readonly kind: 'border_non_aggression' | 'general_non_aggression';
  readonly id: PactId;
  readonly parties: readonly [PlayerId, PlayerId];
  readonly terms: Extract<
    PactTerms,
    { readonly kind: 'border_non_aggression' | 'general_non_aggression' }
  >;
  readonly withdrawal: PactWithdrawalState;
}
export interface InternationalZonePact {
  readonly kind: 'international_zone';
  readonly id: PactId;
  readonly parties: readonly [PlayerId, PlayerId];
  readonly terms: Extract<PactTerms, { readonly kind: 'international_zone' }>;
  readonly expectedConquerorId: PlayerId;
  readonly withdrawal: PactWithdrawalState;
}
export type ActivePact = NonAggressionPact | InternationalZonePact;
export interface CompetitivePactWithdrawal {
  readonly id: PactId;
  readonly parties: readonly [PlayerId, PlayerId];
  readonly terms: PactTerms;
  readonly withdrawingPlayerId: PlayerId;
  readonly recipientId: PlayerId;
  readonly incorporationsRemaining: 1 | 2;
}
export interface CompetitivePactRejection {
  readonly proposerId: PlayerId;
  readonly recipientId: PlayerId;
  /** Game clock time of the rejection. */
  readonly elapsedMs: number;
}
export interface PactState {
  readonly competitiveWithdrawals?: readonly CompetitivePactWithdrawal[];
  readonly competitiveRejections?: readonly CompetitivePactRejection[];
  readonly proposals: readonly PactProposal[];
  readonly active: readonly ActivePact[];
}

export type SetupState =
  | {
      readonly kind: 'automatic_assignment_2_to_3';
      readonly stage: 'additional_armies';
      readonly startingPlayerId: PlayerId;
      readonly currentPlayerId: PlayerId;
      readonly additionalArmiesRemainingByPlayer: Readonly<
        Partial<Record<PlayerId, number>>
      >;
    }
  | {
      readonly kind: 'card_deal_4_to_6';
      readonly stage:
        | 'territory_deal'
        | 'leftover_awards'
        | 'starting_order'
        | 'reinforcement';
      readonly startingPlayerId?: PlayerId;
      readonly currentPlayerId?: PlayerId;
      readonly leftoverCardIds: readonly TerritoryCardId[];
      readonly reinforcementRound: 1 | 2;
      readonly additionalArmiesByPlayerContinent: Readonly<
        Record<string, Readonly<Record<string, number>>>
      >;
      readonly armiesRemainingInActivation: number;
    };

export type GameMode = 'classic' | 'competitive';

export interface CompetitiveClockState {
  readonly updatedAtMs: number;
  readonly elapsedMs: number;
  readonly activationRemainingMs: number;
  readonly activationKey: string;
  readonly lastUnplacedArmiesLost?: number;
  readonly lastExpiredPlayerId?: PlayerId;
  readonly completedRounds: number;
  readonly finalRoundNumber?: number;
  readonly pauseReason?: 'admin' | 'restart' | 'disconnection' | undefined;
  readonly disconnectedPlayerId?: PlayerId | undefined;
  readonly technicalRemainingMs?: number | undefined;
  /** Disconnection wait each player has left for the whole game. */
  readonly technicalRemainingByPlayer?:
    Readonly<Record<PlayerId, number>> | undefined;
  readonly selectedTerritoryId?: TerritoryId | undefined;
}
export interface PendingInheritance {
  readonly playerId: PlayerId;
  readonly cards: readonly TerritoryCardPossession[];
  readonly takeCount: number;
}
interface GameStateBase {
  readonly definition: GameDefinition;
  readonly competitiveClock?: CompetitiveClockState;
  readonly pendingInheritance?: PendingInheritance;
  readonly mode: GameMode;
  readonly id: GameId;
  readonly configuredPlayerCount: 2 | 3 | 4 | 5 | 6;
  /** Competitive with five or six players may be the 60 minute Express game. */
  readonly competitiveDurationMinutes?: 60 | 80;
  /** Competitive bot difficulty; hard when unset, as in the Superliga. */
  readonly competitiveBotLevel?: 'easy' | 'normal' | 'hard';
  /** False keeps automatic turns for absent players instead of a bot. */
  readonly competitiveBotsReplaceAbsent?: boolean;
  /** Competitive table of six where bots take two seats (Superliga 4 + 2). */
  readonly competitiveBotSeats?: 2;
  /**
   * Qualifiers, semifinals and finals: no bots; whoever leaves stays inactive
   * with one-minute turns.
   */
  readonly competitiveDeciding?: true;
  /** Classic with a game clock: two-minute turns and a time limit, no score. */
  readonly classicExpress?: true;
  readonly players: readonly PlayerState[];
}
export interface LobbyGameState extends GameStateBase {
  readonly status: 'LOBBY';
  readonly readyPlayerIds: readonly PlayerId[];
}
interface StartedGameStateBase extends GameStateBase {
  readonly competitiveHistory?: CompetitiveHistory;
  readonly territories: Readonly<Record<TerritoryId, TerritoryState>>;
  readonly cardDeck: CardDeckState;
  readonly commonVictoryCondition: CommonVictoryCondition;
  readonly pacts: PactState;
}
export interface SetupGameState extends StartedGameStateBase {
  readonly status: 'SETUP';
  readonly setup: SetupState;
}
export interface ActiveGameState extends StartedGameStateBase {
  readonly status: 'ACTIVE';
  readonly turn: TurnState;
  readonly pendingAction?: PendingAction;
}
export interface FinishedGameState extends StartedGameStateBase {
  readonly status: 'FINISHED';
  readonly turn: TurnState;
  readonly result: FinishedGameResult;
}
export type GameState =
  LobbyGameState | SetupGameState | ActiveGameState | FinishedGameState;
