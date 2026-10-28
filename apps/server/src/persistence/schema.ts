import {
  PLAYER_COLORS,
  TERRITORIES,
  SECRET_OBJECTIVES,
  TERRITORY_IDS,
  CLASSIC_GAME_DEFINITION,
  resolveGameDefinition,
  resolveGameRuntime,
} from '@game/game-engine';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { gameDefinitionSchema } from '@game/protocol';

import {
  CURRENT_AUTH_SCHEMA_VERSION,
  emptyGameAuthState,
  type AdminAuthState,
} from '../auth/types.js';

import {
  CURRENT_BACKUP_FORMAT_VERSION,
  CURRENT_GAME_SCHEMA_VERSION,
  RECENT_COMMAND_RETENTION,
  type DurableGame,
  type PersistedGameEnvelope,
} from './types.js';

const id = z.string().min(1);
const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const positiveSafeGeneration = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const player = z.strictObject({
  id,
  seatIndex: nonnegativeInteger,
  nickname: z.string(),
  color: z.enum(PLAYER_COLORS),
  controller: z.enum(['controlled', 'controllerless_reassignment']),
  eliminated: z.boolean(),
  disqualified: z.boolean().optional(),
  absent: z.literal(true).optional(),
  bot: z.enum(['absent', 'admin', 'requested', 'table']).optional(),
  botPlayed: z.literal(true).optional(),
  inactive: z.literal(true).optional(),
  botProposalTurn: nonnegativeInteger.optional(),
  cards: z.array(
    z.strictObject({
      cardId: z.enum(TERRITORY_IDS),
      territoryBonusClaimed: z.boolean(),
    }),
  ),
  completedExchangeCount: nonnegativeInteger,
  secretObjectiveId: z
    .enum(Object.keys(SECRET_OBJECTIVES) as [string, ...string[]])
    .optional(),
  effectiveDestructionTargetPlayerId: id.optional(),
});
const territory = z.strictObject({
  ownerId: id.optional(),
  armies: nonnegativeInteger,
  fixedArmiesThisTurn: nonnegativeInteger,
});
const territoryRecord = z.record(z.string(), territory);
const cardDeck = z.strictObject({
  drawPile: z.array(z.enum(TERRITORY_IDS)),
  discardPile: z.array(z.enum(TERRITORY_IDS)),
});
const commonVictory = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('control_territories'),
    territoryCount: z.literal(30),
  }),
  z.strictObject({
    kind: z.literal('control_all_territories'),
    territoryCount: z.literal(50),
  }),
]);
const pactTerms = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('border_non_aggression'),
    territoryIds: z.tuple([z.enum(TERRITORY_IDS), z.enum(TERRITORY_IDS)]),
  }),
  z.strictObject({ kind: z.literal('general_non_aggression') }),
  z.strictObject({
    kind: z.literal('international_zone'),
    territoryId: z.enum(TERRITORY_IDS),
    firstExpectedConquerorId: id,
  }),
]);
const proposal = z.strictObject({
  id,
  proposerId: id,
  recipientId: id,
  terms: pactTerms,
});
const withdrawal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('announced'),
    withdrawingPlayerId: id,
    waitingForPlayerIds: z.array(id).max(5),
  }),
]);
const activePact = z.union([
  z.strictObject({
    kind: z.enum(['border_non_aggression', 'general_non_aggression']),
    id,
    parties: z.tuple([id, id]),
    terms: pactTerms,
    withdrawal,
  }),
  z.strictObject({
    kind: z.literal('international_zone'),
    id,
    parties: z.tuple([id, id]),
    terms: pactTerms,
    expectedConquerorId: id,
    withdrawal,
  }),
]);
const pacts = z.strictObject({
  competitiveWithdrawals: z
    .array(
      z.strictObject({
        id,
        parties: z.tuple([id, id]),
        terms: pactTerms,
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

  proposals: z.array(proposal),
  active: z.array(activePact),
});
const turn = z.strictObject({
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
      roundNumber: positiveInteger,
      pass: z.enum(['incorporation', 'hostility']),
      orderPlayerIds: z.array(id).min(1).max(6),
      actorIndex: z.number().int().nonnegative().max(5),
    }),
  ]),
  isFirstHostilityTurn: z.boolean(),
  firstHostilityStartingPlayerId: id.optional(),
  firstHostilityPlayerIdsRemaining: z.array(id).max(6).optional(),
  conqueredTerritoryIds: z.array(z.enum(TERRITORY_IDS)),
  cardClaimEligible: z.boolean(),
  reinforcementArmiesRemaining: nonnegativeInteger.optional(),
  continentReinforcementsRemaining: z
    .record(z.string(), nonnegativeInteger)
    .optional(),
  lastConqueredTerritoryId: z.enum(TERRITORY_IDS).optional(),
  lastCombat: z
    .strictObject({
      fromTerritoryId: z.enum(TERRITORY_IDS),
      toTerritoryId: z.enum(TERRITORY_IDS),
      attackerDice: z.array(z.number().int().min(1).max(6)).max(3),
      defenderDice: z.array(z.number().int().min(1).max(6)).max(3),
      attackerLosses: z.number().int().min(0).max(3),
      defenderLosses: z.number().int().min(0).max(3),
      conquered: z.boolean(),
    })
    .optional(),
});
const competitiveClock = z.strictObject({
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
  selectedTerritoryId: z.enum(TERRITORY_IDS).optional(),
});
const pendingInheritance = z.strictObject({
  playerId: id,
  takeCount: z.number().int().min(1).max(5),
  cards: z
    .array(
      z.strictObject({
        cardId: z.enum(TERRITORY_IDS),
        territoryBonusClaimed: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});
const base = {
  definition: gameDefinitionSchema,
  competitiveClock: competitiveClock.optional(),
  pendingInheritance: pendingInheritance.optional(),
  id,
  mode: z.enum(['classic', 'competitive']),
  configuredPlayerCount: z.union([
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  competitiveDurationMinutes: z
    .union([z.literal(60), z.literal(80)])
    .optional(),
  competitiveBotLevel: z.enum(['easy', 'normal', 'hard']).optional(),
  competitiveBotsReplaceAbsent: z.boolean().optional(),
  competitiveBotSeats: z.number().int().min(1).max(5).optional(),
  competitiveDeciding: z.literal(true).optional(),
  classicExpress: z.literal(true).optional(),
  players: z.array(player),
};
const competitiveHistory = z.strictObject({
  complete: z.boolean(),
  eliminations: z
    .array(
      z.strictObject({
        eliminatedPlayerId: id,
        eliminatingPlayerId: id,
        turnNumber: positiveInteger,
      }),
    )
    .max(5),
});
const started = {
  competitiveHistory: competitiveHistory.optional(),
  ...base,
  territories: territoryRecord,
  cardDeck,
  commonVictoryCondition: commonVictory,
  pacts,
};
const setup = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('automatic_assignment_2_to_3'),
    stage: z.literal('additional_armies'),
    startingPlayerId: id,
    currentPlayerId: id,
    additionalArmiesRemainingByPlayer: z.record(z.string(), nonnegativeInteger),
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
    leftoverCardIds: z.array(z.enum(TERRITORY_IDS)),
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
    armiesRemainingInActivation: nonnegativeInteger,
  }),
]);
const pendingAction = z.strictObject({
  kind: z.literal('conquest_transfer'),
  playerId: id,
  fromTerritoryId: z.enum(TERRITORY_IDS),
  conqueredTerritoryId: z.enum(TERRITORY_IDS),
  maximumArmies: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const victoryReason = z.union([
  z.strictObject({
    kind: z.literal('secret_objective'),
    objectiveId: z.enum(
      Object.keys(SECRET_OBJECTIVES) as [string, ...string[]],
    ),
  }),
  commonVictory,
  z.strictObject({ kind: z.enum(['time_limit', 'no_competitors']) }),
]);
const gameStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...base,
    status: z.literal('LOBBY'),
    readyPlayerIds: z.array(id),
  }),
  z.strictObject({ ...started, status: z.literal('SETUP'), setup }),
  // Engine transitions are structurally typed spreads; strip hidden predecessor-only keys.
  z.object({
    ...started,
    status: z.literal('ACTIVE'),
    turn,
    pendingAction: pendingAction.optional(),
  }),
  z.object({
    ...started,
    status: z.literal('FINISHED'),
    turn,
    result: z.strictObject({
      winnerId: id.optional(),
      victoryReason,
      scoringEligible: z.boolean().optional(),
    }),
  }),
]);
const committedCommand = z.strictObject({
  commandId: id,
  fingerprint: id,
  committedRevision: nonnegativeInteger,
});
const durableGameSchema = z.strictObject({
  state: gameStateSchema,
  revision: nonnegativeInteger,
  recentCommands: z.array(committedCommand).max(RECENT_COMMAND_RETENTION),
  auth: z.lazy(() => gameAuthSchema),
});

