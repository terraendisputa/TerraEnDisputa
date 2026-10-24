import assert from 'node:assert/strict';
import {
  PLAYER_COLORS,
  TERRITORY_IDS,
  CLASSIC_GAME_DEFINITION,
  resolveGameRuntime,
} from '../packages/game-engine/dist/index.js';

export const gameId = '10000000-0000-4000-8000-000000000001';
export const id = (n) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function players(count = 4) {
  return Array.from({ length: count }, (_, seatIndex) => ({
    id: id(seatIndex + 1),
    seatIndex,
    nickname: `Jugador ${seatIndex + 1}`,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
}
export function random(sequence = [6, 5, 4, 3, 6, 1, 2, 3]) {
  let cursor = 0;
  return {
    rollDie: () => {
      assert.ok(
        cursor < sequence.length,
        'El escenario agotó su secuencia de dados',
      );
      return sequence[cursor++];
    },
    shuffle: (values) => [...values],
    get calls() {
      return cursor;
    },
  };
}
export function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
}
export function reject(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}
export function setup(count = 4, rng) {
  return resolveGameRuntime(CLASSIC_GAME_DEFINITION).createSetup(
    gameId,
    players(count),
    rng ??
      random(
        count === 6
          ? [6, 5, 4, 3, 2, 1, 6, 1, 2, 3, 4, 5]
          : count === 5
            ? [6, 1, 2, 3, 4]
            : count === 3
              ? [6, 1, 2]
              : count === 2
                ? [6, 1]
                : undefined,
      ),
  );
}
export function prepared(count = 4) {
  let state = setup(count);
  while (state.status === 'SETUP') {
    const actor = state.setup.currentPlayerId;
    const territory = TERRITORY_IDS.find(
      (t) => state.territories[t].ownerId === actor,
    );
    const amount =
      state.setup.kind === 'automatic_assignment_2_to_3'
        ? state.setup.additionalArmiesRemainingByPlayer[actor]
        : state.setup.armiesRemainingInActivation;
    state = success(
      resolveGameRuntime(state.definition).applySetupCommand(state, {
        type: 'place_setup_armies',
        playerId: actor,
        placements: { [territory]: amount },
      }),
    );
  }
  return state;
}
export function step(state, command, rng = random()) {
  return success(
    resolveGameRuntime(state.definition).applyCommand(
      state,
      {
        playerId: state.turn.playerId,
        ...command,
      },
      { dice: rng, shuffle: rng },
    ),
  );
}
export function skipHostility(state) {
  for (const type of ['advance_phase', 'advance_phase', 'end_turn'])
    state = step(state, { type });
  return state;
}
export function normalRound() {
  let state = prepared();
  for (let i = 0; i < 4; i++) state = skipHostility(state);
  return state;
}
export function withCards(
  state,
  playerId,
  cardIds,
  completedExchangeCount = 0,
) {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            completedExchangeCount,
            cards: cardIds.map((cardId) => ({
              cardId,
              territoryBonusClaimed: false,
            })),
          }
        : p,
    ),
    cardDeck: {
      drawPile: state.cardDeck.drawPile.filter((t) => !cardIds.includes(t)),
      discardPile: state.cardDeck.discardPile.filter(
        (t) => !cardIds.includes(t),
      ),
    },
  };
}
export function boardPatch(state, patch) {
  return {
    ...state,
    territories: {
      ...state.territories,
      ...Object.fromEntries(
        Object.entries(patch).map(([t, value]) => [
          t,
          {
            ...state.territories[t],
            ...value,
          },
        ]),
      ),
    },
  };
}
