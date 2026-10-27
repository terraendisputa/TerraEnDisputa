/**
 * Reconquista bots. One ordinary command at a time, so the journal keeps
 * bot moves like a player's. Easy and Normal follow Classic's bots; the
 * missile rules are the user's decisions of 2026-10-27.
 */
import { campaignLegal, type Campaign } from './campaign.js';
import { continent, turnActor } from './campaign-politics.js';
import type { ReconquistaTerritory } from './contracts.js';
import { reconquistaActor, reconquistaDeclines } from './express.js';
import { firstHostilityActions } from './hostilities.js';
import type { PreparationBoard, PreparationRandom } from './preparation.js';
import {
  reconquistaLegalActions,
  type ReconquistaSession,
  type SetupAction,
} from './session.js';

export const RECONQUISTA_BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type ReconquistaBotLevel = (typeof RECONQUISTA_BOT_LEVELS)[number];

/** Armies the attacker needs above the defender, as in Classic. */
const ATTACK_MARGIN = { easy: 1, normal: 2, hard: 2 } as const;
/** Easy stops attacking after one roll in six, like a cautious beginner. */
const EASY_STOPS = 1 / 6;
/** Easy fires one of its missiles now and then. */
const EASY_FIRES = 1 / 3;
/** Normal turns 6 armies into a missile only where a border country has this many. */
const MISSILE_ARMIES = 13;

type Territories = readonly Pick<ReconquistaTerritory, 'id' | 'forces'>[];

const pick = <T>(items: readonly T[], random: PreparationRandom) =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))];

function geography(board: PreparationBoard, territories: Territories) {
  const byId = new Map(territories.map((t) => [t.id, t]));
  const around = (id: string) =>
    board.connections
      .filter((e) => e.endpoints.includes(id))
      .map((e) => e.endpoints.find((other) => other !== id)!);
  const armies = (id: string, player: string) =>
    byId.get(id)?.forces.find((f) => f.playerId === player)?.armies ?? 0;
  const enemies = (id: string, player: string) =>
    around(id).filter(
      (n) => !byId.get(n)!.forces.some((f) => f.playerId === player),
    );
  const threat = (id: string, player: string) =>
    enemies(id, player).reduce(
      (sum, n) =>
        sum +
        byId
          .get(n)!
          .forces.filter((f) => f.playerId !== player)
          .reduce((s, f) => s + f.armies, 0),
      0,
    );
  const defenders = (id: string, player: string) =>
    byId
      .get(id)!
      .forces.filter((f) => f.playerId !== player)
      .reduce((s, f) => s + f.armies, 0);
  return { armies, enemies, threat, defenders };
}

/**
 * Reinforcements: Easy puts them all on one border country at random;
 * Normal adds them one by one where enemies outnumber its armies the most.
 */
function placements(
  map: ReturnType<typeof geography>,
  player: string,
  choices: readonly string[],
  amount: number,
  level: ReconquistaBotLevel,
  random: PreparationRandom,
): Record<string, number> {
  if (amount <= 0 || !choices.length) return {};
  const border = choices.filter((id) => map.enemies(id, player).length);
  const pool = border.length ? border : choices;
  if (level === 'easy') return { [pick(pool, random)!]: amount };
  const placed: Record<string, number> = {};
  for (let n = 0; n < amount; n++) {
    let best = pool[0]!,
      score = -Infinity;
    for (const id of pool) {
      const value =
        map.threat(id, player) - map.armies(id, player) - (placed[id] ?? 0);
      if (value > score) {
        best = id;
        score = value;
      }
    }
    placed[best] = (placed[best] ?? 0) + 1;
  }
  return placed;
}

/** Normal: one missile in each border country left with 13 armies or more. */
function conversions(
  map: ReturnType<typeof geography>,
  player: string,
  choices: readonly string[],
  placed: Record<string, number>,
  level: ReconquistaBotLevel,
  fixed: Readonly<Record<string, number>>,
): Record<string, number> {
  if (level === 'easy') return {};
  const total = (id: string) => map.armies(id, player) + (placed[id] ?? 0);
  return Object.fromEntries(
    choices
      .filter(
        (id) =>
          map.enemies(id, player).length > 0 &&
          total(id) >= MISSILE_ARMIES &&
          // Armies regrouped this turn stay fixed until it ends.
          total(id) - 6 >= (fixed[`${player}:${id}`] ?? 0),
      )
      .map((id) => [id, 1]),
  );
}

