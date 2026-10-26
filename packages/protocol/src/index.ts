import { z } from 'zod';
import { nicknameSchema } from './nickname.js';
export { nicknameSchema, sameNickname } from './nickname.js';

export const gameDefinitionSchema = z.strictObject({
  editionId: z.literal('classic'),
  boardId: z.literal('classic'),
  rulesVersion: z.literal(1),
});
export type GameDefinitionView = z.infer<typeof gameDefinitionSchema>;

export const PROTOCOL_VERSION = 14 as const;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 64 * 1024;

const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const territoryId = z.string().min(1).max(40);
const positiveArmies = z.number().int().positive().max(10_000);
const placements = z
  .record(territoryId, positiveArmies)
  .refine((value) => Object.keys(value).length <= 50, 'too many placements');
const pactTerms = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('general_non_aggression') }),
  z.strictObject({
    kind: z.literal('border_non_aggression'),
    territoryIds: z.tuple([territoryId, territoryId]),
  }),
  z.strictObject({
    kind: z.literal('international_zone'),
    territoryId,
    firstExpectedConquerorId: id,
  }),
]);

export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_ready'), ready: z.boolean() }),
  z.strictObject({ type: z.literal('place_setup_armies'), placements }),
  z.strictObject({
    type: z.literal('place_reinforcements'),
    placements,
  }),
  z.strictObject({
    type: z.literal('select_inherited_cards'),
    cardIds: z.array(territoryId).min(1).max(5),
  }),
  z.strictObject({
    type: z.literal('select_reinforcement_country'),
    territoryId,
  }),
  z.strictObject({ type: z.literal('advance_phase') }),
  z.strictObject({
    type: z.literal('exchange_cards'),
    cardIds: z.tuple([territoryId, territoryId, territoryId]),
  }),
  z.strictObject({
    type: z.literal('attack'),
    from: territoryId,
    to: territoryId,
  }),
  z.strictObject({
    type: z.literal('complete_conquest_transfer'),
    armies: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.strictObject({
    type: z.literal('regroup'),
    from: territoryId,
    to: territoryId,
    armies: positiveArmies,
  }),
  z.strictObject({ type: z.literal('claim_card') }),
  z.strictObject({
    type: z.literal('claim_territory_bonus'),
    cardId: territoryId,
  }),
  z.strictObject({ type: z.literal('end_turn') }),
  z.strictObject({
    type: z.literal('propose_pact'),
    proposalId: id,
    recipientId: id,
    terms: pactTerms,
  }),
  z.strictObject({ type: z.literal('reject_pact'), proposalId: id }),
  z.strictObject({ type: z.literal('cancel_pact'), proposalId: id }),
  z.strictObject({
    type: z.literal('accept_pact'),
    proposalId: id,
    pactId: id,
  }),
  z.strictObject({ type: z.literal('withdraw_pact'), pactId: id }),
]);

