import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createClassicSetup,
  applyCommand,
  assertClassicInvariants,
  deriveLegalActions,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORIES,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  competitiveActor,
  chooseBotCommand,
  applyBotCommand,
  assignCompetitiveBot,
  BOT_LEVELS,
  TECHNICAL_WAIT_MS,
} from '../packages/game-engine/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  configureBotsBodySchema,
} from '../packages/protocol/dist/index.js';

function seeded(seed) {
  const next = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
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
const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Bot test ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
const rng = { shuffle: (items) => [...items].reverse() };
function fixture(count = 5) {
  let roll = 0,
    now = 1_000_000;
  let s = startCompetitiveClock(
    createClassicSetup(
      randomUUID(),
      players(count),
      { shuffle: (items) => [...items], rollDie: () => (roll++ % 6) + 1 },
      'competitive',
    ),
    now,
  );
  while (s.status === 'SETUP') {
    now += s.competitiveClock.activationRemainingMs;
    s = tickCompetitiveClock(s, now, true, rng);
  }
  return { s, now, a: s.turn.playerId };
}
function auth(list) {
  return {
    ...emptyGameAuthState(),
    players: Object.fromEntries(
      list.map((p) => [
        p.id,
        {
          playerId: p.id,
          session: {
            verifier: { algorithm: 'sha256', digest: 'a'.repeat(64) },
            transportClass: 'HTTP',
            expiresAt: '2099-01-01T00:00:00.000Z',
            lastActiveAt: '2026-10-13T00:00:00.000Z',
          },
        },
      ]),
    ),
  };
}
const durable = (s) => ({
  state: s,
  revision: 0,
  recentCommands: [],
  auth: auth(s.players),
});
const enemies = (s, pid, id) =>
  TERRITORIES[id].adjacentTerritoryIds.filter(
    (t) => s.territories[t].ownerId !== pid,
  );

void test('games played only by bots never get stuck', () => {
  for (const count of [4, 5, 6])
    for (const level of BOT_LEVELS) {
      const random = seeded(count * 7 + level.length);
      let s = createClassicSetup(
        randomUUID(),
        players(count),
        random,
        'competitive',
      );
      let moves = 0;
      while (s.status !== 'FINISHED' && moves < 40_000) {
        const command = chooseBotCommand(s, competitiveActor(s), level);
        assert.ok(command, `${count}/${level}: no move in ${s.turn?.phase}`);
        assert.notEqual(command.type, 'propose_pact');
        const result = applyBotCommand(s, command, {
          dice: random,
          shuffle: random,
        });
        assert.equal(result.ok, true, JSON.stringify(result.error));
        s = result.state;
        moves++;
      }
      // Easy bots can trade countries for hours; the match clock ends those.
      if (level === 'easy')
        assert.ok(s.status === 'FINISHED' || s.turn.round.roundNumber > 50);
      else
        assert.equal(s.status, 'FINISHED', `${count}/${level} did not finish`);
      assertClassicInvariants(s);
    }
});

void test('normal reinforces an exposed border and attacks only with a clear advantage', () => {
  let { s, a } = fixture();
  while (s.turn.round.kind !== 'normal' || s.turn.playerId !== a)
    s = tickCompetitiveClock(
      s,
      s.competitiveClock.updatedAtMs + s.competitiveClock.activationRemainingMs,
      true,
      rng,
    );
  const place = chooseBotCommand(s, a, 'normal');
  assert.equal(place.type, 'place_reinforcements');
  const [target] = Object.keys(place.placements);
  assert.ok(enemies(s, a, target).length > 0);
  // Normal needs at least two armies more than the defender.
  s = { ...s, turn: { ...s.turn, phase: 'attack' } };
  const [from, to] = TERRITORY_IDS.flatMap((id) =>
    s.territories[id].ownerId === a
      ? enemies(s, a, id).map((t) => [id, t])
      : [],
  )[0];
  const board = (attacker, defender) => ({
    ...s,
    territories: {
      ...s.territories,
      [from]: { ...s.territories[from], armies: attacker },
      ...Object.fromEntries(
        TERRITORY_IDS.filter((t) => s.territories[t].ownerId !== a).map((t) => [
          t,
          { ...s.territories[t], armies: t === to ? defender : 9 },
        ]),
      ),
    },
  });
  const hold = chooseBotCommand(board(4, 3), a, 'normal');
  assert.notEqual(hold.type, 'attack');
  assert.deepEqual(chooseBotCommand(board(5, 3), a, 'normal'), {
    type: 'attack',
    playerId: a,
    from,
    to,
  });
  assert.equal(chooseBotCommand(board(4, 3), a, 'easy').type, 'attack');
  assert.equal(chooseBotCommand(s, s.players[1].id, 'normal'), undefined);
});

void test('a disconnected player is replaced by a bot after seven minutes and takes the seat back', () => {
  let { s, now, a } = fixture();
  s = tickCompetitiveClock(s, now, false, rng);
  s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
  s = tickCompetitiveClock(s, (now += 120_000), false, rng);
  const seat = s.players.find((p) => p.id === a);
  assert.equal(seat.bot, 'absent');
  assert.equal(seat.absent, undefined);
  assertClassicInvariants(s);
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: projectGameFor(s, 1, s.players[1].id),
  });
  assert.equal(
    decodeGame(encodeGame(durable(s))).game.state.players.find(
      (p) => p.id === a,
    ).bot,
    'absent',
  );
  // The bot's turns get no disconnection wait.
  for (let i = 0; i < 20 && s.turn.playerId !== a; i++)
    s = tickCompetitiveClock(
      s,
      (now =
        s.competitiveClock.updatedAtMs +
        s.competitiveClock.activationRemainingMs),
      true,
      rng,
    );
  s = tickCompetitiveClock(s, ++now, false, rng);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  assert.equal(s.turn.playerId, a);
  // Back online on their turn, they play again.
  s = tickCompetitiveClock(s, now + 1, true, rng);
  assert.equal(s.players.find((p) => p.id === a).bot, undefined);
  assert.equal(deriveLegalActions(s, a).readOnly, false);
});