/** Attacks with enough armies; Easy picks one at random, Normal the best odds. */
function attackChoice<T extends { originId: string; targetId: string }>(
  map: ReturnType<typeof geography>,
  player: string,
  routes: readonly T[],
  level: ReconquistaBotLevel,
  random: PreparationRandom,
  defenders: (route: T) => number,
): T | undefined {
  const options = routes.filter(
    (r) =>
      map.armies(r.originId, player) >= defenders(r) + ATTACK_MARGIN[level],
  );
  if (!options.length) return undefined;
  if (level === 'easy')
    return random() < EASY_STOPS ? undefined : pick(options, random);
  return [...options].sort(
    (a, b) =>
      map.armies(b.originId, player) / Math.max(1, defenders(b)) -
      map.armies(a.originId, player) / Math.max(1, defenders(a)),
  )[0];
}

/** Moves the minimum when other enemies still threaten the origin (Normal). */
function occupying(
  map: ReturnType<typeof geography>,
  player: string,
  originId: string,
  targetId: string,
  maximum: number,
  level: ReconquistaBotLevel,
) {
  if (level === 'easy') return 1;
  const exposed =
    map.enemies(originId, player).some((id) => id !== targetId) &&
    map.threat(originId, player) >= map.armies(originId, player) - maximum;
  return exposed ? 1 : maximum;
}

function campaignMove(
  board: PreparationBoard,
  c: Campaign,
  bot: string,
  level: ReconquistaBotLevel,
  random: PreparationRandom,
): SetupAction | null {
  const move = (action: Extract<SetupAction, { kind: 'campaign' }>['action']) =>
    ({ kind: 'campaign', action }) as const;
  const map = geography(board, c.territories);
  if (c.phase === 'zone-decision')
    return move({
      kind: 'decide-zone',
      pactId: c.zoneDecisions[0]!.pactId,
      keep: true,
    });
  const legal = campaignLegal(board, c, bot);
  const pending = c.pending;
  if (pending?.arrivals[0]?.playerId === bot) {
    const arrival = pending.arrivals[0];
    return move({
      kind: 'occupy',
      armies: occupying(
        map,
        bot,
        arrival.originId,
        pending.targetId,
        arrival.maximum,
        level,
      ),
    });
  }
  const alliance = c.alliances.find((a) => a.id === c.activeAllianceId);
  if (alliance) {
    const route = legal.attacks.find((a) => a.targetId === alliance.targetId);
    return move(
      route ? { kind: 'attack-country', ...route } : { kind: 'stop-alliance' },
    );
  }
  const own = turnActor(c) === bot;
  // Cards first: the country card, its +3 and continent cards are always claimed.
  if (legal.canClaimCountry) return move({ kind: 'claim-country' });
  if (legal.bonusCardIds[0])
    return move({ kind: 'claim-bonus', cardId: legal.bonusCardIds[0] });
  if (legal.continentIds[0])
    return move({
      kind: 'claim-continent',
      continentId: legal.continentIds[0],
    });
  if (legal.canExchange && legal.exchanges.length) {
    const choice = [...legal.exchanges].sort(
      (a, b) => a.continentIds.length - b.continentIds.length,
    )[0]!;
    return move({ kind: 'exchange', ...choice });
  }
  if (legal.canReinforce) {
    const ids = legal.placementCountryIds;
    const free = placements(map, bot, ids, c.freeBudget, level, random);
    const byContinent =
      c.phase === 'closing'
        ? {}
        : Object.fromEntries(
            Object.entries(c.continentBudgets).map(([id, armies]) => [
              id,
              placements(
                map,
                bot,
                ids.filter((country) => continent(board, country) === id),
                armies,
                level,
                random,
              ),
            ]),
          );
    const placed = { ...free };
    for (const group of Object.values(byContinent))
      for (const [id, n] of Object.entries(group))
        placed[id] = (placed[id] ?? 0) + n;
    return move({
      kind: 'reinforce',
      placements: free,
      conversions: conversions(map, bot, ids, placed, level, c.fixedArmies),
      continentPlacements: byContinent,
    });
  }
  if (legal.canFinishAllyRegroup) return move({ kind: 'finish-ally-regroup' });
  if (!own) return null;
  if (c.phase === 'attack') {
    const defenders = (r: { targetId: string; defenderId: string }) =>
      map.armies(r.targetId, r.defenderId);
    const attack = attackChoice(
      map,
      bot,
      legal.attacks,
      level,
      random,
      defenders,
    );
    const shot =
      level === 'easy'
        ? random() < EASY_FIRES
          ? pick(legal.missileShots, random)
          : undefined
        : legal.missileShots.find(
            (s) =>
              s.targetId === attack?.targetId &&
              s.defenderId === attack.defenderId,
          );
    if (shot)
      return move({
        kind: 'fire',
        originId: shot.originId,
        targetId: shot.targetId,
        defenderId: shot.defenderId,
      });
    if (attack) return move({ kind: 'attack-country', ...attack });
    if (legal.canFinishAttacks) return move({ kind: 'finish-attacks' });
  }
  if (c.phase === 'regroup' && level !== 'easy') {
    // Interior forces move to a border country, as Classic's Normal bot.
    const regroup = legal.regroups.find(
      (r) =>
        map.enemies(r.originId, bot).length === 0 &&
        map.enemies(r.targetId, bot).length > 0,
    );
    if (regroup) return move({ kind: 'regroup-forces', ...regroup });
  }
  if (legal.canFinishRegroup) return move({ kind: 'finish-regroup' });
  if (legal.canFinishTurn)
    return move({ kind: 'finish-turn', confirmForfeit: true });
  if (legal.canEndTurn) return move({ kind: 'end-turn', confirmForfeit: true });
  return null;
}

