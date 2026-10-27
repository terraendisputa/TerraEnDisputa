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
  deriveLegalActions,
  assignCompetitiveBot,
  COMPETITIVE_BOT_NAMES,
} from '../packages/game-engine/dist/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  updateGameConfigurationBodySchema,
} from '../packages/protocol/dist/index.js';

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
/**
 * Applies the bot's move for whoever must act, failing on illegal moves. A
 * pact offer is answered first, like the server does for every bot.
 */
function botMove(s, level, random) {
  const actor =
    (s.status === 'ACTIVE' && s.pacts.proposals[0]?.recipientId) ||
    competitiveActor(s);
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

/** A board for the bot on turn: the given countries, the rest to `rest`. */
function board(s, spec, rest, armies = 1) {
  return {
    ...s,
    turn: { ...s.turn, phase: 'attack' },
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id) => [
        id,
        {
          ownerId: spec[id]?.[0] ?? rest,
          armies: spec[id]?.[1] ?? armies,
          fixedArmiesThisTurn: 0,
        },
      ]),
    ),
  };
}
const seats = (s) => {
  const a = s.turn.playerId;
  const [b, c] = s.players.filter((p) => p.id !== a).map((p) => p.id);
  return { a, b, c };
};
const offer = (s, proposerId, recipientId, terms) => ({
  ...s,
  pacts: {
    ...s.pacts,
    proposals: [{ id: randomUUID(), proposerId, recipientId, terms }],
  },
});
const pact = (s, a, b, terms = { kind: 'general_non_aggression' }) => ({
  ...s,
  pacts: {
    ...s.pacts,
    active: [
      {
        kind: terms.kind,
        id: randomUUID(),
        parties: [a, b],
        terms,
        withdrawal: { kind: 'none' },
      },
    ],
  },
});
const general = { kind: 'general_non_aggression' };
const OCEANIA = ['australia', 'sumatra', 'borneo', 'java'];

void test('a bot accepts a stronger proposer and rejects a weaker one', () => {
  const s = untilHostility(3, 500);
  const { a, b, c } = seats(s);
  const strong = board(s, { sahara: [a, 3], brazil: [b, 30] }, c);
  const weak = board(s, { sahara: [a, 30], brazil: [b, 2] }, c);
  for (const level of ['normal', 'hard']) {
    assert.equal(
      chooseBotCommand(offer(strong, b, a, general), a, level).type,
      'accept_pact',
      level,
    );
    assert.equal(
      chooseBotCommand(offer(weak, b, a, general), a, level).type,
      'reject_pact',
      level,
    );
  }
});

void test('a bot accepts a pact that guards a continent it holds', () => {
  const s = untilHostility(3, 510);
  const { a, b, c } = seats(s);
  const spec = Object.fromEntries(OCEANIA.map((id) => [id, [a, 20]]));
  const held = board(s, { ...spec, chile: [b, 1] }, c);
  assert.equal(
    chooseBotCommand(offer(held, b, a, general), a, 'normal').type,
    'accept_pact',
  );
  // The same weak proposer without a continent at stake is turned down.
  const loose = board(s, { australia: [a, 20], chile: [b, 1] }, c);
  assert.equal(
    chooseBotCommand(offer(loose, b, a, general), a, 'normal').type,
    'reject_pact',
  );
});

void test('a bot never pacts with its target or over an international zone', () => {
  const s = untilHostility(3, 520);
  const { a, b, c } = seats(s);
  const strong = board(s, { sahara: [a, 3], brazil: [b, 30] }, c);
  const hunting = {
    ...strong,
    players: strong.players.map((p) =>
      p.id === a
        ? {
            ...p,
            secretObjectiveId: `destroy_${s.players.find((x) => x.id === b).color}`,
            effectiveDestructionTargetPlayerId: b,
          }
        : p,
    ),
  };
  assert.equal(
    chooseBotCommand(offer(hunting, b, a, general), a, 'hard').type,
    'reject_pact',
  );
  const zone = {
    kind: 'international_zone',
    territoryId: 'brazil',
    firstExpectedConquerorId: a,
  };
  assert.equal(
    chooseBotCommand(offer(strong, b, a, zone), a, 'hard').type,
    'reject_pact',
  );
});

