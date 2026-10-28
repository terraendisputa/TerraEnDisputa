import {
  CONTINENTS,
  SECRET_OBJECTIVES,
  TERRITORIES,
  TERRITORY_IDS,
  type ContinentId,
  type TerritoryId,
} from './classic-data.js';
import type {
  ActiveGameState,
  GameState,
  PactId,
  PactProposalId,
  PlayerId,
} from './domain.js';
import { deriveLegalActions } from './legal-actions.js';
import {
  applyCommand,
  isPactProposalLegal,
  type DiceSource,
  type DomainResult,
  type GameplayCommand,
  type ShuffleSource,
} from './rules.js';
import { applySetupCommand, type SetupCommand } from './setup.js';

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export type BotCommand = GameplayCommand | SetupCommand;
/** Names for the bots that complete a table, dealt at random. */
export const COMPETITIVE_BOT_NAMES = [
  'Bot Paul',
  'Bot Bélico',
  'Bot Seisdados',
  'Bot Tirabombas',
  'Bot Mate',
  'Bot Facón',
  'Bot Pampa',
  'Bot Truco',
  'Bot Bandoneón',
  'Bot Gaucho',
  'Bot Tango',
  'Bot Asado',
] as const;

/** Armies the attacker needs above the defender (easy and normal). */
const ATTACK_MARGIN = { easy: 1, normal: 2 } as const;
/** Easy stops attacking after one roll in six, like a cautious beginner. */
const EASY_KEEPS_ATTACKING = [true, true, true, true, true, false];
/** Chance of taking the country the hard bot asks for before attacking. */
const HARD_CHANCE = { target: 0.5, other: 0.65, card: 0.5, final: 0.8 };

const owner = (s: GameState, id: TerritoryId) =>
  'territories' in s ? s.territories[id].ownerId : undefined;
const armies = (s: GameState, id: TerritoryId) =>
  'territories' in s ? s.territories[id].armies : 0;
const enemyNeighbors = (s: GameState, pid: PlayerId, id: TerritoryId) =>
  TERRITORIES[id].adjacentTerritoryIds.filter((t) => owner(s, t) !== pid);
const threat = (s: GameState, pid: PlayerId, id: TerritoryId) =>
  enemyNeighbors(s, pid, id).reduce((sum, t) => sum + armies(s, t), 0);
const ownedIn = (s: GameState, pid: PlayerId, c: ContinentId) =>
  TERRITORY_IDS.filter(
    (id) => TERRITORIES[id].continentId === c && owner(s, id) === pid,
  ).length;
const continentSize = (c: ContinentId) => CONTINENTS[c].territoryIds.length;
const holdsContinent = (s: GameState, pid: PlayerId, c: ContinentId) =>
  ownedIn(s, pid, c) === continentSize(c);
const pick = <T>(items: readonly T[], shuffle?: ShuffleSource) =>
  shuffle ? shuffle.shuffle(items)[0] : items[0];

