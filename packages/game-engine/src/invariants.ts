import {
  setupArmies,
  validPlayerCount,
  pactsAllowed,
  humanSeats,
} from './mode-policy.js';
import {
  CONTINENTS,
  CONTINENT_IDS,
  PLAYER_COLORS,
  SECRET_OBJECTIVES,
  TERRITORIES,
  TERRITORY_CARDS,
  TERRITORY_IDS,
  type TerritoryCardId,
} from './classic-data.js';
import type { ActivePact, GameState, PlayerId } from './domain.js';
import { victoryReason } from './rules.js';
import { hasGameClock, timeLimitWinner } from './competitive-clock.js';

/** Pure, Classic-specific structural validation used at engine boundaries and in tests. */
export function classicInvariantViolations(
  state: GameState,
): readonly string[] {
  const errors: string[] = [];
  if (!validPlayerCount(state.mode, state.configuredPlayerCount))
    errors.push('invalid mode or player count');
  if (
    state.status !== 'LOBBY' &&
    !pactsAllowed(
      state.mode,
      state.configuredPlayerCount,
      state.competitiveBotSeats,
    ) &&
    (state.pacts.active.length || state.pacts.proposals.length)
  )
    errors.push('pacts disabled');
  if (
    state.mode === 'competitive' &&
    humanSeats(state) === 4 &&
    state.players.some((p) => p.secretObjectiveId?.startsWith('destroy_'))
  )
    errors.push('destruction objectives disabled');
  const playerIds = new Set<PlayerId>();
  const seats = new Set<number>();
  const colors = new Set<string>();
  for (const player of state.players) {
    if (playerIds.has(player.id)) errors.push(`duplicate player ${player.id}`);
    if (seats.has(player.seatIndex))
      errors.push(`duplicate seat ${player.seatIndex}`);
    if (
      !Number.isInteger(player.seatIndex) ||
      player.seatIndex < 0 ||
      player.seatIndex >= state.configuredPlayerCount
    )
      errors.push(`invalid seat ${player.seatIndex}`);
    if (colors.has(player.color))
      errors.push(`duplicate color ${player.color}`);
    playerIds.add(player.id);
    seats.add(player.seatIndex);
    colors.add(player.color);
    if (!PLAYER_COLORS.includes(player.color))
      errors.push(`invalid color ${player.color}`);
    if (
      !Number.isInteger(player.completedExchangeCount) ||
      player.completedExchangeCount < 0
    )
      errors.push(`invalid exchange count for ${player.id}`);
    if (
      player.secretObjectiveId &&
      !(player.secretObjectiveId in SECRET_OBJECTIVES)
    )
      errors.push(`invalid objective for ${player.id}`);
    if (
      player.effectiveDestructionTargetPlayerId &&
      !playerIds.has(player.effectiveDestructionTargetPlayerId) &&
      !state.players.some(
        ({ id }) => id === player.effectiveDestructionTargetPlayerId,
      )
    )
      errors.push(`invalid destruction target for ${player.id}`);
  }
  if (state.status === 'LOBBY') {
    if (state.players.length > humanSeats(state))
      errors.push('lobby exceeds configured player count');
    if (
      state.competitiveBotSeats &&
      (state.mode !== 'competitive' ||
        state.configuredPlayerCount !== 6 ||
        state.competitiveDurationMinutes === 60)
    )
      errors.push('A bot table is six seats with two bots and no Express');
    const readyIds = new Set<PlayerId>();
    for (const id of state.readyPlayerIds) {
      if (!playerIds.has(id)) errors.push(`invalid ready player ${id}`);
      if (readyIds.has(id)) errors.push(`duplicate ready player ${id}`);
      readyIds.add(id);
    }
    return errors;
  }
  if (state.players.length !== state.configuredPlayerCount)
    errors.push('configured player count mismatch');

  const history = state.competitiveHistory;
  if (history) {
    const victims = new Set<string>();
    let previousTurn = 0;
    if (state.mode !== 'competitive')
      errors.push('Classic cannot contain competitive history');
    for (const event of history.eliminations) {
      if (
        !state.players.some((p) => p.id === event.eliminatingPlayerId) ||
        !state.players.some(
          (p) => p.id === event.eliminatedPlayerId && p.eliminated,
        ) ||
        event.eliminatingPlayerId === event.eliminatedPlayerId ||
        victims.has(event.eliminatedPlayerId) ||
        victims.has(event.eliminatingPlayerId) ||
        state.status === 'SETUP' ||
        ((state.status === 'ACTIVE' || state.status === 'FINISHED') &&
          event.turnNumber > state.turn.turnNumber) ||
        !Number.isSafeInteger(event.turnNumber) ||
        event.turnNumber < 1 ||
        event.turnNumber < previousTurn
      )
        errors.push('invalid competitive elimination history');
      victims.add(event.eliminatedPlayerId);
      previousTurn = event.turnNumber;
    }
    if (
      history.complete &&
      state.players.some((p) => p.eliminated && !victims.has(p.id))
    )
      errors.push('incomplete competitive elimination history');
  }
  const isSmallVariant = state.configuredPlayerCount <= 3;
  if (isSmallVariant) {
    if (state.players.some((player) => player.secretObjectiveId !== undefined))
      errors.push('2-3 player variant must not assign secret objectives');
    if (
      state.commonVictoryCondition.kind !== 'control_all_territories' ||
      state.commonVictoryCondition.territoryCount !== 50
    )
      errors.push('2-3 player variant must use 50-territory victory');
  } else {
    const objectives = state.players.map((player) => player.secretObjectiveId);
    const objectivesRequired =
      state.status !== 'SETUP' ||
      (state.setup.kind === 'card_deal_4_to_6' &&
        ['starting_order', 'reinforcement'].includes(state.setup.stage));
    if (
      objectivesRequired &&
      objectives.some((objective) => objective === undefined)
    )
      errors.push(
        '4-6 player variant requires one secret objective per player',
      );
    const assigned = objectives.filter(
      (objective): objective is NonNullable<typeof objective> =>
        objective !== undefined,
    );
    if (!objectivesRequired && assigned.length !== 0)
      errors.push('objectives assigned before the objective setup stage');
    if (new Set(assigned).size !== assigned.length)
      errors.push('4-6 player variant has duplicate secret objectives');
    if (
      state.commonVictoryCondition.kind !== 'control_territories' ||
      state.commonVictoryCondition.territoryCount !== 30
    )
      errors.push('4-6 player variant must use 30-territory victory');
  }

  const orderedPlayers = [...state.players].sort(
    (a, b) => a.seatIndex - b.seatIndex,
  );
  for (const objectiveHolder of state.players) {
    const objectiveId = objectiveHolder.secretObjectiveId;
    const objective = objectiveId ? SECRET_OBJECTIVES[objectiveId] : undefined;
    if (!objective || objective.kind === 'occupation') {
      if (objectiveHolder.effectiveDestructionTargetPlayerId !== undefined)
        errors.push(`unexpected destruction target for ${objectiveHolder.id}`);
      continue;
    }
    const namedTarget = state.players.find(
      (candidate) => candidate.color === objective.targetColor,
    );
    const holderIndex = orderedPlayers.findIndex(
      (candidate) => candidate.id === objectiveHolder.id,
    );
    const fallbackTarget =
      orderedPlayers[
        (holderIndex - 1 + orderedPlayers.length) % orderedPlayers.length
      ];
    const expectedTarget =
      namedTarget && namedTarget.id !== objectiveHolder.id
        ? namedTarget
        : fallbackTarget;
    const storedTarget = objectiveHolder.effectiveDestructionTargetPlayerId;
    const isCompletedFallback = expectedTarget?.eliminated && !storedTarget;
    if (
      !expectedTarget ||
      (!isCompletedFallback && storedTarget !== expectedTarget.id)
    )
      errors.push(`invalid destruction target for ${objectiveHolder.id}`);
  }

  const territoryKeys = Object.keys(state.territories);
  if (territoryKeys.length !== TERRITORY_IDS.length)
    errors.push('territory count mismatch');
  for (const id of territoryKeys)
    if (!(id in TERRITORIES)) errors.push(`unknown territory ${id}`);
  for (const id of TERRITORY_IDS) {
    const territory = state.territories[id];
    if (!territory) {
      errors.push(`missing territory ${id}`);
      continue;
    }
    if (!Number.isInteger(territory.armies) || territory.armies < 0)
      errors.push(`invalid armies at ${id}`);
    if (
      !Number.isInteger(territory.fixedArmiesThisTurn) ||
      territory.fixedArmiesThisTurn < 0 ||
      territory.fixedArmiesThisTurn > territory.armies
    )
      errors.push(`invalid fixed armies at ${id}`);
    if (territory.ownerId && !playerIds.has(territory.ownerId))
      errors.push(`invalid owner at ${id}`);
    if (
      state.status !== 'SETUP' &&
      (!territory.ownerId ||
        (territory.armies < 1 &&
          !(
            state.status === 'ACTIVE' &&
            state.pendingAction?.kind === 'conquest_transfer' &&
            state.pendingAction.conqueredTerritoryId === id
          )))
    )
      errors.push(`active territory is not valid at ${id}`);
  }

  if (state.status === 'SETUP') validateSetup(state, playerIds, errors);

  if (state.status === 'ACTIVE' || state.status === 'FINISHED') {
    const fixedAllowed = new Set(['regroup', 'end_of_turn_cards']).has(
      state.turn.phase,
    );
    if (
      !fixedAllowed &&
      TERRITORY_IDS.some(
        (id) => state.territories[id].fixedArmiesThisTurn !== 0,
      )
    )
      errors.push('fixed regroup armies are invalid in current phase');
  }

  const cardLocations = new Map<TerritoryCardId, string>();
  const recordCard = (cardId: TerritoryCardId, location: string) => {
    if (!(cardId in TERRITORY_CARDS)) errors.push(`invalid card ${cardId}`);
    const previous = cardLocations.get(cardId);
    if (previous)
      errors.push(`card ${cardId} occurs in ${previous} and ${location}`);
    else cardLocations.set(cardId, location);
  };
  for (const card of state.pendingInheritance?.cards ?? [])
    recordCard(card.cardId, 'pending inheritance');
  if (state.pendingInheritance) {
    const pending = state.pendingInheritance;
    const recipient = state.players.find((p) => p.id === pending.playerId);
    if (
      state.mode !== 'competitive' ||
      !recipient ||
      recipient.eliminated ||
      recipient.disqualified ||
      pending.takeCount !== 5 - recipient.cards.length ||
      pending.takeCount < 1 ||
      pending.cards.length <= pending.takeCount
    )
      errors.push('invalid pending inheritance');
  }
  state.cardDeck.drawPile.forEach((id) => recordCard(id, 'draw pile'));
  state.cardDeck.discardPile.forEach((id) => recordCard(id, 'discard pile'));
  for (const player of state.players) {
    player.cards.forEach(({ cardId, territoryBonusClaimed }) => {
      recordCard(cardId, `hand ${player.id}`);
      if (typeof territoryBonusClaimed !== 'boolean')
        errors.push(`invalid possession metadata for ${cardId}`);
    });
    if (state.status !== 'SETUP') {
      const owned = TERRITORY_IDS.some(
        (id) => state.territories[id]?.ownerId === player.id,
      );
      if (player.eliminated !== !owned)
        errors.push(`elimination mismatch for ${player.id}`);
      if (player.eliminated && player.cards.length)
        errors.push(`eliminated player has cards ${player.id}`);
    }
  }
  if (cardLocations.size !== TERRITORY_IDS.length)
    errors.push('card identity count mismatch');

  const proposalIds = new Set<string>();
  for (const proposal of state.pacts.proposals) {
    if (proposalIds.has(proposal.id))
      errors.push(`duplicate pact proposal ${proposal.id}`);
    proposalIds.add(proposal.id);
    if (
      !playerIds.has(proposal.proposerId) ||
      !playerIds.has(proposal.recipientId) ||
      proposal.proposerId === proposal.recipientId
    )
      errors.push(`invalid pact proposal ${proposal.id}`);
    validateTerms(proposal.terms, playerIds, errors, `proposal ${proposal.id}`);
  }
  const pactIds = new Set<string>();
  for (const wait of state.pacts.competitiveWithdrawals ?? []) {
    if (
      state.mode !== 'competitive' ||
      state.configuredPlayerCount === 4 ||
      !wait.parties.includes(wait.withdrawingPlayerId) ||
      !wait.parties.includes(wait.recipientId) ||
      wait.withdrawingPlayerId === wait.recipientId ||
      wait.parties.some((id) => !playerIds.has(id)) ||
      ![1, 2].includes(wait.incorporationsRemaining) ||
      pactIds.has(wait.id)
    )
      errors.push(`invalid competitive withdrawal ${wait.id}`);
    pactIds.add(wait.id);
    validateTerms(wait.terms, playerIds, errors, `withdrawal ${wait.id}`);
  }
  for (const rejection of state.pacts.competitiveRejections ?? [])
    if (
      state.mode !== 'competitive' ||
      !playerIds.has(rejection.proposerId) ||
      !playerIds.has(rejection.recipientId) ||
      rejection.proposerId === rejection.recipientId
    )
      errors.push('invalid competitive pact rejection');

  for (const pact of state.pacts.active) {
    if (pactIds.has(pact.id)) errors.push(`duplicate pact ${pact.id}`);
    pactIds.add(pact.id);
    validatePact(state, pact, playerIds, errors);
  }

  if (state.status === 'ACTIVE' || state.status === 'FINISHED') {
    if (!playerIds.has(state.turn.playerId)) errors.push('invalid turn player');
    if (state.players.find(({ id }) => id === state.turn.playerId)?.eliminated)
      errors.push('eliminated player has turn');
    if (!Number.isInteger(state.turn.turnNumber) || state.turn.turnNumber < 1)
      errors.push('invalid turn number');
    const round = state.turn.round;
    const survivingRoundOrder = round.orderPlayerIds.filter(
      (id) =>
        !state.players.find((candidate) => candidate.id === id)?.eliminated,
    );
    if (
      round.orderPlayerIds.length === 0 ||
      new Set(round.orderPlayerIds).size !== round.orderPlayerIds.length ||
      round.orderPlayerIds.some((id) => !playerIds.has(id)) ||
      round.actorIndex < 0 ||
      !Number.isInteger(round.actorIndex) ||
      round.orderPlayerIds[round.actorIndex] !== state.turn.playerId ||
      !survivingRoundOrder.includes(state.turn.playerId)
    )
      errors.push('invalid round order or actor');
    if (
      round.kind === 'initial_hostility' &&
      (!state.turn.isFirstHostilityTurn ||
        !['attack', 'regroup', 'end_of_turn_cards'].includes(state.turn.phase))
    )
      errors.push('invalid initial-hostility round phase');
    if (
      round.kind === 'normal' &&
      (round.roundNumber < 1 ||
        !Number.isInteger(round.roundNumber) ||
        state.turn.isFirstHostilityTurn ||
        (round.pass === 'incorporation' &&
          ![
            'territory_reinforcement',
            'continent_reinforcement',
            'ordinary_exchange',
          ].includes(state.turn.phase)) ||
        (round.pass === 'hostility' &&
          !['attack', 'regroup', 'end_of_turn_cards'].includes(
            state.turn.phase,
          )))
    )
      errors.push('invalid normal-round pass phase');
    if (state.turn.isFirstHostilityTurn) {
      const remaining = state.turn.firstHostilityPlayerIdsRemaining;
      const starting = state.turn.firstHostilityStartingPlayerId;
      if ((starting === undefined) !== (remaining === undefined))
        errors.push('incomplete first-hostility round progress');
      if (
        starting !== undefined &&
        remaining !== undefined &&
        (!playerIds.has(starting) ||
          remaining.length === 0 ||
          new Set(remaining).size !== remaining.length ||
          remaining.some((id) => !playerIds.has(id)) ||
          !remaining.includes(state.turn.playerId))
      )
        errors.push('invalid first-hostility round progress');
      if (state.turn.phase === 'territory_reinforcement')
        errors.push('first-hostility turn cannot reinforce');
    }
    for (const id of state.turn.conqueredTerritoryIds)
      if (
        !(id in TERRITORIES) ||
        state.territories[id].ownerId !== state.turn.playerId
      )
        errors.push(`invalid conquered territory ${id}`);
    if (
      state.turn.lastConqueredTerritoryId &&
      !state.turn.conqueredTerritoryIds.includes(
        state.turn.lastConqueredTerritoryId,
      )
    )
      errors.push('last conquest is not a conquest');
    const remaining = state.turn.reinforcementArmiesRemaining;
    if (
      state.turn.phase === 'territory_reinforcement' &&
      remaining === undefined
    )
      errors.push('territory reinforcement phase requires its pool');
    if (
      remaining !== undefined &&
      (!Number.isFinite(remaining) ||
        !Number.isInteger(remaining) ||
        remaining < 0)
    )
      errors.push('invalid reinforcement pool');
    if (
      !['ordinary_exchange', 'territory_reinforcement'].includes(
        state.turn.phase,
      ) &&
      (remaining ?? 0) !== 0
    )
      errors.push('stale territory reinforcement pool');
    if (
      state.turn.phase === 'continent_reinforcement' &&
      state.turn.continentReinforcementsRemaining === undefined
    )
      errors.push('continent reinforcement phase requires its pools');
    for (const [continent, amount] of Object.entries(
      state.turn.continentReinforcementsRemaining ?? {},
    ))
      if (!CONTINENT_IDS.includes(continent as (typeof CONTINENT_IDS)[number]))
        errors.push(`invalid continent reinforcement pool ${continent}`);
      else {
        const id = continent as (typeof CONTINENT_IDS)[number];
        const owns = CONTINENTS[id].territoryIds.every(
          (territoryId) =>
            state.territories[territoryId].ownerId === state.turn.playerId,
        );
        if (
          !owns ||
          !Number.isFinite(amount) ||
          !Number.isInteger(amount) ||
          amount < 0 ||
          amount > CONTINENTS[id].reinforcementBonus
        )
          errors.push(`invalid continent reinforcement pool ${continent}`);
      }
    if (
      ![
        'ordinary_exchange',
        'territory_reinforcement',
        'continent_reinforcement',
      ].includes(state.turn.phase) &&
      Object.values(state.turn.continentReinforcementsRemaining ?? {}).some(
        (amount) => amount !== 0,
      )
    )
      errors.push('stale continent reinforcement pool');
    if (state.status === 'ACTIVE' && state.pendingAction) {
      const pending = state.pendingAction;
      const source = state.territories[pending.fromTerritoryId];
      const destination = state.territories[pending.conqueredTerritoryId];
      const maximum = pending.maximumArmies as number;
      const isInternationalZone = state.pacts.active.some(
        (pact) =>
          pact.kind === 'international_zone' &&
          pact.terms.territoryId === pending.conqueredTerritoryId,
      );
      const expectedMaximum = source
        ? isInternationalZone
          ? 1
          : Math.min(3, source.armies - 1)
        : Number.NaN;
      if (
        state.turn.phase !== 'attack' ||
        pending.playerId !== state.turn.playerId ||
        !source ||
        !destination ||
        source.ownerId !== pending.playerId ||
        destination.ownerId !== pending.playerId ||
        !TERRITORIES[pending.fromTerritoryId]?.adjacentTerritoryIds.includes(
          pending.conqueredTerritoryId,
        ) ||
        source.armies < 1 ||
        !Number.isFinite(maximum) ||
        !Number.isInteger(maximum) ||
        maximum < 1 ||
        maximum !== expectedMaximum ||
        source.armies - maximum < 1 ||
        !state.turn.conqueredTerritoryIds.includes(
          pending.conqueredTerritoryId,
        ) ||
        state.turn.lastConqueredTerritoryId !== pending.conqueredTerritoryId ||
        destination.armies !== 0
      )
        errors.push('invalid pending conquest transfer');
    }
  }
  if (
    state.status === 'FINISHED' &&
    ['time_limit', 'no_competitors'].includes(state.result.victoryReason.kind)
  ) {
    if (
      (state.mode !== 'competitive' &&
        !(
          state.classicExpress &&
          state.result.victoryReason.kind === 'time_limit'
        )) ||
      state.result.winnerId !==
        (state.mode === 'classic' ? timeLimitWinner(state) : undefined) ||
      (state.result.victoryReason.kind === 'time_limit' &&
        (!state.competitiveClock?.finalRoundNumber ||
          state.competitiveClock.completedRounds <
            state.competitiveClock.finalRoundNumber)) ||
      (state.result.victoryReason.kind === 'no_competitors' &&
        state.players.some((p) => !p.eliminated && !p.disqualified))
    )
      errors.push('invalid competitive closure');
  } else if (state.status === 'FINISHED') {
    const winner = state.players.find(({ id }) => id === state.result.winnerId);
    if (!winner || winner.eliminated) errors.push('invalid finished winner');
    if (
      state.players.filter((player) => player.id === state.result.winnerId)
        .length !== 1
    )
      errors.push('finished game must have exactly one winner');
    if (
      winner &&
      JSON.stringify(victoryReason(state, winner.id)) !==
        JSON.stringify(state.result.victoryReason)
    )
      errors.push('invalid finished victory reason');
    if (
      (isSmallVariant &&
        state.result.victoryReason.kind !== 'control_all_territories') ||
      (!isSmallVariant &&
        state.result.victoryReason.kind === 'control_all_territories')
    )
      errors.push('finished victory reason is invalid for Classic variant');
  }
  const clock = state.competitiveClock;
  if (
    clock &&
    state.status === 'FINISHED' &&
    (state.mode === 'competitive'
      ? state.result.scoringEligible !== clock.completedRounds >= 6
      : state.result.scoringEligible !== undefined)
  )
    errors.push('invalid scoring eligibility');
  if (
    clock &&
    (!hasGameClock(state) ||
      ![
        clock.updatedAtMs,
        clock.elapsedMs,
        clock.activationRemainingMs,
        clock.completedRounds,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      clock.activationRemainingMs > 180000 ||
      (clock.finalRoundNumber !== undefined &&
        (!Number.isSafeInteger(clock.finalRoundNumber) ||
          clock.finalRoundNumber < 2)) ||
      (clock.pauseReason === 'disconnection' &&
        (!clock.disconnectedPlayerId ||
          clock.technicalRemainingMs === undefined ||
          clock.technicalRemainingMs < 0 ||
          clock.technicalRemainingMs > 480000)) ||
      Object.entries(clock.technicalRemainingByPlayer ?? {}).some(
        ([pid, ms]) =>
          !state.players.some((p) => p.id === pid) ||
          !Number.isSafeInteger(ms) ||
          ms < 0 ||
          ms > 480000,
      ))
  )
    errors.push('invalid competitive clock');
  if (
    state.mode !== 'competitive' &&
    (state.players.some(
      (p) =>
        p.bot === 'requested' ||
        p.bot === 'table' ||
        (p.bot === 'absent' && !hasGameClock(state)),
    ) ||
      state.competitiveBotSeats)
  )
    errors.push(
      "Classic bots are the administrator's or replace absents in Express",
    );
  if (
    state.competitiveBotSeats &&
    (state.configuredPlayerCount !== 6 ||
      state.competitiveDurationMinutes === 60 ||
      state.players.filter((p) => p.bot === 'table').length !==
        state.competitiveBotSeats)
  )
    errors.push('A bot table is six seats with two bots and no Express');
  if (
    !state.competitiveBotSeats &&
    state.players.some((p) => p.bot === 'table')
  )
    errors.push('Table bots belong to a started bot table');
  if (
    state.players.some(
      (p) => [p.absent, p.bot, p.inactive].filter(Boolean).length > 1,
    )
  )
    errors.push('A seat is either absent, inactive or played by a bot');
  if (
    state.competitiveDeciding &&
    (state.mode !== 'competitive' ||
      state.competitiveBotSeats ||
      state.players.some((p) => p.bot))
  )
    errors.push('A deciding game is Competitive and has no bots');
  if (!state.competitiveDeciding && state.players.some((p) => p.inactive))
    errors.push('Only deciding games have inactive players');
  if (!hasGameClock(state) && state.players.some((p) => p.absent))
    errors.push('Only games with a clock can have absent players');
  if (state.classicExpress && state.mode !== 'classic')
    errors.push('Express is a Classic option');
  if (state.mode !== 'competitive' && state.competitiveDurationMinutes)
    errors.push('Only Competitive can choose its duration');
  if (state.mode === 'classic' && state.players.some((p) => p.disqualified))
    errors.push('Classic cannot contain disqualified players');
  return errors;
}

function validateSetup(
  state: Extract<GameState, { readonly status: 'SETUP' }>,
  playerIds: ReadonlySet<PlayerId>,
  errors: string[],
): void {
  const setup = state.setup;
  const unoccupied = TERRITORY_IDS.filter(
    (id) => state.territories[id].ownerId === undefined,
  );
  const validPlayer = (id: PlayerId | undefined) =>
    id !== undefined && playerIds.has(id);
  const allOwnedWithArmy = TERRITORY_IDS.every((id) => {
    const territory = state.territories[id];
    return territory.ownerId !== undefined && territory.armies >= 1;
  });
  const orderedFrom = (startingPlayerId: PlayerId | undefined) => {
    const seats = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
    const start = seats.findIndex(({ id }) => id === startingPlayerId);
    return start < 0
      ? seats
      : [...seats.slice(start), ...seats.slice(0, start)];
  };
  const territoryCount = (playerId: PlayerId) =>
    TERRITORY_IDS.filter((id) => state.territories[id].ownerId === playerId)
      .length;
  const armyCount = (playerId: PlayerId) =>
    TERRITORY_IDS.reduce(
      (total, id) =>
        total +
        (state.territories[id].ownerId === playerId
          ? state.territories[id].armies
          : 0),
      0,
    );

  if (setup.kind === 'automatic_assignment_2_to_3') {
    if (state.configuredPlayerCount > 3)
      errors.push('small-player setup used for 4-6 players');
    const allocationEntries = Object.entries(
      setup.additionalArmiesRemainingByPlayer,
    );
    if (allocationEntries.some(([id]) => !playerIds.has(id as PlayerId)))
      errors.push('invalid additional-army player');
    if (!validPlayer(setup.startingPlayerId))
      errors.push('small-player setup requires a valid starting player');
    if (!validPlayer(setup.currentPlayerId))
      errors.push('small-player setup requires a valid current player');
    const stableOrder = [...state.players].sort(
      (a, b) => a.seatIndex - b.seatIndex,
    );
    for (const [index, player] of stableOrder.entries()) {
      const expectedTerritories =
        Math.floor(TERRITORY_IDS.length / stableOrder.length) +
        (index < TERRITORY_IDS.length % stableOrder.length ? 1 : 0);
      if (territoryCount(player.id) !== expectedTerritories)
        errors.push(`invalid automatic territory assignment for ${player.id}`);
    }
    const expected = state.configuredPlayerCount === 2 ? 12 : 8;
    if (unoccupied.length !== 0 || !allOwnedWithArmy)
      errors.push('additional-army setup requires every territory occupied');
    if (
      allocationEntries.length !== state.players.length ||
      state.players.some((player) => {
        const amount = setup.additionalArmiesRemainingByPlayer[player.id];
        return amount !== 0 && amount !== expected;
      }) ||
      setup.additionalArmiesRemainingByPlayer[setup.currentPlayerId] !==
        expected
    )
      errors.push('invalid remaining additional-army allocation');
    const order = orderedFrom(setup.startingPlayerId);
    const currentIndex = order.findIndex(
      ({ id }) => id === setup.currentPlayerId,
    );
    for (const [index, player] of order.entries()) {
      const expectedRemaining = index < currentIndex ? 0 : expected;
      const expectedArmies =
        territoryCount(player.id) + (index < currentIndex ? expected : 0);
      if (
        setup.additionalArmiesRemainingByPlayer[player.id] !==
          expectedRemaining ||
        armyCount(player.id) !== expectedArmies
      )
        errors.push(
          `additional-army progression is impossible for ${player.id}`,
        );
    }
    return;
  }

  if (state.configuredPlayerCount < 4)
    errors.push('large-player setup used for 2-3 players');
  const expectedLeftovers = state.configuredPlayerCount === 5 ? 0 : 2;
  if (
    new Set(setup.leftoverCardIds).size !== setup.leftoverCardIds.length ||
    setup.leftoverCardIds.length !== expectedLeftovers
  )
    errors.push('invalid leftover territory-card metadata');
  if (setup.stage === 'territory_deal') {
    if (
      setup.startingPlayerId !== undefined ||
      setup.currentPlayerId !== undefined ||
      setup.armiesRemainingInActivation !== 0 ||
      unoccupied.length !== TERRITORY_IDS.length
    )
      errors.push('stale metadata during territory deal');
    return;
  }
  if (setup.stage === 'leftover_awards') {
    if (
      expectedLeftovers !== 2 ||
      setup.startingPlayerId !== undefined ||
      setup.currentPlayerId !== undefined ||
      setup.armiesRemainingInActivation !== 0 ||
      unoccupied.length !== 2 ||
      setup.leftoverCardIds.some(
        (id) => state.territories[id].ownerId !== undefined,
      ) ||
      TERRITORY_IDS.some((id) =>
        setup.leftoverCardIds.includes(id)
          ? state.territories[id].armies !== 0
          : state.territories[id].ownerId === undefined ||
            state.territories[id].armies !== 1,
      )
    )
      errors.push('invalid leftover-award setup metadata');
    return;
  }
  if (setup.stage === 'starting_order') {
    if (
      !allOwnedWithArmy ||
      setup.currentPlayerId !== undefined ||
      setup.armiesRemainingInActivation !== 0
    )
      errors.push('invalid starting-order setup metadata');
    return;
  }
  if (
    !allOwnedWithArmy ||
    !validPlayer(setup.startingPlayerId) ||
    !validPlayer(setup.currentPlayerId) ||
    setup.armiesRemainingInActivation < 1 ||
    setup.armiesRemainingInActivation >
      setupArmies(state.mode, setup.reinforcementRound)
  )
    errors.push('invalid setup reinforcement activation');
  const baseTerritories = Math.floor(50 / state.configuredPlayerCount);
  const ownershipCounts = state.players.map((player) =>
    territoryCount(player.id),
  );
  if (
    state.configuredPlayerCount === 5
      ? ownershipCounts.some((count) => count !== 10)
      : ownershipCounts.filter((count) => count === baseTerritories + 1)
          .length !== 2 ||
        ownershipCounts.some(
          (count) => count !== baseTerritories && count !== baseTerritories + 1,
        )
  )
    errors.push('invalid initial territory ownership distribution');
  if (
    Object.keys(setup.additionalArmiesByPlayerContinent).some(
      (id) => !state.players.some((p) => p.id === id),
    )
  )
    errors.push('initial allocation references unknown player');
  const order = orderedFrom(setup.startingPlayerId);
  const currentIndex = order.findIndex(
    ({ id }) => id === setup.currentPlayerId,
  );
  for (const [index, player] of order.entries()) {
    const completedExtra =
      (setup.reinforcementRound === 1 ? 0 : setupArmies(state.mode, 1)) +
      (index < currentIndex
        ? setupArmies(state.mode, setup.reinforcementRound)
        : index === currentIndex
          ? setupArmies(state.mode, setup.reinforcementRound) -
            setup.armiesRemainingInActivation
          : 0);
    const counts = setup.additionalArmiesByPlayerContinent[player.id] ?? {};
    for (const continent of CONTINENT_IDS) {
      const actual = TERRITORY_IDS.filter(
        (id) =>
          state.territories[id].ownerId === player.id &&
          TERRITORIES[id].continentId === continent,
      ).reduce((sum, id) => sum + state.territories[id].armies - 1, 0);
      if (
        (counts[continent] ?? 0) !== actual ||
        (state.mode === 'competitive' && actual > 4)
      )
        errors.push('invalid initial continent allocation');
    }
    if (
      state.mode === 'competitive' &&
      new Set(
        TERRITORY_IDS.filter(
          (id) => state.territories[id].ownerId === player.id,
        ).map((id) => TERRITORIES[id].continentId),
      ).size < 2
    )
      errors.push('competitive deal requires two continents');
    if (
      !player.disqualified &&
      armyCount(player.id) !== territoryCount(player.id) + completedExtra
    )
      errors.push(`reinforcement progression is impossible for ${player.id}`);
  }
}

function validateTerms(
  terms: ActivePact['terms'],
  players: ReadonlySet<PlayerId>,
  errors: string[],
  label: string,
) {
  if (terms.kind === 'border_non_aggression') {
    const [a, b] = terms.territoryIds;
    if (a === b || !TERRITORIES[a]?.adjacentTerritoryIds.includes(b))
      errors.push(`invalid border terms for ${label}`);
  }
  if (
    terms.kind === 'international_zone' &&
    (!(terms.territoryId in TERRITORIES) ||
      !players.has(terms.firstExpectedConquerorId))
  )
    errors.push(`invalid international-zone terms for ${label}`);
}

function validatePact(
  state: Exclude<GameState, { readonly status: 'LOBBY' }>,
  pact: ActivePact,
  players: ReadonlySet<PlayerId>,
  errors: string[],
) {
  if (pact.kind !== pact.terms.kind)
    errors.push(`mismatched pact discriminants for pact ${pact.id}`);
  if (
    pact.parties[0] === pact.parties[1] ||
    pact.parties.some((id) => !players.has(id))
  )
    errors.push(`invalid parties for pact ${pact.id}`);
  validateTerms(pact.terms, players, errors, `pact ${pact.id}`);
  if (
    pact.kind === 'border_non_aggression' &&
    pact.terms.kind === 'border_non_aggression'
  ) {
    const owners = pact.terms.territoryIds.map(
      (territoryId) => state.territories[territoryId]?.ownerId,
    );
    if (
      owners.some((owner) => !owner || !pact.parties.includes(owner)) ||
      new Set(owners).size !== 2
    )
      errors.push(`invalid active border ownership for pact ${pact.id}`);
  }
  if (pact.kind === 'international_zone') {
    const zone = state.territories[pact.terms.territoryId];
    const isPendingConquest =
      state.status === 'ACTIVE' &&
      state.pendingAction?.kind === 'conquest_transfer' &&
      state.pendingAction.conqueredTerritoryId === pact.terms.territoryId;
    const holder = zone?.ownerId;
    const expectedOther = pact.parties.find((id) => id !== holder);
    const eachPartyAdjacent = pact.parties.every((partyId) =>
      TERRITORIES[pact.terms.territoryId]?.adjacentTerritoryIds.some(
        (territoryId) => state.territories[territoryId].ownerId === partyId,
      ),
    );
    if (
      !zone ||
      zone.armies !== (isPendingConquest ? 0 : 1) ||
      !holder ||
      !pact.parties.includes(holder) ||
      pact.terms.firstExpectedConquerorId !== pact.parties[1] ||
      pact.expectedConquerorId !== expectedOther ||
      !eachPartyAdjacent
    )
      errors.push(`invalid expected conqueror for pact ${pact.id}`);
  }
  if (pact.withdrawal.kind === 'announced') {
    const withdrawal = pact.withdrawal;
    if (
      !pact.parties.includes(withdrawal.withdrawingPlayerId) ||
      withdrawal.waitingForPlayerIds.includes(withdrawal.withdrawingPlayerId) ||
      new Set(withdrawal.waitingForPlayerIds).size !==
        withdrawal.waitingForPlayerIds.length ||
      withdrawal.waitingForPlayerIds.some((id) => !players.has(id))
    )
      errors.push(`invalid withdrawal for pact ${pact.id}`);
  }
}

export function assertClassicInvariants(state: GameState): void {
  const violations = classicInvariantViolations(state);
  if (violations.length)
    throw new Error(`Classic invariant violation:\n${violations.join('\n')}`);
}
