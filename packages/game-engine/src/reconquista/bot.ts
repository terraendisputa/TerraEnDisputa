/**
 * Reconquista bots. One ordinary command at a time, so the journal keeps
 * bot moves like a player's. The three levels follow Classic's bots; the
 * missile and card rules are the user's decisions of 2026-10-27.
 */
import { campaignLegal, type Campaign } from './campaign.js';
import { continent, turnActor } from './campaign-politics.js';
import type { ReconquistaTerritory } from './contracts.js';
import {
  allianceToStart,
  diplomacyAnswer,
  diplomacyOffer,
  zoneDecision,
  type DiplomacyContext,
  type ReconquistaBotMemory,
} from './bot-diplomacy.js';
import { reconquistaActor } from './express.js';
import { firstHostilityActions } from './hostilities.js';
import type { InitialSecret } from './objectives.js';
import type { PreparationBoard, PreparationRandom } from './preparation.js';
import { combatDice } from './round.js';
import type { VictoryObjective } from './victory.js';
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

/** Chance Hard needs before attacking, as in Classic. */
const HARD_CHANCE = { target: 0.5, other: 0.65, card: 0.5 };
/** Countries anyone wins with, whatever the objective. */
const COMMON_COUNTRIES = 45;

type Territories = readonly Pick<ReconquistaTerritory, 'id' | 'forces'>[];

/** Odds of each loss pair for one roll, by attacker and defender dice. */
const rolls = new Map<string, readonly (readonly [number, number, number])[]>();
function rollOutcomes(attack: number, defense: number) {
  const key = `${attack}:${defense}`;
  const known = rolls.get(key);
  if (known) return known;
  const counts = new Map<string, number>();
  const total = 6 ** (attack + defense);
  for (let n = 0; n < total; n++) {
    const faces = Array.from(
      { length: attack + defense },
      (_, i) => (Math.floor(n / 6 ** i) % 6) + 1,
    );
    const a = faces.slice(0, attack).sort((x, y) => y - x);
    const d = faces.slice(attack).sort((x, y) => y - x);
    let al = 0,
      dl = 0;
    for (let i = 0; i < Math.min(attack, defense); i++)
      if (a[i]! > d[i]!) dl++;
      else al++;
    counts.set(`${al}:${dl}`, (counts.get(`${al}:${dl}`) ?? 0) + 1);
  }
  const outcomes = [...counts].map(([k, c]) => {
    const [al, dl] = k.split(':').map(Number) as [number, number];
    return [al, dl, c / total] as const;
  });
  rolls.set(key, outcomes);
  return outcomes;
}
const chances = new Map<string, number>();
/** Chance of taking a country by rolling until one attacking army is left. */
function conquestChance(attacker: number, defender: number, situation: string) {
  const a = Math.min(attacker, 30),
    d = Math.min(defender, 30);
  if (d <= 0) return 1;
  if (a < 2) return 0;
  const key = `${a}:${d}:${situation}`;
  const known = chances.get(key);
  if (known !== undefined) return known;
  const dice = combatDice(a, d, situation);
  let chance = 0;
  for (const [al, dl, p] of rollOutcomes(dice.attack, dice.defense))
    chance +=
      p *
      conquestChance(a - Math.min(al, a - 1), d - Math.min(dl, d), situation);
  chances.set(key, chance);
  return chance;
}

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
  const owns = (id: string, player: string) =>
    !!byId.get(id)?.forces.some((f) => f.playerId === player);
  return { armies, enemies, threat, defenders, owns };
}
type Geography = ReturnType<typeof geography>;

/**
 * How much Hard wants each country it is not in: what its objectives still
 * need, the color it must destroy, continents it is about to complete, and
 * every country once 45 countries are closer than the objectives.
 */
