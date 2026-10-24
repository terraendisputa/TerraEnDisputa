import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTINENTS,
  TERRITORY_IDS,
  applyCommand,
  applySetupCommand,
  assertClassicInvariants,
  baseReinforcements,
  continentBonuses,
  deriveLegalActions,
  exchangeValue,
  isLegalExchange,
  resolveCombat,
  victoryReason,
} from '../packages/game-engine/dist/index.js';
import {
  boardPatch,
  id,
  normalRound,
  prepared,
  random,
  reject,
  setup,
  skipHostility,
  step,
  success,
  withCards,
} from './classic-test-support.mjs';

for (const [count, expected] of [
  [2, [25, 25]],
  [3, [17, 17, 16]],
  [4, [13, 13, 12, 12]],
  [5, [10, 10, 10, 10, 10]],
  [6, [9, 9, 8, 8, 8, 8]],
]) {
  void test(`Classic: reparto y preparación de ${String(count)} jugadores`, () => {
    const initial = setup(count);
    assert.deepEqual(
      initial.players.map(
        (p) =>
          TERRITORY_IDS.filter((t) => initial.territories[t].ownerId === p.id)
            .length,
      ),
      expected,
    );
    assert.equal(TERRITORY_IDS.length, 50);
    assert.ok(TERRITORY_IDS.every((t) => initial.territories[t].armies === 1));
    assertClassicInvariants(initial);
    if (count <= 3) {
      assert.ok(
        initial.players.every((p) => p.secretObjectiveId === undefined),
      );
      assert.equal(initial.commonVictoryCondition.territoryCount, 50);
    } else {
      assert.equal(initial.commonVictoryCondition.territoryCount, 30);
      assert.equal(
        new Set(initial.players.map((p) => p.secretObjectiveId)).size,
        count,
      );
      for (const p of initial.players.filter((p) =>
        p.secretObjectiveId.startsWith('destroy_'),
      ))
        assert.notEqual(p.effectiveDestructionTargetPlayerId, p.id);
    }
    const active = prepared(count);
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.turn.phase, 'attack');
    assert.equal(active.turn.round.kind, 'initial_hostility');
    assert.equal(
      Object.values(active.territories).reduce((n, t) => n + t.armies, 0),
      50 + count * (count === 2 ? 12 : 8),
    );
    assertClassicInvariants(active);
  });
}
void test('Classic: empate de iniciativa vuelve a tirar solo entre empatados', () => {
  const rng = random([6, 6, 1, 1, 2]);
  const s = setup(3, rng);
  assert.equal(s.setup.startingPlayerId, id(2));
  assert.equal(rng.calls, 5);
});
void test('Classic: reparto no permite colocar fuerzas ajenas ni cantidades parciales', () => {
  const s = setup(4);
  const actor = s.setup.currentPlayerId;
  const mine = TERRITORY_IDS.find((t) => s.territories[t].ownerId === actor);
  const other = TERRITORY_IDS.find((t) => s.territories[t].ownerId !== actor);
  reject(
    applySetupCommand(s, {
      type: 'place_setup_armies',
      playerId: actor,
      placements: { [other]: 5 },
    }),
    'INVALID_PLACEMENT',
  );
  reject(
    applySetupCommand(s, {
      type: 'place_setup_armies',
      playerId: actor,
      placements: { [mine]: 1 },
    }),
    'INVALID_PLACEMENT',
  );
  assert.equal(s.territories[mine].armies, 1);
});
void test('Classic: primera hostilidad, rotación y pasada global completa', () => {
  let s = prepared();
  const initial = [...s.turn.round.orderPlayerIds];
  for (const actor of initial) {
    assert.equal(s.turn.playerId, actor);
    assert.equal(s.turn.round.kind, 'initial_hostility');
    assert.ok(
      !deriveLegalActions(s, actor).actions.includes('place_reinforcements'),
    );
    reject(
      applyCommand(s, {
        type: 'exchange_cards',
        playerId: actor,
        cardIds: ['alaska', 'peru', 'iceland'],
      }),
      'INVALID_PHASE',
    );
    s = skipHostility(s);
  }
  const rotated = [...initial.slice(1), initial[0]];
  assert.deepEqual(s.turn.round.orderPlayerIds, rotated);
  for (const actor of rotated) {
    assert.equal(s.turn.playerId, actor);
    assert.equal(s.turn.round.pass, 'incorporation');
    assert.ok(!deriveLegalActions(s, actor).actions.includes('attack'));
    const target = TERRITORY_IDS.find(
      (t) => s.territories[t].ownerId === actor,
    );
    s = step(s, {
      type: 'place_reinforcements',
      placements: { [target]: s.turn.reinforcementArmiesRemaining },
    });
    assertClassicInvariants(s);
  }
  assert.equal(s.turn.round.pass, 'hostility');
  assert.equal(s.turn.playerId, rotated[0]);
  for (let i = 0; i < 4; i++) s = skipHostility(s);
  assert.deepEqual(s.turn.round.orderPlayerIds, [
    ...rotated.slice(1),
    rotated[0],
  ]);
  assert.equal(s.turn.round.roundNumber, 2);
});
void test('Classic: mínimo territorial y bonos de continente conservados', () => {
  assert.deepEqual([1, 5, 6, 7, 19].map(baseReinforcements), [3, 3, 3, 3, 9]);
  assert.deepEqual(
    Object.values(CONTINENTS).map((c) => c.reinforcementBonus),
    [5, 3, 5, 3, 7, 2],
  );
  let s = normalRound();
  const actor = s.turn.playerId;
  s = boardPatch(
    s,
    Object.fromEntries(
      CONTINENTS.south_america.territoryIds.map((t) => [t, { ownerId: actor }]),
    ),
  );
  assert.equal(continentBonuses(s, actor).south_america, 3);
  s = boardPatch(s, { argentina: { ownerId: id(1) } });
  assert.equal(continentBonuses(s, actor).south_america, undefined);
});
void test('Classic: varios canjes por incorporación y progresión individual', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(exchangeValue),
    [4, 7, 10, 15, 20, 25],
  );
  assert.ok(isLegalExchange(['alaska', 'peru', 'iceland']));
  assert.ok(isLegalExchange(['argentina', 'peru', 'iceland']));
  assert.equal(isLegalExchange(['alaska', 'alaska', 'iceland']), false);
  let s = normalRound();
  const actor = s.turn.playerId;
  const other = s.players.find((p) => p.id !== actor);
  s = withCards(s, actor, [
    'alaska',
    'peru',
    'iceland',
    'spain',
    'greenland',
    'india',
  ]);
  const pool = s.turn.reinforcementArmiesRemaining;
  const old = structuredClone(s);
  s = step(s, {
    type: 'exchange_cards',
    cardIds: ['alaska', 'peru', 'iceland'],
  });
  s = step(s, {
    type: 'exchange_cards',
    cardIds: ['spain', 'greenland', 'india'],
  });
  assert.equal(s.turn.reinforcementArmiesRemaining, pool + 11);
  assert.equal(s.players.find((p) => p.id === actor).completedExchangeCount, 2);
  assert.equal(
    s.players.find((p) => p.id === other.id).completedExchangeCount,
    0,
  );
  assert.deepEqual(old.territories, s.territories);
  assert.equal(old.players.find((p) => p.id === actor).cards.length, 6);
});
void test('Classic: mano mayor que cinco obliga a canjear antes de colocar', () => {
  let s = normalRound();
  const actor = s.turn.playerId;
  s = withCards(s, actor, [
    'alaska',
    'peru',
    'iceland',
    'spain',
    'greenland',
    'india',
  ]);
  reject(
    applyCommand(s, { type: 'advance_phase', playerId: actor }),
    'MANDATORY_EXCHANGE',
  );
  const target = TERRITORY_IDS.find((t) => s.territories[t].ownerId === actor);
  reject(
    applyCommand(s, {
      type: 'place_reinforcements',
      playerId: actor,
      placements: { [target]: s.turn.reinforcementArmiesRemaining },
    }),
    'MANDATORY_EXCHANGE',
  );
});
void test('Classic: máximo tres dados, comparación ordenada y empate del defensor', () => {
  const result = success(resolveCombat(12, 8, random([1, 6, 5, 6, 4, 2])));
  assert.deepEqual(result, {
    attackerDice: [6, 5, 1],
    defenderDice: [6, 4, 2],
    attackerLosses: 2,
    defenderLosses: 1,
  });
});
void test('Classic: conquista queda pendiente, transfiere una vez y bloquea otras acciones', () => {
  let s = boardPatch(prepared(), {
    alaska: { ownerId: id(1), armies: 5 },
    yukon: { ownerId: id(2), armies: 1 },
  });
  s = step(
    s,
    { type: 'attack', from: 'alaska', to: 'yukon' },
    random([6, 6, 6, 1]),
  );
  assert.equal(s.territories.yukon.ownerId, id(1));
  assert.equal(s.territories.yukon.armies, 0);
  assert.equal(s.territories.alaska.armies, 5);
  assert.equal(s.pendingAction.maximumArmies, 3);
  reject(
    applyCommand(s, { type: 'advance_phase', playerId: id(1) }),
    'PENDING_ACTION',
  );
  s = step(s, { type: 'complete_conquest_transfer', armies: 3 });
  assert.equal(s.territories.yukon.armies, 3);
  assert.equal(s.territories.alaska.armies, 2);
  reject(
    applyCommand(s, {
      type: 'complete_conquest_transfer',
      playerId: id(1),
      armies: 3,
    }),
    'INVALID_TRANSFER',
  );
});
void test('Classic: reagrupación fija fuerzas movidas y conserva ocupación', () => {
  let s = boardPatch(prepared(), {
    argentina: { ownerId: id(1), armies: 5 },
    brazil: { ownerId: id(1), armies: 1 },
    sahara: { ownerId: id(1), armies: 1 },
  });
  s = step(s, { type: 'advance_phase' });
  s = step(s, { type: 'regroup', from: 'argentina', to: 'brazil', armies: 3 });
  assert.equal(s.territories.brazil.fixedArmiesThisTurn, 3);
  reject(
    applyCommand(s, {
      type: 'regroup',
      playerId: id(1),
      from: 'brazil',
      to: 'sahara',
      armies: 1,
    }),
    'INSUFFICIENT_ARMIES',
  );
  reject(
    applyCommand(
      s,
      { type: 'attack', playerId: id(1), from: 'brazil', to: 'sahara' },
      { dice: random() },
    ),
    'INVALID_PHASE',
  );
  s = step(s, { type: 'advance_phase' });
  s = step(s, { type: 'end_turn' });
  assert.equal(s.territories.brazil.fixedArmiesThisTurn, 0);
});
void test('Classic: premio +2 por posesión, ventana tardía y repetición rechazada', () => {
  let s = withCards(
    boardPatch(prepared(), { alaska: { ownerId: id(1), armies: 3 } }),
    id(1),
    ['alaska'],
  );
  reject(
    applyCommand(s, {
      type: 'claim_territory_bonus',
      playerId: id(1),
      cardId: 'alaska',
    }),
    'INVALID_PHASE',
  );
  s = step(step(s, { type: 'advance_phase' }), { type: 'advance_phase' });
  s = step(s, { type: 'claim_territory_bonus', cardId: 'alaska' });
  assert.equal(s.territories.alaska.armies, 5);
  assert.equal(s.players[0].cards[0].territoryBonusClaimed, true);
  reject(
    applyCommand(s, {
      type: 'claim_territory_bonus',
      playerId: id(1),
      cardId: 'alaska',
    }),
    'NOT_ELIGIBLE',
  );
});
void test('Classic: carta una vez, límite de cinco, descarte reciclado y renuncia', () => {
  let s = prepared();
  s = {
    ...s,
    turn: { ...s.turn, phase: 'end_of_turn_cards', cardClaimEligible: true },
    cardDeck: { drawPile: [], discardPile: ['alaska'] },
  };
  s = step(s, { type: 'claim_card' });
  assert.equal(s.players[0].cards[0].cardId, 'alaska');
  reject(
    applyCommand(
      s,
      { type: 'claim_card', playerId: id(1) },
      { shuffle: random() },
    ),
    'NOT_ELIGIBLE',
  );
  let full = withCards(prepared(), id(1), [
    'alaska',
    'peru',
    'iceland',
    'spain',
    'india',
  ]);
  full = {
    ...full,
    turn: { ...full.turn, phase: 'end_of_turn_cards', cardClaimEligible: true },
  };
  reject(
    applyCommand(
      full,
      { type: 'claim_card', playerId: id(1) },
      { shuffle: random() },
    ),
    'CARD_LIMIT',
  );
  const ended = step(full, { type: 'end_turn' });
  assert.equal(ended.turn.cardClaimEligible, false);
});
void test('Classic: tercer canje cambia umbral de carta a dos conquistas', () => {
  for (const [count, eligible] of [
    [2, true],
    [3, false],
  ]) {
    let s = withCards(
      boardPatch(prepared(), {
        alaska: { ownerId: id(1), armies: 5 },
        yukon: { ownerId: id(2), armies: 1 },
      }),
      id(1),
      [],
      count,
    );
    s = step(
      s,
      { type: 'attack', from: 'alaska', to: 'yukon' },
      random([6, 6, 6, 1]),
    );
    assert.equal(s.turn.cardClaimEligible, eligible);
  }
});
void test('Classic: pactos públicos, aceptación ajena y retirada espera todos los demás', () => {
  let s = boardPatch(prepared(), {
    alaska: { ownerId: id(1), armies: 5 },
    yukon: { ownerId: id(2), armies: 1 },
  });
  s = step(s, {
    type: 'propose_pact',
    proposalId: id(90),
    recipientId: id(2),
    terms: { kind: 'border_non_aggression', territoryIds: ['alaska', 'yukon'] },
  });
  s = step(s, {
    type: 'accept_pact',
    playerId: id(2),
    proposalId: id(90),
    pactId: id(91),
  });
  reject(
    applyCommand(
      s,
      { type: 'attack', playerId: id(1), from: 'alaska', to: 'yukon' },
      { dice: random() },
    ),
    'PACT_PROHIBITS_ATTACK',
  );
  s = step(s, { type: 'withdraw_pact', pactId: id(91) });
  assert.deepEqual(s.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(2),
    id(3),
    id(4),
  ]);
  s = skipHostility(s);
  s = skipHostility(s);
  assert.equal(s.pacts.active.length, 1);
  assert.deepEqual(s.pacts.active[0].withdrawal.waitingForPlayerIds, [
    id(3),
    id(4),
  ]);
  s = skipHostility(s);
  s = skipHostility(s);
  assert.equal(s.pacts.active.length, 0);
});
void test('Classic: zona internacional exige conquistar y deja una fuerza', () => {
  let s = boardPatch(prepared(), {
    alaska: { ownerId: id(1), armies: 1 },
    yukon: { ownerId: id(1), armies: 5 },
    oregon: { ownerId: id(2), armies: 5 },
  });
  s = withCards(s, id(1), [], 3);
  s = withCards(s, id(2), [], 3);
  s = step(s, {
    type: 'propose_pact',
    proposalId: id(90),
    recipientId: id(2),
    terms: {
      kind: 'international_zone',
      territoryId: 'alaska',
      firstExpectedConquerorId: id(2),
    },
  });
  s = step(s, {
    type: 'accept_pact',
    playerId: id(2),
    proposalId: id(90),
    pactId: id(91),
  });
  s = skipHostility(s);
  reject(
    applyCommand(s, { type: 'advance_phase', playerId: id(2) }),
    'INTERNATIONAL_ZONE_OBLIGATION',
  );
  s = step(
    s,
    { type: 'attack', from: 'oregon', to: 'alaska' },
    random([6, 6, 6, 1]),
  );
  assert.equal(s.pendingAction.maximumArmies, 1);
  assert.equal(s.pacts.active[0].expectedConquerorId, id(1));
  s = step(s, { type: 'complete_conquest_transfer', armies: 1 });
  assert.equal(s.territories.alaska.armies, 1);
  // Authorized original fix: pending zero armies no longer cancels the zone.
  assert.equal(s.pacts.active.length, 1);
  assert.equal(s.pacts.active[0].expectedConquerorId, id(1));
});
void test('Classic: elimina, hereda cartas y cambia objetivo imposible por victoria común', () => {
  let s = prepared();
  const patch = Object.fromEntries(
    TERRITORY_IDS.filter((t) => s.territories[t].ownerId === id(2)).map((t) => [
      t,
      { ownerId: id(4) },
    ]),
  );
  s = boardPatch(s, {
    ...patch,
    alaska: { ownerId: id(1), armies: 5 },
    yukon: { ownerId: id(2), armies: 1 },
  });
  s = withCards(s, id(2), ['spain']);
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === id(3)
        ? {
            ...p,
            secretObjectiveId: 'destroy_red',
            effectiveDestructionTargetPlayerId: id(2),
          }
        : p,
    ),
  };
  s = step(
    s,
    { type: 'attack', from: 'alaska', to: 'yukon' },
    random([6, 6, 6, 1]),
  );
  assert.equal(s.players[1].eliminated, true);
  assert.equal(s.players[1].cards.length, 0);
  assert.ok(s.players[0].cards.some((c) => c.cardId === 'spain'));
  assert.equal(s.players[2].effectiveDestructionTargetPlayerId, undefined);
});
void test('Classic: victoria común inmediata sin traslado pendiente', () => {
  let s = prepared();
  const owned = [
    'alaska',
    ...TERRITORY_IDS.filter((t) => !['alaska', 'yukon'].includes(t)).slice(
      0,
      28,
    ),
  ];
  s = boardPatch(
    s,
    Object.fromEntries(
      TERRITORY_IDS.map((t) => [
        t,
        {
          ownerId: owned.includes(t) ? id(1) : id(2),
          armies: t === 'alaska' ? 5 : 1,
        },
      ]),
    ),
  );
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === id(1)
        ? {
            ...p,
            secretObjectiveId: 'destroy_red',
            effectiveDestructionTargetPlayerId: id(2),
          }
        : p,
    ),
  };
  assert.equal(victoryReason(s, id(1)), undefined);
  s = step(
    s,
    { type: 'attack', from: 'alaska', to: 'yukon' },
    random([6, 6, 6, 1]),
  );
  assert.equal(s.status, 'FINISHED');
  assert.equal(s.result.victoryReason.territoryCount, 30);
  assert.equal(s.pendingAction, undefined);
  reject(
    applyCommand(s, { type: 'end_turn', playerId: id(1) }),
    'GAME_FINISHED',
  );
});