const sessionVerifierSchema = z.strictObject({
  algorithm: z.literal('sha256'),
  digest: z.string().min(1),
});
const recoveryVerifierSchema = z.strictObject({
  algorithm: z.literal('scrypt'),
  salt: z.string().min(1),
  digest: z.string().min(1),
  keyLength: z.literal(32),
  cost: z.literal(16_384),
  blockSize: z.literal(8),
  parallelization: z.literal(1),
});
const activeSessionSchema = z.strictObject({
  verifier: sessionVerifierSchema,
  transportClass: z.enum(['HTTP', 'HTTPS']),
  expiresAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
});
const playerAuthSchema = z.strictObject({
  playerId: id,
  session: activeSessionSchema.optional(),
  recovery: recoveryVerifierSchema.optional(),
  claim: z
    .strictObject({
      verifier: recoveryVerifierSchema,
      expiresAt: z.iso.datetime(),
    })
    .optional(),
});
const gameAuthSchema = z.strictObject({
  authSchemaVersion: z.literal(CURRENT_AUTH_SCHEMA_VERSION),
  generation: nonnegativeInteger,
  players: z.record(z.string(), playerAuthSchema),
});
export const adminAuthSchema = z.strictObject({
  format: z.literal('classic-admin-auth'),
  authSchemaVersion: z.literal(CURRENT_AUTH_SCHEMA_VERSION),
  auth: z.strictObject({
    authSchemaVersion: z.literal(CURRENT_AUTH_SCHEMA_VERSION),
    generation: positiveSafeGeneration,
    recovery: recoveryVerifierSchema,
    session: activeSessionSchema.optional(),
  }),
});