function wants(
  board: PreparationBoard,
  catalog: unknown,
  map: Geography,
  bot: string,
  secrets: readonly InitialSecret[],
  eliminations: Readonly<Record<string, string>>,
): Record<string, number> {
  const all = (
    catalog as { objectives: (VictoryObjective & { target?: string })[] }
  ).objectives;
  const countries = board.countries;
  const owned = countries.filter((c) => map.owns(c.id, bot));
  const ownedIn = (continentId: string) =>
    owned.filter((c) => c.continentId === continentId).length;
  const size = (continentId: string) =>
    countries.filter((c) => c.continentId === continentId).length;
  const quotas: Record<string, number> = {};
  let islands = 0,
    minimum = 0,
    gap = 0;
  const targets: string[] = [];
  for (const secret of secrets) {
    const o = all.find((o) => o.id === secret.objectiveId);
    if (!o) continue;
    if (o.kind === 'destruction') {
      const credit = secret.targetPlayerId
        ? eliminations[secret.targetPlayerId]
        : undefined;
      // A target someone else destroyed leaves the 45 countries.
      if (credit === undefined && secret.targetPlayerId) {
        targets.push(secret.targetPlayerId);
        gap += countries.filter((c) =>
          map.owns(c.id, secret.targetPlayerId!),
        ).length;
      } else if (credit !== bot) gap += COMMON_COUNTRIES - owned.length;
      continue;
    }
    if (o.minTerritories) {
      minimum = Math.max(minimum, o.minTerritories);
      gap += Math.max(0, o.minTerritories - owned.length);
    }
    for (const [id, n] of Object.entries(o.requirements ?? {})) {
      const quota = n === 'all' ? size(id) : n;
      quotas[id] = Math.max(quotas[id] ?? 0, quota);
      gap += Math.max(0, quota - ownedIn(id));
    }
    if (o.islands) {
      islands = o.islands.count;
      gap += Math.max(0, islands - owned.filter((c) => c.island).length);
    }
  }
  const common = COMMON_COUNTRIES - owned.length < gap;
  const islandsShort = owned.filter((c) => c.island).length < islands;
  const values: Record<string, number> = {};
  for (const c of countries) {
    if (map.owns(c.id, bot)) continue;
    let value = common ? 3 : 1;
    if (!common) {
      if (ownedIn(c.continentId) < (quotas[c.continentId] ?? 0)) value += 4;
      if (minimum && owned.length < minimum) value += 2;
      if (islandsShort && c.island) value += 3;
      if (targets.some((t) => map.owns(c.id, t)))
        value += 4 + 8 / Math.max(1, gap);
    }
    const missing = size(c.continentId) - ownedIn(c.continentId);
    if (ownedIn(c.continentId) * 2 >= size(c.continentId)) value += 4 / missing;
    values[c.id] = value;
  }
  return values;
}

/**
 * Where an army helps Hard most: exposed borders, entries to its continents,
 * lone armies next to strong enemies, and countries it attacks from next.
 */
function guardScore(
  board: PreparationBoard,
  map: Geography,
  bot: string,
  id: string,
  values: Record<string, number>,
  extra = 0,
) {
  const enemies = map.enemies(id, bot);
  if (!enemies.length) return -100;
  const own = map.armies(id, bot) + extra;
  const danger = map.threat(id, bot);
  let score = danger - own;
  const continentId = continent(board, id);
  if (
    board.countries
      .filter((c) => c.continentId === continentId)
      .every((c) => map.owns(c.id, bot))
  )
    score += 3;
  if (own <= 1 && danger >= 3) score += 3;
  return score + 1.5 * Math.max(...enemies.map((t) => values[t] ?? 0));
}

/**
 * Hard reinforcements: up to half shore up the countries that need it most,
 * the rest gather on the country that best attacks what the bot wants.
 */
function hardPlacements(
  board: PreparationBoard,
  map: Geography,
  bot: string,
  choices: readonly string[],
  total: number,
  values: Record<string, number>,
  situation: string,
): Record<string, number> {
  if (total <= 0 || !choices.length) return {};
  const guard = Math.floor(total / 2);
  const placed: Record<string, number> = {};
  let used = 0;
  for (const id of [...choices].sort(
    (a, b) =>
      guardScore(board, map, bot, b, values) -
      guardScore(board, map, bot, a, values),
  )) {
    if (used >= guard) break;
    const need = Math.min(
      guard - used,
      Math.max(0, map.threat(id, bot) - map.armies(id, bot)),
    );
    if (need > 0 && guardScore(board, map, bot, id, values) > 0) {
      placed[id] = need;
      used += need;
    }
  }
  const left = total - used;
  let best = choices[0]!,
    score = -Infinity;
  for (const id of choices) {
    const own = map.armies(id, bot) + (placed[id] ?? 0) + left;
    for (const to of map.enemies(id, bot)) {
      const value =
        (values[to] ?? 0) *
        conquestChance(own, map.defenders(to, bot), situation);
      if (value > score) {
        best = id;
        score = value;
      }
    }
  }
  if (left > 0) placed[best] = (placed[best] ?? 0) + left;
  return placed;
}

