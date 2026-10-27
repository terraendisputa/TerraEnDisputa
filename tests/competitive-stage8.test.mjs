import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCommand,
  assertClassicInvariants,
  deriveLegalActions,
  PLAYER_COLORS,
  TERRITORY_IDS,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  competitiveActor,
  competitiveResults,
  chooseBotCommand,
  applyBotCommand,
  assignCompetitiveBot,
  canRequestCompetitiveBot,
  requestCompetitiveBot,
  COMPETITIVE_BOT_NAMES,
} from '../packages/game-engine/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameLifecycleService } from '../apps/server/dist/games/lifecycle-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';

const rng = { shuffle: (items) => [...items].reverse() };
const people = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Mesa ${seatIndex}`,
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

/** A started four plus two table, through the real lobby and start. */
async function table() {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-bots-'));
  const store = await FileGameStore.open(directory);
  let roll = 0;
  const lifecycle = new GameLifecycleService(
    store,
    new PerGameCoordinator(),
    {
      shuffle: (items) => [...items],
      rollDie: () => (roll++ % 6) + 1,
    },
    randomUUID,
    () => 1_000_000,
  );
  const id = await lifecycle.create(4, 'competitive');
  return { directory, store, lifecycle, id };
}
async function seat(store, id, humans) {
  const lobby = await store.loadGame(id);
  await store.commitGame(
    {
      ...lobby,
      state: {
        ...lobby.state,
        players: humans,
        readyPlayerIds: humans.map((p) => p.id),
      },
      auth: { ...auth(humans), generation: lobby.auth.generation + 1 },
      revision: lobby.revision + 1,
    },
    { authGeneration: lobby.auth.generation, revision: lobby.revision },
  );
}

void test('the lobby offers six with four players and two bots, always 1:20 h', async () => {
  const { directory, store, lifecycle, id } = await table();
  try {
    // Competitive bot tables are six seats with two bots, never Express;
    // Classic tables choose their own number of bots.
    await assert.rejects(lifecycle.configure(id, 5, undefined, 2));
    await assert.rejects(lifecycle.configure(id, 6, 60, 2));
    await assert.rejects(lifecycle.configure(id, 6, undefined, 3));
    const classic = await lifecycle.create(4, 'classic');
    await lifecycle.configure(classic, 6, undefined, 2);
    await lifecycle.configure(id, 6, 60);
    await lifecycle.configure(id, 6, undefined, 2);
    let lobby = (await store.loadGame(id)).state;
    assert.equal(lobby.competitiveBotSeats, 2);
    // The bot table drops the earlier Express choice.
    assert.equal(lobby.competitiveDurationMinutes, undefined);
    assertClassicInvariants(lobby);
    // Back to six people.
    await lifecycle.configure(id, 6);
    assert.equal(
      (await store.loadGame(id)).state.competitiveBotSeats,
      undefined,
    );
    await seat(store, id, people(5));
    // Five people do not fit a table of four plus two bots.
    await assert.rejects(lifecycle.configure(id, 6, undefined, 2));
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('at the start two bots take the free seats; no pacts and no destruction missions', async () => {
  const { directory, store, lifecycle, id } = await table();
  try {
    await lifecycle.configure(id, 6, undefined, 2);
    const humans = people(4).map((p, i) => ({
      ...p,
      nickname: i === 0 ? 'bot paul' : p.nickname,
      seatIndex: i * 2 - (i > 1 ? 1 : 0),
      color: PLAYER_COLORS[i + 2],
    }));
    await seat(store, id, humans);
    await lifecycle.start(id);
    const durable = await store.loadGame(id);
    const s = durable.state;
    assert.equal(s.status, 'SETUP');
    assert.equal(s.players.length, 6);
    assert.equal(s.competitiveBotSeats, 2);
    const bots = s.players.filter((p) => p.bot === 'table');
    assert.equal(bots.length, 2);
    for (const bot of bots)
      assert.ok(COMPETITIVE_BOT_NAMES.includes(bot.nickname));
    // A person already uses Bot Paul (ignoring case), so no bot takes it.
    assert.ok(bots.every((bot) => bot.nickname !== 'Bot Paul'));
    assert.notEqual(bots[0].nickname, bots[1].nickname);
    assert.equal(new Set(s.players.map((p) => p.color)).size, 6);
    assert.equal(new Set(s.players.map((p) => p.seatIndex)).size, 6);
    assert.ok(
      s.players.every((p) => !p.secretObjectiveId.startsWith('destroy_')),
    );
    assertClassicInvariants(s);
    // Bots have no session and the save still loads.
    assert.equal(
      decodeGame(encodeGame(durable)).game.state.players.filter(
        (p) => p.bot === 'table',
      ).length,
      2,
    );
    serverMessageSchema.parse({
      type: 'STATE',
      protocolVersion: PROTOCOL_VERSION,
      state: projectGameFor(s, 1, humans[0].id),
    });
    // The administrator cannot take a table bot out.
    assert.throws(() => assignCompetitiveBot(s, bots[0].id, false));
    // Pacts are off for the whole table.
    let active = s;
    let now = 1_000_000;
    while (active.status === 'SETUP') {
      now += active.competitiveClock.activationRemainingMs;
      active = tickCompetitiveClock(active, now, true, rng);
    }
    const a = active.turn.playerId;
    assert.deepEqual(deriveLegalActions(active, a).pactRecipientIds, []);
    const b = active.players.find((p) => p.id !== a && !p.bot).id;
    assert.equal(
      applyCommand(active, {
        type: 'propose_pact',
        playerId: a,
        recipientId: b,
        proposalId: randomUUID(),
        terms: { kind: 'general_non_aggression' },
      }).ok,
      false,
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('a full four plus two game finishes and the results mark the bots', async () => {
  const { directory, store, lifecycle, id } = await table();
  try {
    await lifecycle.configure(id, 6, undefined, 2);
    await seat(store, id, people(4));
    await lifecycle.start(id);
    let s = (await store.loadGame(id)).state;
    // The people's seats are played by bots too, as replacements.
    for (const p of s.players.filter((p) => !p.bot))
      s = assignCompetitiveBot(s, p.id, true);
    let seed = 11;
    const random = {
      rollDie: () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return 1 + Math.floor((seed / 2 ** 32) * 6);
      },
      shuffle: (items) => [...items],
    };
    let now = 1_000_000;
    for (let moves = 0; s.status !== 'FINISHED' && moves < 20_000; moves++) {
      const command = chooseBotCommand(s, competitiveActor(s), 'normal');
      assert.ok(command);
      const result = applyBotCommand(s, command, {
        dice: random,
        shuffle: random,
      });
      assert.equal(result.ok, true);
      s = synchronizeCompetitiveClock(s, result.state, (now += 1000));
    }
    assert.equal(s.status, 'FINISHED');
    assertClassicInvariants(s);
    const results = competitiveResults(s);
    const marks = results.rows.map((row) => row.bot);
    assert.equal(marks.filter((m) => m === 'table').length, 2);
    assert.equal(marks.filter((m) => m === 'replacement').length, 4);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('from the second to last round a player with one country may ask for a bot', async () => {
  const { s: base } = await (async () => {
    const { directory, store, lifecycle, id } = await table();
    try {
      await lifecycle.configure(id, 5);
      await seat(store, id, people(5));
      await lifecycle.start(id);
      let s = (await store.loadGame(id)).state;
      let now = 1_000_000;
      while (s.status === 'SETUP' || s.turn.round.kind !== 'normal') {
        now =
          s.competitiveClock.updatedAtMs +
          s.competitiveClock.activationRemainingMs;
        s = tickCompetitiveClock(s, now, true, rng);
      }
      return { s };
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  })();
  const a = base.players.find((p) => p.id !== base.turn.playerId).id;
  const [keep] = TERRITORY_IDS.filter((t) => base.territories[t].ownerId === a);
  const other = base.players.find((p) => p.id !== a).id;
  const lone = {
    ...base,
    territories: Object.fromEntries(
      TERRITORY_IDS.map((t) => [
        t,
        base.territories[t].ownerId === a && t !== keep
          ? { ...base.territories[t], ownerId: other }
          : base.territories[t],
      ]),
    ),
  };
  const round = lone.turn.round.roundNumber;
  const final = (n) => ({
    ...lone,
    competitiveClock: { ...lone.competitiveClock, finalRoundNumber: n },
  });
  assert.equal(canRequestCompetitiveBot(lone, a), false);
  assert.equal(canRequestCompetitiveBot(final(round + 2), a), false);
  assert.equal(canRequestCompetitiveBot(final(round + 1), a), true);
  assert.equal(canRequestCompetitiveBot(final(round), a), true);
  assert.equal(canRequestCompetitiveBot(final(round + 1), other), false);
  assert.equal(
    projectGameFor(final(round + 1), 1, a).botRequestAvailable,
    true,
  );
  assert.equal(
    projectGameFor(final(round + 1), 1, other).botRequestAvailable,
    undefined,
  );
  assert.throws(() => requestCompetitiveBot(lone, a));
  // Through the server, as a command from that player.
  let record = {
    state: final(round + 1),
    revision: 0,
    recentCommands: [],
    auth: auth(base.players),
  };
  const service = new GameService(
    {
      loadGame: () => Promise.resolve(record),
      commitGame: (candidate) => {
        record = candidate;
        return Promise.resolve({ outcome: 'COMMITTED' });
      },
    },
    undefined,
    () => record.state.competitiveClock.updatedAtMs,
    () => true,
  );
  const reply = await service.process(base.id, a, {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: 0,
    command: { type: 'request_bot' },
  });
  assert.equal(reply.code, undefined, JSON.stringify(reply));
  const seated = record.state.players.find((p) => p.id === a);
  assert.equal(seated.bot, 'requested');
  assert.equal(seated.botPlayed, true);
  // Reconnecting does not take the seat back.
  const later = tickCompetitiveClock(
    record.state,
    record.state.competitiveClock.updatedAtMs + 1,
    true,
    rng,
  );
  assert.equal(later.players.find((p) => p.id === a).bot, 'requested');
  assertClassicInvariants(later);
});