export function encodeGame(
  game: DurableGame,
  persistenceGeneration = randomUUID(),
): PersistedGameEnvelope {
  const normalized = validateDurableGame(game);
  return {
    format: 'ted-snapshot',
    gameSchemaVersion: CURRENT_GAME_SCHEMA_VERSION,
    persistenceGeneration,
    game: normalized,
  };
}

function validateDurableGame(
  value: unknown,
  allowLegacyMissingAuth = false,
): DurableGame {
  const identity = z
    .object({ state: z.object({ definition: z.unknown() }) })
    .parse(value);
  resolveGameDefinition(identity.state.definition);
  const parsed = durableGameSchema.parse(value) as unknown as DurableGame;
  resolveGameRuntime(parsed.state.definition).assertInvariants(parsed.state);
  if (
    parsed.recentCommands.some(
      (record) => record.committedRevision > parsed.revision,
    )
  )
    throw new Error('committed command revision exceeds the game revision');
  if (
    new Set(parsed.recentCommands.map(({ commandId }) => commandId)).size !==
    parsed.recentCommands.length
  )
    throw new Error('duplicate committed command ID');
  for (const [playerId, auth] of Object.entries(parsed.auth.players)) {
    if (playerId !== auth.playerId)
      throw new Error('player auth key does not match player identity');
    if (!parsed.state.players.some((player) => player.id === playerId))
      throw new Error('player auth references a missing game seat');
    const seat = parsed.state.players.find((player) => player.id === playerId)!;
    if (seat.controller === 'controllerless_reassignment') {
      if (auth.session || auth.recovery)
        throw new Error(
          'available player must not have controlling credentials',
        );
    } else if (auth.claim || !auth.session) {
      throw new Error('controlled player auth must have a session');
    }
  }
  for (const seat of parsed.state.players)
    if (!parsed.auth.players[seat.id] && seat.bot !== 'table') {
      if (seat.controller === 'controllerless_reassignment')
        throw new Error('controllerless player is missing reassignment auth');
      if (!allowLegacyMissingAuth)
        throw new Error('controlled player is missing authentication state');
    }
  if (allowLegacyMissingAuth && Object.keys(parsed.auth.players).length !== 0)
    throw new Error('legacy authentication migration must be entirely empty');
  return parsed;
}