void test('easy answers at random, and any bot answers out of turn', () => {
  const s = untilHostility(3, 530);
  const { a, b, c } = seats(s);
  const weak = offer(
    board(s, { sahara: [a, 30], brazil: [b, 2] }, c),
    b,
    a,
    general,
  );
  const first = { shuffle: (items) => [...items] };
  const last = { shuffle: (items) => [...items].reverse() };
  assert.equal(chooseBotCommand(weak, a, 'easy', first).type, 'accept_pact');
  assert.equal(chooseBotCommand(weak, a, 'easy', last).type, 'reject_pact');
  // The player on turn offers; the bot of another seat answers right away.
  const offered = offer(
    board(s, { sahara: [a, 9], egypt: [c, 2] }, b, 3),
    a,
    c,
    general,
  );
  const strong = {
    ...offered,
    players: offered.players.map((p) =>
      p.id === c
        ? {
            ...p,
            secretObjectiveId: undefined,
            effectiveDestructionTargetPlayerId: undefined,
          }
        : p,
    ),
  };
  const answer = chooseBotCommand(strong, c, 'hard');
  assert.equal(answer.type, 'accept_pact');
  const result = applyCommand(strong, answer);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.pacts.active.length, 1);
});

void test('hard breaks a pact that blocks its mission or binds it to a weak partner', () => {
  const s = untilHostility(3, 540);
  const { a, b, c } = seats(s);
  const mission = (state) => ({
    ...state,
    players: state.players.map((p) =>
      p.id === a
        ? {
            ...p,
            secretObjectiveId: 'occupation_09',
            effectiveDestructionTargetPlayerId: undefined,
          }
        : p,
    ),
  });
  // Africa is in the mission and the partner holds Egypt next to Sahara.
  const blocked = pact(
    mission(board(s, { sahara: [a, 6], egypt: [b, 2] }, b, 3)),
    a,
    b,
  );
  const move = chooseBotCommand(blocked, a, 'hard');
  assert.equal(move.type, 'withdraw_pact');
  const result = applyCommand(blocked, move);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.pacts.active[0].withdrawal.kind, 'announced');
  // Normal keeps its pacts.
  assert.notEqual(chooseBotCommand(blocked, a, 'normal').type, 'withdraw_pact');
  const weakPartner = pact(
    board(s, { sahara: [a, 20], brazil: [b, 2] }, c),
    a,
    b,
  );
  assert.equal(chooseBotCommand(weakPartner, a, 'hard').type, 'withdraw_pact');
  // A strong partner away from what it needs keeps the pact.
  const fine = pact(board(s, { sahara: [a, 4], brazil: [b, 9] }, b), a, b);
  assert.notEqual(chooseBotCommand(fine, a, 'hard').type, 'withdraw_pact');
});

void test('hard offers one border pact a turn to guard its continent', () => {
  const s = untilHostility(3, 550);
  const { a, b } = seats(s);
  const spec = Object.fromEntries(OCEANIA.map((id) => [id, [a, 2]]));
  let state = board(s, { ...spec, chile: [b, 5] }, b);
  state = {
    ...state,
    players: state.players.map((p) =>
      p.id === a
        ? {
            ...p,
            secretObjectiveId: undefined,
            effectiveDestructionTargetPlayerId: undefined,
          }
        : p,
    ),
  };
  const move = chooseBotCommand(state, a, 'hard');
  assert.equal(move.type, 'propose_pact');
  assert.equal(move.recipientId, b);
  assert.deepEqual([...move.terms.territoryIds].sort(), ['australia', 'chile']);
  assert.equal(
    chooseBotCommand(state, a, 'normal').type === 'propose_pact',
    false,
  );
  const random = seeded(1);
  const proposed = applyBotCommand(state, move, {
    dice: random,
    shuffle: random,
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed.error));
  const rejected = applyCommand(proposed.state, {
    type: 'reject_pact',
    playerId: b,
    proposalId: move.proposalId,
  });
  assert.equal(rejected.ok, true);
  assert.notEqual(
    chooseBotCommand(rejected.state, a, 'hard').type,
    'propose_pact',
  );
});

