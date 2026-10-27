import { CLASSIC_GAME_DEFINITION } from './game-definition.js';
import {
  SECRET_OBJECTIVES,
  TERRITORIES,
  TERRITORY_IDS,
  type SecretObjectiveId,
  type TerritoryId,
} from './classic-data.js';
import type {
  ActiveGameState,
  GameId,
  GameMode,
  PactState,
  PlayerId,
  PlayerState,
  SetupGameState,
  TerritoryState,
} from './domain.js';
import { setupArmies, validPlayerCount } from './mode-policy.js';
import type { DiceSource, DomainResult, ShuffleSource } from './rules.js';

export class SetupDealExhaustedError extends Error {
  constructor() {
    super('Competitive territory deal exhausted 128 attempts');
    this.name = 'SetupDealExhaustedError';
  }
}

export interface SetupRandomness extends DiceSource, ShuffleSource {}
export type SetupCommand = {
  readonly type: 'place_setup_armies';
  readonly playerId: PlayerId;
  readonly placements: Readonly<Partial<Record<TerritoryId, number>>>;
};

const err = <T>(
  code:
    | 'GAME_PAUSED'
    | 'PLAYER_DISQUALIFIED'
    | 'INVALID_SETUP'
    | 'NOT_YOUR_TURN'
    | 'INVALID_TERRITORY'
    | 'INVALID_PLACEMENT',
): DomainResult<T> => ({
  ok: false,
  error: {
    code: code === 'INVALID_SETUP' ? 'INVALID_PHASE' : code,
    message: code,
  },
});
const ok = <T>(state: T): DomainResult<T> => ({ ok: true, state });
const emptyPacts: PactState = { proposals: [], active: [] };
function rollWinner(
  players: readonly PlayerState[],
  rng: DiceSource,
): PlayerState {
  let candidates = [...players];
  while (candidates.length > 1) {
    let high = 0;
    const rolls = candidates.map((p) => {
      const value = rng.rollDie();
      if (!Number.isInteger(value) || value < 1 || value > 6)
        throw new Error('DiceSource returned an invalid die');
      high = Math.max(high, value);
      return [p, value] as const;
    });
    candidates = rolls.filter(([, v]) => v === high).map(([p]) => p);
  }
  return candidates[0]!;
}
function validRoll(rng: DiceSource): number {
  const value = rng.rollDie();
  if (!Number.isInteger(value) || value < 1 || value > 6)
    throw new Error('DiceSource returned an invalid die');
  return value;
}
function rankedLeftoverRecipients(
  players: readonly PlayerState[],
  rng: DiceSource,
): readonly [PlayerState, PlayerState] {
  const original = players.map((player) => ({ player, roll: validRoll(rng) }));
  const resolve = (candidates: readonly PlayerState[]) =>
    candidates.length === 1 ? candidates[0]! : rollWinner(candidates, rng);
  const firstRoll = Math.max(...original.map(({ roll }) => roll));
  const first = resolve(
    original
      .filter(({ roll }) => roll === firstRoll)
      .map(({ player }) => player),
  );
  const remaining = original.filter(({ player }) => player.id !== first.id);
  const secondRoll = Math.max(...remaining.map(({ roll }) => roll));
  const second = resolve(
    remaining
      .filter(({ roll }) => roll === secondRoll)
      .map(({ player }) => player),
  );
  return [first, second];
}
function seatOrder(
  players: readonly PlayerState[],
  start: PlayerId,
): readonly PlayerState[] {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex),
    i = sorted.findIndex((p) => p.id === start);
  return [...sorted.slice(i), ...sorted.slice(0, i)];
}
function territories(): Record<TerritoryId, TerritoryState> {
  return Object.fromEntries(
    TERRITORY_IDS.map((id) => [id, { armies: 0, fixedArmiesThisTurn: 0 }]),
  ) as Record<TerritoryId, TerritoryState>;
}
function assignObjectives(
  players: readonly PlayerState[],
  rng: ShuffleSource,
  occupationOnly = false,
): readonly PlayerState[] {
  const ids = [
    ...rng.shuffle(
      (Object.keys(SECRET_OBJECTIVES) as SecretObjectiveId[]).filter(
        (id) => !occupationOnly || !id.startsWith('destroy_'),
      ),
    ),
  ];
  return players.map((p) => {
    // Deal without replacement, skipping destruction cards invalid for this
    // holder. Skipped cards remain available for the next player.
    const index = ids.findIndex(
      (id) =>
        !id.startsWith('destroy_') ||
        players.some(
          (target) => target.id !== p.id && target.color === id.slice(8),
        ),
    );
    if (index < 0) throw new Error('No eligible secret objective');
    const objective = ids.splice(index, 1)[0]!;
    if (!objective.startsWith('destroy_'))
      return { ...p, secretObjectiveId: objective };
    const color = objective.slice(8),
      target = players.find((x) => x.color === color);
    return {
      ...p,
      secretObjectiveId: objective,
      effectiveDestructionTargetPlayerId: target!.id,
    };
  });
}
export function createClassicSetup(
  id: GameId,
  players: readonly PlayerState[],
  rng: SetupRandomness,
  mode: GameMode = 'classic',
  botSeats?: 2,
): SetupGameState {
  if (
    !validPlayerCount(mode, players.length) ||
    new Set(players.map((p) => p.id)).size !== players.length
  )
    throw new Error('Invalid player count for game mode');
  const board = territories();
  if (players.length <= 3) {
    const stableOrder = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
    const assignedTerritories = rng.shuffle(TERRITORY_IDS);
    assignedTerritories.forEach((territoryId, index) => {
      board[territoryId] = {
        ownerId: stableOrder[index % stableOrder.length]!.id,
        armies: 1,
        fixedArmiesThisTurn: 0,
      };
    });
    const drawPile = rng.shuffle(TERRITORY_IDS);
    const start = rollWinner(players, rng);
    const allocations = Object.fromEntries(
      players.map((player) => [player.id, players.length === 2 ? 12 : 8]),
    );
    return {
      id,
      definition: CLASSIC_GAME_DEFINITION,
      mode,
      status: 'SETUP',
      configuredPlayerCount: players.length as 2 | 3,
      players,
      territories: board,
      cardDeck: { drawPile, discardPile: [] },
      commonVictoryCondition: {
        kind: 'control_all_territories',
        territoryCount: 50,
      },
      pacts: emptyPacts,
      setup: {
        kind: 'automatic_assignment_2_to_3',
        stage: 'additional_armies',
        startingPlayerId: start.id,
        currentPlayerId: start.id,
        additionalArmiesRemainingByPlayer: allocations,
      },
    };
  }
  const stableOrder = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  let leftovers: TerritoryId[] = [];
  let accepted = false;
  for (let attempt = 0; attempt < 128; attempt++) {
    const cards = [...rng.shuffle(TERRITORY_IDS)],
      even = Math.floor(50 / players.length),
      dealCount = even * players.length;
    for (let i = 0; i < dealCount; i++) {
      const tid = cards[i]!,
        owner = stableOrder[i % stableOrder.length]!;
      board[tid] = { ownerId: owner.id, armies: 1, fixedArmiesThisTurn: 0 };
    }
    leftovers = cards.slice(dealCount);
    if (leftovers.length === 2) {
      const recipients = rankedLeftoverRecipients(players, rng);
      leftovers.forEach((tid, index) => {
        board[tid] = {
          ownerId: recipients[index]!.id,
          armies: 1,
          fixedArmiesThisTurn: 0,
        };
      });
    }
    accepted =
      mode === 'classic' ||
      players.every(
        (player) =>
          new Set(
            TERRITORY_IDS.filter((id) => board[id].ownerId === player.id).map(
              (id) => TERRITORIES[id].continentId,
            ),
          ).size >= 2,
      );
    if (accepted) break;
  }
  if (!accepted) throw new SetupDealExhaustedError();
  const drawPile = rng.shuffle(TERRITORY_IDS);
  const assignedPlayers = assignObjectives(
    players,
    rng,
    mode === 'competitive' && players.length - (botSeats ?? 0) === 4,
  );
  const start = rollWinner(players, rng);
  return {
    id,
    definition: CLASSIC_GAME_DEFINITION,
    mode,
    status: 'SETUP',
    ...(mode === 'competitive'
      ? { competitiveHistory: { complete: true, eliminations: [] } }
      : {}),
    configuredPlayerCount: players.length as 4 | 5 | 6,
    ...(botSeats ? { competitiveBotSeats: botSeats } : {}),
    players: assignedPlayers,
    territories: board,
    cardDeck: { drawPile, discardPile: [] },
    commonVictoryCondition: { kind: 'control_territories', territoryCount: 30 },
    pacts: emptyPacts,
    setup: {
      kind: 'card_deal_4_to_6',
      stage: 'reinforcement',
      startingPlayerId: start.id,
      currentPlayerId: start.id,
      leftoverCardIds: leftovers,
      reinforcementRound: 1,
      additionalArmiesByPlayerContinent: {},
      armiesRemainingInActivation: setupArmies(mode, 1),
    },
  };
}
function next(order: readonly PlayerState[], id: PlayerId): PlayerState {
  return order[(order.findIndex((p) => p.id === id) + 1) % order.length]!;
}
function activate(state: SetupGameState, start: PlayerId): ActiveGameState {
  const firstHostilityOrder = seatOrder(state.players, start)
    .filter((player) => !player.eliminated)
    .map((player) => player.id);
  return {
    ...state,
    status: 'ACTIVE',
    turn: {
      playerId: start,
      turnNumber: 1,
      phase: 'attack',
      round: {
        kind: 'initial_hostility',
        orderPlayerIds: firstHostilityOrder,
        actorIndex: 0,
      },
      isFirstHostilityTurn: true,
      firstHostilityStartingPlayerId: start,
      firstHostilityPlayerIdsRemaining: firstHostilityOrder,
      conqueredTerritoryIds: [],
      cardClaimEligible: false,
    },
  };
}
export function applySetupCommand(
  state: SetupGameState,
  command: SetupCommand,
): DomainResult<SetupGameState | ActiveGameState> {
  if (state.competitiveClock?.pauseReason) return err('GAME_PAUSED');
  if (state.players.find((p) => p.id === command.playerId)?.disqualified)
    return err('PLAYER_DISQUALIFIED');
  const setup = state.setup;
  if (setup.currentPlayerId !== command.playerId) return err('NOT_YOUR_TURN');
  const order = seatOrder(state.players, setup.startingPlayerId!);
  const entries = Object.entries(command.placements) as [TerritoryId, number][];
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (
    entries.length === 0 ||
    entries.some(
      ([t, n]) =>
        !Number.isFinite(n) ||
        !Number.isInteger(n) ||
        n <= 0 ||
        state.territories[t]?.ownerId !== command.playerId,
    )
  )
    return err('INVALID_PLACEMENT');
  if (setup.kind === 'automatic_assignment_2_to_3') {
    const due = setup.additionalArmiesRemainingByPlayer[command.playerId] ?? 0;
    if (setup.stage !== 'additional_armies' || total !== due)
      return err('INVALID_PLACEMENT');
    const updated = add(state, entries),
      n = next(order, command.playerId);
    if (n.id === setup.startingPlayerId)
      return ok(activate(updated, setup.startingPlayerId));
    return ok({
      ...updated,
      setup: {
        ...setup,
        currentPlayerId: n.id,
        additionalArmiesRemainingByPlayer: {
          ...setup.additionalArmiesRemainingByPlayer,
          [command.playerId]: 0,
        },
      },
    });
  }
  if (
    setup.stage !== 'reinforcement' ||
    (state.mode === 'classic'
      ? total !== setup.armiesRemainingInActivation
      : total > setup.armiesRemainingInActivation)
  )
    return err('INVALID_PLACEMENT');
  const counts = {
    ...(setup.additionalArmiesByPlayerContinent[command.playerId] ?? {}),
  };
  for (const [id, amount] of entries) {
    const continent = TERRITORIES[id].continentId;
    counts[continent] = (counts[continent] ?? 0) + amount;
  }
  if (
    state.mode === 'competitive' &&
    Object.values(counts).some((amount) => amount > 4)
  )
    return err('INVALID_PLACEMENT');
  const updated = {
    ...add(state, entries),
    setup: {
      ...setup,
      additionalArmiesByPlayerContinent: {
        ...setup.additionalArmiesByPlayerContinent,
        [command.playerId]: counts,
      },
    },
  };
  const remaining = setup.armiesRemainingInActivation - total;
  if (remaining > 0)
    return ok({
      ...updated,
      setup: { ...updated.setup, armiesRemainingInActivation: remaining },
    });
  const n = next(order, command.playerId);
  if (n.id !== setup.startingPlayerId)
    return ok({
      ...updated,
      setup: {
        ...updated.setup,
        currentPlayerId: n.id,
        armiesRemainingInActivation: setupArmies(
          state.mode,
          setup.reinforcementRound,
        ),
      },
    });
  if (setup.reinforcementRound === 1)
    return ok({
      ...updated,
      setup: {
        ...updated.setup,
        currentPlayerId: setup.startingPlayerId,
        reinforcementRound: 2,
        armiesRemainingInActivation: setupArmies(state.mode, 2),
      },
    });
  return ok(activate(updated, setup.startingPlayerId));
}
function add<T extends SetupGameState>(
  s: T,
  entries: readonly [TerritoryId, number][],
): T {
  let board = { ...s.territories };
  for (const [t, n] of entries)
    board = { ...board, [t]: { ...board[t], armies: board[t].armies + n } };
  return { ...s, territories: board };
}

export function skipDisqualifiedSetupActivation(
  state: SetupGameState,
): SetupGameState | ActiveGameState {
  const setup = state.setup;
  if (setup.kind !== 'card_deal_4_to_6')
    throw new Error('Competitive setup requires card deal');
  const order = seatOrder(state.players, setup.startingPlayerId!);
  const n = next(order, setup.currentPlayerId!);
  if (n.id !== setup.startingPlayerId)
    return {
      ...state,
      setup: {
        ...setup,
        currentPlayerId: n.id,
        armiesRemainingInActivation: 4,
      },
    };
  if (setup.reinforcementRound === 1)
    return {
      ...state,
      setup: {
        ...setup,
        currentPlayerId: setup.startingPlayerId,
        reinforcementRound: 2,
        armiesRemainingInActivation: 4,
      },
    };
  return activate(state, setup.startingPlayerId);
}