/** Hard attacks where the odds pay for what it wants; leaving a weak origin costs. */
function hardAttack<T extends { originId: string; targetId: string }>(
  map: Geography,
  bot: string,
  routes: readonly T[],
  values: Record<string, number>,
  situation: string,
  wantsCard: boolean,
  defenders: (route: T) => number,
): T | undefined {
  let best: T | undefined,
    score = 0;
  for (const r of routes) {
    const chance = conquestChance(
      map.armies(r.originId, bot),
      defenders(r),
      situation,
    );
    const value = values[r.targetId] ?? 0;
    const needed =
      value >= 4
        ? HARD_CHANCE.target
        : wantsCard
          ? HARD_CHANCE.card
          : HARD_CHANCE.other;
    if (chance < needed) continue;
    const exposure =
      map.threat(r.originId, bot) - defenders(r) > map.armies(r.originId, bot)
        ? 1
        : 0;
    const total = chance * value - exposure;
    if (total > score) {
      best = r;
      score = total;
    }
  }
  return best;
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

/** Hard keeps its cards unless the hand is large or a continent of its is at risk. */
function hardExchangesNow(
  board: PreparationBoard,
  c: Campaign,
  map: Geography,
  bot: string,
  values: Record<string, number>,
) {
  if (c.cards.hands[bot]!.length >= 4) return true;
  return c.territories.some(
    (t) =>
      map.owns(t.id, bot) &&
      board.countries
        .filter((x) => x.continentId === continent(board, t.id))
        .every((x) => map.owns(x.id, bot)) &&
      guardScore(board, map, bot, t.id, values) > 3,
  );
}

function campaignMove(
  board: PreparationBoard,
  catalog: unknown,
  c: Campaign,
  bot: string,
  level: ReconquistaBotLevel,
  random: PreparationRandom,
  memory: ReconquistaBotMemory | undefined,
): SetupAction | null {
  const move = (action: Extract<SetupAction, { kind: 'campaign' }>['action']) =>
    ({ kind: 'campaign', action }) as const;
  if (c.phase === 'finished') return null;
  const map = geography(board, c.territories);
  const situation = c.cycle.active!.typeId;
  const hard = level === 'hard';
  const secrets =
    c.objectives.find((o) => o.playerId === bot)?.objectives ?? [];
  const values = hard
    ? wants(board, catalog, map, bot, secrets, c.eliminations)
    : {};
  const x: DiplomacyContext = {
    board,
    catalog,
    c,
    bot,
    level,
    random,
    map,
    values,
    // Colors it must destroy, while nobody else has.
    targets: secrets.flatMap((o) =>
      o.targetPlayerId && !c.eliminations[o.targetPlayerId]
        ? [o.targetPlayerId]
        : [],
    ),
    chance: (attacker, defender) =>
      conquestChance(attacker, defender, situation),
  };
  // Offers are answered even out of turn.
  const answer = diplomacyAnswer(x);
  if (answer) return move(answer);
  if (campaignLegal(board, c, turnActor(c)).actorId !== bot) return null;
  const place = (ids: readonly string[], amount: number) =>
    hard
      ? hardPlacements(board, map, bot, ids, amount, values, situation)
      : placements(map, bot, ids, amount, level, random);
  if (c.phase === 'zone-decision') return move(zoneDecision(x));
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
  if (
    legal.canExchange &&
    legal.exchanges.length &&
    (!hard || hardExchangesNow(board, c, map, bot, values))
  ) {
    const choice = [...legal.exchanges].sort(
      (a, b) => a.continentIds.length - b.continentIds.length,
    )[0]!;
    return move({ kind: 'exchange', ...choice });
  }
  if (legal.canReinforce) {
    const ids = legal.placementCountryIds;
    const free = place(ids, c.freeBudget);
    const byContinent =
      c.phase === 'closing'
        ? {}
        : Object.fromEntries(
            Object.entries(c.continentBudgets).map(([id, armies]) => [
              id,
              place(
                ids.filter((country) => continent(board, country) === id),
                armies,
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
    const diplomacy = allianceToStart(x) ?? diplomacyOffer(x, memory);
    if (diplomacy) return move(diplomacy);
    const defenders = (r: { targetId: string; defenderId: string }) =>
      map.armies(r.targetId, r.defenderId);
    // A country it already shares is attacked from inside: from outside,
    // winning it fails (open question to the user, 2026-10-27).
    const routes = legal.attacks.filter(
      (r) => r.originId === r.targetId || !map.owns(r.targetId, bot),
    );
    const attack = hard
      ? hardAttack(
          map,
          bot,
          routes,
          values,
          situation,
          !c.conquests[bot]?.individual && c.cards.hands[bot]!.length < 5,
          defenders,
        )
      : attackChoice(map, bot, routes, level, random, defenders);
    // Hard also fires at the countries its objectives need.
    const wanted = hard
      ? [...legal.missileShots]
          .filter((s) => (values[s.targetId] ?? 0) >= 4)
          .sort(
            (a, b) =>
              (values[b.targetId] ?? 0) * b.damage -
              (values[a.targetId] ?? 0) * a.damage,
          )[0]
      : undefined;
    const shot =
      level === 'easy'
        ? random() < EASY_FIRES
          ? pick(legal.missileShots, random)
          : undefined
        : (legal.missileShots.find(
            (s) =>
              s.targetId === attack?.targetId &&
              s.defenderId === attack.defenderId,
          ) ?? wanted);
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
    const regroup = legal.regroups
      .filter(
        (r) =>
          map.enemies(r.originId, bot).length === 0 &&
          map.enemies(r.targetId, bot).length > 0,
      )
      .sort((a, b) =>
        hard
          ? guardScore(board, map, bot, b.targetId, values) -
            guardScore(board, map, bot, a.targetId, values)
          : 0,
      )[0];
    if (regroup) return move({ kind: 'regroup-forces', ...regroup });
  }
  if (legal.canFinishRegroup) return move({ kind: 'finish-regroup' });
  if (legal.canFinishTurn)
    return move({ kind: 'finish-turn', confirmForfeit: true });
  if (legal.canEndTurn) return move({ kind: 'end-turn', confirmForfeit: true });
  return null;
}

/**
 * The bot's next command, or null when it has nothing to do now. It answers
 * offers even out of turn; it makes offers only when the caller keeps a
 * memory for it, so it offers once a turn at most.
 */
export function chooseReconquistaBotMove(
  board: PreparationBoard,
  state: ReconquistaSession,
  bot: string,
  level: ReconquistaBotLevel,
  random: PreparationRandom,
  memory?: ReconquistaBotMemory,
): SetupAction | null {
  const c = state.campaign;
  if (c)
    return campaignMove(board, state.catalog, c, bot, level, random, memory);
  if (reconquistaActor(board, state) !== bot) return null;
  const secrets =
    state.objectives.secrets.find((o) => o.playerId === bot)?.objectives ?? [];
  const situation = state.cycle.active?.typeId ?? '';
  if (state.hostility) {
    const h = state.hostility;
    const map = geography(board, h.territories);
    const values =
      level === 'hard'
        ? wants(board, state.catalog, map, bot, secrets, {})
        : {};
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
      const defenders = (r: { targetId: string }) =>
        map.defenders(r.targetId, bot);
      const attack =
        level === 'hard'
          ? hardAttack(
              map,
              bot,
              legal.attacks,
              values,
              situation,
              true,
              defenders,
            )
          : attackChoice(map, bot, legal.attacks, level, random, defenders);
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
    placements:
      level === 'hard'
        ? hardPlacements(
            board,
            map,
            bot,
            legal.placementCountryIds,
            legal.budget,
            wants(board, state.catalog, map, bot, secrets, {}),
            situation,
          )
        : placements(
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
