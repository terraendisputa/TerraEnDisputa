/**
 * Reconquista bot diplomacy (user decisions of 2026-10-27): answers to pacts,
 * alliances and zones, Hard breaking pacts, and at most one offer a turn.
 */
import {
  applyCampaign,
  type Campaign,
  type CampaignAction,
} from './campaign.js';
import { continent, turnActor } from './campaign-politics.js';
import type { PreparationBoard, PreparationRandom } from './preparation.js';

export type DiplomacyLevel = 'easy' | 'normal' | 'hard';
/** What a bot remembers between moves: the turn it last offered or broke a pact. */
export interface ReconquistaBotMemory {
  offeredTurn?: string;
  brokeTurn?: string;
}
/** Pacts players sign, as opposed to those joint attacks create. */
const SIGNED = ['countries', 'continent', 'intercontinental', 'world', 'zone'];
/** A partner with less than this share of the bot's armies is much weaker. */
const MUCH_WEAKER = 0.5;
/** Chance below which one attacker alone cannot take a country. */
const ALONE = 0.5;
/** Chance two attackers together need before offering an alliance. */
const TOGETHER = 0.6;

interface Map {
  readonly armies: (id: string, player: string) => number;
  readonly owns: (id: string, player: string) => boolean;
  readonly defenders: (id: string, player: string) => number;
  readonly enemies: (id: string, player: string) => string[];
}
export interface DiplomacyContext {
  readonly board: PreparationBoard;
  readonly catalog: unknown;
  readonly c: Campaign;
  readonly bot: string;
  readonly level: DiplomacyLevel;
  readonly random: PreparationRandom;
  readonly map: Map;
  /** Countries the bot wants, by value (Hard); empty for the other levels. */
  readonly values: Readonly<Record<string, number>>;
  readonly targets: readonly string[];
  readonly chance: (attacker: number, defender: number) => number;
}

const strength = (c: Campaign, player: string) =>
  c.territories.reduce(
    (sum, t) =>
      sum + (t.forces.find((f) => f.playerId === player)?.armies ?? 0),
    0,
  );
const adjacent = (board: PreparationBoard, a: string, b: string) =>
  board.connections.some(
    (e) => e.endpoints.includes(a) && e.endpoints.includes(b),
  );
/** Accepted by the rules right now: tried on a copy, never on the game. */
function allowed(x: DiplomacyContext, action: CampaignAction): boolean {
  try {
    applyCampaign(x.board, x.catalog, x.c, x.bot, action, () => 0);
    return true;
  } catch {
    return false;
  }
}
const holds = (x: DiplomacyContext, continentId: string, slack = 0) =>
  x.board.countries.filter(
    (c) => c.continentId === continentId && !x.map.owns(c.id, x.bot),
  ).length <= slack;
/** Bordering pairs, bot's country first, that a pact with this partner keeps at peace. */
function covered(
  x: DiplomacyContext,
  partner: string,
  pact: { kind: string; countryIds: string[]; continentIds: string[] },
): [string, string][] {
  if (pact.kind === 'countries') {
    const [a, b] = pact.countryIds as [string, string];
    return x.map.owns(a, x.bot) ? [[a, b]] : [[b, a]];
  }
  if (!['world', 'continent', 'intercontinental'].includes(pact.kind))
    return [];
  const pairs: [string, string][] = [];
  for (const e of x.board.connections) {
    for (const [mine, theirs] of [
      e.endpoints,
      [e.endpoints[1], e.endpoints[0]],
    ] as const) {
      if (!x.map.owns(mine, x.bot) || !x.map.owns(theirs, partner)) continue;
      if (
        pact.kind !== 'world' &&
        !(
          pact.continentIds.includes(continent(x.board, mine)) &&
          pact.continentIds.includes(continent(x.board, theirs))
        )
      )
        continue;
      pairs.push([mine, theirs]);
    }
  }
  return pairs;
}
const guards = (x: DiplomacyContext, pairs: [string, string][], slack = 0) =>
  pairs.some(([mine]) => holds(x, continent(x.board, mine), slack));

/** Hard: a pact stands in the way of its objectives (Classic's criteria). */
function inTheWay(
  x: DiplomacyContext,
  partner: string,
  pairs: [string, string][],
) {
  if (x.targets.includes(partner)) return true;
  if (strength(x.c, partner) < MUCH_WEAKER * strength(x.c, x.bot)) return true;
  return pairs.some(
    ([mine, theirs]) =>
      x.map.armies(mine, x.bot) >= 2 && (x.values[theirs] ?? 0) >= 4,
  );
}

