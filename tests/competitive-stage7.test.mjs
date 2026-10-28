import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createClassicSetup,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORY_CARDS,
  startCompetitiveClock,
  tickCompetitiveClock,
  chooseBotCommand,
  conquestChance,
} from '../packages/game-engine/dist/index.js';

const rng = { shuffle: (items) => [...items].reverse() };
const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Objetivo ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
function fixture() {
  let roll = 0,
    now = 1_000_000;
  let s = startCompetitiveClock(
    createClassicSetup(
      randomUUID(),
      players(5),
      { shuffle: (items) => [...items], rollDie: () => (roll++ % 6) + 1 },
      'competitive',
    ),
    now,
  );
  while (s.status === 'SETUP') {
    now += s.competitiveClock.activationRemainingMs;
    s = tickCompetitiveClock(s, now, true, rng);
  }
  while (s.turn.round.kind !== 'normal')
    s = tickCompetitiveClock(
      s,
      s.competitiveClock.updatedAtMs + s.competitiveClock.activationRemainingMs,
      true,
      rng,
    );
  const a = s.turn.playerId;
  const [b, c] = s.players.filter((p) => p.id !== a);
  return { s, a, b, c };
}
/**
 * A board where the bot owns the given countries and one rival owns the rest
 * with three armies each, unless `rivals` says otherwise.
 */
function board(f, own, rivals = {}, me = {}) {
  const { s, a, b } = f;
  return {
    ...s,
    turn: { ...s.turn, phase: 'attack', cardClaimEligible: true },
    players: s.players.map((p) => (p.id === a ? { ...p, ...me } : p)),
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id) => [
        id,
        id in own
          ? { ownerId: a, armies: own[id], fixedArmiesThisTurn: 0 }
          : {
              ownerId: rivals[id]?.ownerId ?? b.id,
              armies: rivals[id]?.armies ?? 3,
              fixedArmiesThisTurn: 0,
            },
      ]),
    ),
  };
}

void test('dice odds follow the real rules', () => {
  assert.equal(conquestChance(2, 1), 15 / 36);
  assert.equal(conquestChance(1, 1), 0);
  assert.equal(conquestChance(5, 0), 1);
  assert.ok(conquestChance(6, 3) > 0.5 && conquestChance(6, 3) < 0.65);
  assert.ok(conquestChance(10, 2) > conquestChance(4, 2));
});

void test('hard attacks what its secret mission needs', () => {
  const f = fixture();
  // Sahara borders Brazil, Egypt and Spain; only Africa counts for mission 9.
  const s = board(
    f,
    { sahara: 6, alaska: 1 },
    {},
    {
      secretObjectiveId: 'occupation_09',
    },
  );
  delete s.players.find((p) => p.id === f.a).effectiveDestructionTargetPlayerId;
  const move = chooseBotCommand(s, f.a, 'hard');
  assert.equal(move.type, 'attack');
  assert.equal(move.from, 'sahara');
  assert.ok(['egypt', 'zaire', 'ethiopia'].includes(move.to));
});

void test('hard goes after the color it must destroy', () => {
  const f = fixture();
  const s = board(
    f,
    { sahara: 6, alaska: 1 },
    { spain: { ownerId: f.c.id, armies: 3 } },
    {
      secretObjectiveId: `destroy_${f.c.color}`,
      effectiveDestructionTargetPlayerId: f.c.id,
    },
  );
  assert.deepEqual(chooseBotCommand(s, f.a, 'hard'), {
    type: 'attack',
    playerId: f.a,
    from: 'sahara',
    to: 'spain',
  });
});

void test('hard plays for the 30 countries once they are closer than the mission', () => {
  const f = fixture();
  const own = Object.fromEntries(
    TERRITORY_IDS.filter((id) => id !== 'egypt')
      .slice(0, 28)
      .map((id) => [id, 6]),
  );
  const s = board(f, own, {}, { secretObjectiveId: 'occupation_03' });
  const move = chooseBotCommand(s, f.a, 'hard');
  assert.equal(move.type, 'attack');
});

void test('in the last two rounds hard only takes safe countries', () => {
  const f = fixture();
  const base = board(
    f,
    { sahara: 6, alaska: 1 },
    {},
    {
      secretObjectiveId: 'occupation_09',
    },
  );
  const final = {
    ...base,
    competitiveClock: {
      ...base.competitiveClock,
      finalRoundNumber: base.turn.round.roundNumber,
    },
  };
  assert.equal(chooseBotCommand(base, f.a, 'hard').type, 'attack');
  assert.notEqual(chooseBotCommand(final, f.a, 'hard').type, 'attack');
  const safe = { ...final, territories: { ...final.territories } };
  safe.territories.egypt = { ...safe.territories.egypt, armies: 1 };
  assert.equal(chooseBotCommand(safe, f.a, 'hard').to, 'egypt');
});

void test('hard keeps its cards until it needs them; normal trades at once', () => {
  const f = fixture();
  const balloons = Object.values(TERRITORY_CARDS)
    .filter((card) => card.symbol === 'balloon')
    .map((card) => ({ cardId: card.id, territoryBonusClaimed: false }));
  const hand = (cards) => {
    const s = board(f, { sahara: 6, alaska: 1 }, {}, { cards });
    return {
      ...s,
      turn: {
        ...s.turn,
        phase: 'ordinary_exchange',
        reinforcementArmiesRemaining: 3,
      },
    };
  };
  assert.equal(
    chooseBotCommand(hand(balloons.slice(0, 3)), f.a, 'hard').type,
    'place_reinforcements',
  );
  assert.equal(
    chooseBotCommand(hand(balloons.slice(0, 3)), f.a, 'normal').type,
    'exchange_cards',
  );
  assert.equal(
    chooseBotCommand(hand(balloons.slice(0, 4)), f.a, 'hard').type,
    'exchange_cards',
  );
});

void test('hard guards the entry to a continent it holds', () => {
  const f = fixture();
  const s = board(
    f,
    { borneo: 1, sumatra: 1, java: 1, australia: 1 },
    { chile: { ownerId: f.b.id, armies: 8 } },
  );
  const move = chooseBotCommand(
    {
      ...s,
      turn: {
        ...s.turn,
        phase: 'ordinary_exchange',
        reinforcementArmiesRemaining: 6,
      },
    },
    f.a,
    'hard',
  );
  assert.equal(move.type, 'place_reinforcements');
  assert.ok((move.placements.australia ?? 0) >= 3);
  assert.equal(
    Object.values(move.placements).reduce((sum, n) => sum + n, 0),
    6,
  );
});

void test('easy picks among reasonable attacks at random', () => {
  const f = fixture();
  const s = board(f, { sahara: 8, alaska: 1 });
  const first = { shuffle: (items) => [...items] };
  const last = { shuffle: (items) => [...items].reverse() };
  const a = chooseBotCommand(s, f.a, 'easy', first);
  const b = chooseBotCommand(s, f.a, 'easy', last);
  assert.equal(a.type, 'attack');
  // With the reversed order, easy stops attacking this time.
  assert.notEqual(b.type, 'attack');
  const c = chooseBotCommand(s, f.a, 'easy', {
    shuffle: (items) =>
      typeof items[0] === 'boolean' ? items : [...items].reverse(),
  });
  assert.equal(c.type, 'attack');
  assert.notEqual(c.to, a.to);
});
