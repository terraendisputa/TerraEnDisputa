import {
  campaignActionSchema,
  campaignPublicSchema,
  campaignPrivateSchema,
} from './reconquista-campaign.js';
export type {
  CampaignAction,
  CampaignPublic,
  CampaignPrivate,
} from './reconquista-campaign.js';
/** Reconquista HTTP and live contract. Independent from Classic's protocol. */
import { z } from 'zod';
import { nicknameSchema } from './nickname.js';
export { sameNickname } from './nickname.js';
export const RECONQUISTA_PROTOCOL = 4 as const;
export const RECONQUISTA_DEFINITION = {
  editionId: 'reconquista',
  boardId: 'reconquista',
  rulesVersion: 1,
} as const;
const identifier = z.string().min(1).max(80);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(10000);
const amounts = z
  .record(identifier, positive)
  .refine((value) => Object.keys(value).length <= 72);
export const reconquistaActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start-campaign') }),
  z.strictObject({ kind: z.literal('finish-attacks') }),
  z.strictObject({ kind: z.literal('campaign'), action: campaignActionSchema }),
  z.strictObject({
    kind: z.literal('fire-missile'),
    originId: identifier,
    targetId: identifier,
  }),
  z.strictObject({
    kind: z.literal('regroup-missiles'),
    originId: identifier,
    targetId: identifier,
    missiles: positive,
  }),
  z.strictObject({
    kind: z.literal('place'),
    placements: amounts,
    conversions: amounts,
  }),
  z.strictObject({
    kind: z.literal('extra'),
    placements: amounts,
    conversions: amounts,
  }),
  z.strictObject({ kind: z.literal('reveal') }),
  z.strictObject({
    kind: z.literal('attack'),
    originId: identifier,
    targetId: identifier,
  }),
  z.strictObject({ kind: z.literal('transfer'), armies: positive }),
  z.strictObject({
    kind: z.literal('regroup'),
    originId: identifier,
    targetId: identifier,
    armies: positive,
  }),
]);
export type ReconquistaAction = z.infer<typeof reconquistaActionSchema>;
export const reconquistaCommandSchema = z.strictObject({
  protocolVersion: z.literal(RECONQUISTA_PROTOCOL),
  commandId: z.string().uuid(),
  revision: count,
  action: reconquistaActionSchema,
});
export const reconquistaCreateSchema = z.strictObject({
  playerCount: z.union([
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
});
/** Host lobby settings: required players and the Express duration. */
export const reconquistaConfigureSchema = z.strictObject({
  playerCount: reconquistaCreateSchema.shape.playerCount.optional(),
  express: z.boolean().optional(),
  /** Seats bots take at the start; at least one stays for a person. */
  bots: z.number().int().min(0).max(5).optional(),
});
export const reconquistaBotLevelSchema = z.enum(['easy', 'normal', 'hard']);
/** Host changes to the bots of a started game, as in Classic. */
export const reconquistaBotsSchema = z.union([
  z.strictObject({
    level: reconquistaBotLevelSchema.optional(),
    replaceAbsent: z.boolean().optional(),
  }),
  z.strictObject({ playerId: z.string().uuid(), enabled: z.boolean() }),
]);
/** Express clock as a screen shows it; times are as of the reading. */
export const reconquistaClockSchema = z.strictObject({
  durationMs: count,
  elapsedMs: count,
  activationRemainingMs: count,
  finalRound: count.optional(),
  pauseReason: z.enum(['admin', 'restart', 'disconnection']).optional(),
  disconnectedPlayerId: identifier.optional(),
  technicalRemainingMs: count.optional(),
  absentPlayerIds: z.array(identifier).max(6),
});
export type ReconquistaClock = z.infer<typeof reconquistaClockSchema>;
export const reconquistaJoinSchema = z.strictObject({
  nickname: nicknameSchema(32),
  color: z.enum(['white', 'black', 'red', 'blue', 'yellow', 'green']),
});
const color = reconquistaJoinSchema.shape.color;
/** A person takes a seat a table bot left free. */
export const reconquistaTakeSeatSchema = z.strictObject({
  playerId: z.string().uuid(),
  nickname: reconquistaJoinSchema.shape.nickname,
});
const route = z.strictObject({ originId: identifier, targetId: identifier });
const pending = z.strictObject({
  originId: identifier,
  targetId: identifier,
  minimum: z.literal(1),
  maximum: positive,
});
const combat = z.strictObject({
  originId: identifier,
  targetId: identifier,
  attackRolls: z.array(z.number().int().min(1).max(6)).min(1).max(4),
  defenseRolls: z.array(z.number().int().min(1).max(6)).min(1).max(4),
  attackLoss: count,
  defenseLoss: count,
});
const player = z.strictObject({
  id: identifier,
  color,
  nickname: z.string(),
  ready: z.boolean(),
  /** Who plays a seat for its person: a table bot, one the host put, or one replacing an absence. */
  bot: z.enum(['table', 'admin', 'absent']).optional(),
  /** A table bot's seat freed for anyone with the link. */
  free: z.literal(true).optional(),
});
const secret = z.strictObject({
  objectiveId: identifier,
  targetPlayerId: identifier.optional(),
  description: z.string(),
  descriptionEn: z.string().optional(),
});
/** Selection the player on turn shares; empty ids clear it. */
export const reconquistaFocusSchema = z.strictObject({
  originId: identifier.optional(),
  targetId: identifier.optional(),
});
export const reconquistaViewSchema = z.strictObject({
  protocolVersion: z.literal(RECONQUISTA_PROTOCOL),
  definition: z.strictObject({
    editionId: z.literal('reconquista'),
    boardId: z.literal('reconquista'),
    rulesVersion: z.literal(1),
  }),
  gameId: z.string().uuid(),
  revision: count,
  playerCount: reconquistaCreateSchema.shape.playerCount,
  express: z.literal(true).optional(),
  clock: reconquistaClockSchema.optional(),
  stage: z.enum([
    'lobby',
    'initial-placement',
    'reveal-situation',
    'extra-placement',
    'first-hostility',
    'campaign',
  ]),
  players: z.array(player).max(6),
  circle: z.array(identifier),
  territories: z
    .array(
      z.strictObject({
        id: identifier,
        ownership: z.discriminatedUnion('kind', [
          z.strictObject({
            kind: z.literal('exclusive'),
            playerId: identifier,
          }),
          z.strictObject({
            kind: z.literal('shared'),
            playerIds: z.tuple([identifier, identifier]),
          }),
        ]),
        forces: z
          .array(
            z.strictObject({
              playerId: identifier,
              armies: count,
              missiles: count,
            }),
          )
          .min(1)
          .max(2),
      }),
    )
    .max(72),
  situation: z.strictObject({ id: identifier, typeId: identifier }).nullable(),
  crisis: z
    .strictObject({
      kind: z.literal('crisis'),
      participants: z.array(identifier),
      rolls: z.array(z.number().int().min(1).max(6)),
      affectedPlayerIds: z.array(identifier),
      tiebreaks: z.array(z.array(z.number().int().min(1).max(6))).optional(),
    })
    .nullable(),
  restingPlayerId: identifier.nullable(),
  winnerObjectives: z
    .array(
      z.strictObject({
        playerId: identifier,
        objectives: z.array(secret).max(2),
      }),
    )
    .max(6)
    .optional(),
  campaign: campaignPublicSchema.nullable(),
  hostility: z
    .strictObject({
      actorId: identifier,
      phase: z.enum(['attack', 'regroup']),
      pendingConquest: pending.nullable(),
      lastCombat: combat.nullable(),
      lastMissile: route
        .extend({
          distance: z.number().int().min(1).max(3),
          damage: z.number().int().min(1).max(3),
        })
        .nullable(),
    })
    .nullable(),
  self: z
    .strictObject({
      playerId: identifier,
      campaign: campaignPrivateSchema.optional(),
      objectives: z.array(secret).max(2),
      legal: z.strictObject({
        actorId: identifier,
        canPlace: z.boolean(),
        canReveal: z.boolean(),
        budget: count,
        placementCountryIds: z.array(identifier).max(72),
        attacks: z.array(route),
        missileShots: z.array(
          route.extend({
            distance: z.number().int().min(1).max(3),
            damage: z.number().int().min(1).max(3),
          }),
        ),
        missileRegroups: z.array(route.extend({ maximum: count })),
        regroups: z.array(route.extend({ maximum: count })),
        transfer: pending.nullable(),
      }),
    })
    .optional(),
  /** Countries the player on turn has selected, shown to everyone; never journaled. */
  focus: reconquistaFocusSchema.extend({ playerId: identifier }).optional(),
});
export type ReconquistaView = z.infer<typeof reconquistaViewSchema>;
export const reconquistaBoardSchema = z.strictObject({
  protocolVersion: z.literal(1),
  authorityId: z.literal('ted-reconquista-board-visual-3'),
  countries: z
    .array(
      z.strictObject({
        id: identifier,
        name: z.string(),
        continentId: identifier,
        // Centre of the army counter, under the printed name.
        label: z.tuple([z.number(), z.number()]),
        // Fixed spots and headings for this country's missiles: x, y, degrees.
        missileSpots: z
          .array(z.tuple([z.number(), z.number(), z.number()]))
          .min(1),
      }),
    )
    .length(72),
  // Borders and sea crossings, so menus can offer only reachable countries.
  connections: z.array(z.tuple([identifier, identifier])),
});
export type ReconquistaBoard = z.infer<typeof reconquistaBoardSchema>;
export const reconquistaEntrySchema = z.strictObject({
  playerCount: reconquistaCreateSchema.shape.playerCount,
  express: z.literal(true).optional(),
  stage: z.enum(['lobby', 'started']),
  players: z.array(player).max(6),
  botSeats: z.number().int().min(1).max(5).optional(),
  botLevel: reconquistaBotLevelSchema.optional(),
  botsReplaceAbsent: z.boolean().optional(),
});
export type ReconquistaEntry = z.infer<typeof reconquistaEntrySchema>;
export const reconquistaCreatedSchema = z.strictObject({
  gameId: z.string().uuid(),
  revision: count,
  protocolVersion: z.literal(RECONQUISTA_PROTOCOL),
});
export const reconquistaCommandResultSchema = z.strictObject({
  state: reconquistaViewSchema,
  duplicate: z.boolean(),
});