void test('with bots off, absent turns still pass on their own', () => {
  let { s, now, a } = fixture();
  s = { ...s, competitiveBotsReplaceAbsent: false };
  s = tickCompetitiveClock(s, now, false, rng);
  s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
  s = tickCompetitiveClock(s, now + 120_000, false, rng);
  const seat = s.players.find((p) => p.id === a);
  assert.equal(seat.absent, true);
  assert.equal(seat.bot, undefined);
});

void test('the administrator puts a bot in a seat and gives it back; pacts end', () => {
  let { s, now, a } = fixture();
  const [from, to] = TERRITORY_IDS.flatMap((id) =>
    s.territories[id].ownerId === a
      ? enemies(s, a, id).map((t) => [id, t])
      : [],
  )[0];
  const b = s.territories[to].ownerId;
  const proposalId = randomUUID();
  for (const command of [
    {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId,
      terms: { kind: 'border_non_aggression', territoryIds: [from, to] },
    },
    { type: 'accept_pact', playerId: b, proposalId, pactId: randomUUID() },
  ])
    s = synchronizeCompetitiveClock(s, applyCommand(s, command).state, now);
  assert.equal(s.pacts.active.length, 1);
  s = tickCompetitiveClock(s, ++now, false, rng);
  assert.equal(s.competitiveClock.pauseReason, 'disconnection');
  s = assignCompetitiveBot(s, a, true);
  assert.equal(s.players.find((p) => p.id === a).bot, 'admin');
  assert.equal(s.pacts.active.length, 0);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  // Nobody can offer a pact to a bot.
  assert.ok(deriveLegalActions(s, b).pactRecipientIds.every((id) => id !== a));
  // Reconnecting does not undo the administrator's choice.
  s = tickCompetitiveClock(s, now + 1, true, rng);
  assert.equal(s.players.find((p) => p.id === a).bot, 'admin');
  s = assignCompetitiveBot(s, a, false);
  assert.equal(s.players.find((p) => p.id === a).bot, undefined);
  assertClassicInvariants(s);
  const classic = createClassicSetup(
    randomUUID(),
    players(4),
    seeded(3),
    'classic',
  );
  assert.throws(() =>
    assignCompetitiveBot(classic, classic.players[0].id, true),
  );
});

void test('the server plays one bot move per tick and refuses commands from that seat', async () => {
  let { s, now, a } = fixture();
  s = assignCompetitiveBot(s, a, true);
  let record = durable(s),
    timestamp = now;
  const store = {
    loadGame: () => Promise.resolve(record),
    commitGame: (candidate) => {
      record = candidate;
      return Promise.resolve({ outcome: 'COMMITTED' });
    },
  };
  const service = new GameService(
    store,
    undefined,
    () => timestamp,
    () => false,
  );
  const refused = await service.process(s.id, a, {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: 0,
    command: { type: 'advance_phase' },
  });
  assert.equal(refused.code, 'BOT_CONTROLLED');
  for (let i = 0; i < 400 && record.state.turn.playerId === a; i++) {
    timestamp += 100;
    await service.tick(s.id);
  }
  assert.notEqual(record.state.turn.playerId, a);
  assert.ok(record.state.competitiveClock.elapsedMs < 120_000);
  assertClassicInvariants(record.state);
  await service.updateBots(s.id, { level: 'easy', replaceAbsent: false });
  assert.equal(record.state.competitiveBotLevel, 'easy');
  assert.equal(record.state.competitiveBotsReplaceAbsent, false);
  assert.equal(configureBotsBodySchema.safeParse({}).success, false);
  assert.equal(
    configureBotsBodySchema.safeParse({ level: 'expert' }).success,
    false,
  );
});
