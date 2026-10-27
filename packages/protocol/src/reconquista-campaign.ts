/** Explicit internal full-game contract. Never a Classic protocol extension. */
import { z } from 'zod';
const id = z.string().min(1).max(100),
  n = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  positive = n.min(1).max(10000);
const ids = z.array(id).max(100),
  amounts = z.record(id, positive).refine((v) => Object.keys(v).length <= 72);
export const campaignActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reinforce'),
    placements: amounts,
    conversions: amounts,
    continentPlacements: z.record(id, amounts),
  }),
  z.strictObject({
    kind: z.literal('exchange'),
    cardIds: ids,
    continentIds: ids,
  }),
  z.strictObject({
    kind: z.literal('attack-country'),
    originId: id,
    targetId: id,
    defenderId: id,
  }),
  z.strictObject({
    kind: z.literal('fire'),
    originId: id,
    targetId: id,
    defenderId: id,
  }),
  z.strictObject({ kind: z.literal('occupy'), armies: positive }),
  z.strictObject({ kind: z.literal('continue-invasion') }),
  z.strictObject({
    kind: z.literal('regroup-forces'),
    originId: id,
    targetId: id,
    armies: n,
    missiles: n,
  }),
  z.strictObject({ kind: z.literal('finish-attacks') }),
  z.strictObject({ kind: z.literal('finish-regroup') }),
  z.strictObject({ kind: z.literal('finish-ally-regroup') }),
  z.strictObject({ kind: z.literal('claim-country') }),
  z.strictObject({ kind: z.literal('claim-bonus'), cardId: id }),
  z.strictObject({ kind: z.literal('claim-continent'), continentId: id }),
  z.strictObject({
    kind: z.literal('finish-turn'),
    confirmForfeit: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('end-turn'),
    confirmForfeit: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('propose-pact'),
    partnerId: id,
    pactKind: z.enum([
      'countries',
      'continent',
      'intercontinental',
      'world',
      'zone',
    ]),
    countryIds: ids,
    continentIds: ids,
  }),
  z.strictObject({
    kind: z.literal('respond-pact'),
    pactId: id,
    accept: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('withdraw-pact'), pactId: id }),
  z.strictObject({
    kind: z.literal('propose-alliance'),
    allyId: id,
    originId: id,
    allyOriginId: id,
    targetId: id,
  }),
  z.strictObject({
    kind: z.literal('respond-alliance'),
    allianceId: id,
    accept: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('start-alliance'), allianceId: id }),
  z.strictObject({ kind: z.literal('stop-alliance') }),
  z.strictObject({
    kind: z.literal('decide-zone'),
    pactId: id,
    keep: z.boolean(),
  }),
]);
export type CampaignAction = z.infer<typeof campaignActionSchema>;
const card = z.strictObject({
  id,
  countryId: id.nullable(),
  symbol: z.enum([
    'plane',
    'tank_grenade',
    'ship',
    'soldier_wildcard',
    'supercard',
    'wildcard',
  ]),
});
const route = z.strictObject({ originId: id, targetId: id, defenderId: id });
const occupation = z.strictObject({
  targetId: id,
  creditId: id,
  joint: z.boolean(),
  arrivals: z.array(
    z.strictObject({ playerId: id, originId: id, maximum: positive }),
  ),
  capturedMissiles: n,
  invasion: z.boolean(),
  continuing: z.boolean(),
  originalDefenders: ids,
});
const pact = z.strictObject({
  id,
  proposerId: id,
  partnerId: id,
  linkedCountryId: id.nullable(),
  kind: z.enum([
    'countries',
    'continent',
    'intercontinental',
    'world',
    'internal',
    'origin',
    'zone',
  ]),
  countryIds: ids,
  continentIds: ids,
  status: z.enum(['proposed', 'active']),
  withdrawal: z
    .strictObject({ by: id, waitFor: id, completedTurns: n })
    .nullable(),
  untilStart: z.strictObject({ playerId: id, round: positive }).nullable(),
  opportunity: z.boolean(),
  fulfilled: z.boolean(),
});
const alliance = z.strictObject({
  id,
  proposerId: id,
  allyId: id,
  originId: id,
  allyOriginId: id,
  targetId: id,
  status: z.enum(['proposed', 'accepted', 'active']),
  nextId: id,
  exhaustive: z.boolean(),
  executeTurn: n,
});
export const campaignPublicSchema = z.strictObject({
  round: positive,
  order: ids,
  actorId: id,
  phase: z.enum([
    'incorporation',
    'attack',
    'regroup',
    'ally-regroup',
    'ally-closing',
    'closing',
    'zone-decision',
    'finished',
  ]),
  extraPass: z.boolean(),
  players: z.array(
    z.strictObject({
      playerId: id,
      cardCount: n.max(5),
      continentIds: ids,
      usedContinentIds: ids,
      exchanges: n,
      penaltyDebt: n,
    }),
  ),
  pacts: z.array(pact),
  alliances: z.array(alliance),
  activeAllianceId: id.nullable(),
  occupation: occupation.nullable(),
  zoneDecisions: z.array(z.strictObject({ pactId: id, playerId: id })),
  eliminations: z.record(id, id),
  winners: ids,
  /** Express ended by the clock; no winners means a full tie. */
  timeLimit: z.literal(true).optional(),
  lastCombat: route
    .extend({
      attackRolls: z.array(positive.max(6)).max(4),
      defenseRolls: z.array(positive.max(6)).max(4),
      attackLoss: n,
      defenseLoss: n,
    })
    .nullable(),
  lastMissile: route
    .extend({ distance: positive.max(3), damage: positive.max(3) })
    .nullable(),
  lastExchange: z
    .strictObject({
      playerId: id,
      countryCardIds: ids,
      countryCards: z.array(card),
      continentIds: ids,
      armies: positive,
    })
    .nullable(),
});
export const campaignPrivateSchema = z.strictObject({
  hand: z
    .array(
      card.extend({
        acquisition: z.enum(['draw', 'inheritance']),
        bonusUsed: z.boolean(),
      }),
    )
    .max(5),
  legal: z.strictObject({
    actorId: id,
    attacks: z.array(route),
    missileShots: z.array(
      route.extend({ distance: positive.max(3), damage: positive.max(3) }),
    ),
    regroups: z.array(
      z.strictObject({ originId: id, targetId: id, armies: n, missiles: n }),
    ),
    canReinforce: z.boolean(),
    canExchange: z.boolean(),
    exchanges: z.array(z.strictObject({ cardIds: ids, continentIds: ids })),
    canFinishAttacks: z.boolean(),
    canFinishRegroup: z.boolean(),
    canFinishAllyRegroup: z.boolean(),
    canFinishTurn: z.boolean(),
    canClaimCountry: z.boolean(),
    bonusCardIds: ids,
    continentIds: ids,
    needsForfeitConfirmation: z.boolean(),
    canEndTurn: z.boolean(),
    endTurnMayForfeit: z.boolean(),
    occupation: occupation.nullable(),
    freeBudget: n,
    continentBudgets: z.record(id, n),
    pactScopes: z.record(
      id,
      z.strictObject({
        continents: ids,
        continentPairs: z.array(z.tuple([id, id])),
      }),
    ),
    placementCountryIds: ids,
  }),
});
export type CampaignPublic = z.infer<typeof campaignPublicSchema>;
export type CampaignPrivate = z.infer<typeof campaignPrivateSchema>;