/**
 * The bot's next command, or null when it has nothing to do now. Until bots
 * learn diplomacy, every pact or alliance offered to them is rejected.
 */
export function chooseReconquistaBotMove(
  board: PreparationBoard,
  state: ReconquistaSession,
  bot: string,
  level: ReconquistaBotLevel,
  random: PreparationRandom,
): SetupAction | null {
  const c = state.campaign;
  if (
    c &&
    c.phase !== 'finished' &&
    !c.pending &&
    c.phase !== 'zone-decision'
  ) {
    const decline = reconquistaDeclines(state, bot)[0];
    if (decline) return decline;
  }
  if (reconquistaActor(board, state) !== bot) return null;
  if (c) return campaignMove(board, c, bot, level, random);
  if (state.hostility) {
    const h = state.hostility;
    const map = geography(board, h.territories);
    const legal = firstHostilityActions(
      board,
      h,
      bot,
      state.cycle.active!.typeId,
      state.activation?.restingPlayerId ?? null,
    );
    if (legal.transfer)
      return {
        kind: 'transfer',
        armies: occupying(
          map,
          bot,
          legal.transfer.originId,
          legal.transfer.targetId,
          legal.transfer.maximum,
          level,
        ),
      };
    if (h.phase === 'attack') {
      // Missiles start with full turns.
      const attack = attackChoice(map, bot, legal.attacks, level, random, (r) =>
        map.defenders(r.targetId, bot),
      );
      if (attack) return { kind: 'attack', ...attack };
      return { kind: 'finish-attacks' };
    }
    if (level !== 'easy') {
      const regroup = legal.regroups.find(
        (r) =>
          map.enemies(r.originId, bot).length === 0 &&
          map.enemies(r.targetId, bot).length > 0,
      );
      if (regroup)
        return {
          kind: 'regroup',
          originId: regroup.originId,
          targetId: regroup.targetId,
          armies: regroup.maximum,
        };
    }
    return { kind: 'start-campaign' };
  }
  if (state.stage === 'reveal-situation') return { kind: 'reveal' };
  const legal = reconquistaLegalActions(board, state, bot);
  const map = geography(board, state.preparation.territories);
  return {
    kind: state.stage === 'initial-placement' ? 'place' : 'extra',
    placements: placements(
      map,
      bot,
      legal.placementCountryIds,
      legal.budget,
      level,
      random,
    ),
    conversions: {},
  };
}