export const clientCommandSchema = z.strictObject({
  type: z.literal('COMMAND'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: id,
  baseRevision: revision,
  command: commandPayloadSchema,
});
export type CommandPayload = z.infer<typeof commandPayloadSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;

export const protocolErrorCodeSchema = z.enum([
  'MALFORMED_MESSAGE',
  'PROTOCOL_MISMATCH',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'GAME_NOT_FOUND',
  'PLAYER_NOT_FOUND',
  'INVALID_LIFECYCLE_STATE',
  'INVALID_GAME_COMMAND',
  'SETUP_DEAL_EXHAUSTED',
  'COLOR_ALREADY_IN_USE',
  'NICKNAME_ALREADY_IN_USE',
  'STALE_REVISION',
  'DUPLICATE_COMMAND',
  'COMMAND_ID_REUSED',
  'PERSISTENCE_FAILURE',
  'GAME_UNAVAILABLE',
  'RATE_LIMITED',
  'SERVER_ERROR',
  'GAME_PAUSED',
  'PLAYER_DISQUALIFIED',
  'INVALID_INHERITANCE',
  'GAME_NOT_ACTIVE',
  'GAME_FINISHED',
  'NOT_YOUR_TURN',
  'INVALID_PHASE',
  'PENDING_ACTION',
  'UNKNOWN_PLAYER',
  'PLAYER_ELIMINATED',
  'INVALID_TERRITORY',
  'NOT_OWNER',
  'NOT_ADJACENT',
  'INSUFFICIENT_ARMIES',
  'PACT_PROHIBITS_ATTACK',
  'SUICIDE_ATTACK',
  'INVALID_DICE',
  'INVALID_TRANSFER',
  'INVALID_PLACEMENT',
  'INVALID_EXCHANGE',
  'MANDATORY_EXCHANGE',
  'CARD_LIMIT',
  'NOT_ELIGIBLE',
  'INVALID_PACT',
  'DUPLICATE_PACT',
  'PACT_NOT_FOUND',
  'PACT_LIMIT',
  'PACT_COOLDOWN',
  'INTERNATIONAL_ZONE_OBLIGATION',
]);
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

export interface PublicPlayerView {
  readonly id: string;
  readonly seatIndex: number;
  readonly nickname: string;
  readonly color: string;
  readonly controller: 'controlled' | 'controllerless_reassignment';
  readonly eliminated: boolean;
  readonly disqualified?: boolean;
  readonly absent?: boolean;
  readonly cardCount: number;
  readonly completedExchangeCount: number;
}
export type SetupView =
  | {
      readonly kind: 'automatic_assignment_2_to_3';
      readonly stage: 'additional_armies';
      readonly startingPlayerId: string;
      readonly currentPlayerId: string;
      readonly additionalArmiesRemainingByPlayer: Readonly<
        Partial<Record<string, number>>
      >;
    }
  | {
      readonly kind: 'card_deal_4_to_6';
      readonly stage:
        | 'territory_deal'
        | 'leftover_awards'
        | 'starting_order'
        | 'reinforcement';
      readonly startingPlayerId?: string;
      readonly currentPlayerId?: string;
      readonly leftoverCardIds: readonly string[];
      readonly reinforcementRound: 1 | 2;
      readonly additionalArmiesByPlayerContinent: Readonly<
        Record<string, Readonly<Record<string, number>>>
      >;
      readonly armiesRemainingInActivation: number;
    };
export interface TurnView {
  readonly playerId: string;
  readonly turnNumber: number;
  readonly phase:
    | 'territory_reinforcement'
    | 'continent_reinforcement'
    | 'ordinary_exchange'
    | 'attack'
    | 'regroup'
    | 'end_of_turn_cards';
  readonly round:
    | {
        readonly kind: 'initial_hostility';
        readonly orderPlayerIds: readonly string[];
        readonly actorIndex: number;
      }
    | {
        readonly kind: 'normal';
        readonly roundNumber: number;
        readonly pass: 'incorporation' | 'hostility';
        readonly orderPlayerIds: readonly string[];
        readonly actorIndex: number;
      };
  readonly isFirstHostilityTurn: boolean;
  readonly firstHostilityStartingPlayerId?: string;
  readonly firstHostilityPlayerIdsRemaining?: readonly string[];
  readonly conqueredTerritoryIds: readonly string[];
  readonly cardClaimEligible: boolean;
  readonly reinforcementArmiesRemaining?: number;
  readonly continentReinforcementsRemaining?: Readonly<
    Partial<Record<string, number>>
  >;
  readonly lastConqueredTerritoryId?: string;
  readonly lastCombat?: {
    readonly fromTerritoryId: string;
    readonly toTerritoryId: string;
    readonly attackerDice: readonly number[];
    readonly defenderDice: readonly number[];
    readonly attackerLosses: number;
    readonly defenderLosses: number;
    readonly conquered: boolean;
  };
}
export interface PendingActionView {
  readonly kind: 'conquest_transfer';
  readonly playerId: string;
  readonly fromTerritoryId: string;
  readonly conqueredTerritoryId: string;
  readonly maximumArmies: 1 | 2 | 3;
}
export type PactTermsView =
  | { readonly kind: 'general_non_aggression' }
  | {
      readonly kind: 'border_non_aggression';
      readonly territoryIds: readonly [string, string];
    }
  | {
      readonly kind: 'international_zone';
      readonly territoryId: string;
      readonly firstExpectedConquerorId: string;
    };
export interface PactStateView {
  readonly competitiveWithdrawals?: readonly {
    readonly id: string;
    readonly parties: readonly [string, string];
    readonly terms: PactTermsView;
    readonly withdrawingPlayerId: string;
    readonly recipientId: string;
    readonly incorporationsRemaining: 1 | 2;
  }[];
  readonly competitiveRejections?: readonly {
    readonly proposerId: string;
    readonly recipientId: string;
    readonly elapsedMs: number;
  }[];
  readonly proposals: readonly {
    readonly id: string;
    readonly proposerId: string;
    readonly recipientId: string;
    readonly terms: PactTermsView;
  }[];
  readonly active: readonly (
    | {
        readonly kind: 'border_non_aggression' | 'general_non_aggression';
        readonly id: string;
        readonly parties: readonly [string, string];
        readonly terms: PactTermsView;
        readonly withdrawal:
          | { readonly kind: 'none' }
          | {
              readonly kind: 'announced';
              readonly withdrawingPlayerId: string;
              readonly waitingForPlayerIds: readonly string[];
            };
      }
    | {
        readonly kind: 'international_zone';
        readonly id: string;
        readonly parties: readonly [string, string];
        readonly terms: PactTermsView;
        readonly expectedConquerorId: string;
        readonly withdrawal:
          | { readonly kind: 'none' }
          | {
              readonly kind: 'announced';
              readonly withdrawingPlayerId: string;
              readonly waitingForPlayerIds: readonly string[];
            };
      }
  )[];
}
export interface GameResultView {
  readonly winnerId?: string;
  readonly scoringEligible?: boolean;
  readonly victoryReason:
    | {
        readonly kind: 'secret_objective';
        readonly objectiveId: string;
        readonly effectiveDestructionTargetColor?: string;
      }
    | { readonly kind: 'control_territories'; readonly territoryCount: 30 }
    | { readonly kind: 'control_all_territories'; readonly territoryCount: 50 }
    | { readonly kind: 'time_limit' | 'no_competitors' };
}
export type LegalActionType =
  | 'select_inherited_cards'
  | 'set_ready'
  | 'place_setup_armies'
  | 'place_reinforcements'
  | 'advance_phase'
  | 'exchange_cards'
  | 'attack'
  | 'complete_conquest_transfer'
  | 'regroup'
  | 'claim_card'
  | 'claim_territory_bonus'
  | 'end_turn'
  | 'propose_pact'
  | 'accept_pact'
  | 'reject_pact'
  | 'cancel_pact'
  | 'withdraw_pact';
export interface LegalActionGuidanceView {
  readonly readOnly: boolean;
  readonly actions: readonly LegalActionType[];
  readonly territoryChoices: readonly string[];
  readonly reinforcementChoices: readonly {
    readonly territoryId: string;
    readonly maximumArmies: number;
  }[];
  readonly attackChoices: readonly {
    readonly from: string;
    readonly targets: readonly string[];
  }[];
  readonly regroupChoices: readonly {
    readonly from: string;
    readonly to: string;
    readonly maximumArmies: number;
  }[];
  readonly exchangeAvailable: boolean;
  readonly exchangeChoices: readonly {
    readonly cardIds: readonly [string, string, string];
    readonly rewardArmies: number;
  }[];
  readonly territoryBonusCardIds: readonly string[];
  readonly conquestTransferMaximum?: 1 | 2 | 3;
  readonly pactProposalIdsToAnswer: readonly string[];
  readonly pactProposalIdsToCancel: readonly string[];
  readonly pactIdsToWithdraw: readonly string[];
  readonly pactRecipientIds: readonly string[];
  readonly pactProposalChoices: readonly {
    readonly recipientId: string;
    readonly terms: PactTermsView;
  }[];
}
export interface CompetitiveClockView {
  readonly updatedAtMs: number;
  readonly elapsedMs: number;
  readonly activationRemainingMs: number;
  readonly activationKey: string;
  readonly lastUnplacedArmiesLost?: number;
  readonly lastExpiredPlayerId?: string;
  readonly completedRounds: number;
  readonly finalRoundNumber?: number;
  readonly pauseReason?: 'admin' | 'restart' | 'disconnection' | undefined;
  readonly disconnectedPlayerId?: string | undefined;
  readonly technicalRemainingMs?: number | undefined;
  readonly technicalRemainingByPlayer?:
    Readonly<Record<string, number>> | undefined;
  readonly selectedTerritoryId?: string | undefined;
}
export interface PlayerGameView {
  readonly definition: GameDefinitionView;
  readonly competitiveClock?: CompetitiveClockView;
  readonly pendingInheritance?: {
    readonly playerId: string;
    readonly takeCount: number;
    readonly cardCount: number;
  };
  readonly gameId: string;
  readonly revision: number;
  readonly status: 'LOBBY' | 'SETUP' | 'ACTIVE' | 'FINISHED';
  readonly mode: 'classic' | 'competitive';
  readonly configuredPlayerCount: number;
  readonly competitiveDurationMinutes?: 60 | 80;
  readonly selfPlayerId: string;
  readonly players: readonly PublicPlayerView[];
  readonly readyPlayerIds?: readonly string[];
  readonly territories?: Readonly<
    Record<
      string,
      {
        readonly ownerId?: string;
        readonly armies: number;
        readonly fixedArmiesThisTurn: number;
      }
    >
  >;
  readonly setup?: SetupView;
  readonly turn?: TurnView;
  readonly pendingAction?: PendingActionView;
  readonly pacts?: PactStateView;
  readonly result?: GameResultView;
  readonly legalActions: LegalActionGuidanceView;
  readonly private: {
    readonly inheritedCards?: readonly {
      readonly cardId: string;
      readonly symbol: 'galleon' | 'balloon' | 'cannon' | 'wildcard';
      readonly territoryBonusClaimed: boolean;
    }[];
    readonly cards: readonly {
      readonly cardId: string;
      readonly symbol: 'galleon' | 'balloon' | 'cannon' | 'wildcard';
      readonly territoryBonusClaimed: boolean;
    }[];
    readonly secretObjectiveId?: string;
    readonly effectiveDestructionTargetPlayerId?: string;
  };
}

export interface ExactPoints {
  readonly numerator: number;
  readonly denominator: number;
}
export interface CompetitiveResultRow {
  readonly playerId: string;
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
    readonly eliminatedPlayerId: string;
    readonly eliminatingPlayerId: string;
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

export interface AdminGameView {
  readonly definition: GameDefinitionView;
  readonly competitiveResults?: CompetitiveResults;
  readonly pendingInheritance?: {
    readonly playerId: string;
    readonly takeCount: number;
    readonly cardCount: number;
  };
  readonly competitiveClock?: CompetitiveClockView;
  readonly gameId: string;
  readonly revision: number;
  readonly status: PlayerGameView['status'];
  readonly mode: 'classic' | 'competitive';
  readonly configuredPlayerCount: number;
  readonly competitiveDurationMinutes?: 60 | 80;
  readonly players: readonly PublicPlayerView[];
  readonly readyPlayerIds?: readonly string[];
  readonly setup?: SetupView;
  readonly turn?: TurnView;
  readonly result?: GameResultView;
}

export type ServerMessage =
  | {
      readonly type: 'HELLO';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly gameId: string;
      readonly playerId: string;
    }
  | {
      readonly type: 'STATE';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly state: PlayerGameView;
    }
  | {
      readonly type: 'COMMAND_RESULT';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly commandId: string;
      readonly status: 'COMMITTED' | 'DUPLICATE';
      readonly committedRevision: number;
    }
  | {
      readonly type: 'COMMAND_REJECTED';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly commandId?: string;
      readonly code: ProtocolErrorCode;
      readonly message: string;
      readonly currentRevision?: number;
    }
  | {
      readonly type: 'ERROR';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly code: ProtocolErrorCode;
      readonly message: string;
    };

export const competitiveClockViewSchema = z.strictObject({
  updatedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activationRemainingMs: z.number().int().nonnegative().max(180000),
  activationKey: z.string().min(1).max(100),
  lastUnplacedArmiesLost: z.number().int().nonnegative().optional(),
  lastExpiredPlayerId: id.optional(),
  completedRounds: z.number().int().nonnegative(),
  finalRoundNumber: z.number().int().min(2).optional(),
  pauseReason: z.enum(['admin', 'restart', 'disconnection']).optional(),
  disconnectedPlayerId: id.optional(),
  technicalRemainingMs: z.number().int().nonnegative().max(480000).optional(),
  technicalRemainingByPlayer: z
    .record(id, z.number().int().nonnegative().max(480000))
    .optional(),
  selectedTerritoryId: territoryId.optional(),
});
const publicPlayerViewSchema = z.strictObject({
  id,
  seatIndex: z.number().int().nonnegative().max(5),
  nickname: z.string().min(1).max(40),
  color: z.enum(['blue', 'red', 'black', 'yellow', 'green', 'magenta']),
  controller: z.enum(['controlled', 'controllerless_reassignment']),
  eliminated: z.boolean(),
  disqualified: z.boolean().optional(),
  absent: z.literal(true).optional(),
  cardCount: z.number().int().nonnegative().max(50),
  completedExchangeCount: z.number().int().nonnegative(),
});
const setupViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('automatic_assignment_2_to_3'),
    stage: z.literal('additional_armies'),
    startingPlayerId: id,
    currentPlayerId: id,
    additionalArmiesRemainingByPlayer: z.record(
      id,
      z.number().int().nonnegative(),
    ),
  }),
  z.strictObject({
    kind: z.literal('card_deal_4_to_6'),
    stage: z.enum([
      'territory_deal',
      'leftover_awards',
      'starting_order',
      'reinforcement',
    ]),
    startingPlayerId: id.optional(),
    currentPlayerId: id.optional(),
    leftoverCardIds: z.array(territoryId).max(2),
    reinforcementRound: z.union([z.literal(1), z.literal(2)]),
    additionalArmiesByPlayerContinent: z.record(
      z.string(),
      z.partialRecord(
        z.enum([
          'north_america',
          'south_america',
          'europe',
          'africa',
          'asia',
          'oceania',
        ]),
        z.number().int().nonnegative(),
      ),
    ),
    armiesRemainingInActivation: z.number().int().nonnegative().max(10_000),
  }),
]);
const turnViewSchema = z.strictObject({
  playerId: id,
  turnNumber: z.number().int().positive(),
  phase: z.enum([
    'territory_reinforcement',
    'continent_reinforcement',
    'ordinary_exchange',
    'attack',
    'regroup',
    'end_of_turn_cards',
  ]),
  round: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('initial_hostility'),
      orderPlayerIds: z.array(id).min(1).max(6),
      actorIndex: z.number().int().nonnegative().max(5),
    }),
    z.strictObject({
      kind: z.literal('normal'),
      roundNumber: z.number().int().positive(),
      pass: z.enum(['incorporation', 'hostility']),
      orderPlayerIds: z.array(id).min(1).max(6),
      actorIndex: z.number().int().nonnegative().max(5),
    }),
  ]),
  isFirstHostilityTurn: z.boolean(),
  firstHostilityStartingPlayerId: id.optional(),
  firstHostilityPlayerIdsRemaining: z.array(id).max(6).optional(),
  conqueredTerritoryIds: z.array(territoryId).max(50),
  cardClaimEligible: z.boolean(),
  reinforcementArmiesRemaining: z.number().int().nonnegative().optional(),
  continentReinforcementsRemaining: z
    .record(z.string().min(1).max(40), z.number().int().nonnegative())
    .optional(),
  lastConqueredTerritoryId: territoryId.optional(),
  lastCombat: z
    .strictObject({
      fromTerritoryId: territoryId,
      toTerritoryId: territoryId,
      attackerDice: z.array(z.number().int().min(1).max(6)).max(3),
      defenderDice: z.array(z.number().int().min(1).max(6)).max(3),
      attackerLosses: z.number().int().min(0).max(3),
      defenderLosses: z.number().int().min(0).max(3),
      conquered: z.boolean(),
    })
    .optional(),
});
const pactTermsViewSchema = pactTerms;
const pactStateViewSchema = z.strictObject({
  competitiveWithdrawals: z
    .array(
      z.strictObject({
        id,
        parties: z.tuple([id, id]),
        terms: pactTermsViewSchema,
        withdrawingPlayerId: id,
        recipientId: id,
        incorporationsRemaining: z.union([z.literal(1), z.literal(2)]),
      }),
    )
    .optional(),
  competitiveRejections: z
    .array(
      z.strictObject({
        proposerId: id,
        recipientId: id,
        elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .optional(),

  proposals: z.array(
    z.strictObject({
      id,
      proposerId: id,
      recipientId: id,
      terms: pactTermsViewSchema,
    }),
  ),
  active: z.array(
    z.union([
      z.strictObject({
        kind: z.enum(['border_non_aggression', 'general_non_aggression']),
        id,
        parties: z.tuple([id, id]),
        terms: pactTermsViewSchema,
        withdrawal: z.union([
          z.strictObject({ kind: z.literal('none') }),
          z.strictObject({
            kind: z.literal('announced'),
            withdrawingPlayerId: id,
            waitingForPlayerIds: z.array(id).max(5),
          }),
        ]),
      }),
      z.strictObject({
        kind: z.literal('international_zone'),
        id,
        parties: z.tuple([id, id]),
        terms: pactTermsViewSchema,
        expectedConquerorId: id,
        withdrawal: z.union([
          z.strictObject({ kind: z.literal('none') }),
          z.strictObject({
            kind: z.literal('announced'),
            withdrawingPlayerId: id,
            waitingForPlayerIds: z.array(id).max(5),
          }),
        ]),
      }),
    ]),
  ),
});
const legalActionsViewSchema = z.strictObject({
  readOnly: z.boolean(),
  actions: z.array(
    z.enum([
      'select_inherited_cards',
      'set_ready',
      'place_setup_armies',
      'place_reinforcements',
      'advance_phase',
      'exchange_cards',
      'attack',
      'complete_conquest_transfer',
      'regroup',
      'claim_card',
      'claim_territory_bonus',
      'end_turn',
      'propose_pact',
      'accept_pact',
      'reject_pact',
      'cancel_pact',
      'withdraw_pact',
    ]),
  ),
  territoryChoices: z.array(territoryId).max(50),
  reinforcementChoices: z.array(
    z.strictObject({
      territoryId,
      maximumArmies: z.number().int().positive(),
    }),
  ),
  attackChoices: z.array(
    z.strictObject({
      from: territoryId,
      targets: z.array(territoryId).max(50),
    }),
  ),
  regroupChoices: z.array(
    z.strictObject({
      from: territoryId,
      to: territoryId,
      maximumArmies: z.number().int().positive(),
    }),
  ),
  exchangeAvailable: z.boolean(),
  exchangeChoices: z.array(
    z.strictObject({
      cardIds: z.tuple([territoryId, territoryId, territoryId]),
      rewardArmies: z.number().int().positive(),
    }),
  ),
  territoryBonusCardIds: z.array(territoryId).max(50),
  conquestTransferMaximum: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional(),
  pactProposalIdsToAnswer: z.array(id),
  pactProposalIdsToCancel: z.array(id),
  pactIdsToWithdraw: z.array(id),
  pactRecipientIds: z.array(id),
  pactProposalChoices: z.array(
    z.strictObject({
      recipientId: id,
      terms: pactTermsViewSchema,
    }),
  ),
});
export const playerGameViewSchema = z.strictObject({
  definition: gameDefinitionSchema,
  gameId: id,
  revision,
  status: z.enum(['LOBBY', 'SETUP', 'ACTIVE', 'FINISHED']),
  mode: z.enum(['classic', 'competitive']),
  configuredPlayerCount: z.number().int().min(2).max(6),
  competitiveDurationMinutes: z
    .union([z.literal(60), z.literal(80)])
    .optional(),
  selfPlayerId: id,
  players: z.array(publicPlayerViewSchema).min(1).max(6),
  readyPlayerIds: z.array(id).max(6).optional(),
  territories: z
    .record(
      territoryId,
      z.strictObject({
        ownerId: id.optional(),
        armies: z.number().int().nonnegative(),
        fixedArmiesThisTurn: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  setup: setupViewSchema.optional(),
  turn: turnViewSchema.optional(),
  pendingAction: z
    .strictObject({
      kind: z.literal('conquest_transfer'),
      playerId: id,
      fromTerritoryId: territoryId,
      conqueredTerritoryId: territoryId,
      maximumArmies: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .optional(),
  competitiveClock: competitiveClockViewSchema.optional(),
  pendingInheritance: z
    .strictObject({
      playerId: id,
      takeCount: z.number().int().min(1).max(5),
      cardCount: z.number().int().min(1).max(50),
    })
    .optional(),
  pacts: pactStateViewSchema.optional(),
  result: z
    .strictObject({
      winnerId: id.optional(),
      scoringEligible: z.boolean().optional(),
      victoryReason: z.union([
        z.strictObject({ kind: z.enum(['time_limit', 'no_competitors']) }),
        z.strictObject({
          kind: z.literal('secret_objective'),
          objectiveId: z.string().min(1).max(80),
          effectiveDestructionTargetColor: z
            .enum(['blue', 'red', 'black', 'yellow', 'green', 'magenta'])
            .optional(),
        }),
        z.strictObject({
          kind: z.literal('control_territories'),
          territoryCount: z.literal(30),
        }),
        z.strictObject({
          kind: z.literal('control_all_territories'),
          territoryCount: z.literal(50),
        }),
      ]),
    })
    .optional(),
  legalActions: legalActionsViewSchema,
  private: z.strictObject({
    inheritedCards: z
      .array(
        z.strictObject({
          cardId: territoryId,
          symbol: z.enum(['galleon', 'balloon', 'cannon', 'wildcard']),
          territoryBonusClaimed: z.boolean(),
        }),
      )
      .optional(),
    cards: z.array(
      z.strictObject({
        cardId: territoryId,
        symbol: z.enum(['galleon', 'balloon', 'cannon', 'wildcard']),
        territoryBonusClaimed: z.boolean(),
      }),
    ),
    secretObjectiveId: z.string().min(1).max(80).optional(),
    effectiveDestructionTargetPlayerId: id.optional(),
  }),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('HELLO'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    gameId: id,
    playerId: id,
  }),
  z.strictObject({
    type: z.literal('STATE'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    state: playerGameViewSchema,
  }),
  z.strictObject({
    type: z.literal('COMMAND_RESULT'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: id,
    status: z.enum(['COMMITTED', 'DUPLICATE']),
    committedRevision: revision,
  }),
  z.strictObject({
    type: z.literal('COMMAND_REJECTED'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: id.optional(),
    code: protocolErrorCodeSchema,
    message: z.string().max(500),
    currentRevision: revision.optional(),
  }),
  z.strictObject({
    type: z.literal('ERROR'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    code: protocolErrorCodeSchema,
    message: z.string().max(500),
  }),
]);

export const adminLoginBodySchema = z.strictObject({
  recoveryCode: z.string().min(1).max(128),
});
export const createGameBodySchema = z
  .strictObject({
    definition: gameDefinitionSchema.optional(),
    mode: z.enum(['classic', 'competitive']).default('classic'),
    configuredPlayerCount: z.number().int().min(2).max(6),
  })
  .refine(
    (body) => body.mode !== 'competitive' || body.configuredPlayerCount >= 4,
  );

export const joinGameBodySchema = z.strictObject({
  nickname: nicknameSchema(40),
  color: z.enum(['blue', 'red', 'black', 'yellow', 'green', 'magenta']),
});
export const gameIdParamsSchema = z.strictObject({ gameId: id });
export const gamePlayerParamsSchema = z.strictObject({
  gameId: id,
  playerId: id,
});
export const updateGameConfigurationBodySchema = z.strictObject({
  configuredPlayerCount: z.number().int().min(2).max(6),
  competitiveDurationMinutes: z
    .union([z.literal(60), z.literal(80)])
    .optional(),
});
export const confirmGameActionBodySchema = z.strictObject({
  confirmGameId: id,
});
export const takeSeatBodySchema = z.strictObject({ playerId: id });

export interface BootstrapResponse {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly transportClass: 'HTTP' | 'HTTPS';
  readonly encrypted: boolean;
  readonly websocketPathTemplate: '/api/games/{gameId}/live';
}

export interface AdminConnectionResponse {
  readonly choices: readonly {
    readonly origin: string;
    readonly label: string;
    readonly requiresSelection?: boolean;
  }[];
  readonly reason?: string;
}

export const adminLaunchBodySchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
