import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createClassicSetup,
  applyCommand,
  applyBotCommand,
  chooseBotCommand,
  competitiveActor,
  assertClassicInvariants,
  BOT_LEVELS,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORIES,
  TERRITORY_CARDS,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
} from '../packages/game-engine/dist/index.js';

const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Clásico ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
/** A small seeded random source, so every run plays the same games. */
function seeded(seed) {
  let x = seed >>> 0;
  const next = () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
  return {
    rollDie: () => 1 + Math.floor(next() * 6),
    shuffle: (items) => {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  };
}
const classic = (count, random, express = false) => {
  const s = createClassicSetup(randomUUID(), players(count), random, 'classic');
  return express ? startCompetitiveClock({ ...s, classicExpress: true }, 0) : s;
};
/** Applies the bot's move for whoever must act, failing on illegal moves. */
function botMove(s, level, random) {
  const actor = competitiveActor(s);
  const command = actor ? chooseBotCommand(s, actor, level, random) : undefined;
  if (!command) return undefined;
  const result = applyBotCommand(s, command, { dice: random, shuffle: random });
  assert.equal(
    result.ok,
    true,
    `${level} ${command.type}: ${JSON.stringify(result.error)}`,
  );
  return result.state;
}

void test('bots place the setup armies of every Classic table size', () => {
  for (const count of [2, 3, 4, 5, 6])
    for (const level of BOT_LEVELS) {
      const random = seeded(count * 10 + BOT_LEVELS.indexOf(level));
      let s = classic(count, random);
      for (let i = 0; i < 50 && s.status === 'SETUP'; i++) {
        const next = botMove(s, level, random);
        assert.ok(next, `${count} ${level}: no setup move`);
        s = next;
      }
      assert.equal(s.status, 'ACTIVE', `${count} players, ${level}`);
      assertClassicInvariants(s);
    }
});

void test('without a clock, Classic bots always have a legal move', () => {
  for (const count of [2, 3, 4, 6])
    for (const level of BOT_LEVELS) {
      const random = seeded(100 + count * 10 + BOT_LEVELS.indexOf(level));
      let s = classic(count, random);
      for (let i = 0; i < 3000 && s.status !== 'FINISHED'; i++) {
        const next = botMove(s, level, random);
        assert.ok(next, `${count} ${level}: stuck in ${s.turn?.phase}`);
        s = next;
      }
      assertClassicInvariants(s);
      assert.notEqual(s.status, 'SETUP');
    }
});

void test('Express games played only by bots end on time or by victory', () => {
  for (const count of [2, 4, 6]) {
    const level = BOT_LEVELS[count % 3];
    const random = seeded(200 + count);
    let s = classic(count, random, true);
    let now = 0;
    while (s.status !== 'FINISHED' && now < 6 * 60 * 60_000) {
      now += 1000;
      s = tickCompetitiveClock(s, now, true, random);
      if (s.status === 'FINISHED') break;
      const next = botMove(s, level, random);
      if (next) s = synchronizeCompetitiveClock(s, next, now);
    }
    assert.equal(s.status, 'FINISHED', `${count} players`);
    assert.equal(s.result.scoringEligible, undefined);
    assertClassicInvariants(s);
  }
});

/** Plays bot moves until the given player's hostility pass begins. */
function untilHostility(count, seed) {
  const random = seeded(seed);
  let s = classic(count, random);
  while (s.status === 'SETUP') s = botMove(s, 'normal', random);
  while (s.turn.round.kind !== 'normal' || s.turn.round.pass !== 'hostility')
    s = botMove(s, 'normal', random);
  return s;
}

void test('bots never attack a partner of a pact in force', () => {
  let s = untilHostility(3, 300);
  const a = s.turn.playerId;
  const [b, c] = s.players.filter((p) => p.id !== a).map((p) => p.id);
  const proposalId = randomUUID();
  for (const command of [
    {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId,
      terms: { kind: 'general_non_aggression' },
    },
    { type: 'accept_pact', playerId: b, proposalId, pactId: randomUUID() },
  ]) {
    const result = applyCommand(s, command);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    s = result.state;
  }
  // The partner is weak all around; only Egypt belongs to someone else.
  const board = {
    ...s,
    turn: { ...s.turn, phase: 'attack' },
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id) => [
        id,
        id === 'sahara'
          ? { ownerId: a, armies: 9, fixedArmiesThisTurn: 0 }
          : id === 'egypt'
            ? { ownerId: c, armies: 2, fixedArmiesThisTurn: 0 }
            : { ownerId: b, armies: 1, fixedArmiesThisTurn: 0 },
      ]),
    ),
  };
  for (const level of BOT_LEVELS) {
    const move = chooseBotCommand(board, a, level, {
      shuffle: (items) => [...items],
    });
    if (move.type === 'attack') assert.equal(move.to, 'egypt', level);
    assert.notEqual(board.territories[move.to]?.ownerId, b, level);
  }
  assert.ok(TERRITORIES.sahara.adjacentTerritoryIds.includes('egypt'));
});

void test('with more than five cards a Classic bot trades before placing', () => {
  const s = untilHostility(4, 400);
  // Back to the same player's incorporation with six cards in hand.
  const a = s.turn.playerId;
  const cards = [
    ...Object.values(TERRITORY_CARDS)
      .filter((c) => c.symbol === 'balloon')
      .slice(0, 3),
    ...Object.values(TERRITORY_CARDS)
      .filter((c) => c.symbol === 'galleon')
      .slice(0, 3),
  ].map((c) => ({ cardId: c.id, territoryBonusClaimed: false }));
  const held = {
    ...s,
    players: s.players.map((p) => (p.id === a ? { ...p, cards } : p)),
    turn: {
      ...s.turn,
      phase: 'ordinary_exchange',
      reinforcementArmiesRemaining: 5,
    },
  };
  for (const level of BOT_LEVELS)
    assert.equal(chooseBotCommand(held, a, level).type, 'exchange_cards');
});
