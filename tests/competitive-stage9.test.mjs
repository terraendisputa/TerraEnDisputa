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
  deriveLegalActions,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORIES,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  assignCompetitiveBot,
  canRequestCompetitiveBot,
  markCompetitiveInactive,
  TECHNICAL_WAIT_MS,
  TURN_MS,
  INACTIVE_TURN_MS,
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
  updateGameConfigurationBodySchema,
} from '../packages/protocol/dist/index.js';

const rng = { shuffle: (items) => [...items].reverse() };
const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Final ${seatIndex}`,
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
/** A deciding five-player game on its first normal activation. */
function fixture() {
  let roll = 0,
    now = 1_000_000;
  let s = startCompetitiveClock(
    {
      ...createClassicSetup(
        randomUUID(),
        players(5),
        { shuffle: (items) => [...items], rollDie: () => (roll++ % 6) + 1 },
        'competitive',
      ),
      competitiveDeciding: true,
    },
    now,
  );
  while (s.status === 'SETUP') {
    now += s.competitiveClock.activationRemainingMs;
    s = tickCompetitiveClock(s, now, true, rng);
  }
  return { s, now, a: s.turn.playerId };
}
const passTurns = (s, a, connected = true) => {
  for (let i = 0; i < 20 && s.turn.playerId !== a; i++)
    s = tickCompetitiveClock(
      s,
      s.competitiveClock.updatedAtMs + s.competitiveClock.activationRemainingMs,
      connected,
      rng,
    );
  return s;
};

void test('the lobby marks a deciding game, never a bot table, and starts with it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-deciding-'));
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
    );
    assert.equal(
      updateGameConfigurationBodySchema.safeParse({
        configuredPlayerCount: 6,
        competitiveBotSeats: 2,
        competitiveDeciding: true,
      }).success,
      false,
    );
    const classic = await lifecycle.create(5, 'classic');
    await assert.rejects(
      lifecycle.configure(classic, 5, undefined, undefined, true),
    );
    const id = await lifecycle.create(5, 'competitive');
    await lifecycle.configure(id, 5, undefined, undefined, true);
    await assert.rejects(lifecycle.configure(id, 6, undefined, 2));
    // Changing the count keeps the choice.
    await lifecycle.configure(id, 6, 60);
    let lobby = await store.loadGame(id);
    assert.equal(lobby.state.competitiveDeciding, true);
    await lifecycle.configure(id, 6, undefined, undefined, false);
    assert.equal(
      (await store.loadGame(id)).state.competitiveDeciding,
      undefined,
    );
    await lifecycle.configure(id, 5, undefined, undefined, true);
    lobby = await store.loadGame(id);
    const seated = players(5);
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
    const started = await store.loadGame(id);
    assert.equal(started.state.competitiveDeciding, true);
    assertClassicInvariants(started.state);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('in a deciding game an absent player turns inactive, not a bot, with one-minute turns', () => {
  let { s, now, a } = fixture();
  const [from, to] = TERRITORY_IDS.flatMap((id) =>
    s.territories[id].ownerId === a
      ? TERRITORIES[id].adjacentTerritoryIds
          .filter((t) => s.territories[t].ownerId !== a)
          .map((t) => [id, t])
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
  // The usual wait first: five minutes of grace and the turn time.
  s = tickCompetitiveClock(s, now, false, rng);
  assert.equal(s.competitiveClock.pauseReason, 'disconnection');
  s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
  s = tickCompetitiveClock(s, now + TURN_MS, false, rng);
  const seat = s.players.find((p) => p.id === a);
  assert.equal(seat.inactive, true);
  assert.equal(seat.bot, undefined);
  assert.equal(seat.absent, undefined);
  assert.equal(s.pacts.active.length, 0);
  assertClassicInvariants(s);
  assert.equal(
    decodeGame(
      encodeGame({
        state: s,
        revision: 0,
        recentCommands: [],
        auth: auth(s.players),
      }),
    ).game.state.players.find((p) => p.id === a).inactive,
    true,
  );
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: projectGameFor(s, 1, a),
  });
  // Their next turn lasts one minute and does not wait for them.
  s = passTurns(s, a);
  assert.equal(s.turn.playerId, a);
  assert.equal(s.competitiveClock.activationRemainingMs, INACTIVE_TURN_MS);
  now = s.competitiveClock.updatedAtMs;
  s = tickCompetitiveClock(s, now + 1, false, rng);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  s = tickCompetitiveClock(s, now + INACTIVE_TURN_MS, false, rng);
  assert.notEqual(s.turn.playerId, a);
  // Back online they may play their short turns, still inactive.
  s = passTurns(s, a);
  s = tickCompetitiveClock(s, s.competitiveClock.updatedAtMs + 1, true, rng);
  assert.equal(s.players.find((p) => p.id === a).inactive, true);
  assert.equal(deriveLegalActions(s, a).readOnly, false);
  assert.ok(s.competitiveClock.activationRemainingMs <= INACTIVE_TURN_MS);
});

void test('the administrator marks a player inactive and back; no bots in deciding games', async () => {
  let { s, now, a } = fixture();
  s = tickCompetitiveClock(s, ++now, false, rng);
  assert.equal(s.competitiveClock.pauseReason, 'disconnection');
  s = markCompetitiveInactive(s, a, true);
  assert.equal(s.players.find((p) => p.id === a).inactive, true);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  assert.equal(s.competitiveClock.activationRemainingMs, INACTIVE_TURN_MS);
  assertClassicInvariants(s);
  s = markCompetitiveInactive(s, a, false);
  assert.equal(s.players.find((p) => p.id === a).inactive, undefined);
  // The short current turn ends; the next one is normal again.
  s = tickCompetitiveClock(s, now + INACTIVE_TURN_MS, true, rng);
  assert.notEqual(s.turn.playerId, a);
  s = passTurns(s, a);
  assert.equal(s.competitiveClock.activationRemainingMs, TURN_MS);
  assert.throws(() => assignCompetitiveBot(s, a, true));
  const lone = {
    ...s,
    competitiveClock: {
      ...s.competitiveClock,
      finalRoundNumber: s.turn.round.roundNumber,
    },
  };
  assert.equal(canRequestCompetitiveBot(lone, a), false);
  const { competitiveDeciding: _, ...regular } = s;
  void _;
  assert.throws(() => markCompetitiveInactive(regular, a, true));
  // Through the server, as the administrator would.
  const other = s.players.find((p) => p.id !== a).id;
  let record = {
    state: s,
    revision: 0,
    recentCommands: [],
    auth: auth(s.players),
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
  await service.updateBots(s.id, { playerId: other, inactive: true });
  assert.equal(record.state.players.find((p) => p.id === other).inactive, true);
  await assert.rejects(
    service.updateBots(s.id, { playerId: other, enabled: true }),
  );
});
