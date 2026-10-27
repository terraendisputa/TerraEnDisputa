import {
  TERRITORIES,
  TERRITORY_IDS,
  type TerritoryId,
} from './classic-data.js';
import type {
  ActiveGameState,
  CompetitiveClockState,
  GameState,
  PlayerId,
  SetupGameState,
} from './domain.js';
import {
  applyCommand,
  completeConquestTransfer,
  isActiveInternationalZone,
  selectInheritedCards,
  finishCompetitiveActivation,
  type ShuffleSource,
} from './rules.js';
import { applySetupCommand, skipDisqualifiedSetupActivation } from './setup.js';

export const TURN_MS = 120_000;
export const FINAL_TURN_MS = 180_000;
/**
 * Superliga waits up to seven minutes for a disconnected player on each
 * activation: five minutes of grace with the game clock stopped, then the two
 * minutes of the turn itself. The grace is kept across reconnections within
 * the same activation and renews with the next one.
 */
export const TECHNICAL_WAIT_MS = 300_000;
export const competitiveDurationMs = (
  count: number,
  minutes?: 60 | 80,
): number => (count === 4 ? 60 : (minutes ?? 80)) * 60_000;
export function competitiveActor(s: GameState): PlayerId | undefined {
  return (
    s.pendingInheritance?.playerId ??
    (s.status === 'SETUP'
      ? s.setup.currentPlayerId
      : s.status === 'ACTIVE'
        ? s.turn.playerId
        : undefined)
  );
}
function key(s: GameState): string {
  if (s.status === 'SETUP')
    return `setup:${s.setup.kind === 'card_deal_4_to_6' ? s.setup.reinforcementRound : 0}:${s.setup.currentPlayerId}`;
  return s.status === 'ACTIVE' || s.status === 'FINISHED'
    ? `turn:${s.turn.turnNumber}:${s.turn.playerId}`
    : 'lobby';
}
function duration(s: GameState, clock: CompetitiveClockState): number {
  return s.status === 'ACTIVE' &&
    s.turn.round.kind === 'normal' &&
    clock.finalRoundNumber !== undefined &&
    s.turn.round.roundNumber > clock.finalRoundNumber - 2
    ? FINAL_TURN_MS
    : TURN_MS;
}
export function startCompetitiveClock(
  s: GameState,
  now: number,
  restart = false,
): GameState {
  if (
    s.mode !== 'competitive' ||
    s.status === 'LOBBY' ||
    (s.status === 'FINISHED' && !s.pendingInheritance)
  )
    return s;
  const existing = s.competitiveClock;
  if (existing && !restart) return s;
  return {
    ...s,
    competitiveClock: {
      ...(existing ?? {
        elapsedMs: 0,
        activationRemainingMs: TURN_MS,
        activationKey: key(s),
        completedRounds:
          s.status === 'ACTIVE' && s.turn.round.kind === 'normal'
            ? s.turn.round.roundNumber - 1
            : 0,
      }),
      updatedAtMs: now,
      ...(restart
        ? { pauseReason: 'restart', disconnectedPlayerId: undefined }
        : {}),
    },
  };
}
export function synchronizeCompetitiveClock(
  before: GameState,
  after: GameState,
  now: number,
): GameState {
  if (after.mode !== 'competitive' || !before.competitiveClock) return after;
  now = Math.max(
    now,
    before.competitiveClock.updatedAtMs,
    after.competitiveClock?.updatedAtMs ?? 0,
  );
  let clock: CompetitiveClockState = {
    ...before.competitiveClock,
    ...(after.competitiveClock ?? {}),
    updatedAtMs: now,
  };
  if (after.status === 'ACTIVE' && after.turn.round.kind === 'normal')
    clock = {
      ...clock,
      completedRounds: Math.max(
        clock.completedRounds,
        after.turn.round.roundNumber - 1,
      ),
    };
  if (
    before.status === 'ACTIVE' &&
    before.turn.round.kind === 'normal' &&
    after.status === 'ACTIVE' &&
    after.turn.round.kind === 'normal' &&
    after.turn.round.roundNumber > before.turn.round.roundNumber &&
    clock.finalRoundNumber !== undefined &&
    before.turn.round.roundNumber >= clock.finalRoundNumber
  ) {
    return {
      ...after,
      status: 'FINISHED',
      turn: before.turn,
      competitiveClock: clock,
      result: {
        victoryReason: { kind: 'time_limit' },
        scoringEligible: clock.completedRounds >= 6,
      },
    };
  }
  if (key(after) !== clock.activationKey)
    clock = {
      ...clock,
      activationKey: key(after),
      activationRemainingMs: duration(after, clock),
      selectedTerritoryId: undefined,
      technicalRemainingMs: undefined,
    };
  if (after.status === 'FINISHED')
    return {
      ...after,
      competitiveClock: clock,
      result: { ...after.result, scoringEligible: clock.completedRounds >= 6 },
    };
  return { ...after, competitiveClock: clock };
}
function resolveInheritance(s: GameState, random: ShuffleSource): GameState {
  const pending = s.pendingInheritance;
  if (!pending) return s;
  const result = selectInheritedCards(
    s,
    pending.playerId,
    random
      .shuffle(pending.cards)
      .slice(0, pending.takeCount)
      .map((c) => c.cardId),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
function allocation(
  s: SetupGameState | ActiveGameState,
  amount: number,
  random: ShuffleSource,
  continent?: string,
): Record<string, number> {
  const pid = competitiveActor(s)!;
  const options = TERRITORY_IDS.filter(
    (id) =>
      s.territories[id].ownerId === pid &&
      (!continent || TERRITORIES[id].continentId === continent) &&
      !(s.status === 'ACTIVE' && isActiveInternationalZone(s, id)),
  );
  const selected = s.competitiveClock?.selectedTerritoryId;
  const choices = random.shuffle(options);
  const order =
    selected && choices.includes(selected)
      ? [selected, ...choices.filter((id) => id !== selected)]
      : choices;
  const placements: Record<string, number> = {};
  const counts =
    s.status === 'SETUP' && s.setup.kind === 'card_deal_4_to_6'
      ? { ...(s.setup.additionalArmiesByPlayerContinent[pid] ?? {}) }
      : undefined;
  for (const id of order) {
    const c = TERRITORIES[id].continentId;
    const n = counts ? Math.min(amount, 4 - (counts[c] ?? 0)) : amount;
    if (n > 0) {
      placements[id] = n;
      amount -= n;
      if (counts) counts[c] = (counts[c] ?? 0) + n;
    }
    if (amount === 0) break;
  }
  if (amount !== 0 && s.status === 'SETUP')
    throw new Error('No legal competitive initial allocation');
  return placements;
}
function expire(s: GameState, random: ShuffleSource): GameState {
  s = resolveInheritance(s, random);
  if (s.status === 'FINISHED' || s.status === 'LOBBY') return s;
  if (s.status === 'SETUP') {
    if (s.setup.kind !== 'card_deal_4_to_6')
      throw new Error('Invalid competitive setup');
    if (s.players.find((p) => p.id === competitiveActor(s))?.disqualified)
      return skipDisqualifiedSetupActivation(s);
    const result = applySetupCommand(s, {
      type: 'place_setup_armies',
      playerId: competitiveActor(s)!,
      placements: allocation(s, s.setup.armiesRemainingInActivation, random),
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  }
  if (s.pendingAction) {
    const result = completeConquestTransfer(s, s.pendingAction.playerId, 1);
    if (!result.ok) throw new Error(result.error.message);
    s = result.state;
  }
  if (s.status !== 'ACTIVE') return s;
  const currentActor = s.turn.playerId;
  if (
    !s.players.find((p) => p.id === currentActor)?.disqualified &&
    s.turn.round.kind === 'normal' &&
    s.turn.round.pass === 'incorporation'
  ) {
    // No exchange is invented. Unspent ordinary and continent pools are placed legally.
    let lost = 0;
    const ordinary = s.turn.reinforcementArmiesRemaining ?? 0;
    if (ordinary > 0) {
      const placements = allocation(s, ordinary, random);
      const allocated = Object.values(placements).reduce((n, v) => n + v, 0);
      lost += ordinary - allocated;
      if (allocated > 0) {
        const result = applyCommand(
          {
            ...s,
            turn: {
              ...s.turn,
              phase: 'territory_reinforcement',
              reinforcementArmiesRemaining: allocated,
            },
          },
          {
            type: 'place_reinforcements',
            playerId: s.turn.playerId,
            placements,
          },
        );
        if (!result.ok) throw new Error(result.error.message);
        s = result.state;
      } else s = { ...s, turn: { ...s.turn, reinforcementArmiesRemaining: 0 } };
    }
    if (s.status !== 'ACTIVE') return s;
    const pools = { ...(s.turn.continentReinforcementsRemaining ?? {}) };
    const placements: Record<string, number> = {};
    for (const [continent, amount] of Object.entries(pools))
      if (amount && amount > 0) {
        const assigned = allocation(s, amount, random, continent);
        const allocated = Object.values(assigned).reduce((n, v) => n + v, 0);
        lost += amount - allocated;
        pools[continent as keyof typeof pools] = allocated;
        Object.assign(placements, assigned);
      }
    s = {
      ...s,
      competitiveClock: {
        ...s.competitiveClock!,
        lastUnplacedArmiesLost: lost,
        lastExpiredPlayerId: currentActor,
      },
      turn: { ...s.turn, continentReinforcementsRemaining: pools },
    };
    if (Object.keys(placements).length) {
      const result = applyCommand(
        { ...s, turn: { ...s.turn, phase: 'continent_reinforcement' } },
        { type: 'place_reinforcements', playerId: s.turn.playerId, placements },
      );
      if (!result.ok) throw new Error(result.error.message);
      // place(continent) itself completes the incorporation. Do not advance twice.
      return result.state;
    }
  }
  return s.status === 'ACTIVE' ? finishCompetitiveActivation(s) : s;
}
export type CompetitiveSeat = 'absent' | 'bot-absent' | 'bot-admin';
/**
 * Who plays a seat that its player left. As in the Superliga, a bot takes it
 * and the player's pacts end; with bots off, its turns pass on their own.
 * Without a seat value the player plays again.
 */
export function setCompetitiveSeat(
  s: GameState,
  pid: PlayerId,
  seat: CompetitiveSeat | undefined,
): GameState {
  const next = {
    ...s,
    players: s.players.map((p) => {
      if (p.id !== pid) return p;
      const { absent: _absent, bot: _bot, ...rest } = p;
      void _absent;
      void _bot;
      return seat === 'absent'
        ? { ...rest, absent: true }
        : seat
          ? { ...rest, bot: seat === 'bot-admin' ? 'admin' : 'absent' }
          : rest;
    }),
  } as GameState;
  if (!seat) return next;
  if (!('pacts' in next)) return next;
  return {
    ...next,
    pacts: {
      ...next.pacts,
      active: next.pacts.active.filter((p) => !p.parties.includes(pid)),
      proposals: next.pacts.proposals.filter(
        (p) => p.proposerId !== pid && p.recipientId !== pid,
      ),
      ...(next.pacts.competitiveRejections
        ? {
            competitiveRejections: next.pacts.competitiveRejections.filter(
              (r) => r.proposerId !== pid && r.recipientId !== pid,
            ),
          }
        : {}),
      ...(next.pacts.competitiveWithdrawals
        ? {
            competitiveWithdrawals: next.pacts.competitiveWithdrawals.filter(
              (p) => !p.parties.includes(pid),
            ),
          }
        : {}),
    },
  };
}
function noCompetitors(s: GameState): GameState {
  if (s.status === 'LOBBY' || s.status === 'FINISHED') return s;
  const turn =
    s.status === 'ACTIVE'
      ? s.turn
      : {
          playerId: s.players[0]!.id,
          turnNumber: 1,
          phase: 'attack' as const,
          round: {
            kind: 'initial_hostility' as const,
            orderPlayerIds: s.players
              .filter((p) => !p.eliminated)
              .map((p) => p.id),
            actorIndex: 0,
          },
          isFirstHostilityTurn: true,
          firstHostilityStartingPlayerId: s.players[0]!.id,
          firstHostilityPlayerIdsRemaining: s.players
            .filter((p) => !p.eliminated)
            .map((p) => p.id),
          conqueredTerritoryIds: [],
          cardClaimEligible: false,
        };
  return {
    ...s,
    status: 'FINISHED',
    turn,
    result: {
      victoryReason: { kind: 'no_competitors' },
      scoringEligible: (s.competitiveClock?.completedRounds ?? 0) >= 6,
    },
  };
}
export function tickCompetitiveClock(
  s: GameState,
  now: number,
  connected: boolean,
  random: ShuffleSource,
): GameState {
  if (
    s.mode !== 'competitive' ||
    s.status === 'LOBBY' ||
    (s.status === 'FINISHED' && !s.pendingInheritance)
  )
    return s;
  if (!s.competitiveClock) s = startCompetitiveClock(s, now);
  now = Math.max(now, s.competitiveClock!.updatedAtMs);
  const original = s;
  let clock = s.competitiveClock!;
  const delta = Math.max(0, now - clock.updatedAtMs);
  const pid = competitiveActor(s)!;
  if (clock.pauseReason === 'admin' || clock.pauseReason === 'restart')
    return s;
  if (clock.pauseReason === 'disconnection') {
    const remaining = Math.max(
      0,
      (clock.technicalRemainingMs ?? TECHNICAL_WAIT_MS) - delta,
    );
    if (remaining > 0 && !connected)
      return {
        ...s,
        competitiveClock: {
          ...clock,
          updatedAtMs: now,
          technicalRemainingMs: remaining,
        },
      };
    // Once the grace is spent, the turn clock runs out the remaining time.
    clock = {
      ...clock,
      updatedAtMs: now,
      pauseReason: undefined,
      technicalRemainingMs: remaining,
      disconnectedPlayerId: undefined,
    };
    s = { ...s, competitiveClock: clock };
  } else {
    const used = Math.min(delta, clock.activationRemainingMs);
    const elapsed = clock.elapsedMs + (s.status === 'ACTIVE' ? used : 0);
    clock = {
      ...clock,
      updatedAtMs: now,
      activationRemainingMs: Math.max(0, clock.activationRemainingMs - used),
      elapsedMs: elapsed,
    };
    if (
      clock.finalRoundNumber === undefined &&
      elapsed >=
        competitiveDurationMs(
          s.configuredPlayerCount,
          s.competitiveDurationMinutes,
        )
    )
      clock = {
        ...clock,
        finalRoundNumber:
          (s.status === 'ACTIVE' && s.turn.round.kind === 'normal'
            ? s.turn.round.roundNumber
            : 0) + 2,
      };
    s = { ...s, competitiveClock: clock };
    const seat = s.players.find((p) => p.id === pid);
    const absent = seat?.absent;
    // A returning player takes back a seat a bot kept for them.
    if ((absent || seat?.bot === 'absent') && connected)
      s = setCompetitiveSeat(s, pid, undefined);
    const botPlays =
      seat?.bot === 'admin' || (seat?.bot === 'absent' && !connected);
    if (!connected && !botPlays) s = resolveInheritance(s, random);
    if (absent && !connected) s = expire(s, random);
    else if (
      !connected &&
      !botPlays &&
      s.status !== 'FINISHED' &&
      (clock.technicalRemainingMs ?? TECHNICAL_WAIT_MS) > 0
    )
      return {
        ...s,
        competitiveClock: {
          ...clock,
          pauseReason: 'disconnection',
          disconnectedPlayerId: pid,
          technicalRemainingMs: clock.technicalRemainingMs ?? TECHNICAL_WAIT_MS,
        },
      };
    else if (clock.activationRemainingMs === 0) {
      if (!connected && !botPlays && s.status !== 'FINISHED') {
        s = resolveInheritance(s, random);
        s = setCompetitiveSeat(
          s,
          pid,
          s.competitiveBotsReplaceAbsent === false ? 'absent' : 'bot-absent',
        );
      }
      s = expire(s, random);
    }
  }
  s = synchronizeCompetitiveClock(original, s, now);
  // Disqualified players remain defenders but receive no activations or reinforcements.
  for (let i = 0; i < 12 && s.status !== 'FINISHED'; i++) {
    if (s.players.every((p) => p.eliminated || p.disqualified))
      return noCompetitors(s);
    const actor = s.players.find((p) => p.id === competitiveActor(s));
    if (!actor?.disqualified) break;
    const before = s;
    s = expire(s, random);
    s = synchronizeCompetitiveClock(before, s, now);
  }
  return s;
}
export function pauseCompetitiveClock(
  s: GameState,
  now: number,
  paused: boolean,
): GameState {
  if (
    s.mode !== 'competitive' ||
    !s.competitiveClock ||
    s.status === 'LOBBY' ||
    (s.status === 'FINISHED' && !s.pendingInheritance)
  )
    throw new Error('INVALID_PHASE');
  const clock = s.competitiveClock;
  if (paused && clock.pauseReason === 'disconnection')
    throw new Error('INVALID_PHASE');
  return {
    ...s,
    competitiveClock: {
      ...clock,
      updatedAtMs: now,
      pauseReason: paused ? 'admin' : undefined,
      disconnectedPlayerId: undefined,
      technicalRemainingMs: clock.technicalRemainingMs,
    },
  };
}
/** The administrator puts a bot in a seat, or gives it back to its player. */
export function assignCompetitiveBot(
  s: GameState,
  pid: PlayerId,
  enabled: boolean,
): GameState {
  const player = s.players.find((p) => p.id === pid);
  if (
    s.mode !== 'competitive' ||
    !s.competitiveClock ||
    (s.status !== 'SETUP' && s.status !== 'ACTIVE') ||
    !player ||
    player.eliminated ||
    player.disqualified
  )
    throw new Error('INVALID_PHASE');
  if (!enabled) return player.bot ? setCompetitiveSeat(s, pid, undefined) : s;
  const next = setCompetitiveSeat(s, pid, 'bot-admin');
  const clock = next.competitiveClock!;
  return clock.pauseReason === 'disconnection' &&
    clock.disconnectedPlayerId === pid
    ? {
        ...next,
        competitiveClock: {
          ...clock,
          pauseReason: undefined,
          disconnectedPlayerId: undefined,
        },
      }
    : next;
}
export function selectCompetitiveTerritory(
  s: GameState,
  pid: PlayerId,
  territoryId: TerritoryId,
): GameState {
  if (
    s.mode !== 'competitive' ||
    (s.status !== 'SETUP' && s.status !== 'ACTIVE') ||
    !s.competitiveClock ||
    s.competitiveClock.pauseReason ||
    competitiveActor(s) !== pid ||
    !('territories' in s) ||
    s.territories[territoryId]?.ownerId !== pid ||
    s.players.find((p) => p.id === pid)?.disqualified ||
    (s.status === 'ACTIVE' &&
      (![
        'ordinary_exchange',
        'territory_reinforcement',
        'continent_reinforcement',
      ].includes(s.turn.phase) ||
        isActiveInternationalZone(s, territoryId)))
  )
    throw new Error('INVALID_PLACEMENT');
  return {
    ...s,
    competitiveClock: {
      ...s.competitiveClock,
      selectedTerritoryId: territoryId,
    },
  };
}