/** The answer to the first pact or alliance waiting for the bot. */
export function diplomacyAnswer(x: DiplomacyContext): CampaignAction | null {
  const { c, bot } = x;
  if (c.pending || c.phase === 'zone-decision' || c.phase === 'finished')
    return null;
  const coin = () => x.random() < 0.5;
  const pact = c.pacts.find(
    (p) => p.status === 'proposed' && p.partnerId === bot,
  );
  if (pact) {
    const from = pact.proposerId;
    const stronger = strength(c, from) > strength(c, bot);
    const accept =
      x.level === 'easy'
        ? coin()
        : !x.targets.includes(from) &&
          (stronger ||
            (pact.kind !== 'zone' && guards(x, covered(x, from, pact))));
    const action: CampaignAction = {
      kind: 'respond-pact',
      pactId: pact.id,
      accept,
    };
    return accept && !allowed(x, action)
      ? { ...action, accept: false }
      : action;
  }
  const alliance = c.alliances.find(
    (a) => a.status === 'proposed' && a.allyId === bot,
  );
  if (alliance) {
    // Pacts it signed; the automatic ones of joint attacks do not count.
    const partners = c.pacts
      .filter(
        (p) =>
          p.status === 'active' &&
          SIGNED.includes(p.kind) &&
          [p.proposerId, p.partnerId].includes(bot),
      )
      .map((p) => (p.proposerId === bot ? p.partnerId : p.proposerId));
    const accept =
      x.level === 'easy'
        ? coin()
        : !partners.some((p) => x.map.owns(alliance.targetId, p));
    const action: CampaignAction = {
      kind: 'respond-alliance',
      allianceId: alliance.id,
      accept,
    };
    return accept && !allowed(x, action)
      ? { ...action, accept: false }
      : action;
  }
  return null;
}

/** A zone the partner did not keep: Easy decides at random, the others end it. */
export function zoneDecision(x: DiplomacyContext): CampaignAction {
  return {
    kind: 'decide-zone',
    pactId: x.c.zoneDecisions[0]!.pactId,
    keep: x.level === 'easy' ? x.random() < 0.5 : false,
  };
}

/** Starts an accepted alliance on its turn. */
export function allianceToStart(x: DiplomacyContext): CampaignAction | null {
  for (const a of x.c.alliances.filter(
    (a) => a.proposerId === x.bot && a.status === 'accepted',
  )) {
    const action: CampaignAction = { kind: 'start-alliance', allianceId: a.id };
    if (allowed(x, action)) return action;
  }
  return null;
}

/** Hard: withdraws from the first pact in its way, once a turn. */
function pactToBreak(x: DiplomacyContext): CampaignAction | null {
  if (x.level !== 'hard') return null;
  for (const p of x.c.pacts) {
    if (
      p.status !== 'active' ||
      p.withdrawal ||
      !SIGNED.includes(p.kind) ||
      ![p.proposerId, p.partnerId].includes(x.bot)
    )
      continue;
    const partner = p.proposerId === x.bot ? p.partnerId : p.proposerId;
    if (!inTheWay(x, partner, covered(x, partner, p))) continue;
    const action: CampaignAction = { kind: 'withdraw-pact', pactId: p.id };
    if (allowed(x, action)) return action;
  }
  return null;
}

/** A border pact to a stronger neighbor threatening a continent it holds or nearly holds. */
function pactToPropose(x: DiplomacyContext): CampaignAction | null {
  const mine = strength(x.c, x.bot);
  for (const t of x.c.territories) {
    if (!x.map.owns(t.id, x.bot)) continue;
    for (const theirs of x.map.enemies(t.id, x.bot)) {
      const owner = x.c.territories.find((v) => v.id === theirs)!;
      if (owner.forces.length !== 1) continue;
      const neighbor = owner.forces[0]!.playerId;
      const pair: [string, string][] = [[t.id, theirs]];
      if (
        x.targets.includes(neighbor) ||
        strength(x.c, neighbor) <= mine ||
        x.map.armies(theirs, neighbor) < x.map.armies(t.id, x.bot) ||
        !guards(x, pair, 1) ||
        (x.level === 'hard' && inTheWay(x, neighbor, pair))
      )
        continue;
      const action: CampaignAction = {
        kind: 'propose-pact',
        partnerId: neighbor,
        pactKind: 'countries',
        countryIds: [t.id, theirs],
        continentIds: [],
      };
      if (allowed(x, action)) return action;
    }
  }
  return null;
}

