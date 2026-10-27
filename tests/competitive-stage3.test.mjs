import WebSocket from '../apps/server/node_modules/ws/wrapper.mjs';
import { buildServer } from '../apps/server/dist/app.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { sessionCookieName } from '../apps/server/dist/auth/cookies.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClassicSetup,
  applyCommand,
  applySetupCommand,
  assertClassicInvariants,
  deriveLegalActions,
  PLAYER_COLORS,
  TERRITORY_IDS,
  TERRITORIES,
  CONTINENTS,
  startCompetitiveClock,
  tickCompetitiveClock,
  synchronizeCompetitiveClock,
  selectCompetitiveTerritory,
  pauseCompetitiveClock,
  competitiveDurationMs,
  TURN_MS,
  FINAL_TURN_MS,
  TECHNICAL_WAIT_MS,
} from '../packages/game-engine/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import {
  projectGameFor,
  projectGameForAdmin,
} from '../apps/server/dist/games/projection.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
import { PersistenceFailedError } from '../apps/server/dist/persistence/atomic-file.js';
const rng = { shuffle: (items) => [...items].reverse() };
function fixture(count = 5, active = true) {
  const players = Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `Clock ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
  let roll = 0,
    now = 1_000_000;
  let s = startCompetitiveClock(
    createClassicSetup(
      randomUUID(),
      players,
      { shuffle: (items) => [...items], rollDie: () => (roll++ % 6) + 1 },
      'competitive',
    ),
    now,
  );
  if (active)
    while (s.status === 'SETUP') {
      now += s.competitiveClock.activationRemainingMs;
      s = tickCompetitiveClock(s, now, true, rng);
      assertClassicInvariants(s);
    }
  return {
    s,
    now,
    a: active ? s.turn.playerId : s.setup.currentPlayerId,
    b: s.players.find(
      (p) => p.id !== (active ? s.turn.playerId : s.setup.currentPlayerId),
    ).id,
  };
}
function perform(s, command, now = s.competitiveClock.updatedAtMs) {
  const result = applyCommand(s, command, {
    shuffle: rng,
    dice: { rollDie: () => 6 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return synchronizeCompetitiveClock(s, result.state, now);
}
function advance(s) {
  return perform(s, { type: 'advance_phase', playerId: s.turn.playerId });
}
function close(s) {
  while (s.turn.phase !== 'end_of_turn_cards') s = advance(s);
  return perform(s, { type: 'end_turn', playerId: s.turn.playerId });
}
function expire(s) {
  const now =
    s.competitiveClock.updatedAtMs + s.competitiveClock.activationRemainingMs;
  return tickCompetitiveClock(s, now, true, rng);
}
function giveCards(s, pid, ids) {
  return {
    ...s,
    players: s.players.map((p) =>
      p.id === pid
        ? {
            ...p,
            cards: ids.map((cardId) => ({
              cardId,
              territoryBonusClaimed: false,
            })),
          }
        : p,
    ),
    cardDeck: {
      ...s.cardDeck,
      drawPile: s.cardDeck.drawPile.filter((id) => !ids.includes(id)),
      discardPile: s.cardDeck.discardPile.filter((id) => !ids.includes(id)),
    },
  };
}
function durable(s) {
  return {
    state: s,
    revision: 0,
    recentCommands: [],
    auth: {
      ...emptyGameAuthState(),
      players: Object.fromEntries(
        s.players.map((p) => [
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
    },
  };
}
void test('setup auto-allocation obeys accumulated continent cap, no general time before first hostility', () => {
  for (const count of [4, 5, 6]) {
    let { s, now } = fixture(count, false);
    let activations = 0;
    while (s.status === 'SETUP') {
      assert.equal(s.competitiveClock.elapsedMs, 0);
      now += TURN_MS;
      s = tickCompetitiveClock(s, now, true, rng);
      assertClassicInvariants(s);
      activations++;
    }
    assert.equal(activations, count * 2);
    assert.equal(s.competitiveClock.elapsedMs, 0);
    assert.equal(s.competitiveClock.activationRemainingMs, TURN_MS);
    for (const p of s.players)
      assert.equal(
        TERRITORY_IDS.reduce(
          (n, t) =>
            n +
            (s.territories[t].ownerId === p.id
              ? s.territories[t].armies - 1
              : 0),
          0,
        ),
        8,
      );
  }
});
void test('changing phase or selecting territory never refreshes turn; hostilities expire through full end', () => {
  let { s, now, a } = fixture();
  s = tickCompetitiveClock(s, now + 45000, true, rng);
  assert.equal(s.competitiveClock.activationRemainingMs, 75000);
  s = advance(s);
  assert.equal(s.competitiveClock.activationRemainingMs, 75000);
  s = advance(s);
  s = { ...s, turn: { ...s.turn, cardClaimEligible: true } };
  s = expire(s);
  assert.notEqual(s.turn.playerId, a);
  assert.equal(s.players.find((p) => p.id === a).cards.length, 0);
  assert.equal(s.competitiveClock.activationRemainingMs, TURN_MS);
  assert.equal(s.competitiveClock.elapsedMs, TURN_MS);
});
void test('general timer announces exact threshold; completes current round plus exactly two full finals', () => {
  for (const count of [4, 5, 6]) {
    let { s, now, a } = fixture(count);
    s = {
      ...s,
      competitiveClock: {
        ...s.competitiveClock,
        elapsedMs: competitiveDurationMs(count) - 1,
      },
    };
    s = tickCompetitiveClock(s, now + 1, true, rng);
    assert.equal(s.status, 'ACTIVE');
    assert.equal(s.turn.playerId, a);
    assert.equal(s.competitiveClock.finalRoundNumber, 2);
    assert.equal(s.competitiveClock.activationRemainingMs, TURN_MS - 1);
    let steps = 0,
      finals = 0;
    while (s.status !== 'FINISHED' && steps++ < 40) {
      if (s.turn.round.kind === 'normal') {
        assert.equal(s.competitiveClock.activationRemainingMs, FINAL_TURN_MS);
        finals++;
      }
      s = expire(s);
      assertClassicInvariants(s);
    }
    assert.equal(s.status, 'FINISHED');
    assert.equal(s.result.victoryReason.kind, 'time_limit');
    assert.equal(s.result.winnerId, undefined);
    assert.equal(s.competitiveClock.completedRounds, 2);
    assert.equal(s.result.scoringEligible, false);
    assert.equal(finals, count * 4);
    serverMessageSchema.parse({
      type: 'STATE',
      protocolVersion: PROTOCOL_VERSION,
      state: projectGameFor(s, 1, a),
    });
    assert.equal(projectGameForAdmin(s, 1).result.winnerId, undefined);
  }
});
void test('final announcement during normal round preserves current duration and closes after two more rounds', () => {
  let { s } = fixture(4);
  while (s.turn.round.kind === 'initial_hostility') s = close(s);
  s = {
    ...s,
    competitiveClock: {
      ...s.competitiveClock,
      elapsedMs: competitiveDurationMs(4) - 1,
    },
  };
  s = tickCompetitiveClock(s, s.competitiveClock.updatedAtMs + 1, true, rng);
  assert.equal(s.competitiveClock.finalRoundNumber, 3);
  let steps = 0;
  while (s.status !== 'FINISHED' && steps++ < 40) {
    if (s.turn.round.roundNumber === 1)
      assert.ok(s.competitiveClock.activationRemainingMs <= TURN_MS);
    else assert.equal(s.competitiveClock.activationRemainingMs, FINAL_TURN_MS);
    s = expire(s);
    assertClassicInvariants(s);
  }
  assert.equal(s.competitiveClock.completedRounds, 3);
  assert.equal(s.result.victoryReason.kind, 'time_limit');
});
void test('pause and restart freeze both clocks, backward wall time does not refund time', () => {
  let { s, now } = fixture();
  s = tickCompetitiveClock(s, now + 20000, true, rng);
  s = pauseCompetitiveClock(s, now + 20000, true);
  assert.equal(tickCompetitiveClock(s, now + 800000, true, rng), s);
  assert.equal(
    applyCommand(s, { type: 'advance_phase', playerId: s.turn.playerId }).error
      .code,
    'GAME_PAUSED',
  );
  const resumed = pauseCompetitiveClock(s, now + 800000, false);
  assert.equal(resumed.competitiveClock.activationRemainingMs, 100000);
  const restarted = startCompetitiveClock(resumed, now + 2000000, true);
  assert.equal(restarted.competitiveClock.elapsedMs, 20000);
  assert.equal(restarted.competitiveClock.pauseReason, 'restart');
  const continuing = pauseCompetitiveClock(restarted, now + 3000000, false);
  const backwards = tickCompetitiveClock(continuing, now + 2999990, true, rng);
  assert.equal(backwards.competitiveClock.activationRemainingMs, 100000);
  assert.equal(backwards.competitiveClock.updatedAtMs, now + 3000000);
  const earlyCommand = perform(
    backwards,
    { type: 'advance_phase', playerId: backwards.turn.playerId },
    now + 2999990,
  );
  assert.equal(earlyCommand.competitiveClock.updatedAtMs, now + 3000000);
  assert.equal(earlyCommand.competitiveClock.activationRemainingMs, 100000);
});
void test('technical wait gives five minutes of grace, pauses effective/turn time; reconnect retains balance', () => {
  let { s, now, a } = fixture();
  s = tickCompetitiveClock(s, now + 30000, false, rng);
  assert.equal(s.competitiveClock.pauseReason, 'disconnection');
  assert.equal(s.competitiveClock.activationRemainingMs, 90000);
  s = tickCompetitiveClock(s, now + 230000, false, rng);
  assert.equal(s.competitiveClock.technicalRemainingMs, 100000);
  assert.equal(s.competitiveClock.elapsedMs, 30000);
  s = tickCompetitiveClock(s, now + 240000, true, rng);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  assert.equal(s.turn.playerId, a);
  assert.equal(s.competitiveClock.activationRemainingMs, 90000);
  assert.equal(s.competitiveClock.elapsedMs, 30000);
});
function borderTerms(s, a, b) {
  const [from, to] = TERRITORY_IDS.flatMap((id) =>
    s.territories[id].ownerId === a
      ? TERRITORIES[id].adjacentTerritoryIds
          .filter((t) => s.territories[t].ownerId === b)
          .map((t) => [id, t])
      : [],
  )[0];
  return { kind: 'border_non_aggression', territoryIds: [from, to] };
}
void test('after grace and turn time the player is absent: pacts end, turns pass alone until reconnection', () => {
  let { s, now, a } = fixture();
  s = { ...s, competitiveBotsReplaceAbsent: false };
  const b = s.players.find(
    (p) =>
      p.id !== a &&
      TERRITORY_IDS.some(
        (id) =>
          s.territories[id].ownerId === a &&
          TERRITORIES[id].adjacentTerritoryIds.some(
            (t) => s.territories[t].ownerId === p.id,
          ),
      ),
  ).id;
  const proposalId = randomUUID();
  s = perform(s, {
    type: 'propose_pact',
    playerId: a,
    recipientId: b,
    proposalId,
    terms: borderTerms(s, a, b),
  });
  s = perform(s, {
    type: 'accept_pact',
    playerId: b,
    proposalId,
    pactId: randomUUID(),
  });
  const before = s.territories;
  s = tickCompetitiveClock(s, now, false, rng);
  s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  assert.equal(s.turn.playerId, a);
  // The turn clock now runs; reconnecting here would still let them play.
  s = tickCompetitiveClock(s, (now += 119999), false, rng);
  assert.equal(s.turn.playerId, a);
  assert.equal(s.competitiveClock.elapsedMs, 119999);
  s = tickCompetitiveClock(s, now + 1, false, rng);
  const absent = s.players.find((p) => p.id === a);
  assert.equal(absent.absent, true);
  assert.equal(absent.disqualified, undefined);
  assert.equal(s.pacts.active.length, 0);
  assert.deepEqual(s.territories, before);
  assert.notEqual(s.turn.playerId, a);
  assertClassicInvariants(s);
  // While still away, their activations pass at once.
  for (let i = 0; i < 20 && s.turn.playerId !== a; i++) s = expire(s);
  assert.equal(s.turn.playerId, a);
  now = s.competitiveClock.updatedAtMs;
  s = tickCompetitiveClock(s, now + 1, false, rng);
  assert.notEqual(s.turn.playerId, a);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  for (let i = 0; i < 20 && s.turn.playerId !== a; i++) s = expire(s);
  // Back online, they take their seat again.
  now = s.competitiveClock.updatedAtMs;
  s = tickCompetitiveClock(s, now + 1, true, rng);
  assert.equal(s.turn.playerId, a);
  assert.equal(s.players.find((p) => p.id === a).absent, undefined);
  assert.equal(deriveLegalActions(s, a).readOnly, false);
  assertClassicInvariants(s);
});
void test('absence during initial setup places troops automatically and completes legal preparation', () => {
  let { s, now, a } = fixture(4, false);
  s = { ...s, competitiveBotsReplaceAbsent: false };
  s = tickCompetitiveClock(s, now, false, rng);
  s = tickCompetitiveClock(s, (now += TECHNICAL_WAIT_MS), false, rng);
  s = tickCompetitiveClock(s, now + 120000, false, rng);
  assert.equal(s.players.find((p) => p.id === a).absent, true);
  assert.notEqual(s.setup.currentPlayerId, a);
  while (s.status === 'SETUP') {
    s = expire(s);
    assertClassicInvariants(s);
  }
  assertClassicInvariants(s);
  const owned = TERRITORY_IDS.filter((t) => s.territories[t].ownerId === a);
  assert.equal(
    owned.reduce((n, t) => n + s.territories[t].armies, 0),
    owned.length + 8,
  );
});
void test('last selected own country is persisted and receives remaining ordinary armies on expiry', () => {
  let { s, a } = fixture();
  while (s.turn.round.kind === 'initial_hostility') s = close(s);
  a = s.turn.playerId;
  const country = TERRITORY_IDS.find((t) => s.territories[t].ownerId === a);
  s = selectCompetitiveTerritory(s, a, country);
  const count = s.territories[country].armies;
  const due = s.turn.reinforcementArmiesRemaining;
  const clock = s.competitiveClock.activationRemainingMs;
  s = tickCompetitiveClock(
    s,
    s.competitiveClock.updatedAtMs + 30000,
    true,
    rng,
  );
  assert.equal(s.competitiveClock.activationRemainingMs, clock - 30000);
  s = expire(s);
  assert.equal(s.territories[country].armies, count + due);
  assert.notEqual(s.turn.playerId, a);
  assertClassicInvariants(s);
});
void test('timeout completes pending conquest with one troop and no additional attack or regroup', () => {
  let { s, a, b } = fixture();
  s = {
    ...s,
    territories: {
      ...s.territories,
      oregon: { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 },
      yukon: { ownerId: a, armies: 0, fixedArmiesThisTurn: 0 },
    },
    turn: {
      ...s.turn,
      lastConqueredTerritoryId: 'yukon',
      conqueredTerritoryIds: ['yukon'],
      cardClaimEligible: true,
    },
    pendingAction: {
      kind: 'conquest_transfer',
      playerId: a,
      fromTerritoryId: 'oregon',
      conqueredTerritoryId: 'yukon',
      maximumArmies: 3,
    },
  };
  s = expire(s);
  assert.equal(s.pendingAction, undefined);
  assert.equal(s.territories.yukon.armies, 1);
  assert.equal(s.territories.oregon.armies, 4);
  assert.equal(s.players.find((p) => p.id === a).cards.length, 0);
  void b;
});
function inheritanceFixture(ownCards, otherCards) {
  let { s, now, a, b } = fixture();
  const c = s.players.find((p) => p.id !== a && p.id !== b).id;
  s = giveCards(s, a, s.cardDeck.drawPile.slice(0, ownCards));
  s = giveCards(s, b, s.cardDeck.drawPile.slice(0, otherCards));
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a
        ? {
            ...p,
            secretObjectiveId: 'occupation_09',
            effectiveDestructionTargetPlayerId: undefined,
          }
        : p,
    ),
    territories: Object.fromEntries(
      Object.entries(s.territories).map(([t, v]) => [
        t,
        t === 'oregon'
          ? { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 }
          : t === 'yukon'
            ? { ownerId: b, armies: 1, fixedArmiesThisTurn: 0 }
            : v.ownerId === b
              ? { ...v, ownerId: c }
              : v,
      ]),
    ),
  };
  let rolls = 0;
  const attack = applyCommand(
    s,
    { type: 'attack', playerId: a, from: 'oregon', to: 'yukon' },
    { dice: { rollDie: () => (++rolls <= 3 ? 6 : 1) } },
  );
  assert.equal(attack.ok, true);
  s = synchronizeCompetitiveClock(s, attack.state, now);
  return { s, now, a, b };
}
void test('inheritance choice completes to five, is private, rejects wrong amount and discards excess', () => {
  let { s, a, b } = inheritanceFixture(4, 3);
  assert.equal(s.pendingInheritance.takeCount, 1);
  assert.equal(s.players.find((p) => p.id === a).cards.length, 4);
  const mine = projectGameFor(s, 0, a),
    other = projectGameFor(s, 0, b);
  assert.equal(mine.private.inheritedCards.length, 3);
  assert.equal(other.private.inheritedCards, undefined);
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: mine,
  });
  assert.equal(projectGameForAdmin(s, 0).pendingInheritance.cardCount, 3);
  assert.equal(
    applyCommand(s, {
      type: 'select_inherited_cards',
      playerId: a,
      cardIds: s.pendingInheritance.cards.slice(0, 2).map((c) => c.cardId),
    }).ok,
    false,
  );
  const selected = s.pendingInheritance.cards[1].cardId;
  const discarded = s.pendingInheritance.cards
    .filter((c) => c.cardId !== selected)
    .map((c) => c.cardId);
  s = perform(s, {
    type: 'select_inherited_cards',
    playerId: a,
    cardIds: [selected],
  });
  assert.equal(s.pendingInheritance, undefined);
  assert.equal(s.players.find((p) => p.id === a).cards.length, 5);
  assert.equal(
    s.players.find((p) => p.id === a).cards.some((c) => c.cardId === selected),
    true,
  );
  for (const id of discarded)
    assert.equal(s.cardDeck.discardPile.includes(id), true);
});
void test('inheritance fills only available capacity, full hand loses incoming cards, no automatic exchange', () => {
  for (const [own, other] of [
    [0, 3],
    [1, 4],
    [2, 3],
    [3, 2],
    [4, 1],
    [5, 3],
  ]) {
    const { s, a } = inheritanceFixture(own, other);
    assert.equal(s.pendingInheritance, undefined);
    assert.equal(
      s.players.find((p) => p.id === a).cards.length,
      Math.min(5, own + other),
    );
    assert.equal(s.players.find((p) => p.id === a).completedExchangeCount, 0);
  }
});
void test('absence or expiry chooses inheritance via injected RNG; no late claim survives', () => {
  for (const absent of [true, false]) {
    let { s, a, now } = inheritanceFixture(4, 3);
    const expected = rng.shuffle(s.pendingInheritance.cards)[0].cardId;
    s = tickCompetitiveClock(s, now + (absent ? 0 : TURN_MS), !absent, rng);
    assert.equal(s.pendingInheritance, undefined);
    assert.equal(s.players.find((p) => p.id === a).cards.length, 5);
    assert.equal(
      s.players
        .find((p) => p.id === a)
        .cards.some((c) => c.cardId === expected),
      true,
    );
    assert.equal(
      applyCommand(s, {
        type: 'select_inherited_cards',
        playerId: a,
        cardIds: [expected],
      }).ok,
      false,
    );
  }
});
void test('five cards prevent new draw; competitive can skip exchange and Classic rules remain unchanged', () => {
  let { s, a } = fixture();
  s = giveCards(s, a, s.cardDeck.drawPile.slice(0, 5));
  s = advance(advance(s));
  s = { ...s, turn: { ...s.turn, cardClaimEligible: true } };
  assert.equal(
    applyCommand(s, { type: 'claim_card', playerId: a }, { shuffle: rng }).error
      .code,
    'CARD_LIMIT',
  );
  assert.equal(deriveLegalActions(s, a).actions.includes('claim_card'), false);
  s = close(s);
  while (!(
    s.turn.round.kind === 'normal' &&
    s.turn.round.pass === 'incorporation' &&
    s.turn.playerId === a
  ))
    s = expire(s);
  const six = s.cardDeck.drawPile[0];
  s = giveCards(s, a, [
    ...s.players.find((p) => p.id === a).cards.map((c) => c.cardId),
    six,
  ]);
  assert.equal(
    applyCommand(s, { type: 'advance_phase', playerId: a }).ok,
    true,
  );
  assert.equal(
    applyCommand(
      { ...s, mode: 'classic', competitiveClock: undefined },
      { type: 'advance_phase', playerId: a },
    ).error.code,
    'MANDATORY_EXCHANGE',
  );
});
void test('new ruptures are blocked at announcement while established waits persist', () => {
  let { s, a, b, now } = fixture();
  s = perform(s, {
    type: 'propose_pact',
    playerId: a,
    recipientId: b,
    proposalId: randomUUID(),
    terms: borderTerms(s, a, b),
  });
  const id = randomUUID();
  s = perform(s, {
    type: 'accept_pact',
    playerId: b,
    proposalId: s.pacts.proposals[0].id,
    pactId: id,
  });
  s = {
    ...s,
    competitiveClock: {
      ...s.competitiveClock,
      elapsedMs: competitiveDurationMs(5) - 1,
    },
  };
  s = tickCompetitiveClock(s, now + 1, true, rng);
  assert.equal(
    applyCommand(s, { type: 'withdraw_pact', playerId: a, pactId: id }).ok,
    false,
  );
  assert.equal(deriveLegalActions(s, a).pactIdsToWithdraw.length, 0);
});
void test('victory scoring requires six already completed rounds, independent of initial setup', () => {
  for (const completedRounds of [0, 5, 6]) {
    let { s, a } = fixture();
    s = { ...s, competitiveClock: { ...s.competitiveClock, completedRounds } };
    const countries = TERRITORY_IDS.slice(0, 30).filter((t) => t !== 'yukon');
    const c = s.players.find((p) => p.id !== a).id;
    s = {
      ...s,
      territories: Object.fromEntries(
        Object.entries(s.territories).map(([t, v]) => [
          t,
          t === 'alaska'
            ? { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 }
            : t === 'yukon'
              ? { ownerId: c, armies: 1, fixedArmiesThisTurn: 0 }
              : countries.includes(t)
                ? { ...v, ownerId: a }
                : v.ownerId === a
                  ? { ...v, ownerId: c }
                  : v,
        ]),
      ),
    };
    let dice = 0;
    const result = applyCommand(
      s,
      { type: 'attack', playerId: a, from: 'alaska', to: 'yukon' },
      { dice: { rollDie: () => (++dice <= 3 ? 6 : 1) } },
    );
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'FINISHED');
    assert.equal(result.state.result.scoringEligible, completedRounds >= 6);
  }
});
void test('file restart/migration retains balances, selection and card identities; recovery pauses', async () => {
  let { s, a, now } = fixture();
  s = tickCompetitiveClock(s, now + 23000, true, rng);
  const envelope = encodeGame(durable(s));
  assert.equal(envelope.gameSchemaVersion, 12);
  assert.deepEqual(
    decodeGame(envelope).game.state,
    encodeGame(durable(s)).game.state,
  );
  const directory = await mkdtemp(join(tmpdir(), 'ted-clock-restart-'));
  let store = await FileGameStore.open(directory);
  try {
    await store.commitGame(durable(s), { revision: null });
    await store.close();
    store = await FileGameStore.open(directory);
    const service = new GameService(store, undefined, () => now + 10_000_000);
    await service.recoverClock(s.id);
    const recovered = await store.loadGame(s.id);
    assert.equal(recovered.state.competitiveClock.activationRemainingMs, 97000);
    assert.equal(recovered.state.competitiveClock.elapsedMs, 23000);
    assert.equal(recovered.state.competitiveClock.pauseReason, 'restart');
    assert.equal(
      (
        await service.process(s.id, a, {
          type: 'COMMAND',
          protocolVersion: PROTOCOL_VERSION,
          commandId: randomUUID(),
          baseRevision: recovered.revision,
          command: { type: 'advance_phase' },
        })
      ).code,
      'GAME_PAUSED',
    );
    await service.pause(s.id, false);
    assert.equal(
      (await store.loadGame(s.id)).state.competitiveClock.activationRemainingMs,
      97000,
    );
    const old = encodeGame(durable({ ...s, competitiveClock: undefined }));
    old.gameSchemaVersion = 8;
    delete old.game.state.definition;
    delete old.game.state.competitiveHistory;
    assert.equal(decodeGame(old).game.state.mode, 'competitive');
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('command at exact deadline cannot commit late action; failed clock commit leaves durable state intact', async () => {
  const { s, a, now } = fixture();
  let stored = durable(s);
  let fail = false;
  const store = {
    loadGame: () => Promise.resolve(stored),
    commitGame: (candidate) => {
      if (fail)
        return Promise.reject(
          new PersistenceFailedError('injected', new Error('test fault')),
        );
      stored = candidate;
      return Promise.resolve({ outcome: 'COMMITTED' });
    },
  };
  const service = new GameService(store, undefined, () => now + TURN_MS);
  const message = {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: 0,
    command: { type: 'advance_phase' },
  };
  fail = true;
  assert.equal((await service.process(s.id, a, message)).kind, 'FAILED');
  assert.equal(stored.revision, 0);
  assert.equal(stored.state.turn.playerId, a);
  fail = false;
  assert.equal(
    (await service.process(s.id, a, message)).code,
    'STALE_REVISION',
  );
  assert.equal(stored.revision, 1);
  assert.notEqual(stored.state.turn.playerId, a);
});
void test('all owned countries may be zones: timeout loses only unplaceable armies and preserves pacts', () => {
  let { s, a, b } = fixture();
  const c = s.players.find((p) => p.id !== a && p.id !== b).id;
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a ? { ...p, completedExchangeCount: 3 } : p,
    ),
    territories: Object.fromEntries(
      Object.entries(s.territories).map(([t, v]) => [
        t,
        ['alaska', 'yukon'].includes(t)
          ? { ownerId: a, armies: 1, fixedArmiesThisTurn: 0 }
          : ['oregon', 'canada'].includes(t)
            ? { ownerId: b, armies: 5, fixedArmiesThisTurn: 0 }
            : v.ownerId === a
              ? { ...v, ownerId: c }
              : v,
      ]),
    ),
  };
  // Zones are no longer offered in Competitive, but older games may hold them.
  s = {
    ...s,
    pacts: {
      ...s.pacts,
      active: ['alaska', 'yukon'].map((country) => ({
        kind: 'international_zone',
        id: randomUUID(),
        parties: [a, b],
        terms: {
          kind: 'international_zone',
          territoryId: country,
          firstExpectedConquerorId: b,
        },
        expectedConquerorId: b,
        withdrawal: { kind: 'none' },
      })),
    },
  };
  assertClassicInvariants(s);
  while (!(
    s.turn.round.kind === 'normal' &&
    s.turn.round.pass === 'incorporation' &&
    s.turn.playerId === a
  ))
    s = expire(s);
  assert.equal(deriveLegalActions(s, a).reinforcementChoices.length, 0);
  const due = s.turn.reinforcementArmiesRemaining;
  s = expire(s);
  assert.equal(s.competitiveClock.lastExpiredPlayerId, a);
  assert.equal(s.competitiveClock.lastUnplacedArmiesLost, due);
  assert.equal(s.pacts.active.length, 2);
  assert.equal(s.territories.alaska.armies, 1);
  assert.equal(s.territories.yukon.armies, 1);
  assert.notEqual(s.turn.playerId, a);
  assertClassicInvariants(s);
});
void test('HTTP admin pause authorization and real WebSocket presence drive scheduler and resume', async () => {
  const { s, a, now } = fixture(4);
  let timestamp = now;
  const directory = await mkdtemp(join(tmpdir(), 'ted-clock-http-'));
  const store = await FileGameStore.open(directory);
  const tokens = s.players.map(() => randomBytes(32).toString('base64url'));
  const initial = durable({ ...s, competitiveBotsReplaceAbsent: false });
  initial.auth.players = Object.fromEntries(
    s.players.map((p, i) => [
      p.id,
      {
        playerId: p.id,
        session: {
          ...initial.auth.players[p.id].session,
          verifier: {
            algorithm: 'sha256',
            digest: createHash('sha256').update(tokens[i]).digest('base64url'),
          },
        },
      },
    ]),
  );
  await store.commitGame(initial, { revision: null });
  const auth = new AuthenticationService(store);
  const code = await auth.initializeAdmin();
  const origin = 'http://clock-test.local';
  const server = buildServer({
    store,
    logger: false,
    clockNow: () => timestamp,
    clockIntervalMs: 10,
    publicOrigin: origin,
  });
  const sockets = [];
  async function eventually(predicate) {
    for (let i = 0; i < 150; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Scheduler condition was not reached');
  }
  async function connect(index) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.server.address().port}/api/games/${s.id}/live`,
      `classic-v${PROTOCOL_VERSION}`,
      {
        headers: {
          origin,
          cookie: `${sessionCookieName({ kind: 'player', gameId: s.id }, 'HTTP')}=${tokens[index]}`,
        },
      },
    );
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'HELLO') resolve();
      });
      socket.once('error', reject);
      socket.once('close', (code, reason) =>
        reject(new Error(`Socket closed before HELLO: ${code} ${reason}`)),
      );
    });
    return socket;
  }
  try {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const path = `/api/admin/games/${s.id}/pause`;
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers: { origin },
          payload: { paused: false },
        })
      ).statusCode,
      401,
    );
    const login = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { recoveryCode: code },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      origin,
      cookie: [login.headers['set-cookie']]
        .flat()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers,
          payload: { paused: false },
        })
      ).statusCode,
      409,
    );
    for (let i = 0; i < s.players.length; i++) await connect(i);
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers,
          payload: { paused: false },
        })
      ).statusCode,
      200,
    );
    timestamp += 10000;
    await eventually(
      async () =>
        (await store.loadGame(s.id)).state.competitiveClock
          .activationRemainingMs === 110000,
    );
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers,
          payload: { paused: true },
        })
      ).statusCode,
      200,
    );
    timestamp += 100000;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      (await store.loadGame(s.id)).state.competitiveClock.activationRemainingMs,
      110000,
    );
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers,
          payload: { paused: false },
        })
      ).statusCode,
      200,
    );
    const actorIndex = s.players.findIndex((p) => p.id === a);
    sockets[actorIndex].close();
    await eventually(
      async () =>
        (await store.loadGame(s.id)).state.competitiveClock.pauseReason ===
        'disconnection',
    );
    const waiting = await store.loadGame(s.id);
    assert.equal(
      waiting.state.competitiveClock.technicalRemainingMs,
      TECHNICAL_WAIT_MS,
    );
    timestamp += TECHNICAL_WAIT_MS;
    await eventually(
      async () =>
        (await store.loadGame(s.id)).state.competitiveClock.pauseReason ===
        undefined,
    );
    timestamp += 110000;
    await eventually(
      async () =>
        (await store.loadGame(s.id)).state.players.find((p) => p.id === a)
          .absent,
    );
    const absent = await store.loadGame(s.id);
    assert.notEqual(absent.state.turn.playerId, a);
    assert.equal(absent.state.competitiveClock.elapsedMs, 120000);
  } finally {
    for (const socket of sockets) socket.terminate();
    await server.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('continental timeout bonuses stay in their continent while ordinary armies use last selection', () => {
  let { s } = fixture(4);
  while (s.turn.round.kind === 'initial_hostility') s = close(s);
  const a = s.turn.playerId;
  const north = TERRITORY_IDS.filter(
    (t) => TERRITORIES[t].continentId === 'north_america',
  );
  s = {
    ...s,
    territories: Object.fromEntries(
      Object.entries(s.territories).map(([t, v]) => [
        t,
        north.includes(t) || t === 'brazil' ? { ...v, ownerId: a } : v,
      ]),
    ),
  };
  const ordinary = Math.max(
    3,
    Math.floor(
      TERRITORY_IDS.filter((t) => s.territories[t].ownerId === a).length / 2,
    ),
  );
  const bonus = CONTINENTS.north_america.reinforcementBonus;
  s = {
    ...s,
    turn: {
      ...s.turn,
      reinforcementArmiesRemaining: ordinary,
      continentReinforcementsRemaining: { north_america: bonus },
    },
  };
  s = selectCompetitiveTerritory(s, a, 'brazil');
  const brazil = s.territories.brazil.armies;
  const before = north.reduce((n, t) => n + s.territories[t].armies, 0);
  s = expire(s);
  assert.equal(s.territories.brazil.armies, brazil + ordinary);
  assert.equal(
    north.reduce((n, t) => n + s.territories[t].armies, 0),
    before + bonus,
  );
  assertClassicInvariants(s);
});
void test('paused/disqualified setup commands are rejected directly by engine', () => {
  let { s, a, now } = fixture(4, false);
  const territory = TERRITORY_IDS.find((t) => s.territories[t].ownerId === a);
  const command = {
    type: 'place_setup_armies',
    playerId: a,
    placements: { [territory]: 1 },
  };
  s = pauseCompetitiveClock(s, now, true);
  assert.equal(applySetupCommand(s, command).error.code, 'GAME_PAUSED');
  s = pauseCompetitiveClock(s, now, false);
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a ? { ...p, disqualified: true } : p,
    ),
  };
  assert.equal(applySetupCommand(s, command).error.code, 'PLAYER_DISQUALIFIED');
});
void test('if all remaining players are disqualified, close without inventing a winner or ranking', () => {
  let { s, now } = fixture(4);
  // Older games could disqualify players for disconnection.
  s = {
    ...s,
    players: s.players.map((p) => ({ ...p, disqualified: true })),
  };
  s = tickCompetitiveClock(s, now, true, rng);
  assert.equal(s.status, 'FINISHED');
  assert.equal(s.result.victoryReason.kind, 'no_competitors');
  assert.equal(s.result.winnerId, undefined);
  assert.equal(s.result.scoringEligible, false);
  assertClassicInvariants(s);
});
void test('shutdown checkpoint failure preserves confirmed state and still closes the server', async () => {
  const { s, now } = fixture(4);
  const directory = await mkdtemp(join(tmpdir(), 'ted-clock-shutdown-fault-'));
  const store = await FileGameStore.open(directory);
  await store.commitGame(durable(s), { revision: null });
  const server = buildServer({
    store,
    logger: false,
    clockNow: () => now,
    clockIntervalMs: 0,
  });
  try {
    await server.ready();
    const before = await store.loadGame(s.id);
    const original = store.commitGame.bind(store);
    store.commitGame = () =>
      Promise.reject(
        new PersistenceFailedError(
          'injected shutdown fault',
          new Error('test fault'),
        ),
      );
    await server.close();
    store.commitGame = original;
    assert.deepEqual(await store.loadGame(s.id), before);
  } finally {
    await server.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test('reconnections share the grace of one activation, including admin pause and persistence', () => {
  let { s, now, a } = fixture();
  s = { ...s, competitiveBotsReplaceAbsent: false };
  s = tickCompetitiveClock(s, ++now, false, rng);
  now += TECHNICAL_WAIT_MS - 1000;
  s = tickCompetitiveClock(s, now, false, rng);
  s = tickCompetitiveClock(s, ++now, true, rng);
  assert.equal(s.competitiveClock.technicalRemainingMs, 999);
  s = pauseCompetitiveClock(s, now, true);
  s = decodeGame(encodeGame(durable(s))).game.state;
  s = startCompetitiveClock(s, now + 10000, true);
  now += 10000;
  s = pauseCompetitiveClock(s, now, false);
  assert.equal(s.competitiveClock.technicalRemainingMs, 999);
  s = tickCompetitiveClock(s, ++now, false, rng);
  assert.equal(s.competitiveClock.technicalRemainingMs, 999);
  now += 999;
  s = tickCompetitiveClock(s, now, false, rng);
  assert.equal(s.competitiveClock.pauseReason, undefined);
  assert.equal(s.turn.playerId, a);
  now += s.competitiveClock.activationRemainingMs;
  s = tickCompetitiveClock(s, now, false, rng);
  assert.equal(s.players.find((p) => p.id === a).absent, true);
  assert.notEqual(s.turn.playerId, a);
  assert.equal(s.competitiveClock.technicalRemainingMs, undefined);
  assertClassicInvariants(s);
});

void test('each activation renews the five minute grace', () => {
  let { s, now, a } = fixture();
  s = tickCompetitiveClock(s, ++now, false, rng);
  s = tickCompetitiveClock(s, (now += 30000), false, rng);
  s = tickCompetitiveClock(s, ++now, true, rng);
  assert.equal(
    s.competitiveClock.technicalRemainingMs,
    TECHNICAL_WAIT_MS - 30001,
  );
  s = close(s);
  assert.notEqual(s.turn.playerId, a);
  assert.equal(s.competitiveClock.technicalRemainingMs, undefined);
  s = tickCompetitiveClock(s, ++now, false, rng);
  assert.equal(s.competitiveClock.technicalRemainingMs, TECHNICAL_WAIT_MS);
  s = tickCompetitiveClock(s, now + 5000, true, rng);
  for (let i = 0; i < 20 && s.turn.playerId !== a; i++) s = expire(s);
  assert.equal(s.turn.playerId, a);
  now = s.competitiveClock.updatedAtMs;
  s = tickCompetitiveClock(s, now + 1, false, rng);
  assert.equal(s.competitiveClock.technicalRemainingMs, TECHNICAL_WAIT_MS);
  assertClassicInvariants(s);
});

void test('clock-only revisions allow delayed intentions, but not stale gameplay, future revisions or replay', async () => {
  const { s, now, a } = fixture();
  let timestamp = now,
    record = durable(s);
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
    () => true,
  );
  for (let i = 0; i < 10; i++) {
    timestamp += 1000;
    await service.tick(s.id);
  }
  assert.equal(record.revision, 10);
  const payload = {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: 0,
    command: { type: 'advance_phase' },
  };
  assert.equal(
    (await service.process(s.id, a, { ...payload, baseRevision: 11 })).code,
    'STALE_REVISION',
  );
  assert.equal(
    (await service.process(s.id, a, payload, () => false)).code,
    'UNAUTHORIZED',
  );
  assert.equal((await service.process(s.id, a, payload)).kind, 'COMMITTED');
  assert.equal(record.state.turn.phase, 'regroup');
  timestamp += 1000;
  await service.tick(s.id);
  assert.equal((await service.process(s.id, a, payload)).kind, 'DUPLICATE');
  assert.equal(
    (await service.process(s.id, a, { ...payload, commandId: randomUUID() }))
      .code,
    'STALE_REVISION',
  );
  // A different GameService (restart) knows no safe revision range.
  const restarted = new GameService(
    store,
    undefined,
    () => timestamp,
    () => true,
  );
  assert.equal(
    (
      await restarted.process(s.id, a, {
        ...payload,
        commandId: randomUUID(),
        baseRevision: record.revision - 1,
      })
    ).code,
    'STALE_REVISION',
  );
});

void test('clock revision tolerance ends at expiry, final announcement and changed authentication', async () => {
  for (const boundary of ['expiry', 'final', 'auth']) {
    const { s, now, a } = fixture();
    let timestamp = now,
      record = durable(s);
    if (boundary === 'final')
      record = {
        ...record,
        state: {
          ...s,
          competitiveClock: {
            ...s.competitiveClock,
            elapsedMs: competitiveDurationMs(5) - 1500,
          },
        },
      };
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
      () => true,
    );
    timestamp += 1000;
    await service.tick(s.id);
    if (boundary === 'auth')
      record = {
        ...record,
        auth: { ...record.auth, generation: record.auth.generation + 1 },
      };
    else {
      timestamp += boundary === 'expiry' ? TURN_MS : 1000;
      await service.tick(s.id);
    }
    const outcome = await service.process(s.id, a, {
      type: 'COMMAND',
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      baseRevision: 0,
      command: { type: 'advance_phase' },
    });
    assert.equal(outcome.code, 'STALE_REVISION', boundary);
  }
});

void test('a delayed command crossing a clock boundary commits the boundary and requests broadcast', async () => {
  const { s, now, a } = fixture();
  let timestamp = now,
    record = durable(s);
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
    () => true,
  );
  timestamp += 1000;
  await service.tick(s.id);
  timestamp += TURN_MS;
  const outcome = await service.process(s.id, a, {
    type: 'COMMAND',
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    baseRevision: 0,
    command: { type: 'advance_phase' },
  });
  assert.equal(outcome.code, 'STALE_REVISION');
  assert.equal(outcome.stateChanged, true);
  assert.notEqual(record.state.turn.playerId, a);
});