void test('a border offer is dropped once its countries change hands', () => {
  const s = untilHostility(3, 555);
  const { a, b, c } = seats(s);
  const spec = Object.fromEntries(OCEANIA.map((id) => [id, [a, 2]]));
  const terms = {
    kind: 'border_non_aggression',
    territoryIds: ['australia', 'chile'],
  };
  const waiting = offer(board(s, { ...spec, chile: [b, 5] }, c), a, b, terms);
  const kept = applyCommand(waiting, { type: 'advance_phase', playerId: a });
  assert.equal(kept.ok, true, JSON.stringify(kept.error));
  assert.equal(kept.state.pacts.proposals.length, 1);
  const lost = board(s, { ...spec, chile: [c, 5] }, c);
  const dropped = applyCommand(
    { ...lost, pacts: waiting.pacts },
    { type: 'advance_phase', playerId: a },
  );
  assert.equal(dropped.ok, true, JSON.stringify(dropped.error));
  assert.equal(dropped.state.pacts.proposals.length, 0);
});

void test('Classic Express lets pacts be broken in the final rounds', () => {
  const s = untilHostility(3, 560);
  const { a, b } = seats(s);
  const final = pact(
    { ...s, classicExpress: true, competitiveClock: { finalRoundNumber: 1 } },
    a,
    b,
  );
  assert.equal(deriveLegalActions(final, a).pactIdsToWithdraw.length, 1);
});

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
/** A GameService over one game kept in memory. */
function served(state, connected = () => true) {
  const game = {
    record: {
      state,
      revision: 0,
      recentCommands: [],
      auth: auth(state.players),
    },
    timestamp: 5_000_000,
  };
  const store = {
    loadGame: () => Promise.resolve(game.record),
    commitGame: (candidate) => {
      game.record = candidate;
      return Promise.resolve({ outcome: 'COMMITTED' });
    },
  };
  game.service = new GameService(
    store,
    undefined,
    () => game.timestamp,
    connected,
  );
  return game;
}

void test('without Express the administrator puts a bot that plays and keeps the pacts', async () => {
  let s = untilHostility(3, 600);
  const { a, b } = seats(s);
  const proposalId = randomUUID();
  for (const command of [
    {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId,
      terms: general,
    },
    { type: 'accept_pact', playerId: b, proposalId, pactId: randomUUID() },
  ])
    s = applyCommand(s, command).state;
  const game = served(s);
  await game.service.updateBots(s.id, { playerId: a, enabled: true });
  assert.equal(game.record.state.players.find((p) => p.id === a).bot, 'admin');
  assert.equal(game.record.state.pacts.active.length, 1);
  assert.equal(game.record.state.competitiveClock, undefined);
  const refused = await game.service.process(s.id, a, {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: game.record.revision,
    command: { type: 'advance_phase' },
  });
  assert.equal(refused.code, 'BOT_CONTROLLED');
  for (let i = 0; i < 300 && game.record.state.turn.playerId === a; i++) {
    game.timestamp += 1000;
    await game.service.tick(s.id);
  }
  assert.notEqual(game.record.state.turn.playerId, a);
  assertClassicInvariants(game.record.state);
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: projectGameFor(game.record.state, 1, b),
  });
  assert.equal(
    decodeGame(encodeGame(game.record)).game.state.players.find(
      (p) => p.id === a,
    ).bot,
    'admin',
  );
  // Others can offer it pacts, and the administrator gives the seat back.
  const botSeat = assignCompetitiveBot(s, a, true);
  assert.ok(
    deriveLegalActions(
      { ...botSeat, turn: { ...botSeat.turn, playerId: b } },
      b,
    ).pactRecipientIds.includes(a),
  );
  await game.service.updateBots(s.id, { playerId: a, enabled: false });
  assert.equal(
    game.record.state.players.find((p) => p.id === a).bot,
    undefined,
  );
  await assert.rejects(
    game.service.updateBots(s.id, { playerId: a, inactive: true }),
  );
});