/** Odds of each loss pair for one roll, indexed by attacker and defender dice. */
const rolls = new Map<string, readonly (readonly [number, number, number])[]>();
function rollOutcomes(attackDice: number, defendDice: number) {
  const key = `${attackDice}:${defendDice}`;
  const known = rolls.get(key);
  if (known) return known;
  const counts = new Map<string, number>();
  const total = 6 ** (attackDice + defendDice);
  for (let n = 0; n < total; n++) {
    const faces = Array.from(
      { length: attackDice + defendDice },
      (_, i) => (Math.floor(n / 6 ** i) % 6) + 1,
    );
    const a = faces.slice(0, attackDice).sort((x, y) => y - x);
    const d = faces.slice(attackDice).sort((x, y) => y - x);
    let attackerLosses = 0,
      defenderLosses = 0;
    for (let i = 0; i < Math.min(a.length, d.length); i++)
      if (a[i]! > d[i]!) defenderLosses++;
      else attackerLosses++;
    const k = `${attackerLosses}:${defenderLosses}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const result = [...counts].map(([k, n]) => {
    const [al, dl] = k.split(':').map(Number);
    return [al!, dl!, n / total] as const;
  });
  rolls.set(key, result);
  return result;
}

const chances = new Map<string, number>();
/**
 * Chance that attacking from a country with these armies, roll after roll
 * until one army is left, takes a country with these defenders.
 */
export function conquestChance(attacker: number, defender: number): number {
  const a = Math.min(attacker, 40),
    d = Math.min(defender, 40);
  if (d <= 0) return 1;
  if (a < 2) return 0;
  const key = `${a}:${d}`;
  const known = chances.get(key);
  if (known !== undefined) return known;
  let chance = 0;
  for (const [al, dl, p] of rollOutcomes(Math.min(3, a - 1), Math.min(3, d)))
    chance += p * conquestChance(a - al, d - dl);
  chances.set(key, chance);
  return chance;
}

const inFinalRounds = (s: ActiveGameState) => {
  const final = s.competitiveClock?.finalRoundNumber;
  return (
    final !== undefined &&
    s.turn.round.kind === 'normal' &&
    s.turn.round.roundNumber > final - 2
  );
};

/**
 * What the bot plays for: its secret mission, or the common objective once
 * that is closer.
 */
function aims(s: GameState, pid: PlayerId) {
  const me = s.players.find((p) => p.id === pid);
  const owned = TERRITORY_IDS.filter((id) => owner(s, id) === pid).length;
  const objective = me?.secretObjectiveId
    ? SECRET_OBJECTIVES[me.secretObjectiveId]
    : undefined;
  const target = me?.effectiveDestructionTargetPlayerId;
  let missionGap = Infinity;
  if (objective?.kind === 'occupation')
    missionGap = Object.entries(objective.continentMinimums).reduce(
      (sum, [c, n]) => sum + Math.max(0, n - ownedIn(s, pid, c as ContinentId)),
      0,
    );
  else if (target)
    missionGap = TERRITORY_IDS.filter((id) => owner(s, id) === target).length;
  const commonGap =
    ('commonVictoryCondition' in s
      ? s.commonVictoryCondition.territoryCount
      : 30) - owned;
  return {
    objective,
    target,
    missionGap,
    commonGap,
    common: commonGap < missionGap,
  };
}

/**
 * How much the hard bot wants each country it does not own: what its secret
 * mission still needs, the color it must destroy, continents it is about to
 * complete, and every country once 30 is closer than the mission.
 */
function targetValues(
  s: GameState,
  pid: PlayerId,
): Partial<Record<TerritoryId, number>> {
  const { objective, target, missionGap, common } = aims(s, pid);
  const values: Partial<Record<TerritoryId, number>> = {};
  for (const id of TERRITORY_IDS) {
    const holder = owner(s, id);
    if (holder === pid) continue;
    const c = TERRITORIES[id].continentId;
    let value = common ? 3 : 1;
    if (!common && objective?.kind === 'occupation') {
      const needed =
        (objective.continentMinimums as Partial<Record<ContinentId, number>>)[
          c
        ] ?? 0;
      if (ownedIn(s, pid, c) < needed) value += 4;
    }
    if (!common && holder !== undefined && holder === target)
      value += 4 + 8 / Math.max(1, missionGap);
    const missing = continentSize(c) - ownedIn(s, pid, c);
    if (ownedIn(s, pid, c) * 2 >= continentSize(c))
      value += (2 * CONTINENTS[c].reinforcementBonus) / missing;
    if (holder !== undefined && holdsContinent(s, holder, c)) value += 1;
    values[id] = value;
  }
  return values;
}

/**
 * Where an army helps the hard bot most: exposed borders, entries to its
 * continents, lone armies next to strong enemies, and countries it attacks
 * from next.
 */
function guardScore(
  s: GameState,
  pid: PlayerId,
  id: TerritoryId,
  values: Partial<Record<TerritoryId, number>>,
  extra = 0,
): number {
  const enemies = enemyNeighbors(s, pid, id);
  if (!enemies.length) return -100;
  const own = armies(s, id) + extra;
  const danger = threat(s, pid, id);
  let score = danger - own;
  if (holdsContinent(s, pid, TERRITORIES[id].continentId)) score += 3;
  if (own <= 1 && danger >= 3) score += 3;
  score += 1.5 * Math.max(...enemies.map((t) => values[t] ?? 0));
  return score;
}

/**
 * Hard reinforcements: up to half shore up the countries that need it most,
 * the rest gather on the country that best attacks what the bot wants.
 */
function hardPlacements(
  s: GameState,
  pid: PlayerId,
  choices: readonly TerritoryId[],
  total: number,
  values: Partial<Record<TerritoryId, number>>,
): Partial<Record<TerritoryId, number>> {
  const guard = Math.floor(total / 2);
  const placements: Partial<Record<TerritoryId, number>> = {};
  let used = 0;
  for (const id of [...choices].sort(
    (a, b) => guardScore(s, pid, b, values) - guardScore(s, pid, a, values),
  )) {
    if (used >= guard) break;
    const own = armies(s, id);
    const exposed =
      holdsContinent(s, pid, TERRITORIES[id].continentId) ||
      (own <= 1 && threat(s, pid, id) >= 3);
    const need = exposed
      ? Math.min(guard - used, Math.max(0, threat(s, pid, id) - own))
      : 0;
    if (need > 0) {
      placements[id] = need;
      used += need;
    }
  }
  const left = total - used;
  let best: TerritoryId | undefined,
    bestScore = -Infinity;
  for (const id of choices) {
    const own = armies(s, id) + (placements[id] ?? 0) + left;
    for (const to of enemyNeighbors(s, pid, id)) {
      const score = (values[to] ?? 0) * conquestChance(own, armies(s, to));
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
  }
  best ??= choices[0];
  if (best && left > 0) placements[best] = (placements[best] ?? 0) + left;
  return placements;
}

/** Spreads armies one at a time, each to the country that needs it most. */
function spread(
  s: GameState,
  pid: PlayerId,
  choices: readonly TerritoryId[],
  total: number,
  values: Partial<Record<TerritoryId, number>>,
  cap: (
    id: TerritoryId,
    placements: Partial<Record<TerritoryId, number>>,
  ) => boolean = () => true,
): Partial<Record<TerritoryId, number>> {
  const placements: Partial<Record<TerritoryId, number>> = {};
  for (let n = 0; n < total; n++) {
    let best: TerritoryId | undefined,
      bestScore = -Infinity;
    for (const id of choices) {
      if (!cap(id, placements)) continue;
      const score = guardScore(s, pid, id, values, placements[id] ?? 0);
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    if (!best) break;
    placements[best] = (placements[best] ?? 0) + 1;
  }
  return placements;
}

/**
 * The border country with the most enemy armies around it compared with its
 * own. Easy takes any border country.
 */
function bestTarget(
  s: GameState,
  pid: PlayerId,
  choices: readonly TerritoryId[],
  level: BotLevel,
  shuffle?: ShuffleSource,
): TerritoryId | undefined {
  const border = choices.filter((id) => enemyNeighbors(s, pid, id).length);
  const pool = border.length ? border : choices;
  if (level === 'easy') return pick(pool, shuffle);
  let best: TerritoryId | undefined,
    bestScore = -Infinity;
  for (const id of pool) {
    const score = threat(s, pid, id) - armies(s, id);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function setupCommand(
  s: Extract<GameState, { status: 'SETUP' }>,
  pid: PlayerId,
  level: BotLevel,
  shuffle?: ShuffleSource,
): SetupCommand | undefined {
  const setup = s.setup;
  // Classic with two or three players places its extra armies in one go.
  const due =
    setup.kind === 'card_deal_4_to_6'
      ? setup.armiesRemainingInActivation
      : (setup.additionalArmiesRemainingByPlayer[pid] ?? 0);
  if (due <= 0) return undefined;
  const counts =
    setup.kind === 'card_deal_4_to_6'
      ? (setup.additionalArmiesByPlayerContinent[pid] ?? {})
      : {};
  const owned = TERRITORY_IDS.filter((id) => owner(s, id) === pid);
  const limit = (id: TerritoryId) =>
    s.mode === 'competitive'
      ? 4 - (counts[TERRITORIES[id].continentId] ?? 0)
      : Infinity;
  let placements: Partial<Record<TerritoryId, number>> = {};
  if (level === 'hard') {
    const values = targetValues(s, pid);
    placements = spread(s, pid, owned, due, values, (id, placed) => {
      const c = TERRITORIES[id].continentId;
      const inContinent = owned
        .filter((t) => TERRITORIES[t].continentId === c)
        .reduce((sum, t) => sum + (placed[t] ?? 0), 0);
      return inContinent < limit(id);
    });
  } else {
    const order: TerritoryId[] = [];
    for (let rest = [...owned]; rest.length;) {
      const next = bestTarget(s, pid, rest, level, shuffle)!;
      order.push(next);
      rest = rest.filter((id) => id !== next);
    }
    const used: Partial<Record<ContinentId, number>> = {};
    let left = due;
    for (const id of order) {
      const c = TERRITORIES[id].continentId;
      const amount = Math.min(left, limit(id) - (used[c] ?? 0));
      if (amount > 0) {
        placements[id] = amount;
        used[c] = (used[c] ?? 0) + amount;
        left -= amount;
      }
      if (!left) break;
    }
  }
  const placed = Object.values(placements).reduce((a, b) => a + (b ?? 0), 0);
  return placed === due
    ? { type: 'place_setup_armies', playerId: pid, placements }
    : undefined;
}

/**
 * Whether the hard bot trades its cards now. It keeps them while it can still
 * take a card and nothing is at stake, so the armies arrive when needed.
 */
function hardExchangesNow(s: ActiveGameState, pid: PlayerId): boolean {
  const me = s.players.find((p) => p.id === pid)!;
  if (me.cards.length >= 4 || inFinalRounds(s)) return true;
  const values = targetValues(s, pid);
  return TERRITORY_IDS.some(
    (id) =>
      owner(s, id) === pid &&
      holdsContinent(s, pid, TERRITORIES[id].continentId) &&
      guardScore(s, pid, id, values) > 3,
  );
}

function hardAttack(
  s: ActiveGameState,
  pid: PlayerId,
  choices: ReturnType<typeof deriveLegalActions>['attackChoices'],
): { from: TerritoryId; to: TerritoryId } | undefined {
  const values = targetValues(s, pid);
  const final = inFinalRounds(s);
  const me = s.players.find((p) => p.id === pid)!;
  const wantsCard = !s.turn.cardClaimEligible && me.cards.length < 5;
  let best: { from: TerritoryId; to: TerritoryId } | undefined,
    bestScore = 0;
  for (const { from, targets } of choices)
    for (const to of targets) {
      const chance = conquestChance(armies(s, from), armies(s, to));
      const value = values[to] ?? 0;
      const needed = final
        ? HARD_CHANCE.final
        : value >= 4
          ? HARD_CHANCE.target
          : wantsCard
            ? HARD_CHANCE.card
            : HARD_CHANCE.other;
      if (chance < needed) continue;
      // Leaving a lone army next to other strong enemies costs points.
      const exposure =
        threat(s, pid, from) - armies(s, to) > armies(s, from) ? 1 : 0;
      const score = chance * value - exposure;
      if (score > bestScore) {
        best = { from, to };
        bestScore = score;
      }
    }
  return best;
}

type PactTerms = ActiveGameState['pacts']['proposals'][number]['terms'];
/** Countries short of the common objective at which any pact is in the way. */
const COMMON_GAP_TO_BREAK = 5;
/** A partner with less than this share of the bot's armies is much weaker. */
const MUCH_WEAKER = 0.5;

const strength = (s: GameState, pid: PlayerId) =>
  TERRITORY_IDS.reduce(
    (sum, id) => (owner(s, id) === pid ? sum + armies(s, id) : sum),
    0,
  );

/** The bordering pairs, own country first, that these terms keep at peace. */
function coveredBorders(
  s: GameState,
  pid: PlayerId,
  partner: PlayerId,
  terms: PactTerms,
): (readonly [TerritoryId, TerritoryId])[] {
  if (terms.kind === 'border_non_aggression') {
    const [a, b] = terms.territoryIds;
    return [owner(s, a) === pid ? [a, b] : [b, a]];
  }
  if (terms.kind === 'international_zone') return [];
  return TERRITORY_IDS.flatMap((id) =>
    owner(s, id) === pid
      ? TERRITORIES[id].adjacentTerritoryIds
          .filter((t) => owner(s, t) === partner)
          .map((t) => [id, t] as const)
      : [],
  );
}

/** Whether one of the borders lies on a continent missing at most this many. */
const guardsContinent = (
  s: GameState,
  pid: PlayerId,
  borders: readonly (readonly [TerritoryId, TerritoryId])[],
  missing = 0,
) =>
  borders.some(([own]) => {
    const c = TERRITORIES[own].continentId;
    return continentSize(c) - ownedIn(s, pid, c) <= missing;
  });

/**
 * Whether a pact with this partner stands in the bot's way: the partner is
 * the color it must destroy or is much weaker, or the pact keeps it from a
 * country its mission needs, or from any country once 30 is a few away.
 */
function pactInTheWay(
  s: GameState,
  pid: PlayerId,
  partner: PlayerId,
  borders: readonly (readonly [TerritoryId, TerritoryId])[],
): boolean {
  const plan = aims(s, pid);
  if (partner === plan.target) return true;
  if (strength(s, partner) < MUCH_WEAKER * strength(s, pid)) return true;
  return borders.some(([from, to]) => {
    if (armies(s, from) < 2) return false;
    if (plan.common) return plan.commonGap <= COMMON_GAP_TO_BREAK;
    const c = TERRITORIES[to].continentId;
    const needed =
      plan.objective?.kind === 'occupation'
        ? ((
            plan.objective.continentMinimums as Partial<
              Record<ContinentId, number>
            >
          )[c] ?? 0)
        : 0;
    return ownedIn(s, pid, c) < needed;
  });
}

/**
 * Classic: the answer to the first proposal waiting for the bot. It accepts
 * when the proposer is stronger or the pact guards a continent it holds, and
 * never pacts with the color it must destroy or over an international zone.
 * Easy decides at random.
 */
function pactAnswer(
  s: ActiveGameState,
  pid: PlayerId,
  level: BotLevel,
  shuffle: ShuffleSource | undefined,
  newId: () => string,
): GameplayCommand | undefined {
  const proposal = s.pacts.proposals.find((p) => p.recipientId === pid);
  if (!proposal) return undefined;
  const from = proposal.proposerId;
  const possible =
    proposal.terms.kind !== 'international_zone' &&
    from !== aims(s, pid).target &&
    isPactProposalLegal(s, from, pid, proposal.terms);
  const accept =
    possible &&
    (level === 'easy'
      ? pick([true, false], shuffle)
      : strength(s, from) > strength(s, pid) ||
        guardsContinent(s, pid, coveredBorders(s, pid, from, proposal.terms)));
  return accept
    ? {
        type: 'accept_pact',
        playerId: pid,
        proposalId: proposal.id,
        pactId: newId() as PactId,
      }
    : { type: 'reject_pact', playerId: pid, proposalId: proposal.id };
}

/** Classic hard: announces the end of the first pact in its way. */
function pactToBreak(
  s: ActiveGameState,
  pid: PlayerId,
): GameplayCommand | undefined {
  const pact = s.pacts.active.find((p) => {
    if (!p.parties.includes(pid) || p.withdrawal.kind !== 'none') return false;
    const partner = p.parties.find((id) => id !== pid)!;
    return pactInTheWay(
      s,
      pid,
      partner,
      coveredBorders(s, pid, partner, p.terms),
    );
  });
  return pact
    ? { type: 'withdraw_pact', playerId: pid, pactId: pact.id }
    : undefined;
}

/**
 * Classic hard: once a turn, and with no offer of its own still waiting, a
 * border pact to a stronger neighbor that threatens a continent it holds or
 * is one country from completing. Never to the color it must destroy.
 */
function pactToPropose(
  s: ActiveGameState,
  pid: PlayerId,
  newId: () => string,
): GameplayCommand | undefined {
  const me = s.players.find((p) => p.id === pid)!;
  if (
    me.botProposalTurn === s.turn.turnNumber ||
    s.pacts.proposals.some((p) => p.proposerId === pid)
  )
    return undefined;
  const mine = strength(s, pid);
  for (const own of TERRITORY_IDS) {
    if (owner(s, own) !== pid) continue;
    for (const theirs of TERRITORIES[own].adjacentTerritoryIds) {
      const neighbor = owner(s, theirs);
      const border = [[own, theirs] as const];
      if (
        !neighbor ||
        neighbor === pid ||
        strength(s, neighbor) <= mine ||
        armies(s, theirs) < armies(s, own) ||
        !guardsContinent(s, pid, border, 1) ||
        pactInTheWay(s, pid, neighbor, border)
      )
        continue;
      const terms: PactTerms = {
        kind: 'border_non_aggression',
        territoryIds: [own, theirs],
      };
      if (isPactProposalLegal(s, pid, neighbor, terms))
        return {
          type: 'propose_pact',
          playerId: pid,
          recipientId: neighbor,
          proposalId: newId() as PactProposalId,
          terms,
        };
    }
  }
  return undefined;
}

/**
 * The next move for a seat played by the server, or nothing when the bot has
 * no move. Easy picks almost at random among reasonable moves, normal follows
 * fixed rules, and hard plays its mission, guards its continents, weighs the
 * real dice odds, saves cards and plays the final rounds for the tiebreak.
 * It plays Classic and Competitive alike: the legal actions keep it within
 * the pacts in force and make it trade when Classic requires it. In Classic
 * it also answers pacts, even out of turn, and hard proposes and breaks them;
 * Competitive bots never pact.
 */
export function chooseBotCommand(
  s: GameState,
  pid: PlayerId,
  level: BotLevel = 'hard',
  shuffle?: ShuffleSource,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): BotCommand | undefined {
  if (s.pendingInheritance?.playerId === pid)
    return {
      type: 'select_inherited_cards',
      playerId: pid,
      cardIds: s.pendingInheritance.cards
        .slice(0, s.pendingInheritance.takeCount)
        .map((c) => c.cardId),
    };
  if (s.status === 'SETUP')
    return s.setup.currentPlayerId === pid
      ? setupCommand(s, pid, level, shuffle)
      : undefined;
  if (s.status === 'ACTIVE' && s.mode === 'classic') {
    const answer = pactAnswer(s, pid, level, shuffle, newId);
    if (answer) return answer;
  }
  if (s.status !== 'ACTIVE' || s.turn.playerId !== pid) return undefined;
  const legal = deriveLegalActions(s, pid);
  const can = (action: (typeof legal.actions)[number]) =>
    legal.actions.includes(action);
  if (s.pendingAction?.playerId === pid && legal.conquestTransferMaximum) {
    const from = s.pendingAction.fromTerritoryId;
    // Hard keeps armies home when other enemies still border the origin.
    const exposed =
      level === 'hard' &&
      enemyNeighbors(s, pid, from).some(
        (t) => t !== s.pendingAction?.conqueredTerritoryId,
      ) &&
      threat(s, pid, from) >= armies(s, from);
    return {
      type: 'complete_conquest_transfer',
      playerId: pid,
      armies: level === 'easy' || exposed ? 1 : legal.conquestTransferMaximum,
    };
  }
  const phase = s.turn.phase;
  if (can('exchange_cards') && legal.exchangeChoices[0]) {
    const placing = can('place_reinforcements');
    if (level !== 'hard' || !placing || hardExchangesNow(s, pid)) {
      // Trade cards whose country bonus is spent or out of reach first.
      const me = s.players.find((p) => p.id === pid)!;
      const keep = (id: TerritoryId) =>
        owner(s, id) === pid &&
        !me.cards.find((c) => c.cardId === id)?.territoryBonusClaimed;
      const choice = [...legal.exchangeChoices].sort(
        (a, b) => a.cardIds.filter(keep).length - b.cardIds.filter(keep).length,
      )[0]!;
      return { type: 'exchange_cards', playerId: pid, cardIds: choice.cardIds };
    }
  }
  if (can('place_reinforcements')) {
    let placements: Partial<Record<TerritoryId, number>> = {};
    const values = level === 'hard' ? targetValues(s, pid) : {};
    if (phase === 'continent_reinforcement') {
      const byContinent = new Map<ContinentId, TerritoryId[]>();
      for (const choice of legal.reinforcementChoices) {
        const c = TERRITORIES[choice.territoryId].continentId;
        byContinent.set(c, [...(byContinent.get(c) ?? []), choice.territoryId]);
      }
      for (const ids of byContinent.values()) {
        const due = legal.reinforcementChoices.find(
          (c) => c.territoryId === ids[0],
        )!.maximumArmies;
        if (level === 'hard')
          placements = {
            ...placements,
            ...hardPlacements(s, pid, ids, due, values),
          };
        else placements[bestTarget(s, pid, ids, level, shuffle)!] = due;
      }
    } else {
      const ids = legal.reinforcementChoices.map((c) => c.territoryId);
      const due = s.turn.reinforcementArmiesRemaining ?? 0;
      if (level === 'hard')
        placements = hardPlacements(s, pid, ids, due, values);
      else {
        const target = bestTarget(s, pid, ids, level, shuffle);
        if (target && due > 0) placements[target] = due;
      }
    }
    if (Object.keys(placements).length)
      return { type: 'place_reinforcements', playerId: pid, placements };
  }
  if (
    phase === 'attack' &&
    level === 'hard' &&
    s.mode === 'classic' &&
    !s.pendingAction
  ) {
    const pactMove = pactToBreak(s, pid) ?? pactToPropose(s, pid, newId);
    if (pactMove) return pactMove;
  }
  if (phase === 'attack') {
    let best: { from: TerritoryId; to: TerritoryId } | undefined;
    if (level === 'hard') best = hardAttack(s, pid, legal.attackChoices);
    else {
      const options = legal.attackChoices.flatMap(({ from, targets }) =>
        targets
          .filter(
            (to) => armies(s, from) >= armies(s, to) + ATTACK_MARGIN[level],
          )
          .map((to) => ({ from, to })),
      );
      if (level === 'easy') {
        if (options.length && pick(EASY_KEEPS_ATTACKING, shuffle))
          best = pick(options, shuffle);
      } else
        best = options.sort(
          (a, b) =>
            armies(s, b.from) / armies(s, b.to) -
            armies(s, a.from) / armies(s, a.to),
        )[0];
    }
    if (best) return { type: 'attack', playerId: pid, ...best };
  }
  if (phase === 'regroup' && level !== 'easy') {
    // Interior armies move to a border country; each move empties its source.
    const values = level === 'hard' ? targetValues(s, pid) : {};
    const moves = legal.regroupChoices.filter(
      (c) =>
        enemyNeighbors(s, pid, c.from).length === 0 &&
        enemyNeighbors(s, pid, c.to).length > 0,
    );
    const move =
      level === 'hard'
        ? moves.sort(
            (a, b) =>
              guardScore(s, pid, b.to, values) -
              guardScore(s, pid, a.to, values),
          )[0]
        : moves[0];
    if (move)
      return {
        type: 'regroup',
        playerId: pid,
        from: move.from,
        to: move.to,
        armies: move.maximumArmies,
      };
  }
  if (can('claim_card')) return { type: 'claim_card', playerId: pid };
  if (can('claim_territory_bonus') && legal.territoryBonusCardIds[0])
    return {
      type: 'claim_territory_bonus',
      playerId: pid,
      cardId: legal.territoryBonusCardIds[0],
    };
  if (can('advance_phase')) return { type: 'advance_phase', playerId: pid };
  if (can('end_turn')) return { type: 'end_turn', playerId: pid };
  // Nothing else to do: trade the cards rather than wait for the clock.
  if (can('exchange_cards') && legal.exchangeChoices[0])
    return {
      type: 'exchange_cards',
      playerId: pid,
      cardIds: legal.exchangeChoices[0].cardIds,
    };
  return undefined;
}

export function applyBotCommand(
  s: GameState,
  command: BotCommand,
  dependencies: { readonly dice: DiceSource; readonly shuffle: ShuffleSource },
): DomainResult<GameState> {
  if (command.type === 'propose_pact' && s.status === 'ACTIVE') {
    // Remember the turn, so the bot offers one pact a turn at most.
    const result = applyCommand(s, command, dependencies);
    if (!result.ok) return result;
    const turnNumber = s.turn.turnNumber;
    return {
      ...result,
      state: {
        ...result.state,
        players: result.state.players.map((p) =>
          p.id === command.playerId ? { ...p, botProposalTurn: turnNumber } : p,
        ),
      } as GameState,
    };
  }
  if (command.type !== 'place_setup_armies')
    return applyCommand(s, command, dependencies);
  if (s.status !== 'SETUP')
    return {
      ok: false,
      error: { code: 'INVALID_PHASE', message: 'INVALID_PHASE' },
    };
  return applySetupCommand(s, command);
}
