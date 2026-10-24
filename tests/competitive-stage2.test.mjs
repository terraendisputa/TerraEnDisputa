import { GameService } from '../apps/server/dist/games/game-service.js';
import { PerGameCoordinator } from '../apps/server/dist/games/per-game-coordinator.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClassicSetup,
  applySetupCommand,
  applyCommand,
  pactBlocks,
  deriveLegalActions,
  assertClassicInvariants,
  TERRITORY_IDS,
  TERRITORIES,
  PLAYER_COLORS,
  blockedByZone,
  isActiveInternationalZone,
} from '../packages/game-engine/dist/index.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
const shuffle = { shuffle: (items) => [...items] };
function fixture(mode = 'competitive', count = 5) {
  const players = Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    nickname: `P${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
  let die = 0;
  let s = createClassicSetup(
    randomUUID(),
    players,
    { ...shuffle, rollDie: () => (die++ % 6) + 1 },
    mode,
  );
  while (s.status === 'SETUP') {
    const id = s.setup.currentPlayerId;
    let due = s.setup.armiesRemainingInActivation;
    const counts = { ...s.setup.additionalArmiesByPlayerContinent[id] };
    const placements = {};
    for (const t of TERRITORY_IDS.filter(
      (t) => s.territories[t].ownerId === id,
    )) {
      const continent = TERRITORIES[t].continentId;
      const amount = Math.min(
        due,
        mode === 'competitive' ? 4 - (counts[continent] ?? 0) : due,
      );
      if (amount > 0) {
        placements[t] = amount;
        counts[continent] = (counts[continent] ?? 0) + amount;
        due -= amount;
      }
      if (!due) break;
    }
    assert.equal(due, 0);
    s = run(s, { type: 'place_setup_armies', playerId: id, placements }, true);
  }
  const { setup: _setup, ...active } = s;
  void _setup;
  s = active;
  const a = s.turn.playerId;
  const b = s.players.find((p) => p.id !== a).id;
  // Controlled border and zone fixture. Keep card deck, objectives and seats valid.
  s = {
    ...s,
    territories: {
      ...s.territories,
      alaska: { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 },
      yukon: { ownerId: b, armies: 5, fixedArmiesThisTurn: 0 },
      canada: { ownerId: a, armies: 1, fixedArmiesThisTurn: 0 },
      oregon: { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 },
    },
  };
  assertClassicInvariants(s);
  return { s, a, b };
}
function run(s, c, setup = false) {
  const result = setup
    ? applySetupCommand(s, c)
    : applyCommand(s, c, { shuffle, dice: { rollDie: () => 6 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
}
const command = (s, type, extra = {}) =>
  run(s, { type, playerId: s.turn.playerId, ...extra });
const general = { kind: 'general_non_aggression' };
const border = {
  kind: 'border_non_aggression',
  territoryIds: ['alaska', 'yukon'],
};
function offer(s, a, b, terms = general) {
  const proposalId = randomUUID();
  return {
    s: run(s, {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId,
      terms,
    }),
    proposalId,
  };
}
function accepted(s, a, b, terms = general) {
  const o = offer(s, a, b, terms),
    pactId = randomUUID();
  return {
    s: run(o.s, {
      type: 'accept_pact',
      playerId: b,
      proposalId: o.proposalId,
      pactId,
    }),
    pactId,
  };
}
function endHostility(s) {
  while (s.turn.phase !== 'end_of_turn_cards') s = command(s, 'advance_phase');
  return command(s, 'end_turn');
}
function incorporate(s) {
  s = command(s, 'advance_phase');
  const id = s.turn.playerId;
  const t = TERRITORY_IDS.find(
    (t) => s.territories[t].ownerId === id && !isActiveInternationalZone(s, t),
  );
  s = command(s, 'place_reinforcements', {
    placements: { [t]: s.turn.reinforcementArmiesRemaining },
  });
  s = command(s, 'advance_phase');
  if (s.turn.phase === 'continent_reinforcement') {
    const placements = {};
    for (const [c, n] of Object.entries(
      s.turn.continentReinforcementsRemaining,
    )) {
      if (!n) continue;
      const country = TERRITORY_IDS.find(
        (t) =>
          TERRITORIES[t].continentId === c &&
          s.territories[t].ownerId === id &&
          !isActiveInternationalZone(s, t),
      );
      placements[country] = n;
    }
    if (Object.keys(placements).length)
      s = command(s, 'place_reinforcements', { placements });
    s = command(s, 'advance_phase');
  }
  return s;
}
void test('propose only during own attacks, immediate acceptance, 4-player prohibition', () => {
  const { s, a, b } = fixture();
  const p = accepted(s, a, b);
  assert.equal(pactBlocks(p.s, a, b, 'alaska', 'yukon'), true);
  assert.equal(pactBlocks(p.s, b, a, 'yukon', 'alaska'), true);
  for (const phase of ['regroup', 'end_of_turn_cards', 'ordinary_exchange']) {
    const state = { ...s, turn: { ...s.turn, phase } };
    assert.equal(
      applyCommand(state, {
        type: 'propose_pact',
        playerId: a,
        recipientId: b,
        proposalId: randomUUID(),
        terms: general,
      }).ok,
      false,
    );
    assert.equal(
      deriveLegalActions(state, a).actions.includes('propose_pact'),
      false,
    );
  }
  assert.equal(
    applyCommand(s, {
      type: 'propose_pact',
      playerId: b,
      recipientId: a,
      proposalId: randomUUID(),
      terms: general,
    }).ok,
    false,
  );
  const four = fixture('competitive', 4);
  assert.equal(
    applyCommand(four.s, {
      type: 'propose_pact',
      playerId: four.a,
      recipientId: four.b,
      proposalId: randomUUID(),
      terms: general,
    }).ok,
    false,
  );
});
void test('proposal survives attacks/regroup/card; expires only at recipient full end_turn', () => {
  let { s, a, b } = fixture();
  const o = offer(s, a, b);
  s = o.s;
  while (s.turn.playerId !== b) s = endHostility(s);
  for (let i = 0; i < 2; i++) {
    s = command(s, 'advance_phase');
    assert.equal(s.pacts.proposals.length, 1);
  }
  const answer = run(s, {
    type: 'accept_pact',
    playerId: b,
    proposalId: o.proposalId,
    pactId: randomUUID(),
  });
  assert.equal(answer.pacts.active.length, 1);
  s = command(s, 'end_turn');
  assert.equal(s.pacts.proposals.length, 0);
  assert.equal(
    applyCommand(s, {
      type: 'accept_pact',
      playerId: b,
      proposalId: o.proposalId,
      pactId: randomUUID(),
    }).ok,
    false,
  );
});
void test('card acquisition itself does not expire the offer', () => {
  let { s, a, b } = fixture();
  s = offer(s, a, b).s;
  while (s.turn.playerId !== b) s = endHostility(s);
  s = command(command(s, 'advance_phase'), 'advance_phase');
  s = { ...s, turn: { ...s.turn, cardClaimEligible: true } };
  s = command(s, 'claim_card');
  assert.equal(s.pacts.proposals.length, 1);
  s = command(s, 'end_turn');
  assert.equal(s.pacts.proposals.length, 0);
});
void test('proposal to recipient who already played survives until their next complete turn', () => {
  let { s, a, b } = fixture();
  s = endHostility(s);
  const proposer = s.turn.playerId;
  const o = offer(s, proposer, a);
  s = o.s;
  while (!(s.turn.playerId === a && s.turn.phase === 'attack')) {
    s =
      s.turn.round.kind === 'normal' && s.turn.round.pass === 'incorporation'
        ? incorporate(s)
        : endHostility(s);
    assert.equal(s.pacts.proposals.length, 1);
  }
  s = endHostility(s);
  assert.equal(s.pacts.proposals.length, 0);
  void b;
});
void test('all three ruptures release B, preserve only original scope, wait for two B incorporations', () => {
  for (const terms of [
    general,
    border,
    {
      kind: 'international_zone',
      territoryId: 'canada',
      firstExpectedConquerorId: 'placeholder',
    },
  ]) {
    let { s, a, b } = fixture();
    const value =
      terms.kind === 'international_zone'
        ? { ...terms, firstExpectedConquerorId: b }
        : terms;
    if (value.kind === 'international_zone')
      s = {
        ...s,
        players: s.players.map((p) =>
          p.id === a ? { ...p, completedExchangeCount: 3 } : p,
        ),
      };
    const pact = accepted(s, a, b, value);
    s = pact.s;
    assert.equal(
      deriveLegalActions(s, a).pactIdsToWithdraw.includes(pact.pactId),
      true,
    );
    s = command(s, 'withdraw_pact', { pactId: pact.pactId });
    assert.equal(s.pacts.active.length, 0);
    assert.equal(s.pacts.competitiveWithdrawals[0].incorporationsRemaining, 2);
    assert.equal(pactBlocks(s, b, a, 'yukon', 'alaska'), false);
    assert.equal(
      pactBlocks(s, a, b, 'alaska', 'yukon'),
      value.kind !== 'international_zone',
    );
    assert.equal(
      pactBlocks(s, a, b, 'oregon', 'canada'),
      value.kind !== 'border_non_aggression',
    );
    if (value.kind === 'international_zone') {
      assert.equal(blockedByZone(s, b), false);
      assert.equal(isActiveInternationalZone(s, 'canada'), false);
    }
    let count = 0,
      guard = 0;
    while (count < 2 && guard++ < 60) {
      const incorporating =
        s.turn.round.kind === 'normal' && s.turn.round.pass === 'incorporation';
      const isB = s.turn.playerId === b;
      s = incorporating ? incorporate(s) : endHostility(s);
      if (incorporating && isB) count++;
      assert.equal(s.pacts.competitiveWithdrawals.length, count === 2 ? 0 : 1);
      if (count < 2)
        assert.equal(
          s.pacts.competitiveWithdrawals[0].incorporationsRemaining,
          2 - count,
        );
      assertClassicInvariants(s);
    }
    assert.equal(count, 2);
  }
});
void test('distinct compatible pacts coexist, duplicates and contradictory zones rejected', () => {
  let { s, a, b } = fixture();
  s = accepted(s, a, b, border).s;
  s = accepted(s, a, b, general).s;
  assert.equal(s.pacts.active.length, 2);
  assert.equal(
    applyCommand(s, {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId: randomUUID(),
      terms: border,
    }).ok,
    false,
  );
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a ? { ...p, completedExchangeCount: 3 } : p,
    ),
  };
  const zone = {
    kind: 'international_zone',
    territoryId: 'canada',
    firstExpectedConquerorId: b,
  };
  assert.equal(
    applyCommand(s, {
      type: 'propose_pact',
      playerId: a,
      recipientId: b,
      proposalId: randomUUID(),
      terms: zone,
    }).ok,
    false,
  );
  const one = fixture();
  const o = offer(one.s, one.a, one.b);
  assert.equal(
    applyCommand(o.s, {
      type: 'propose_pact',
      playerId: one.a,
      recipientId: one.b,
      proposalId: randomUUID(),
      terms: general,
    }).ok,
    false,
  );
});
void test('acceptance revalidates ownership and supports pending transfer without resolving it', () => {
  let { s, a, b } = fixture();
  const o = offer(s, a, b, border);
  const invalid = {
    ...o.s,
    territories: {
      ...o.s.territories,
      yukon: {
        ...o.s.territories.yukon,
        ownerId: s.players.find((p) => p.id !== a && p.id !== b).id,
      },
    },
  };
  assert.equal(
    applyCommand(invalid, {
      type: 'accept_pact',
      playerId: b,
      proposalId: o.proposalId,
      pactId: randomUUID(),
    }).ok,
    false,
  );
  const pending = {
    kind: 'conquest_transfer',
    playerId: a,
    fromTerritoryId: 'oregon',
    conqueredTerritoryId: 'canada',
    maximumArmies: 3,
  };
  s = { ...o.s, pendingAction: pending };
  const done = run(s, {
    type: 'accept_pact',
    playerId: b,
    proposalId: o.proposalId,
    pactId: randomUUID(),
  });
  assert.deepEqual(done.pendingAction, pending);
  assert.equal(done.turn.playerId, a);
  const cancelled = run(s, {
    type: 'cancel_pact',
    playerId: a,
    proposalId: o.proposalId,
  });
  assert.deepEqual(cancelled.pendingAction, pending);
});
void test('Classic keeps immediate pacts, indefinite proposals, symmetric withdrawal including international zones', () => {
  let { s, a, b } = fixture('classic');
  s = offer(s, a, b).s;
  while (s.turn.playerId !== b) s = endHostility(s);
  s = endHostility(s);
  assert.equal(s.pacts.proposals.length, 1);
  const id = randomUUID();
  s = run(s, {
    type: 'accept_pact',
    playerId: b,
    proposalId: s.pacts.proposals[0].id,
    pactId: id,
  });
  while (!(s.turn.playerId === a && s.turn.phase === 'attack'))
    s =
      s.turn.round.kind === 'normal' && s.turn.round.pass === 'incorporation'
        ? incorporate(s)
        : endHostility(s);
  s = command(s, 'withdraw_pact', { pactId: id });
  assert.equal(pactBlocks(s, b, a, 'yukon', 'alaska'), true);
  assert.equal(s.pacts.competitiveWithdrawals, undefined);
  const z = fixture('classic');
  const state = {
    ...z.s,
    players: z.s.players.map((p) =>
      p.id === z.a ? { ...p, completedExchangeCount: 3 } : p,
    ),
  };
  const pact = accepted(state, z.a, z.b, {
    kind: 'international_zone',
    territoryId: 'canada',
    firstExpectedConquerorId: z.b,
  });
  assert.equal(
    applyCommand(pact.s, {
      type: 'withdraw_pact',
      playerId: z.a,
      pactId: pact.pactId,
    }).ok,
    true,
  );
});
void test('cooldowns persist through file restart, project publicly, legacy schema7 preserves contracts', async () => {
  let { s, a, b } = fixture();
  const pact = accepted(s, a, b);
  s = command(pact.s, 'withdraw_pact', { pactId: pact.pactId });
  const durable = {
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
  assert.deepEqual(decodeGame(encodeGame(durable)).game.state, s);
  const directory = await mkdtemp(join(tmpdir(), 'ted-comp-stage2-'));
  try {
    const store = await FileGameStore.open(directory);
    await store.commitGame(durable, { revision: null });
    await store.close();
    const reopened = await FileGameStore.open(directory);
    try {
      assert.deepEqual((await reopened.loadGame(s.id)).state, s);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const view = projectGameFor(s, 0, a);
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: view,
  });
  assert.equal(view.pacts.competitiveWithdrawals[0].incorporationsRemaining, 2);
  const old = encodeGame({ ...durable, state: pact.s });
  old.gameSchemaVersion = 7;
  delete old.game.state.definition;
  delete old.game.state.competitiveHistory;
  const { definition: oldDefinition, ...oldState } = decodeGame(old).game.state;
  assert.deepEqual(oldDefinition, CLASSIC_DEFINITION);
  assert.deepEqual(oldState, old.game.state);
  const legacy = encodeGame({ ...durable, state: pact.s });
  legacy.gameSchemaVersion = 7;
  delete legacy.game.state.definition;
  delete legacy.game.state.competitiveHistory;
  legacy.game.state.pacts.active[0].withdrawal = {
    kind: 'announced',
    withdrawingPlayerId: a,
    waitingForPlayerIds: s.players.filter((p) => p.id !== a).map((p) => p.id),
  };
  let inherited = decodeGame(legacy).game.state;
  assert.deepEqual(
    { ...inherited, definition: undefined },
    { ...legacy.game.state, definition: undefined },
  );
  assert.equal(pactBlocks(inherited, b, a, 'yukon', 'alaska'), true);
  for (let i = 0; inherited.pacts.active.length && i < 10; i++)
    inherited = endHostility(inherited);
  assert.equal(inherited.pacts.active.length, 0);
  const future = encodeGame(durable);
  future.gameSchemaVersion = 13;
  assert.throws(() => decodeGame(future));
});
void test('elimination removes agreements, offers and waits; surviving 5-player table still permits pacts', () => {
  let { s, a, b } = fixture();
  const c = s.players.find((p) => p.id !== a && p.id !== b).id;
  const pact = accepted(s, a, b, border);
  s = pact.s;
  s = command(s, 'withdraw_pact', { pactId: pact.pactId });
  s = offer(s, a, b, general).s;
  s = {
    ...s,
    territories: Object.fromEntries(
      Object.entries(s.territories).map(([t, v]) => [
        t,
        v.ownerId === b
          ? {
              ...v,
              ownerId: t === 'yukon' ? b : c,
              armies: t === 'yukon' ? 1 : v.armies,
            }
          : v,
      ]),
    ),
  };
  let rolls = 0;
  const result = applyCommand(
    s,
    { type: 'attack', playerId: a, from: 'oregon', to: 'yukon' },
    { dice: { rollDie: () => (++rolls <= 3 ? 6 : 1) } },
  );
  assert.equal(result.ok, true);
  s = result.state;
  assert.equal(s.players.find((p) => p.id === b).eliminated, true);
  assert.equal(s.pacts.proposals.length, 0);
  assert.equal(s.pacts.competitiveWithdrawals.length, 0);
  if (s.status === 'ACTIVE') {
    if (s.pendingAction)
      s = command(s, 'complete_conquest_transfer', { armies: 1 });
    assert.equal(deriveLegalActions(s, a).pactRecipientIds.includes(c), true);
    assert.equal(offer(s, a, c).s.pacts.proposals.length, 1);
  }
});
const CLASSIC_DEFINITION = {
  editionId: 'classic',
  boardId: 'classic',
  rulesVersion: 1,
};

void test('concurrent acceptance/end-turn is atomic and duplicate acceptance is idempotent', async () => {
  for (const acceptFirst of [true, false]) {
    let { s, a, b } = fixture();
    const offered = offer(s, a, b);
    s = offered.s;
    while (s.turn.playerId !== b) s = endHostility(s);
    s = command(command(s, 'advance_phase'), 'advance_phase');
    const auth = {
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
    };
    const directory = await mkdtemp(join(tmpdir(), 'ted-comp-pact-race-'));
    const store = await FileGameStore.open(directory);
    try {
      await store.commitGame(
        { state: s, revision: 0, recentCommands: [], auth },
        { revision: null },
      );
      const service = new GameService(store, new PerGameCoordinator());
      const accept = {
        type: 'COMMAND',
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        baseRevision: 0,
        command: {
          type: 'accept_pact',
          proposalId: offered.proposalId,
          pactId: randomUUID(),
        },
      };
      const end = {
        type: 'COMMAND',
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        baseRevision: 0,
        command: { type: 'end_turn' },
      };
      const outcomes = await Promise.all(
        (acceptFirst ? [accept, end] : [end, accept]).map((message) =>
          service.process(s.id, b, message),
        ),
      );
      assert.equal(outcomes[0].kind, 'COMMITTED');
      assert.equal(outcomes[1].code, 'STALE_REVISION');
      const saved = await store.loadGame(s.id);
      assert.equal(saved.state.pacts.proposals.length, 0);
      assert.equal(saved.state.pacts.active.length, acceptFirst ? 1 : 0);
      if (acceptFirst) {
        assert.equal(
          (await service.process(s.id, b, accept)).kind,
          'DUPLICATE',
        );
        assert.equal((await store.loadGame(s.id)).revision, 1);
      }
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
void test('attack commands enforce scope and other agreements remain effective after rupture', () => {
  for (const terms of [general, border]) {
    let { s, a, b } = fixture();
    const pact = accepted(s, a, b, terms);
    s = command(pact.s, 'withdraw_pact', { pactId: pact.pactId });
    const denied = applyCommand(
      s,
      { type: 'attack', playerId: a, from: 'alaska', to: 'yukon' },
      { dice: { rollDie: () => 6 } },
    );
    assert.equal(denied.error.code, 'PACT_PROHIBITS_ATTACK');
    const outside = applyCommand(
      s,
      { type: 'attack', playerId: a, from: 'oregon', to: 'yukon' },
      { dice: { rollDie: () => 6 } },
    );
    assert.equal(outside.ok, terms.kind === 'border_non_aggression');
  }
  let { s, a, b } = fixture();
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a ? { ...p, completedExchangeCount: 3 } : p,
    ),
  };
  const zone = accepted(s, a, b, {
    kind: 'international_zone',
    territoryId: 'canada',
    firstExpectedConquerorId: b,
  });
  s = command(zone.s, 'withdraw_pact', { pactId: zone.pactId });
  s = {
    ...s,
    territories: {
      ...s.territories,
      canada: { ...s.territories.canada, ownerId: b },
    },
  };
  const denied = applyCommand(
    s,
    { type: 'attack', playerId: a, from: 'oregon', to: 'canada' },
    { dice: { rollDie: () => 6 } },
  );
  assert.equal(denied.error.code, 'PACT_PROHIBITS_ATTACK');
  const fresh = fixture();
  const first = accepted(fresh.s, fresh.a, fresh.b, border);
  const both = accepted(first.s, fresh.a, fresh.b, general);
  s = command(both.s, 'withdraw_pact', { pactId: first.pactId });
  assert.equal(pactBlocks(s, fresh.b, fresh.a, 'yukon', 'alaska'), true);
});

void test('zones can be proposed and accepted without exchanges from the first hostility', () => {
  for (const mode of ['classic', 'competitive']) {
    const { s, a, b } = fixture(mode);
    assert.equal(s.turn.round.kind, 'initial_hostility');
    assert.equal(s.players.find((p) => p.id === a).completedExchangeCount, 0);
    const terms = {
      kind: 'international_zone',
      territoryId: 'canada',
      firstExpectedConquerorId: b,
    };
    const pact = accepted(s, a, b, terms);
    assert.equal(pact.s.pacts.active.length, 1);
    assert.equal(
      deriveLegalActions(s, a).actions.includes('propose_pact'),
      true,
    );
    for (const phase of mode === 'competitive'
      ? ['regroup', 'end_of_turn_cards', 'ordinary_exchange']
      : []) {
      assert.equal(
        applyCommand(
          { ...s, turn: { ...s.turn, phase } },
          {
            type: 'propose_pact',
            playerId: a,
            recipientId: b,
            proposalId: randomUUID(),
            terms,
          },
        ).ok,
        false,
      );
    }
  }
});
void test('card conquest threshold remains one before third exchange and two afterwards', () => {
  for (const mode of ['classic', 'competitive']) {
    for (const exchanges of [0, 2, 3, 4]) {
      for (const priorConquests of [0, 1]) {
        const { s, a } = fixture(mode);
        const state = {
          ...s,
          players: s.players.map((p) =>
            p.id === a ? { ...p, completedExchangeCount: exchanges } : p,
          ),
          territories: {
            ...s.territories,
            yukon: { ...s.territories.yukon, armies: 1 },
          },
          turn: {
            ...s.turn,
            conqueredTerritoryIds: priorConquests ? ['oregon'] : [],
          },
        };
        let die = 0;
        const result = applyCommand(
          state,
          { type: 'attack', playerId: a, from: 'alaska', to: 'yukon' },
          { dice: { rollDie: () => (++die <= 3 ? 6 : 1) } },
        );
        assert.equal(result.ok, true);
        assert.equal(
          result.state.turn.cardClaimEligible,
          exchanges < 3 || priorConquests === 1,
        );
      }
    }
  }
});
