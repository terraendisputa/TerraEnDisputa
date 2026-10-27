import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClassicSetup,
  applyCommand,
  assertClassicInvariants,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORIES,
  TERRITORY_CARDS,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  pauseCompetitiveClock,
  gameClockDurationMs,
  timeLimitWinner,
  TECHNICAL_WAIT_MS,
  TURN_MS,
} from '../packages/game-engine/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';

const rng = { shuffle: (items) => [...items].reverse() };
const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Express ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
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
function express(count) {
  let roll = 0;
  return startCompetitiveClock(
    {
      ...createClassicSetup(
        randomUUID(),
        players(count),
        { shuffle: (items) => [...items], rollDie: () => (roll++ % 6) + 1 },
        'classic',
      ),
      classicExpress: true,
    },
    1_000_000,
  );
}
/** Lets every turn run out while everyone stays connected. */
const expireTurn = (s) =>
  tickCompetitiveClock(
    s,
    s.competitiveClock.updatedAtMs + s.competitiveClock.activationRemainingMs,
    true,
    rng,
  );

void test('Express lasts 40 minutes with two or three players, like Competitive with more', () => {
  const at = (configuredPlayerCount) =>
    gameClockDurationMs({ mode: 'classic', configuredPlayerCount }) / 60_000;
  assert.deepEqual([2, 3, 4, 5, 6].map(at), [40, 40, 60, 80, 80]);
  assert.equal(
    gameClockDurationMs({
      mode: 'competitive',
      configuredPlayerCount: 5,
      competitiveDurationMinutes: 60,
    }),
    60 * 60_000,
  );
});

void test('the lobby chooses Express for Classic only and the game starts with the clock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classic-express-'));
  const store = await FileGameStore.open(directory);
  try {
    const lifecycle = new GameLifecycleService(
      store,
      new PerGameCoordinator(),
      {
        shuffle: (items) => [...items],
        rollDie: (() => {
          let roll = 0;
          return () => (roll++ % 6) + 1;
        })(),
      },
      randomUUID,
      () => 5_000,
    );
    const competitive = await lifecycle.create(4, 'competitive');
    await assert.rejects(
      lifecycle.configure(
        competitive,
        4,
        undefined,
        undefined,
        undefined,
        true,
      ),
    );
    const id = await lifecycle.create(2, 'classic');
    await lifecycle.configure(id, 3, undefined, undefined, undefined, true);
    // Changing the player count keeps Express.
    await lifecycle.configure(id, 2);
    let lobby = await store.loadGame(id);
    assert.equal(lobby.state.classicExpress, true);
    const seated = players(2);
    await store.commitGame(
      {
        ...lobby,
        state: {
          ...lobby.state,
          players: seated,
          readyPlayerIds: seated.map((p) => p.id),
        },
        auth: { ...auth(seated), generation: lobby.auth.generation + 1 },
        revision: lobby.revision + 1,
      },
      { authGeneration: lobby.auth.generation, revision: lobby.revision },
    );
    await lifecycle.start(id);
    const started = (await store.loadGame(id)).state;
    assert.equal(started.classicExpress, true);
    assert.equal(started.competitiveClock.activationRemainingMs, TURN_MS);
    assertClassicInvariants(started);
    // Without Express, Classic keeps no clock.
    const free = await lifecycle.create(2, 'classic');
    await lifecycle.configure(free, 2, undefined, undefined, undefined, true);
    await lifecycle.configure(free, 2, undefined, undefined, undefined, false);
    assert.equal((await store.loadGame(free)).state.classicExpress, undefined);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('idle Express games of two to six run out of time without a score', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    let s = express(count);
    for (let i = 0; i < 2000 && s.status !== 'FINISHED'; i++) {
      s = expireTurn(s);
      assertClassicInvariants(s);
    }
    assert.equal(s.status, 'FINISHED', `${count} players`);
    assert.equal(s.result.victoryReason.kind, 'time_limit');
    assert.equal(s.result.scoringEligible, undefined);
    assert.equal(s.result.winnerId, timeLimitWinner(s));
    assert.ok(
      s.competitiveClock.elapsedMs >=
        gameClockDurationMs({ mode: 'classic', configuredPlayerCount: count }),
    );
    serverMessageSchema.parse({
      type: 'STATE',
      protocolVersion: PROTOCOL_VERSION,
      state: projectGameFor(s, 1, s.players[0].id),
    });
    assert.equal(
      decodeGame(encodeGame(durable(s))).game.state.classicExpress,
      true,
    );
  }
});

