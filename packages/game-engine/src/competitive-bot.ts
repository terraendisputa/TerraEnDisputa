import {
  TERRITORIES,
  TERRITORY_IDS,
  type TerritoryId,
} from './classic-data.js';
import type { GameState, PlayerId } from './domain.js';
import { deriveLegalActions } from './legal-actions.js';
import {
  applyCommand,
  type DiceSource,
  type DomainResult,
  type GameplayCommand,
  type ShuffleSource,
} from './rules.js';
import { applySetupCommand, type SetupCommand } from './setup.js';

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export type BotCommand = GameplayCommand | SetupCommand;

/** Armies the attacker needs above the defender before the bot attacks. */
const ATTACK_MARGIN: Readonly<Record<BotLevel, number>> = {
  easy: 1,
  normal: 2,
  hard: 2,
};

const owner = (s: GameState, id: TerritoryId) =>
  'territories' in s ? s.territories[id].ownerId : undefined;
const armies = (s: GameState, id: TerritoryId) =>
  'territories' in s ? s.territories[id].armies : 0;
const enemyNeighbors = (s: GameState, pid: PlayerId, id: TerritoryId) =>
  TERRITORIES[id].adjacentTerritoryIds.filter((t) => owner(s, t) !== pid);

/**
 * Where reinforcements matter most: the border country with the most enemy
 * armies around it compared with its own. Easy takes the first border country.
 */
function bestTarget(
  s: GameState,
  pid: PlayerId,
  choices: readonly TerritoryId[],
  level: BotLevel,
): TerritoryId | undefined {
  const border = choices.filter((id) => enemyNeighbors(s, pid, id).length);
  const pool = border.length ? border : choices;
  if (level === 'easy') return pool[0];
  let best: TerritoryId | undefined,
    bestScore = -Infinity;
  for (const id of pool) {
    const threat = enemyNeighbors(s, pid, id).reduce(
      (sum, t) => sum + armies(s, t),
      0,
    );
    const score = threat - armies(s, id);
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
): SetupCommand | undefined {
  if (s.setup.kind !== 'card_deal_4_to_6') return undefined;
  let due = s.setup.armiesRemainingInActivation;
  const counts = { ...(s.setup.additionalArmiesByPlayerContinent[pid] ?? {}) };
  const owned = TERRITORY_IDS.filter((id) => owner(s, id) === pid);
  const order: TerritoryId[] = [];
  for (let rest = [...owned]; rest.length;) {
    const next = bestTarget(s, pid, rest, level)!;
    order.push(next);
    rest = rest.filter((id) => id !== next);
  }
  const placements: Partial<Record<TerritoryId, number>> = {};
  for (const id of order) {
    const continent = TERRITORIES[id].continentId;
    const amount =
      s.mode === 'competitive'
        ? Math.min(due, 4 - (counts[continent] ?? 0))
        : due;
    if (amount > 0) {
      placements[id] = amount;
      counts[continent] = (counts[continent] ?? 0) + amount;
      due -= amount;
    }
    if (!due) break;
  }
  return due === 0
    ? { type: 'place_setup_armies', playerId: pid, placements }
    : undefined;
}

/**
 * The next move for a seat played by the server. Stage one keeps simple
 * rules: exchange when possible, reinforce the most exposed border, attack
 * only with a clear advantage, bring interior armies to the border and take a
 * card. It never offers pacts. Returns nothing when the bot has no move.
 */
export function chooseBotCommand(
  s: GameState,
  pid: PlayerId,
  level: BotLevel = 'hard',
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
      ? setupCommand(s, pid, level)
      : undefined;
  if (s.status !== 'ACTIVE' || s.turn.playerId !== pid) return undefined;
  const legal = deriveLegalActions(s, pid);
  const can = (action: (typeof legal.actions)[number]) =>
    legal.actions.includes(action);
  if (s.pendingAction?.playerId === pid && legal.conquestTransferMaximum)
    return {
      type: 'complete_conquest_transfer',
      playerId: pid,
      armies: level === 'easy' ? 1 : legal.conquestTransferMaximum,
    };
  const phase = s.turn.phase;
  if (can('exchange_cards') && legal.exchangeChoices[0])
    return {
      type: 'exchange_cards',
      playerId: pid,
      cardIds: legal.exchangeChoices[0].cardIds,
    };
  if (can('place_reinforcements')) {
    const placements: Partial<Record<TerritoryId, number>> = {};
    if (phase === 'continent_reinforcement') {
      const byContinent = new Map<string, TerritoryId[]>();
      for (const choice of legal.reinforcementChoices) {
        const continent = TERRITORIES[choice.territoryId].continentId;
        byContinent.set(continent, [
          ...(byContinent.get(continent) ?? []),
          choice.territoryId,
        ]);
      }
      for (const ids of byContinent.values()) {
        const target = bestTarget(s, pid, ids, level)!;
        placements[target] = legal.reinforcementChoices.find(
          (c) => c.territoryId === target,
        )!.maximumArmies;
      }
    } else {
      const target = bestTarget(
        s,
        pid,
        legal.reinforcementChoices.map((c) => c.territoryId),
        level,
      );
      const due = s.turn.reinforcementArmiesRemaining ?? 0;
      if (target && due > 0) placements[target] = due;
    }
    if (Object.keys(placements).length)
      return { type: 'place_reinforcements', playerId: pid, placements };
  }
  if (phase === 'attack') {
    let best: { from: TerritoryId; to: TerritoryId } | undefined,
      bestRatio = 0;
    for (const { from, targets } of legal.attackChoices)
      for (const to of targets) {
        if (armies(s, from) < armies(s, to) + ATTACK_MARGIN[level]) continue;
        const ratio = armies(s, from) / armies(s, to);
        if (ratio > bestRatio) {
          best = { from, to };
          bestRatio = ratio;
        }
        if (level === 'easy') break;
      }
    if (best) return { type: 'attack', playerId: pid, ...best };
  }
  if (phase === 'regroup' && level !== 'easy') {
    // Interior armies move to a border country; each move empties its source.
    const move = legal.regroupChoices.find(
      (c) =>
        enemyNeighbors(s, pid, c.from).length === 0 &&
        enemyNeighbors(s, pid, c.to).length > 0,
    );
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
  return undefined;
}

export function applyBotCommand(
  s: GameState,
  command: BotCommand,
  dependencies: { readonly dice: DiceSource; readonly shuffle: ShuffleSource },
): DomainResult<GameState> {
  if (command.type !== 'place_setup_armies')
    return applyCommand(s, command, dependencies);
  if (s.status !== 'SETUP')
    return {
      ok: false,
      error: { code: 'INVALID_PHASE', message: 'INVALID_PHASE' },
    };
  return applySetupCommand(s, command);
}