void test('the server lets a bot answer a pact offered out of its turn', async () => {
  const s = untilHostility(3, 610);
  const { a, c } = seats(s);
  const withBot = assignCompetitiveBot(s, c, true);
  const proposalId = randomUUID();
  const offered = applyCommand(withBot, {
    type: 'propose_pact',
    playerId: a,
    recipientId: c,
    proposalId,
    terms: general,
  });
  assert.equal(offered.ok, true, JSON.stringify(offered.error));
  const game = served(offered.state);
  game.timestamp += 1000;
  await game.service.tick(s.id);
  assert.equal(game.record.state.pacts.proposals.length, 0);
  assert.equal(game.record.state.turn.playerId, a);
  assertClassicInvariants(game.record.state);
});

void test('in Express an absent player gets a bot that leaves when they return', async () => {
  const random = seeded(620);
  let s = classic(3, random, true);
  let now = 0;
  while (s.status === 'SETUP') {
    now += s.competitiveClock.activationRemainingMs;
    s = tickCompetitiveClock(s, now, true, random);
  }
  const a = s.turn.playerId;
  let online = false;
  const game = served(s, (_, id) => id !== a || online);
  game.timestamp = now;
  for (
    let i = 0;
    i < 100 && !game.record.state.players.find((p) => p.id === a).bot;
    i++
  ) {
    game.timestamp += 10_000;
    await game.service.tick(s.id);
  }
  assert.equal(game.record.state.players.find((p) => p.id === a).bot, 'absent');
  assertClassicInvariants(game.record.state);
  online = true;
  for (
    let i = 0;
    i < 2000 && game.record.state.players.find((p) => p.id === a).bot;
    i++
  ) {
    game.timestamp += 1000;
    await game.service.tick(s.id);
  }
  assert.equal(
    game.record.state.players.find((p) => p.id === a).bot,
    undefined,
  );
});

