import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLAYER_COLORS,
  TERRITORIES,
  TERRITORY_IDS,
  applyCommand,
  applySetupCommand,
  assertClassicInvariants,
  createClassicSetup,
  deriveLegalActions,
} from '../packages/game-engine/dist/index.js';
import {
  PROTOCOL_VERSION,
  clientCommandSchema,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
import { projectGameFor } from '../apps/server/dist/games/projection.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import {
  decodeGame,
  encodeGame,
} from '../apps/server/dist/persistence/schema.js';

const gameId = '10000000-0000-4000-8000-000000000001';
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pactId = id(91);
function random(values = [6, 5, 4, 3, 6, 1, 2, 3]) {
  let index = 0;
  return {
    shuffle: (items) => [...items],
    rollDie: () => {
      assert.ok(index < values.length, 'Unexpected extra die roll');
      return values[index++];
    },
  };
}
function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assertClassicInvariants(result.state);
  return result.state;
}
function step(state, command, dice = random()) {
  return success(
    applyCommand(
      state,
      { playerId: state.turn.playerId, ...command },
      { dice, shuffle: dice },
    ),
  );
}
function rejected(state, command, code) {
  const before = structuredClone(state);
  const result = applyCommand(state, command, { dice: random() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  assert.deepEqual(state, before);
}
function endHostility(state) {
  for (const type of ['advance_phase', 'advance_phase', 'end_turn'])
    state = step(state, { type });
  return state;
}
function prepared() {
  const players = Array.from({ length: 4 }, (_, seatIndex) => ({
    id: id(seatIndex + 1),
    seatIndex,
    nickname: `Jugador ${seatIndex + 1}`,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
  let state = createClassicSetup(gameId, players, random());
  while (state.status === 'SETUP') {
    const actor = state.setup.currentPlayerId;
    const territory = TERRITORY_IDS.find(
      (t) => state.territories[t].ownerId === actor,
    );
    state = success(
      applySetupCommand(state, {
        type: 'place_setup_armies',
        playerId: actor,
        placements: { [territory]: state.setup.armiesRemainingInActivation },
      }),
    );
  }
  state = {
    ...state,
    territories: {
      ...state.territories,
      alaska: { ownerId: id(1), armies: 1, fixedArmiesThisTurn: 0 },
      yukon: { ownerId: id(1), armies: 5, fixedArmiesThisTurn: 0 },
      oregon: { ownerId: id(2), armies: 5, fixedArmiesThisTurn: 0 },
    },
  };
  assertClassicInvariants(state);
  return state;
}
function zone() {
  let state = step(prepared(), {
    type: 'propose_pact',
    proposalId: id(90),
    recipientId: id(2),
    terms: {
      kind: 'international_zone',
      territoryId: 'alaska',
      firstExpectedConquerorId: id(2),
    },
  });
  state = step(state, {
    type: 'accept_pact',
    playerId: id(2),
    proposalId: id(90),
    pactId,
  });
  return state;
}
function durable(state, revision = 10) {
  return {
    state,
    revision,
    recentCommands: [],
    auth: {
      authSchemaVersion: 1,
      generation: 1,
      players: Object.fromEntries(
        state.players.map((p) => [
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
function conquest(state, from = 'oregon') {
  return step(
    state,
    { type: 'attack', from, to: 'alaska' },
    random([6, 6, 6, 1]),
  );
}

void test('Zone proposals are available from the first hostility regardless of exchanges or round number', () => {
  for (const count of [0, 1, 2, 3]) {
    const initial = prepared();
    const state = {
      ...initial,
      players: initial.players.map((p) => ({
        ...p,
        completedExchangeCount: count,
      })),
    };
    const choice = deriveLegalActions(state, id(1)).pactProposalChoices.find(
      (item) =>
        item.recipientId === id(2) &&
        item.terms.kind === 'international_zone' &&
        item.terms.territoryId === 'alaska',
    );
    assert.ok(choice, `Missing zone before exchange ${count + 1}`);
    const proposed = step(state, {
      type: 'propose_pact',
      proposalId: id(90),
      ...choice,
    });
    const accepted = step(proposed, {
      type: 'accept_pact',
      playerId: id(2),
      proposalId: id(90),
      pactId,
    });
    assert.equal(accepted.pacts.active[0].kind, 'international_zone');
    for (const roundNumber of [1, 3]) {
      const normal = {
        ...state,
        turn: {
          ...state.turn,
          isFirstHostilityTurn: false,
          round: {
            kind: 'normal',
            orderPlayerIds: initial.turn.round.orderPlayerIds,
            actorIndex: 0,
            roundNumber,
            pass: 'hostility',
          },
        },
      };
      assert.ok(
        deriveLegalActions(normal, id(1)).pactProposalChoices.some(
          (item) =>
            item.recipientId === id(2) &&
            item.terms.kind === 'international_zone' &&
            item.terms.territoryId === 'alaska',
        ),
      );
    }
  }
});

void test('Black can propose Mongolia to Yellow before any exchange; card eligibility still depends on exchanges', () => {
  let state = endHostility(endHostility(prepared()));
  state = {
    ...state,
    territories: {
      ...state.territories,
      gobi: { ownerId: id(3), armies: 15, fixedArmiesThisTurn: 0 },
      mongolia: { ownerId: id(3), armies: 1, fixedArmiesThisTurn: 0 },
      siberia: { ownerId: id(4), armies: 12, fixedArmiesThisTurn: 0 },
    },
  };
  assert.equal(state.players[2].color, 'black');
  assert.equal(state.players[3].color, 'yellow');
  const choice = deriveLegalActions(state, id(3)).pactProposalChoices.find(
    (item) =>
      item.recipientId === id(4) &&
      item.terms.kind === 'international_zone' &&
      item.terms.territoryId === 'mongolia',
  );
  assert.ok(choice);
  state = step(state, { type: 'propose_pact', proposalId: id(90), ...choice });
  state = step(state, {
    type: 'accept_pact',
    playerId: id(4),
    proposalId: id(90),
    pactId,
  });
  assert.equal(state.pacts.active[0].terms.territoryId, 'mongolia');
  for (const count of [0, 2, 3, 4]) {
    const zoneState = zone();
    const next = {
      ...zoneState,
      players: zoneState.players.map((p) =>
        p.id === id(2) ? { ...p, completedExchangeCount: count } : p,
      ),
    };
    const conquered = conquest(endHostility(next));
    assert.equal(conquered.turn.cardClaimEligible, count < 3);
  }
});

void test('Zone withdrawal is offered only to a participant in their hostility activation', () => {
  const state = zone();
  const incorporation = {
    ...state,
    turn: {
      ...state.turn,
      phase: 'territory_reinforcement',
      round: {
        ...state.turn.round,
        kind: 'normal',
        roundNumber: 1,
        pass: 'incorporation',
      },
    },
  };
  assert.deepEqual(
    deriveLegalActions(incorporation, id(1)).pactIdsToWithdraw,
    [],
  );
  rejected(
    incorporation,
    { type: 'withdraw_pact', playerId: id(1), pactId },
    'INVALID_PHASE',
  );
  assert.deepEqual(deriveLegalActions(state, id(1)).pactIdsToWithdraw, [
    pactId,
  ]);
  assert.deepEqual(deriveLegalActions(state, id(2)).pactIdsToWithdraw, []);
  rejected(
    state,
    { type: 'withdraw_pact', playerId: id(2), pactId },
    'NOT_YOUR_TURN',
  );
  const outsider = {
    ...state,
    turn: {
      ...state.turn,
      playerId: id(3),
      round: { ...state.turn.round, actorIndex: 2 },
    },
  };
  rejected(
    outsider,
    { type: 'withdraw_pact', playerId: id(3), pactId },
    'INVALID_PACT',
  );
  const announced = step(state, { type: 'withdraw_pact', pactId });
  assert.deepEqual(announced.pacts.active[0].withdrawal, {
    kind: 'announced',
    withdrawingPlayerId: id(1),
    waitingForPlayerIds: [id(2), id(3), id(4)],
  });
  assert.deepEqual(deriveLegalActions(announced, id(1)).pactIdsToWithdraw, []);
  rejected(
    announced,
    { type: 'withdraw_pact', playerId: id(1), pactId },
    'INVALID_PACT',
  );
  rejected(
    {
      ...state,
      players: state.players.map((p) =>
        p.id === id(1) ? { ...p, eliminated: true } : p,
      ),
    },
    { type: 'withdraw_pact', playerId: id(1), pactId },
    'PLAYER_ELIMINATED',
  );
  rejected(
    { ...state, status: 'FINISHED' },
    { type: 'withdraw_pact', playerId: id(1), pactId },
    'GAME_FINISHED',
  );
});

void test('Zone obligations survive withdrawal, combat and mandatory transfer until all others finish', () => {
  let state = step(zone(), { type: 'withdraw_pact', pactId });
  state = endHostility(state);
  assert.equal(state.turn.playerId, id(2));
  rejected(
    state,
    { type: 'advance_phase', playerId: id(2) },
    'INTERNATIONAL_ZONE_OBLIGATION',
  );
  state = conquest(state);
  assert.equal(state.pendingAction.maximumArmies, 1);
  assert.equal(state.pacts.active.length, 1);
  rejected(
    state,
    { type: 'withdraw_pact', playerId: id(2), pactId },
    'PENDING_ACTION',
  );
  assert.deepEqual(deriveLegalActions(state, id(2)).pactIdsToWithdraw, []);
  rejected(
    state,
    { type: 'complete_conquest_transfer', playerId: id(2), armies: 2 },
    'INVALID_TRANSFER',
  );
  state = step(state, { type: 'complete_conquest_transfer', armies: 1 });
  assert.equal(state.territories.alaska.armies, 1);
  assert.equal(state.pacts.active[0].expectedConquerorId, id(1));
  assert.equal(state.pacts.active[0].withdrawal.kind, 'announced');
  state = endHostility(state);
  assert.deepEqual(state.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(3),
    id(4),
  ]);
  state = endHostility(state);
  assert.deepEqual(state.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(4),
  ]);
  state = endHostility(state);
  assert.equal(state.pacts.active.length, 0);
});

void test('Incorporation passes and initiative rotation do not shorten a zone withdrawal', () => {
  let state = endHostility(zone());
  state = step(state, { type: 'withdraw_pact', pactId });
  state = conquest(state);
  state = step(state, { type: 'complete_conquest_transfer', armies: 1 });
  for (let i = 0; i < 3; i++) state = endHostility(state);
  assert.equal(state.turn.round.pass, 'incorporation');
  assert.deepEqual(state.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(1),
  ]);
  while (state.turn.round.pass === 'incorporation') {
    if (state.turn.phase === 'ordinary_exchange')
      state = step(state, { type: 'advance_phase' });
    else if (
      state.turn.phase === 'territory_reinforcement' &&
      state.turn.reinforcementArmiesRemaining > 0
    ) {
      const territory = deriveLegalActions(state, state.turn.playerId)
        .territoryChoices[0];
      state = step(state, {
        type: 'place_reinforcements',
        placements: { [territory]: state.turn.reinforcementArmiesRemaining },
      });
    } else if (
      state.turn.phase === 'continent_reinforcement' &&
      Object.values(state.turn.continentReinforcementsRemaining).some(
        (n) => n > 0,
      )
    ) {
      const placements = {};
      for (const [continent, amount] of Object.entries(
        state.turn.continentReinforcementsRemaining,
      )) {
        if (amount === 0) continue;
        const territory = TERRITORY_IDS.find(
          (t) =>
            TERRITORIES[t].continentId === continent &&
            state.territories[t].ownerId === state.turn.playerId &&
            t !== 'alaska',
        );
        placements[territory] = amount;
      }
      state = step(state, { type: 'place_reinforcements', placements });
    } else state = step(state, { type: 'advance_phase' });
    assert.deepEqual(state.pacts.active[0].withdrawal.waitingForPlayerIds, [
      id(1),
    ]);
  }
  assert.equal(state.turn.playerId, id(2));
  rejected(
    {
      ...state,
      turn: {
        ...state.turn,
        phase: 'territory_reinforcement',
        round: { ...state.turn.round, pass: 'incorporation' },
      },
    },
    { type: 'withdraw_pact', playerId: id(2), pactId },
    'INVALID_PACT',
  );
});

void test('Withdrawal does not unlock reinforcement, regrouping or territory-card bonuses in the zone', () => {
  const state = step(zone(), { type: 'withdraw_pact', pactId });
  rejected(
    state,
    {
      type: 'place_reinforcements',
      playerId: id(1),
      placements: { alaska: 1 },
    },
    'INVALID_PLACEMENT',
  );
  const regrouping = { ...state, turn: { ...state.turn, phase: 'regroup' } };
  rejected(
    regrouping,
    {
      type: 'regroup',
      playerId: id(1),
      from: 'yukon',
      to: 'alaska',
      armies: 1,
    },
    'INVALID_PLACEMENT',
  );
  const cards = {
    ...state,
    turn: { ...state.turn, phase: 'end_of_turn_cards' },
    players: state.players.map((p) =>
      p.id === id(1)
        ? { ...p, cards: [{ cardId: 'alaska', territoryBonusClaimed: false }] }
        : p,
    ),
  };
  rejected(
    cards,
    { type: 'claim_territory_bonus', playerId: id(1), cardId: 'alaska' },
    'INVALID_PLACEMENT',
  );
});

void test('Third-party conquest still terminates an international zone during withdrawal', () => {
  let state = step(zone(), { type: 'withdraw_pact', pactId });
  state = {
    ...state,
    territories: {
      ...state.territories,
      kamchatka: { ownerId: id(3), armies: 5, fixedArmiesThisTurn: 0 },
    },
    turn: {
      ...state.turn,
      playerId: id(3),
      round: { ...state.turn.round, actorIndex: 2 },
    },
  };
  state = step(
    state,
    { type: 'attack', from: 'kamchatka', to: 'alaska' },
    random([6, 6, 6, 1]),
  );
  assert.equal(state.pacts.active.length, 0);
});

void test('Border and general pact withdrawals retain the same waiting behavior', () => {
  for (const terms of [
    { kind: 'border_non_aggression', territoryIds: ['yukon', 'oregon'] },
    { kind: 'general_non_aggression' },
  ]) {
    let state = step(prepared(), {
      type: 'propose_pact',
      proposalId: id(90),
      recipientId: id(2),
      terms,
    });
    state = step(state, {
      type: 'accept_pact',
      playerId: id(2),
      proposalId: id(90),
      pactId,
    });
    state = step(state, { type: 'withdraw_pact', pactId });
    rejected(
      state,
      { type: 'attack', playerId: id(1), from: 'yukon', to: 'oregon' },
      'PACT_PROHIBITS_ATTACK',
    );
    for (let i = 0; i < 3; i++) {
      state = endHostility(state);
      assert.equal(state.pacts.active.length, 1);
    }
    state = endHostility(state);
    assert.equal(state.pacts.active.length, 0);
  }
});

void test('Schemas 5/6 add only missing zone withdrawal; schema 12 requires it and projects the wait', () => {
  const current = encodeGame(durable(zone())).game;
  const envelope = encodeGame(current);
  assert.equal(envelope.gameSchemaVersion, 12);
  for (const version of [5, 6]) {
    const legacy = structuredClone(envelope);
    legacy.gameSchemaVersion = version;
    delete legacy.game.state.definition;
    delete legacy.game.state.mode;
    delete legacy.game.state.pacts.active[0].withdrawal;
    const before = structuredClone(legacy);
    const migrated = decodeGame(legacy);
    assert.deepEqual(migrated.game, current);
    assert.deepEqual(legacy, before);
  }
  const missing = structuredClone(envelope);
  delete missing.game.state.pacts.active[0].withdrawal;
  assert.throws(() => decodeGame(missing));
  assert.throws(() => decodeGame({ ...envelope, gameSchemaVersion: 13 }));
  const state = step(current.state, { type: 'withdraw_pact', pactId });
  const view = projectGameFor(state, 11, id(1));
  const message = serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: view,
  });
  assert.deepEqual(
    message.state.pacts.active[0].withdrawal,
    state.pacts.active[0].withdrawal,
  );
  assert.throws(() =>
    serverMessageSchema.parse({
      type: 'STATE',
      protocolVersion: 7,
      state: view,
    }),
  );
  const invalid = structuredClone(state);
  invalid.pacts.active[0].withdrawal.waitingForPlayerIds.push(id(1));
  assert.throws(() => assertClassicInvariants(invalid));
});

void test('Eliminated waiting players do not prevent a zone withdrawal from expiring', () => {
  let state = step(zone(), { type: 'withdraw_pact', pactId });
  state = {
    ...state,
    players: state.players.map((p) =>
      p.id === id(4) ? { ...p, eliminated: true } : p,
    ),
    territories: Object.fromEntries(
      Object.entries(state.territories).map(([territory, value]) => [
        territory,
        value.ownerId === id(4) ? { ...value, ownerId: id(3) } : value,
      ]),
    ),
  };
  assertClassicInvariants(state);
  state = endHostility(state);
  assert.deepEqual(state.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(2),
    id(3),
  ]);
  state = conquest(state);
  state = step(state, { type: 'complete_conquest_transfer', armies: 1 });
  state = endHostility(state);
  state = endHostility(state);
  assert.equal(state.pacts.active.length, 0);
});

void test('Durable withdrawal, replay and simultaneous requests survive restart and backup', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ted-zone-withdrawal-'));
  let store;
  try {
    store = await FileGameStore.open(join(temporary, 'data'));
    await store.commitGame(durable(zone()));
    const service = new GameService(store);
    const command = clientCommandSchema.parse({
      type: 'COMMAND',
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      baseRevision: 10,
      command: { type: 'withdraw_pact', pactId },
    });
    const results = await Promise.all([
      service.process(gameId, id(1), command),
      service.process(gameId, id(1), command),
    ]);
    assert.deepEqual(
      results.map((r) => r.kind),
      ['COMMITTED', 'DUPLICATE'],
    );
    const stale = await service.process(gameId, id(1), {
      ...command,
      commandId: randomUUID(),
    });
    assert.equal(stale.code, 'STALE_REVISION');
    const unauthorized = await service.process(
      gameId,
      id(1),
      command,
      () => false,
    );
    assert.equal(unauthorized.code, 'UNAUTHORIZED');
    const before = await store.loadGame(gameId);
    assert.equal(before.revision, 11);
    assert.equal(before.state.pacts.active[0].withdrawal.kind, 'announced');
    const backup = join(temporary, 'backup.json');
    await store.createBackup(backup);
    await store.close();
    store = await FileGameStore.open(join(temporary, 'data'));
    assert.deepEqual(await store.loadGame(gameId), before);
    const pending = conquest(endHostility(before.state));
    const withPending = { ...before, state: pending, revision: 12 };
    await store.commitGame(withPending, { revision: 11, authGeneration: 1 });
    await store.createBackup(backup);
    await store.close();
    store = undefined;
    const restoredDirectory = join(temporary, 'restored');
    await FileGameStore.restoreBackup(restoredDirectory, backup);
    store = await FileGameStore.open(restoredDirectory);
    const restored = await store.loadGame(gameId);
    assert.deepEqual(restored, withPending);
    const transferred = step(restored.state, {
      type: 'complete_conquest_transfer',
      armies: 1,
    });
    assert.equal(transferred.pacts.active[0].withdrawal.kind, 'announced');
    assert.equal(transferred.pacts.active[0].expectedConquerorId, id(1));
    assert.equal(JSON.parse(await readFile(backup, 'utf8')).games.length, 1);
  } finally {
    await store?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('Both schema7 branches migrate explicitly: Classic keeps announced zone withdrawal; Competitive keeps mode/setup counters', () => {
  const classic = step(zone(), { type: 'withdraw_pact', pactId });
  const normalized = encodeGame(durable(classic));
  const original = structuredClone(normalized);
  original.gameSchemaVersion = 7;
  delete original.game.state.definition;
  delete original.game.state.mode;
  assert.deepEqual(decodeGame(original).game.state, normalized.game.state);
  const freshPlayers = classic.players.map(
    ({ id, seatIndex, nickname, color, controller }) => ({
      id,
      seatIndex,
      nickname,
      color,
      controller,
      eliminated: false,
      cards: [],
      completedExchangeCount: 0,
    }),
  );
  const classicSetup = createClassicSetup(gameId, freshPlayers, random());
  const prior = encodeGame(durable(classicSetup));
  prior.gameSchemaVersion = 7;
  delete prior.game.state.definition;
  delete prior.game.state.mode;
  prior.game.state.setup.reinforcementRound = 5;
  delete prior.game.state.setup.additionalArmiesByPlayerContinent;
  const recovered = decodeGame(prior).game.state;
  assert.equal(recovered.mode, 'classic');
  assert.equal(recovered.setup.reinforcementRound, 1);
  assert.deepEqual(recovered.territories, classicSetup.territories);
  assert.equal(
    recovered.setup.currentPlayerId,
    classicSetup.setup.currentPlayerId,
  );
  const competitive = createClassicSetup(
    gameId,
    freshPlayers,
    random(),
    'competitive',
  );
  const oldCompetitive = encodeGame(durable(competitive));
  oldCompetitive.gameSchemaVersion = 7;
  delete oldCompetitive.game.state.definition;
  delete oldCompetitive.game.state.competitiveHistory;
  const migratedCompetitive = decodeGame(oldCompetitive).game.state;
  assert.equal(migratedCompetitive.mode, 'competitive');
  assert.deepEqual(migratedCompetitive.setup, competitive.setup);
  assert.deepEqual(migratedCompetitive.players, competitive.players);
});
