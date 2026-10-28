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
  competitiveDurationMs,
  PACT_REJECTION_WAIT_MS,
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
  updateGameConfigurationBodySchema,
} from '../packages/protocol/dist/index.js';

const rng = { shuffle: (items) => [...items].reverse() };
const players = (count) =>
  Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Superliga ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
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
function perform(s, command) {
  const result = applyCommand(s, command, {
    shuffle: rng,
    dice: { rollDie: () => 6 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return synchronizeCompetitiveClock(
    s,
    result.state,
    s.competitiveClock.updatedAtMs,
  );
}
function border(s, a) {
  const [from, to] = TERRITORY_IDS.flatMap((id) =>
    s.territories[id].ownerId === a
      ? TERRITORIES[id].adjacentTerritoryIds
          .filter((t) => s.territories[t].ownerId !== a)
          .map((t) => [id, t])
      : [],
  )[0];
  return {
    recipientId: s.territories[to].ownerId,
    terms: { kind: 'border_non_aggression', territoryIds: [from, to] },
  };
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
function durable(s) {
  return { state: s, revision: 0, recentCommands: [], auth: auth(s.players) };
}

void test('a rejected proposer waits five minutes of game time to propose to that player again', () => {
  let { s, a } = fixture();
  const { recipientId: b, terms } = border(s, a);
  const propose = (state) =>
    applyCommand(state, {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId: randomUUID(),
      terms,
    });
  const proposalId = randomUUID();
  s = perform(s, {
    type: 'propose_pact',
    playerId: a,
    recipientId: b,
    proposalId,
    terms,
  });
  // Cancelling is not a rejection.
  s = perform(s, { type: 'cancel_pact', playerId: a, proposalId });
  assert.equal(propose(s).ok, true);
  s = propose(s).state;
  s = perform(s, {
    type: 'reject_pact',
    playerId: b,
    proposalId: s.pacts.proposals[0].id,
  });
  assert.equal(s.pacts.competitiveRejections.length, 1);
  assert.equal(propose(s).error.code, 'PACT_COOLDOWN');
  assert.ok(
    deriveLegalActions(s, a).pactProposalChoices.every(
      (choice) => choice.recipientId !== b,
    ),
  );
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: projectGameFor(s, 1, a),
  });
  assertClassicInvariants(s);
  const elapsed = s.competitiveClock.elapsedMs;
  const later = (ms) => ({
    ...s,
    competitiveClock: { ...s.competitiveClock, elapsedMs: elapsed + ms },
  });
  assert.equal(propose(later(PACT_REJECTION_WAIT_MS - 1)).ok, false);
  assert.equal(propose(later(PACT_REJECTION_WAIT_MS)).ok, true);
  const restored = decodeGame(encodeGame(durable(s))).game.state;
  assert.deepEqual(
    restored.pacts.competitiveRejections,
    s.pacts.competitiveRejections,
  );
});

void test('a player with one country cannot attack from it with four armies or fewer', () => {
  let { s, a } = fixture();
  const [from] = TERRITORY_IDS.filter((t) => s.territories[t].ownerId === a);
  const to = TERRITORIES[from].adjacentTerritoryIds[0];
  const others = s.players.filter((p) => p.id !== a).map((p) => p.id);
  const lone = (armies) => ({
    ...s,
    territories: Object.fromEntries(
      TERRITORY_IDS.map((t, i) => [
        t,
        t === from
          ? { ownerId: a, armies, fixedArmiesThisTurn: 0 }
          : {
              ...s.territories[t],
              ownerId:
                s.territories[t].ownerId === a
                  ? others[i % others.length]
                  : s.territories[t].ownerId,
            },
      ]),
    ),
  });
  const attack = (state) =>
    applyCommand(
      state,
      { type: 'attack', playerId: a, from, to },
      { dice: { rollDie: () => 1 } },
    );
  assert.equal(attack(lone(4)).error.code, 'SUICIDE_ATTACK');
  assert.deepEqual(deriveLegalActions(lone(4), a).attackChoices, []);
  assert.equal(attack(lone(5)).ok, true);
  assert.equal(deriveLegalActions(lone(5), a).attackChoices.length, 1);
});

void test('Express plays 60 minutes with five or six; four always plays 60', () => {
  assert.equal(competitiveDurationMs(4), 60 * 60_000);
  assert.equal(competitiveDurationMs(4, 80), 60 * 60_000);
  assert.equal(competitiveDurationMs(5), 80 * 60_000);
  assert.equal(competitiveDurationMs(6, 60), 60 * 60_000);
  for (const minutes of [undefined, 60]) {
    let { s, now } = fixture(5);
    s = {
      ...s,
      ...(minutes ? { competitiveDurationMinutes: minutes } : {}),
      competitiveClock: { ...s.competitiveClock, elapsedMs: 60 * 60_000 - 1 },
    };
    s = tickCompetitiveClock(s, now + 1, true, rng);
    assert.equal(s.competitiveClock.finalRoundNumber !== undefined, !!minutes);
  }
});

void test('the lobby stores the Express choice and carries it into the game', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'competitive-express-'));
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
        configuredPlayerCount: 5,
        competitiveDurationMinutes: 70,
      }).success,
      false,
    );
    const classic = await lifecycle.create(5, 'classic');
    await assert.rejects(lifecycle.configure(classic, 5, 60));
    const id = await lifecycle.create(5, 'competitive');
    await lifecycle.configure(id, 5, 60);
    await lifecycle.configure(id, 6);
    const lobby = await store.loadGame(id);
    assert.equal(lobby.state.competitiveDurationMinutes, 60);
    const seated = players(6);
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
    assert.equal(started.state.status, 'SETUP');
    assert.equal(started.state.competitiveDurationMinutes, 60);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