void test('a full tie at the time limit has no winner', () => {
  let s = express(2);
  while (s.status === 'SETUP') s = expireTurn(s);
  const [a, b] = s.players;
  const tied = {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      cards: [],
      completedExchangeCount: 0,
    })),
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id, i) => [
        id,
        { ownerId: i % 2 ? a.id : b.id, armies: 2, fixedArmiesThisTurn: 0 },
      ]),
    ),
  };
  assert.equal(timeLimitWinner(tied), undefined);
  const ahead = {
    ...tied,
    territories: {
      ...tied.territories,
      [TERRITORY_IDS[0]]: { ...tied.territories[TERRITORY_IDS[0]], armies: 3 },
    },
  };
  assert.equal(
    timeLimitWinner(ahead),
    ahead.territories[TERRITORY_IDS[0]].ownerId,
  );
});

void test('a disconnected player is awaited, then a bot or nobody plays; Classic pacts stay', () => {
  for (const replaceAbsent of [true, false]) {
    let s = express(4);
    if (!replaceAbsent) s = { ...s, competitiveBotsReplaceAbsent: false };
    while (s.status === 'SETUP' || s.turn.round.kind !== 'normal')
      s = expireTurn(s);
    while (s.turn.round.pass !== 'hostility') s = expireTurn(s);
    const a = s.turn.playerId;
    const b = s.players.find((p) => p.id !== a).id;
    const proposalId = randomUUID();
    let now = s.competitiveClock.updatedAtMs;
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
      s = synchronizeCompetitiveClock(s, result.state, now);
    }
    const pacts = s.pacts.active.length;
    s = tickCompetitiveClock(s, ++now, false, rng);
    assert.equal(s.competitiveClock.pauseReason, 'disconnection');
    const elapsed = s.competitiveClock.elapsedMs;
    s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
    // The pause does not count as game time.
    assert.equal(s.competitiveClock.elapsedMs, elapsed);
    s = tickCompetitiveClock(s, now + TURN_MS, false, rng);
    const seat = s.players.find((p) => p.id === a);
    // A bot takes the seat by default; without one, its turns pass alone.
    assert.equal(seat.absent, replaceAbsent ? undefined : true);
    assert.equal(seat.bot, replaceAbsent ? 'absent' : undefined);
    assert.equal(s.pacts.active.length, pacts);
    assertClassicInvariants(s);
    // Back online, they play again.
    for (let i = 0; i < 20 && s.turn.playerId !== a; i++) s = expireTurn(s);
    s = tickCompetitiveClock(s, s.competitiveClock.updatedAtMs + 1, true, rng);
    assert.equal(s.players.find((p) => p.id === a).absent, undefined);
    assert.equal(s.players.find((p) => p.id === a).bot, undefined);
  }
});

void test('the administrator pauses Express and commands wait', () => {
  let s = express(3);
  while (s.status === 'SETUP') s = expireTurn(s);
  const now = s.competitiveClock.updatedAtMs + 1000;
  s = pauseCompetitiveClock(s, now, true);
  assert.equal(s.competitiveClock.pauseReason, 'admin');
  const frozen = tickCompetitiveClock(s, now + 600_000, true, rng);
  assert.equal(
    frozen.competitiveClock.activationRemainingMs,
    s.competitiveClock.activationRemainingMs,
  );
  assert.equal(
    applyCommand(s, { type: 'advance_phase', playerId: s.turn.playerId }).error
      .code,
    'GAME_PAUSED',
  );
  s = pauseCompetitiveClock(s, now + 5000, false);
  assert.equal(s.competitiveClock.pauseReason, undefined);
});

void test('an expired Classic incorporation trades the cards it must before placing', () => {
  let s = express(4);
  while (s.status === 'SETUP' || s.turn.round.kind !== 'normal')
    s = expireTurn(s);
  while (s.turn.round.pass !== 'incorporation') s = expireTurn(s);
  const a = s.turn.playerId;
  const own = TERRITORY_IDS.filter((t) => s.territories[t].ownerId === a);
  const balloons = Object.values(TERRITORY_CARDS)
    .filter((c) => c.symbol === 'balloon')
    .slice(0, 3)
    .map((c) => c.id);
  const extra = Object.values(TERRITORY_CARDS)
    .filter((c) => c.symbol === 'galleon')
    .slice(0, 3)
    .map((c) => c.id);
  const hand = [...balloons, ...extra].map((cardId) => ({
    cardId,
    territoryBonusClaimed: false,
  }));
  s = {
    ...s,
    players: s.players.map((p) => (p.id === a ? { ...p, cards: hand } : p)),
    cardDeck: {
      ...s.cardDeck,
      drawPile: s.cardDeck.drawPile.filter(
        (id) => !balloons.includes(id) && !extra.includes(id),
      ),
    },
  };
  assert.equal(s.turn.phase, 'ordinary_exchange');
  const before = own.reduce((n, t) => n + s.territories[t].armies, 0);
  s = expireTurn(s);
  const after = s.players.find((p) => p.id === a);
  assert.equal(after.cards.length, 3);
  assert.equal(after.completedExchangeCount, 1);
  assert.ok(
    own.reduce((n, t) => n + s.territories[t].armies, 0) > before,
    'reinforcements were placed',
  );
  void TERRITORIES;
});