/** A lobby on disk, with these people seated and ready. */
async function lobby(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'classic-bots-'));
  const store = await FileGameStore.open(directory);
  const random = seeded(700);
  const lifecycle = new GameLifecycleService(
    store,
    new PerGameCoordinator(),
    random,
    randomUUID,
    () => 5_000,
  );
  const seat = async (id, count) => {
    const current = await store.loadGame(id);
    const seated = players(count);
    await store.commitGame(
      {
        ...current,
        state: {
          ...current.state,
          players: seated,
          readyPlayerIds: seated.map((p) => p.id),
        },
        auth: { ...auth(seated), generation: current.auth.generation + 1 },
        revision: current.revision + 1,
      },
      { authGeneration: current.auth.generation, revision: current.revision },
    );
    return seated;
  };
  try {
    await fn({ store, lifecycle, seat });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

void test('the lobby chooses how many bots join a Classic table', async () => {
  await lobby(async ({ store, lifecycle, seat }) => {
    const id = await lifecycle.create(4, 'classic');
    await lifecycle.configure(id, 3, undefined, 2);
    // Other options keep the bots; zero takes them off.
    await lifecycle.configure(id, 3, undefined, undefined, undefined, true);
    assert.equal((await store.loadGame(id)).state.competitiveBotSeats, 2);
    await lifecycle.configure(id, 3, undefined, 0);
    assert.equal(
      (await store.loadGame(id)).state.competitiveBotSeats,
      undefined,
    );
    // At least one seat stays for a person.
    await assert.rejects(lifecycle.configure(id, 3, undefined, 3));
    await lifecycle.configure(id, 3, undefined, 2);
    const people = await seat(id, 1);
    await lifecycle.start(id);
    const s = (await store.loadGame(id)).state;
    assert.equal(s.status, 'SETUP');
    assert.equal(s.classicExpress, true);
    assert.equal(s.players.length, 3);
    const bots = s.players.filter((p) => p.bot === 'table');
    assert.equal(bots.length, 2);
    assert.ok(bots.every((b) => COMPETITIVE_BOT_NAMES.includes(b.nickname)));
    assert.ok(s.players.every((p) => p.seatIndex < 3));
    assert.equal(s.players.find((p) => p.id === people[0].id).bot, undefined);
    assertClassicInvariants(s);
    assert.equal(
      decodeGame(encodeGame(await store.loadGame(id))).game.state
        .competitiveBotSeats,
      2,
    );
    serverMessageSchema.parse({
      type: 'STATE',
      protocolVersion: PROTOCOL_VERSION,
      state: projectGameFor(s, 1, people[0].id),
    });
    // The bots play their setup on their own.
    const service = new GameService(store, undefined, () => 6_000);
    for (let i = 0; i < 20; i++) await service.tick(id);
    const after = (await store.loadGame(id)).state;
    assert.ok(
      after.status !== 'SETUP' ||
        !bots.some((b) => b.id === after.setup.currentPlayerId),
    );
    // In Express the administrator frees a table bot's seat for a person.
    await service.updateBots(id, { playerId: bots[0].id, enabled: false });
    const freed = await store.loadGame(id);
    const seatState = freed.state.players.find((p) => p.id === bots[0].id);
    assert.equal(seatState.bot, undefined);
    assert.equal(seatState.absent, true);
    assert.equal(seatState.controller, 'controllerless_reassignment');
    assert.deepEqual(freed.auth.players[bots[0].id], { playerId: bots[0].id });
    assertClassicInvariants(freed.state);
    decodeGame(encodeGame(freed));
    // Whoever takes it plays under their own name, which must be free.
    const auth = new AuthenticationService(store);
    assert.equal(
      await auth.takeAvailableSeat(id, bots[0].id, 'HTTP'),
      undefined,
    );
    await assert.rejects(
      auth.takeAvailableSeat(
        id,
        bots[0].id,
        'HTTP',
        undefined,
        people[0].nickname,
      ),
    );
    assert.ok(
      await auth.takeAvailableSeat(id, bots[0].id, 'HTTP', undefined, 'Lucía'),
    );
    const taken = await store.loadGame(id);
    const person = taken.state.players.find((p) => p.id === bots[0].id);
    assert.equal(person.nickname, 'Lucía');
    assert.equal(person.controller, 'controlled');
    decodeGame(encodeGame(taken));
  });
});

void test('a Classic table without Express seats four people and two bots', async () => {
  await lobby(async ({ store, lifecycle, seat }) => {
    const id = await lifecycle.create(6, 'classic');
    await lifecycle.configure(id, 6, undefined, 2);
    // Six people no longer fit with two bots.
    await seat(id, 4);
    await assert.rejects(lifecycle.configure(id, 6, undefined, 3));
    await lifecycle.start(id);
    const s = (await store.loadGame(id)).state;
    assert.equal(s.players.filter((p) => p.bot === 'table').length, 2);
    assert.equal(s.competitiveClock, undefined);
    assertClassicInvariants(s);
    // Without Express the table bots stay to the end.
    const service = new GameService(store, undefined, () => 6_000);
    const bot = s.players.find((p) => p.bot === 'table');
    await assert.rejects(
      service.updateBots(id, { playerId: bot.id, enabled: false }),
    );
  });
  assert.equal(
    updateGameConfigurationBodySchema.safeParse({
      configuredPlayerCount: 3,
      competitiveBotSeats: 3,
    }).success,
    false,
  );
  assert.equal(
    updateGameConfigurationBodySchema.safeParse({
      configuredPlayerCount: 3,
      competitiveBotSeats: 0,
    }).success,
    true,
  );
});