export function decodeGame(value: unknown): PersistedGameEnvelope {
  const header = z
    .strictObject({
      format: z.literal('ted-snapshot'),
      gameSchemaVersion: z.number().int().positive(),
      persistenceGeneration: z.string().uuid(),
      game: z.unknown(),
    })
    .parse(value);
  if (header.gameSchemaVersion > CURRENT_GAME_SCHEMA_VERSION)
    throw new UnsupportedSchemaError(header.gameSchemaVersion);
  // Schemas 5 and 6 retain authentication and seat state. Schema 7 adds
  // explicit mode, incorporation index and persisted continent allocations.
  // Schema 8 adds optional unilateral competitive withdrawal records. Schema 7
  // contracts remain intact; already announced withdrawals keep their old terms.
  // Schema 9 adds competitive clocks, disqualification and pending inheritance.
  // Schema 10 persists ordered elimination events without reconstructing history.
  // Schema 12 adds the explicit edition/board/rules definition. Older schemas
  // are always Classic; Reconquista development snapshots written with its
  // former independent 7/8 numbering carry a definition and are rejected.
  if (
    header.gameSchemaVersion < CURRENT_GAME_SCHEMA_VERSION &&
    header.gameSchemaVersion !== 5 &&
    header.gameSchemaVersion !== 6 &&
    header.gameSchemaVersion !== 7 &&
    header.gameSchemaVersion !== 8 &&
    header.gameSchemaVersion !== 9 &&
    header.gameSchemaVersion !== 10 &&
    header.gameSchemaVersion !== 11
  )
    throw new Error(
      `Unsupported older game schema ${header.gameSchemaVersion}; no migration exists`,
    );
  const legacyGame = z
    .object({
      auth: z.unknown().optional(),
      state: z.object({ definition: z.unknown().optional() }).passthrough(),
    })
    .passthrough()
    .parse(header.game);
  if (
    header.gameSchemaVersion < CURRENT_GAME_SCHEMA_VERSION &&
    legacyGame.state.definition !== undefined
  )
    throw new UnsupportedSchemaError(
      header.gameSchemaVersion,
      `Game schema ${header.gameSchemaVersion} with an edition definition was written by a Reconquista development build and is not supported`,
    );
  // Only historical schemas may lack authentication state; a current
  // snapshot without it is corrupt, not an anonymous legacy game.
  const legacyMissingAuth =
    legacyGame.auth === undefined &&
    header.gameSchemaVersion < CURRENT_GAME_SCHEMA_VERSION;
  let migratedGame = legacyMissingAuth
    ? { ...legacyGame, auth: emptyGameAuthState() }
    : legacyGame;
  if (
    header.gameSchemaVersion < 7 ||
    (header.gameSchemaVersion === 7 &&
      z
        .object({ mode: z.unknown().optional() })
        .passthrough()
        .parse(migratedGame.state).mode === undefined)
  ) {
    const old = z
      .object({ state: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(migratedGame);
    const state: Record<string, unknown> = { ...old.state, mode: 'classic' };
    if (state.status === 'SETUP') {
      const setup = z
        .object({ kind: z.string() })
        .passthrough()
        .parse(state.setup);
      if (setup.kind === 'card_deal_4_to_6') {
        if (setup.reinforcementRound !== 5 && setup.reinforcementRound !== 3)
          throw new Error('Invalid legacy setup round');
        const board = territoryRecord.parse(state.territories);
        const counts: Record<string, Record<string, number>> = {};
        for (const id of TERRITORY_IDS) {
          const t = board[id]!;
          if (!t.ownerId || t.armies <= 1) continue;
          const byContinent = (counts[t.ownerId] ??= {});
          const c = TERRITORIES[id].continentId;
          byContinent[c] = (byContinent[c] ?? 0) + t.armies - 1;
        }
        state.setup = {
          ...setup,
          reinforcementRound: setup.reinforcementRound === 5 ? 1 : 2,
          additionalArmiesByPlayerContinent: counts,
        };
      }
    }
    migratedGame = { ...old, state };
  }
  if (header.gameSchemaVersion < 8) {
    const oldState = z
      .object({
        state: z
          .object({
            pacts: z
              .object({ competitiveWithdrawals: z.unknown().optional() })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(migratedGame);
    if (oldState.state.pacts?.competitiveWithdrawals !== undefined)
      throw new Error('Unexpected stage 2 fields in legacy schema');
  }
  if (header.gameSchemaVersion < 10) {
    const prior = z
      .object({
        state: z
          .object({ competitiveHistory: z.unknown().optional() })
          .passthrough(),
      })
      .passthrough()
      .parse(migratedGame);
    if (prior.state.competitiveHistory !== undefined)
      throw new Error('Unexpected stage 4 fields in legacy schema');
  }
  if (header.gameSchemaVersion < 9) {
    const prior = z
      .object({
        state: z
          .object({
            competitiveClock: z.unknown().optional(),
            pendingInheritance: z.unknown().optional(),
            players: z.array(
              z.object({ disqualified: z.unknown().optional() }).passthrough(),
            ),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(migratedGame);
    if (
      prior.state.competitiveClock !== undefined ||
      prior.state.pendingInheritance !== undefined ||
      prior.state.players.some((p) => p.disqualified !== undefined)
    )
      throw new Error('Unexpected stage 3 fields in legacy schema');
  }
  if (header.gameSchemaVersion < CURRENT_GAME_SCHEMA_VERSION) {
    const legacyState = z
      .object({
        pacts: z
          .object({
            active: z.array(z.object({ kind: z.string() }).passthrough()),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .parse(migratedGame.state);
    if (legacyState.pacts)
      migratedGame = {
        ...migratedGame,
        state: {
          ...legacyState,
          pacts: {
            ...legacyState.pacts,
            active: legacyState.pacts.active.map((pact) =>
              pact.kind === 'international_zone'
                ? { withdrawal: { kind: 'none' }, ...pact }
                : pact,
            ),
          },
        },
      };
  }
  if (header.gameSchemaVersion < CURRENT_GAME_SCHEMA_VERSION)
    migratedGame = {
      ...migratedGame,
      state: { ...migratedGame.state, definition: CLASSIC_GAME_DEFINITION },
    };
  return {
    format: 'ted-snapshot',
    gameSchemaVersion: CURRENT_GAME_SCHEMA_VERSION,
    persistenceGeneration: header.persistenceGeneration,
    game: validateDurableGame(migratedGame, legacyMissingAuth),
  };
}

const backupManifestFields = {
  serverVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
  gameCount: nonnegativeInteger,
};
const backupV1Schema = z.strictObject({
  format: z.literal('ted-backup'),
  manifest: z.strictObject({
    backupFormatVersion: z.literal(1),
    ...backupManifestFields,
  }),
  games: z.array(z.unknown()),
});
const backupV2Schema = z.strictObject({
  format: z.literal('ted-backup'),
  manifest: z.strictObject({
    backupFormatVersion: z.literal(2),
    ...backupManifestFields,
  }),
  games: z.array(z.unknown()),
  adminAuth: adminAuthSchema.optional(),
});
// Version 3 adds Reconquista games, checked by the Reconquista store on restore.
const backupV3Schema = z.strictObject({
  format: z.literal('ted-backup'),
  manifest: z.strictObject({
    backupFormatVersion: z.literal(CURRENT_BACKUP_FORMAT_VERSION),
    ...backupManifestFields,
    reconquistaGameCount: nonnegativeInteger,
  }),
  games: z.array(z.unknown()),
  reconquista: z.array(z.unknown()),
  adminAuth: adminAuthSchema.optional(),
});
const backupSchema = z.union([backupV1Schema, backupV2Schema, backupV3Schema]);

export function decodeBackup(value: unknown) {
  const parsed = backupSchema.parse(value);
  const games = parsed.games.map(decodeGame);
  if (games.length !== parsed.manifest.gameCount)
    throw new Error('Backup game count does not match manifest');
  // Older backups have no Reconquista games.
  const reconquista = 'reconquista' in parsed ? parsed.reconquista : [];
  if (
    'reconquista' in parsed &&
    reconquista.length !== parsed.manifest.reconquistaGameCount
  )
    throw new Error('Backup Reconquista game count does not match manifest');
  return {
    manifest: {
      ...parsed.manifest,
      backupFormatVersion: CURRENT_BACKUP_FORMAT_VERSION,
      reconquistaGameCount: reconquista.length,
    },
    games,
    reconquista,
    adminAuth:
      'adminAuth' in parsed
        ? (parsed.adminAuth?.auth as AdminAuthState | undefined)
        : undefined,
  };
}

export class UnsupportedSchemaError extends Error {
  constructor(
    readonly schemaVersion: number,
    message = `Game schema ${schemaVersion} is newer than supported schema ${CURRENT_GAME_SCHEMA_VERSION}`,
  ) {
    super(message);
    this.name = 'UnsupportedSchemaError';
  }
}