void test('obsolete WebSocket commands update only their sender; limits span tabs and bound pending work', async () => {
  const { DEFAULT_RATE_LIMIT_POLICIES } =
    await import('../apps/server/dist/security/rate-limiter.js');
  for (const mode of ['classic', 'competitive']) {
    const f = fixture(4);
    let s = f.s;
    if (mode === 'classic') {
      let n = 0;
      s = createClassicSetup(
        randomUUID(),
        s.players,
        { shuffle: (items) => [...items], rollDie: () => (n++ % 6) + 1 },
        'classic',
      );
    }
    const directory = await mkdtemp(join(tmpdir(), 'ted-command-limits-'));
    const store = await FileGameStore.open(directory);
    const tokens = s.players.map(() => randomBytes(32).toString('base64url'));
    const initial = durable(s);
    initial.revision = 1;
    s.players.forEach((p, i) => {
      initial.auth.players[p.id].session.verifier.digest = createHash('sha256')
        .update(tokens[i])
        .digest('base64url');
    });
    await store.commitGame(initial, { revision: null });
    const origin = 'http://limits-test.local';
    const server = buildServer({
      store,
      logger: false,
      publicOrigin: origin,
      clockIntervalMs: 0,
      clockNow: () => f.now,
      rateLimitNow: () => 0,
      rateLimitPolicies: {
        ...DEFAULT_RATE_LIMIT_POLICIES,
        'game-command': {
          windowMs: 1000,
          source: 30,
          target: 120,
          global: 600,
        },
      },
    });
    const sockets = [];
    const connect = async (index) => {
      const messages = [];
      const socket = new WebSocket(
        `ws://127.0.0.1:${server.server.address().port}/api/games/${s.id}/live`,
        `classic-v${PROTOCOL_VERSION}`,
        {
          headers: {
            origin,
            cookie: `${sessionCookieName({ kind: 'player', gameId: s.id }, 'HTTP')}=${tokens[index]}`,
          },
        },
      );
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.on('message', (data) => {
          const m = JSON.parse(data.toString());
          messages.push(m);
          if (m.type === 'STATE') resolve();
        });
        socket.once('error', reject);
      });
      return { socket, messages };
    };
    const sendObsolete = async (client) => {
      const commandId = randomUUID();
      const response = new Promise((resolve, reject) => {
        const listener = (data) => {
          const m = JSON.parse(data.toString());
          if (
            m.type === 'ERROR' ||
            (m.type === 'COMMAND_REJECTED' && m.commandId === commandId)
          ) {
            client.socket.off('message', listener);
            client.socket.off('error', reject);
            resolve(m);
          }
        };
        client.socket.on('message', listener);
        client.socket.once('error', reject);
      });
      client.socket.send(
        JSON.stringify({
          type: 'COMMAND',
          protocolVersion: PROTOCOL_VERSION,
          commandId,
          baseRevision: 0,
          command: { type: 'advance_phase' },
        }),
      );
      return response;
    };
    try {
      await server.listen({ host: '127.0.0.1', port: 0 });
      const sender = await connect(0),
        otherTab = await connect(0),
        observer = await connect(1);
      const observerStates = observer.messages.filter(
        (m) => m.type === 'STATE',
      ).length;
      const otherTabStates = otherTab.messages.filter(
        (m) => m.type === 'STATE',
      ).length;
      for (let i = 0; i < 30; i++)
        assert.equal(
          (await sendObsolete(i % 2 ? sender : otherTab)).code,
          'STALE_REVISION',
        );
      assert.equal(
        observer.messages.filter((m) => m.type === 'STATE').length,
        observerStates,
      );
      assert.equal(
        otherTab.messages.filter((m) => m.type === 'STATE').length,
        otherTabStates + 15,
      );
      const limited = await sendObsolete(sender);
      assert.equal(limited.code, 'RATE_LIMITED');
      assert.equal(
        (await store.loadGame(s.id)).revision,
        mode === 'competitive' ? 2 : 1,
      );
      // Passive tabs also share a finite connection budget, independent of messages.
      const extraTabs = [];
      for (let i = 0; i < 8; i++) extraTabs.push(await connect(2));
      const excess = new WebSocket(
        `ws://127.0.0.1:${server.server.address().port}/api/games/${s.id}/live`,
        `classic-v${PROTOCOL_VERSION}`,
        {
          headers: {
            origin,
            cookie: `${sessionCookieName({ kind: 'player', gameId: s.id }, 'HTTP')}=${tokens[2]}`,
          },
        },
      );
      sockets.push(excess);
      const denied = await new Promise((resolve, reject) => {
        const messages = [];
        excess.on('message', (data) => {
          const m = JSON.parse(data.toString());
          messages.push(m);
          if (m.type === 'HELLO')
            reject(new Error('Excess connection was accepted'));
        });
        excess.once('error', reject);
        excess.once('close', (code, reason) =>
          resolve({ code, reason: reason.toString(), messages }),
        );
      });
      assert.equal(denied.code, 1008);
      assert.equal(denied.reason, 'RATE_LIMITED');
      assert.equal(denied.messages[0].code, 'RATE_LIMITED');
      const released = new Promise((resolve) =>
        extraTabs[0].socket.once('close', resolve),
      );
      extraTabs[0].socket.close();
      await released;
      const replacementTab = await connect(2);
      assert.equal(
        replacementTab.messages.some((m) => m.type === 'STATE'),
        true,
      );
      assert.equal(observer.socket.readyState, WebSocket.OPEN);
      // Another player has their own budget, but cannot enqueue arbitrarily many messages.
      const closed = new Promise((resolve) =>
        observer.socket.once('close', (code, reason) =>
          resolve({ code, reason: reason.toString() }),
        ),
      );
      for (let i = 0; i < 12; i++)
        observer.socket.send(
          JSON.stringify({
            type: 'COMMAND',
            protocolVersion: PROTOCOL_VERSION,
            commandId: randomUUID(),
            baseRevision: 0,
            command: { type: 'advance_phase' },
          }),
        );
      assert.deepEqual(await closed, { code: 1008, reason: 'RATE_LIMITED' });
    } finally {
      for (const socket of sockets) socket.terminate();
      await server.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