/**
 * An alliance on a country that neither can take alone but both together
 * can, offered to the strongest player on that border.
 */
function allianceToPropose(x: DiplomacyContext): CampaignAction | null {
  const { c, bot, map } = x;
  for (const target of c.territories) {
    if (map.owns(target.id, bot) || target.forces.length !== 1) continue;
    const holder = target.forces[0]!.playerId;
    if (x.level === 'hard' && (x.values[target.id] ?? 0) < 4) continue;
    const defense = target.forces[0]!.armies;
    const origin = c.territories
      .filter(
        (t) =>
          map.owns(t.id, bot) &&
          t.forces.length === 1 &&
          adjacent(x.board, t.id, target.id) &&
          map.armies(t.id, bot) >= 2,
      )
      .sort((a, b) => map.armies(b.id, bot) - map.armies(a.id, bot))[0];
    if (!origin || x.chance(map.armies(origin.id, bot), defense) >= ALONE)
      continue;
    const allies = c.territories
      .flatMap((t) =>
        t.forces.length === 1 &&
        t.forces[0]!.playerId !== bot &&
        t.forces[0]!.playerId !== holder &&
        !x.targets.includes(t.forces[0]!.playerId) &&
        !c.eliminations[t.forces[0]!.playerId] &&
        adjacent(x.board, t.id, target.id) &&
        t.forces[0]!.armies >= 2
          ? [
              {
                id: t.id,
                ally: t.forces[0]!.playerId,
                armies: t.forces[0]!.armies,
              },
            ]
          : [],
      )
      .filter(
        (a) =>
          x.chance(a.armies, defense) < ALONE &&
          x.chance(map.armies(origin.id, bot) + a.armies - 1, defense) >=
            TOGETHER,
      )
      .sort((a, b) => strength(c, b.ally) - strength(c, a.ally));
    for (const a of allies) {
      const action: CampaignAction = {
        kind: 'propose-alliance',
        allyId: a.ally,
        originId: origin.id,
        allyOriginId: a.id,
        targetId: target.id,
      };
      if (allowed(x, action)) return action;
    }
  }
  return null;
}

/** Hard: a zone on its lone army that a stronger neighbor threatens. */
function zoneToPropose(x: DiplomacyContext): CampaignAction | null {
  if (x.level !== 'hard') return null;
  const mine = strength(x.c, x.bot);
  for (const t of x.c.territories) {
    if (
      t.forces.length !== 1 ||
      t.forces[0]!.playerId !== x.bot ||
      t.forces[0]!.armies !== 1 ||
      t.forces[0]!.missiles !== 0
    )
      continue;
    for (const theirs of x.map.enemies(t.id, x.bot)) {
      const owner = x.c.territories.find((v) => v.id === theirs)!;
      const neighbor = owner.forces[0]!.playerId;
      if (x.targets.includes(neighbor) || strength(x.c, neighbor) <= mine)
        continue;
      const action: CampaignAction = {
        kind: 'propose-pact',
        partnerId: neighbor,
        pactKind: 'zone',
        countryIds: [t.id],
        continentIds: [],
      };
      if (allowed(x, action)) return action;
    }
  }
  return null;
}

/**
 * At the start of its attacks, once a turn: Hard breaks a pact in its way,
 * then Normal and Hard offer a pact, an alliance or (Hard) a zone.
 */
export function diplomacyOffer(
  x: DiplomacyContext,
  memory: ReconquistaBotMemory | undefined,
): CampaignAction | null {
  if (!memory || x.level === 'easy' || turnActor(x.c) !== x.bot) return null;
  const turn = `${x.c.round}:${x.c.completedTurns[x.bot] ?? 0}`;
  if (memory.brokeTurn !== turn) {
    memory.brokeTurn = turn;
    const broken = pactToBreak(x);
    if (broken) return broken;
  }
  if (memory.offeredTurn === turn) return null;
  memory.offeredTurn = turn;
  return pactToPropose(x) ?? allianceToPropose(x) ?? zoneToPropose(x);
}
