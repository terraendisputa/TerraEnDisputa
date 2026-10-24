import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import { createFirstHostility } from '../packages/game-engine/dist/reconquista/hostilities.js';
import { createSituationDeck } from '../packages/game-engine/dist/reconquista/situations.js';
import {
  initialSituationCycle,
  activateSituation,
} from '../packages/game-engine/dist/reconquista/round.js';
import {
  createCampaign,
  applyCampaign,
  campaignLegal,
  assertCampaign,
} from '../packages/game-engine/dist/reconquista/campaign.js';
import { projectCampaign } from '../packages/game-engine/dist/reconquista/campaign-projection.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
  ),
);
const board = preparationBoard(catalog),
  players = [
    { id: 'a', color: 'white' },
    { id: 'b', color: 'black' },
    { id: 'c', color: 'red' },
  ];
function random(seed = 1) {
  let x = seed;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function game(types = ['classic_combat', 'snow'], seats = players) {
  const rng = random();
  const deck = createSituationDeck(catalog, rng);
  const ordered = [];
  for (const type of types) {
    const card = deck.cards.find(
      (c) => c.typeId === type && !ordered.includes(c),
    );
    assert(card);
    ordered.push(card);
  }
  const activation = activateSituation(
    initialSituationCycle({
      ...deck,
      cards: [...ordered, ...deck.cards.filter((c) => !ordered.includes(c))],
    }),
    seats,
    rng,
  );
  const countries = board.countries.map((c, i) => ({
    id: c.id,
    ownership: { kind: 'exclusive', playerId: seats[i % seats.length].id },
    forces: [{ playerId: seats[i % seats.length].id, armies: 1, missiles: 0 }],
  }));
  return createCampaign(
    board,
    catalog,
    seats,
    seats.map((p) => p.id),
    seats.map((p) => ({
      playerId: p.id,
      objectives: [{ objectiveId: 'occupation_02' }],
    })),
    createFirstHostility(countries, 'a'),
    activation,
    rng,
  );
}
const go = (s, p, a, rng = random(123)) =>
  applyCampaign(board, catalog, s, p, a, rng);
function set(s, id, p, armies = 1, missiles = 0) {
  const t = s.territories.find((t) => t.id === id);
  t.ownership = { kind: 'exclusive', playerId: p };
  t.forces = [{ playerId: p, armies, missiles }];
}
function close(s, p) {
  s = go(s, p, { kind: 'finish-regroup' });
  return go(s, p, { kind: 'finish-turn', confirmForfeit: true });
}
function take(s, p, id, acquisition = 'draw') {
  const index = s.cards.drawPile.findIndex((c) => c.id === id);
  assert(index >= 0);
  s.cards.hands[p].push({
    ...s.cards.drawPile.splice(index, 1)[0],
    acquisition,
    bonusUsed: acquisition === 'inheritance',
  });
}
void test('Full round rotates starter while fixed neighbors remain; next situation replaces snow and ordinary reinforcements become mandatory', () => {
  let s = game(['snow', 'closed_borders']);
  s = close(s, 'a');
  assert.equal(s.order[s.turnIndex], 'b');
  s = close(s, 'b');
  s = close(s, 'c');
  assert.equal(s.round, 2);
  assert.deepEqual(s.circle, ['a', 'b', 'c']);
  assert.deepEqual(s.order, ['b', 'c', 'a']);
  assert.equal(s.phase, 'incorporation');
  assert.equal(s.cycle.active.typeId, 'closed_borders');
  assert.equal(s.freeBudget, 12);
  assert.throws(() => go(s, 'b', { kind: 'finish-regroup' }));
  // D75: every player incorporates in round order before the first attack.
  for (const p of ['b', 'c', 'a']) {
    assert.equal(s.order[s.turnIndex], p);
    assert.equal(s.phase, 'incorporation');
    assert(!campaignLegal(board, s, p).canEndTurn);
    const id = campaignLegal(board, s, p).placementCountryIds[0];
    s = go(s, p, {
      kind: 'reinforce',
      placements: { [id]: 12 },
      conversions: {},
      continentPlacements: {},
    });
  }
  assert.equal(s.order[s.turnIndex], 'b');
  assert.equal(s.phase, 'attack');
  s = close(s, 'b');
  assert.equal(s.order[s.turnIndex], 'c');
  assert.equal(s.phase, 'attack');
});
void test('D24 extra reinforcement passes all players before round2 ordinary budgets and forbids exchange in that pass', () => {
  let s = game(['classic_combat', 'extra_reinforcements']);
  for (const p of ['a', 'b', 'c']) s = close(s, p);
  assert(s.extraPass);
  assert.equal(s.freeBudget, 12);
  for (const p of ['b', 'c', 'a']) {
    assert.equal(s.order[s.turnIndex], p);
    assert(!campaignLegal(board, s, p).canExchange);
    const id = campaignLegal(board, s, p).placementCountryIds[0];
    s = go(s, p, {
      kind: 'reinforce',
      placements: { [id]: 12 },
      conversions: {},
      continentPlacements: {},
    });
  }
  assert(!s.extraPass);
  assert.equal(s.order[s.turnIndex], 'b');
  assert.equal(s.phase, 'incorporation');
  assert.equal(s.freeBudget, 12);
});
void test('D39/D40: inherited card never awards +3, normal redrawn bonus does; five cards cancel reward', () => {
  let s = game();
  set(s, 'argentina', 'a');
  set(s, 'uruguay', 'a');
  take(s, 'a', 'argentina', 'inheritance');
  take(s, 'a', 'uruguay');
  s.phase = 'closing';
  assert(!campaignLegal(board, s, 'a').bonusCardIds.includes('argentina'));
  assert(campaignLegal(board, s, 'a').bonusCardIds.includes('uruguay'));
  assert.throws(() => go(s, 'a', { kind: 'claim-bonus', cardId: 'argentina' }));
  s = go(s, 'a', { kind: 'claim-bonus', cardId: 'uruguay' });
  assert.equal(
    s.territories.find((t) => t.id === 'uruguay').forces[0].armies,
    4,
  );
  assert.throws(() => go(s, 'a', { kind: 'claim-bonus', cardId: 'uruguay' }));
  for (const id of s.cards.drawPile.slice(0, 3).map((c) => c.id))
    take(s, 'a', id);
  s.conquests.a = { individual: 2, joint: 0 };
  assert(!campaignLegal(board, s, 'a').canClaimCountry);
  assert.throws(() => go(s, 'a', { kind: 'claim-country' }));
});
void test('D41/D42: continent claim is public, cannot be used twice, returns on loss and can be reclaimed if unused', () => {
  let s = game();
  for (const c of board.countries.filter((c) => c.continentId === 'oceania'))
    set(s, c.id, 'a');
  s.phase = 'closing';
  assert(campaignLegal(board, s, 'a').continentIds.includes('oceania'));
  assert.throws(() =>
    go(s, 'a', { kind: 'finish-turn', confirmForfeit: false }),
  );
  s = go(s, 'a', { kind: 'claim-continent', continentId: 'oceania' });
  assert.equal(s.cards.continents.oceania.holderId, 'a');
  const before = JSON.stringify(s);
  const publicView = projectCampaign(board, s, null);
  assert.equal(JSON.stringify(s), before);
  assert(!publicView.private);
  assert(
    publicView.public.players
      .find((p) => p.playerId === 'a')
      .continentIds.includes('oceania'),
  );
  const ships = s.cards.drawPile
    .filter((c) => c.symbol === 'ship')
    .slice(0, 2)
    .map((c) => c.id);
  for (const id of ships) take(s, 'a', id);
  s.phase = 'incorporation';
  s = go(s, 'a', {
    kind: 'exchange',
    cardIds: ships,
    continentIds: ['oceania'],
  });
  assert.deepEqual(s.cards.continents.oceania.usedBy, ['a']);
  s.phase = 'closing';
  assert(!campaignLegal(board, s, 'a').continentIds.includes('oceania'));
  let other = game();
  for (const c of board.countries.filter((c) => c.continentId === 'oceania'))
    set(other, c.id, 'a');
  other.phase = 'closing';
  other = go(other, 'a', { kind: 'claim-continent', continentId: 'oceania' });
  set(other, 'australia', 'b');
  other = go(other, 'a', { kind: 'finish-turn', confirmForfeit: true });
  assert.equal(other.cards.continents.oceania.holderId, null);
});
void test('D44–D45: allied attacks alternate, skip exhausted ally, and sole capable occupier gains exclusive country', () => {
  let s = game();
  set(s, 'iran', 'a', 2);
  set(s, 'rusia', 'b', 7);
  set(s, 'ucrania', 'c', 2);
  s = go(s, 'a', {
    kind: 'propose-alliance',
    allyId: 'b',
    originId: 'iran',
    allyOriginId: 'rusia',
    targetId: 'ucrania',
  });
  const id = s.alliances[0].id;
  s = go(s, 'b', { kind: 'respond-alliance', allianceId: id, accept: true });
  s = go(s, 'a', { kind: 'start-alliance', allianceId: id });
  let i = 0;
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'iran',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    () => [0, 0.9, 0.9][i++],
  );
  assert.equal(s.alliances[0].nextId, 'b');
  assert.equal(s.territories.find((t) => t.id === 'iran').forces[0].armies, 1);
  i = 0;
  s = go(
    s,
    'b',
    {
      kind: 'attack-country',
      originId: 'rusia',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    () => [0.99, 0.99, 0.99, 0, 0][i++],
  );
  assert(s.pending);
  assert.equal(s.pending.joint, false);
  assert.equal(s.pending.arrivals[0].playerId, 'b');
  s = go(s, 'b', { kind: 'occupy', armies: 2 });
  assert.equal(
    s.territories.find((t) => t.id === 'ucrania').ownership.kind,
    'exclusive',
  );
  assert.equal(
    s.territories.find((t) => t.id === 'ucrania').ownership.playerId,
    'b',
  );
});

function winRolls(attacks = 3, defense = 1) {
  const values = [...Array(attacks).fill(0.99), ...Array(defense).fill(0)];
  return () => {
    assert(values.length);
    return values.shift();
  };
}
function alliance(s, origin = 'iran', other = 'rusia', target = 'ucrania') {
  s = go(s, 'a', {
    kind: 'propose-alliance',
    allyId: 'b',
    originId: origin,
    allyOriginId: other,
    targetId: target,
  });
  const id = s.alliances.at(-1).id;
  s = go(s, 'b', { kind: 'respond-alliance', allianceId: id, accept: true });
  return go(s, 'a', { kind: 'start-alliance', allianceId: id });
}
function sharedGame() {
  let s = game();
  set(s, 'iran', 'a', 7);
  set(s, 'rusia', 'b', 7);
  set(s, 'ucrania', 'c', 1);
  s = alliance(s);
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'iran',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    winRolls(),
  );
  s = go(s, 'a', { kind: 'occupy', armies: 2 });
  return go(s, 'b', { kind: 'occupy', armies: 2 });
}
void test('Allied conquest creates per-player forces, automatic origin/internal protection and two-stage ally regroup/card window', () => {
  let s = sharedGame();
  const t = s.territories.find((t) => t.id === 'ucrania');
  assert.equal(t.ownership.kind, 'shared');
  assert.deepEqual(
    t.forces.map((f) => f.armies),
    [2, 2],
  );
  assert(s.pacts.some((p) => p.kind === 'origin'));
  assert(s.pacts.some((p) => p.kind === 'internal'));
  assert.equal(s.conquests.a.joint, 1);
  assert.equal(s.conquests.b.joint, 1);
  assert(!campaignLegal(board, s, 'a').canClaimCountry);
  set(s, 'bielorrusia', 'c', 1);
  s = alliance(s, 'ucrania', 'ucrania', 'bielorrusia');
  assert.equal(
    s.alliances.find((a) => a.id === s.activeAllianceId).exhaustive,
    false,
  );
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'ucrania',
      targetId: 'bielorrusia',
      defenderId: 'c',
    },
    winRolls(1, 1),
  );
  s = go(s, 'a', { kind: 'occupy', armies: 1 });
  s = go(s, 'b', { kind: 'occupy', armies: 1 });
  assert.equal(s.conquests.a.joint, 2);
  assert.equal(s.conquests.b.joint, 2);
  s = go(s, 'a', { kind: 'finish-regroup' });
  assert.equal(s.phase, 'ally-regroup');
  assert(!campaignLegal(board, s, 'b').canClaimCountry);
  s = go(s, 'b', { kind: 'finish-ally-regroup' });
  assert.equal(s.phase, 'ally-closing');
  assert(campaignLegal(board, s, 'b').canClaimCountry);
  s = go(s, 'b', { kind: 'claim-country' });
  assert.equal(s.cards.hands.b.length, 1);
  assert.throws(() => go(s, 'b', { kind: 'claim-country' }));
  s = go(s, 'b', { kind: 'finish-ally-regroup' });
  assert.equal(s.phase, 'closing');
  assert(campaignLegal(board, s, 'a').canClaimCountry);
  const before = JSON.stringify(s);
  projectCampaign(board, s, 'a');
  projectCampaign(board, s, 'b');
  assert.equal(
    JSON.stringify(s),
    before,
    'projection must not mutate counters',
  );
});
void test('Shared country blocks external partner attack, internal attack until withdrawal, and only selected defender participates', () => {
  let s = sharedGame();
  set(s, 'iran', 'a', 8);
  const t = s.territories.find((t) => t.id === 'ucrania');
  t.forces[0].armies = 4;
  t.forces[1].armies = 2;
  assert(
    !campaignLegal(board, s, 'a').attacks.some(
      (r) => r.originId === 'iran' && r.targetId === 'ucrania',
    ),
  );
  assert(
    !campaignLegal(board, s, 'a').attacks.some(
      (r) => r.originId === 'ucrania' && r.targetId === 'ucrania',
    ),
  );
  const internal = s.pacts.find((p) => p.kind === 'internal');
  s = go(s, 'a', { kind: 'withdraw-pact', pactId: internal.id });
  // Completed ordinary turn of counterpart expires the announced withdrawal, not all surviving players.
  s.completedTurns.b = internal.withdrawal?.completedTurns ?? 1;
  s.pacts = s.pacts.filter((p) => p.kind !== 'internal' && p.kind !== 'origin');
  assert(
    !campaignLegal(board, s, 'a').attacks.some(
      (r) => r.originId === 'iran' && r.targetId === 'ucrania',
    ),
  );
  assert(
    campaignLegal(board, s, 'a').attacks.some(
      (r) =>
        r.originId === 'ucrania' &&
        r.targetId === 'ucrania' &&
        r.defenderId === 'b',
    ),
  );
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'ucrania',
      targetId: 'ucrania',
      defenderId: 'b',
    },
    winRolls(3, 2),
  );
  assert.equal(
    s.territories.find((t) => t.id === 'ucrania').ownership.kind,
    'exclusive',
  );
  assert.equal(
    s.territories.find((t) => t.id === 'ucrania').forces[0].armies,
    4,
  );
  assert.equal(s.conquests.a.individual, 1);
});
void test('D48–D50/D64: third-party expulsion captures only chosen missiles, requires entry/continuation and creates no automatic replacement pact', () => {
  let s = sharedGame();
  const neighbor = board.connections
    .filter((e) => e.endpoints.includes('ucrania'))
    .map((e) => e.endpoints.find((id) => id !== 'ucrania'))
    .find((id) => !['iran', 'rusia'].includes(id));
  set(s, neighbor, 'c', 8, 1);
  s.turnIndex = 2;
  const t = s.territories.find((t) => t.id === 'ucrania');
  t.forces[0].armies = 1;
  t.forces[0].missiles = 3;
  t.forces[1].armies = 4;
  t.forces[1].missiles = 2;
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: neighbor,
      targetId: 'ucrania',
      defenderId: 'a',
    },
    winRolls(),
  );
  assert(s.pending.invasion);
  assert.equal(s.pending.arrivals[0].playerId, 'c');
  assert.throws(() => go(s, 'c', { kind: 'finish-regroup' }));
  assert(!s.pacts.some((p) => p.kind === 'internal'));
  assert(!s.pacts.some((p) => p.kind === 'origin'));
  s = go(s, 'c', { kind: 'occupy', armies: 2 });
  const occupied = s.territories.find((t) => t.id === 'ucrania');
  assert.equal(occupied.ownership.kind, 'shared');
  assert.equal(occupied.forces.find((f) => f.playerId === 'c').missiles, 3);
  assert.equal(occupied.forces.find((f) => f.playerId === 'b').missiles, 2);
  assert(!s.sharedOriginal.ucrania);
  assert.equal(
    s.territories.find((t) => t.id === neighbor).forces[0].missiles,
    1,
  );
});
void test('D49: shared missile superiority and losses use the selected owner, never combined garrisons; internal missile rejected', () => {
  let s = sharedGame();
  set(s, 'polonia', 'c', 2, 2);
  s.turnIndex = 2;
  const t = s.territories.find((t) => t.id === 'ucrania');
  t.forces[0].armies = 6;
  t.forces[0].missiles = 1;
  t.forces[1].armies = 20;
  t.forces[1].missiles = 8;
  const before = structuredClone(t.forces[1]);
  s = go(s, 'c', {
    kind: 'fire',
    originId: 'polonia',
    targetId: 'ucrania',
    defenderId: 'a',
  });
  assert.deepEqual(
    s.territories
      .find((t) => t.id === 'ucrania')
      .forces.find((f) => f.playerId === 'b'),
    before,
  );
  assert.equal(
    s.territories
      .find((t) => t.id === 'ucrania')
      .forces.find((f) => f.playerId === 'a').armies,
    3,
  );
  assert.throws(() =>
    go(s, 'c', {
      kind: 'fire',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'b',
    }),
  );
  s.turnIndex = 0;
  assert.throws(() =>
    go(s, 'a', {
      kind: 'fire',
      originId: 'ucrania',
      targetId: 'ucrania',
      defenderId: 'b',
    }),
  );
});
void test('D54: world pact protects both during withdrawal and expires after a rested counterpart turn', () => {
  let s = game(['rest_black', 'classic_combat']);
  set(s, 'argentina', 'a', 7);
  set(s, 'uruguay', 'b', 3);
  s = go(s, 'a', {
    kind: 'propose-pact',
    partnerId: 'b',
    pactKind: 'world',
    countryIds: [],
    continentIds: [],
  });
  const id = s.pacts[0].id;
  s = go(s, 'b', { kind: 'respond-pact', pactId: id, accept: true });
  s = go(s, 'a', { kind: 'withdraw-pact', pactId: id });
  assert(s.pacts[0].withdrawal);
  assert(
    !campaignLegal(board, s, 'a').attacks.some((r) => r.targetId === 'uruguay'),
  );
  s = close(s, 'a');
  assert.equal(s.phase, 'attack');
  assert.equal(campaignLegal(board, s, 'b').attacks.length, 0);
  assert(s.pacts.some((p) => p.id === id));
  s = close(s, 'b');
  assert(!s.pacts.some((p) => p.id === id));
  assert.equal(s.order[s.turnIndex], 'c');
});
void test('D55/D65: country pact protects all shortest-path edges and permits a shortest legal detour within three borders', async () => {
  const { permittedMissileDistance, edgeProtected } =
    await import('../packages/game-engine/dist/reconquista/campaign-politics.js');
  let s = game();
  set(s, 'canada', 'a', 2);
  set(s, 'isla_victoria', 'a', 2, 2);
  set(s, 'oregon', 'b', 7);
  s = go(s, 'a', {
    kind: 'propose-pact',
    partnerId: 'b',
    pactKind: 'countries',
    countryIds: ['canada', 'oregon'],
    continentIds: [],
  });
  let id = s.pacts.at(-1).id;
  s = go(s, 'b', { kind: 'respond-pact', pactId: id, accept: true });
  assert(edgeProtected(board, s, 'a', 'canada', 'oregon'));
  assert.equal(
    permittedMissileDistance(board, s, 'a', 'isla_victoria', 'oregon'),
    3,
  );
  s = go(s, 'a', {
    kind: 'fire',
    originId: 'isla_victoria',
    targetId: 'oregon',
    defenderId: 'b',
  });
  assert.equal(s.lastMissile.damage, 1);
  s.pacts = [];
  s = go(s, 'a', {
    kind: 'propose-pact',
    partnerId: 'b',
    pactKind: 'countries',
    countryIds: ['isla_victoria', 'oregon'],
    continentIds: [],
  });
  id = s.pacts.at(-1).id;
  s = go(s, 'b', { kind: 'respond-pact', pactId: id, accept: true });
  assert(edgeProtected(board, s, 'a', 'isla_victoria', 'canada'));
  assert(edgeProtected(board, s, 'a', 'canada', 'oregon'));
  assert.throws(() =>
    go(s, 'a', {
      kind: 'fire',
      originId: 'isla_victoria',
      targetId: 'oregon',
      defenderId: 'b',
    }),
  );
});
function zoneGame(type = 'classic_combat') {
  let s = game([type, 'classic_combat']);
  set(s, 'argentina', 'a', 8);
  set(s, 'uruguay', 'a', 1);
  set(s, 'brasil', 'b', 8);
  s.cards.exchanges.a = 3;
  s.cards.exchanges.b = 3;
  s = go(s, 'a', {
    kind: 'propose-pact',
    partnerId: 'b',
    pactKind: 'zone',
    countryIds: ['uruguay'],
    continentIds: [],
  });
  return go(s, 'b', {
    kind: 'respond-pact',
    pactId: s.pacts[0].id,
    accept: true,
  });
}
void test('D57–D59: zone gates both third exchanges, forbids reinforcement/+3 and penalizes a missed legal conquest before rival chooses', () => {
  let s = zoneGame();
  take(s, 'a', 'uruguay');
  s.phase = 'closing';
  assert(!campaignLegal(board, s, 'a').bonusCardIds.includes('uruguay'));
  s.phase = 'incorporation';
  s.freeBudget = 3;
  assert.throws(() =>
    go(s, 'a', {
      kind: 'reinforce',
      placements: { uruguay: 3 },
      conversions: {},
      continentPlacements: {},
    }),
  );
  s.phase = 'attack';
  s.freeBudget = 0;
  s = close(s, 'a');
  take(s, 'b', s.cards.drawPile[0].id);
  const removed = s.cards.hands.b[0].id;
  s = go(s, 'b', { kind: 'finish-regroup' });
  s = go(s, 'b', { kind: 'finish-turn', confirmForfeit: true });
  assert.equal(s.phase, 'zone-decision');
  assert.equal(s.cards.hands.b.length, 0);
  assert(s.cards.drawPile.some((c) => c.id === removed));
  assert.throws(() =>
    go(s, 'b', {
      kind: 'decide-zone',
      pactId: s.zoneDecisions[0].pactId,
      keep: false,
    }),
  );
  s = go(s, 'a', {
    kind: 'decide-zone',
    pactId: s.zoneDecisions[0].pactId,
    keep: true,
  });
  assert.equal(s.order[s.turnIndex], 'c');
});
void test('D58/D59: no penalty when Rest makes zone conquest impossible; debts consume future eligible cards once each', () => {
  let s = zoneGame('rest_black');
  s = close(s, 'a');
  s = close(s, 'b');
  assert.equal(s.phase, 'attack');
  assert.equal(s.penaltyDebts.b, 0);
  assert.equal(s.zoneDecisions.length, 0);
  s.phase = 'closing';
  s.turnIndex = 1;
  s.activation.restingPlayerId = null;
  s.conquests.b = { individual: 2, joint: 0 };
  s.penaltyDebts.b = 2;
  const before = s.cards.drawPile.length;
  s = go(s, 'b', { kind: 'claim-country' });
  assert.equal(s.cards.drawPile.length, before);
  assert.equal(s.penaltyDebts.b, 1);
  assert.throws(() => go(s, 'b', { kind: 'claim-country' }));
});

void test('D66: a continuing invader exhausted outside leaves captured missiles to the resisting occupant', () => {
  let s = sharedGame();
  set(s, 'polonia', 'c', 3, 1);
  s.turnIndex = 2;
  const target = s.territories.find((t) => t.id === 'ucrania');
  target.forces[0].armies = 1;
  target.forces[0].missiles = 3;
  target.forces[1].armies = 8;
  target.forces[1].missiles = 2;
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'a',
    },
    winRolls(2),
  );
  assert.equal(s.pending.capturedMissiles, 3);
  s = go(s, 'c', { kind: 'continue-invasion' });
  assert(s.pending.continuing);
  assertCampaign(board, catalog, s);
  assert.throws(() => go(s, 'c', { kind: 'finish-attacks' }));
  let rolls = [0, 0, 0.99, 0.99, 0.99, 0.99];
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'b',
    },
    () => rolls.shift(),
  );
  assert.equal(s.pending, null);
  assert.deepEqual(s.invasionSpoils, {});
  assert.deepEqual(s.territories.find((t) => t.id === 'ucrania').forces, [
    { playerId: 'b', armies: 8, missiles: 5 },
  ]);
  assert.equal(
    s.territories.find((t) => t.id === 'polonia').forces[0].missiles,
    1,
  );
  assert.equal(
    s.territories.find((t) => t.id === 'polonia').forces[0].armies,
    1,
  );
  s = go(s, 'c', { kind: 'finish-attacks' });
  assert.equal(s.phase, 'regroup');
});

void test('D64/D66: a successful continuing invader must occupy and retains all captured missiles', () => {
  let s = sharedGame();
  set(s, 'polonia', 'c', 8, 1);
  s.turnIndex = 2;
  const target = s.territories.find((t) => t.id === 'ucrania');
  for (const f of target.forces) {
    f.armies = 1;
    f.missiles = 2;
  }
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'a',
    },
    winRolls(),
  );
  s = go(s, 'c', { kind: 'continue-invasion' });
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'b',
    },
    winRolls(),
  );
  assert(!s.pending.invasion);
  assert.equal(s.pending.capturedMissiles, 4);
  assert.throws(() => go(s, 'c', { kind: 'finish-attacks' }));
  s = go(s, 'c', { kind: 'occupy', armies: 2 });
  assert.deepEqual(s.territories.find((t) => t.id === 'ucrania').forces, [
    { playerId: 'c', armies: 2, missiles: 4 },
  ]);
  assert.deepEqual(s.invasionSpoils, {});
});

void test('Country reward counts distinct territories: entering and then expelling the remaining partner counts once', () => {
  let s = sharedGame();
  set(s, 'polonia', 'c', 8);
  s.turnIndex = 2;
  s.cards.exchanges.c = 3;
  const target = s.territories.find((t) => t.id === 'ucrania');
  for (const f of target.forces) f.armies = 1;
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'a',
    },
    winRolls(),
  );
  s = go(s, 'c', { kind: 'occupy', armies: 3 });
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'ucrania',
      targetId: 'ucrania',
      defenderId: 'b',
    },
    winRolls(2),
  );
  assert.equal(s.conquests.c.individual, 1);
  assert.deepEqual(s.conquestCountries.c.individual, ['ucrania']);
  s = go(s, 'c', { kind: 'finish-regroup' });
  assert.equal(campaignLegal(board, s, 'c').canClaimCountry, false);
});

void test('Off-turn alliance accepted during closing remains scheduled for the proposer next attack turn', () => {
  let s = game();
  set(s, 'iran', 'a', 7);
  set(s, 'rusia', 'b', 7);
  set(s, 'ucrania', 'c', 1);
  s = go(s, 'a', { kind: 'finish-regroup' });
  s = go(s, 'a', {
    kind: 'propose-alliance',
    allyId: 'b',
    originId: 'iran',
    allyOriginId: 'rusia',
    targetId: 'ucrania',
  });
  const id = s.alliances.at(-1).id;
  s = go(s, 'b', { kind: 'respond-alliance', allianceId: id, accept: true });
  assert.equal(s.alliances.at(-1).executeTurn, 2);
  s = go(s, 'a', { kind: 'finish-turn', confirmForfeit: true });
  assert(s.alliances.some((a) => a.id === id));
  s = close(s, 'b');
  s = close(s, 'c');
  // D75: round two incorporates b, c and a in turn, then attacks from b.
  for (const actor of ['b', 'c', 'a']) {
    const legal = campaignLegal(board, s, actor);
    s = go(s, actor, {
      kind: 'reinforce',
      placements: { [legal.placementCountryIds[0]]: legal.freeBudget },
      conversions: {},
      continentPlacements: {},
    });
  }
  for (const actor of ['b', 'c']) s = close(s, actor);
  s = go(s, 'a', { kind: 'start-alliance', allianceId: id });
  assert.equal(s.activeAllianceId, id);
});

void test('D66: both allied origins exhaust after expelling one occupant; the remaining defender keeps captured missiles', () => {
  let s = game(undefined, [...players, { id: 'd', color: 'blue' }]);
  set(s, 'iran', 'a', 7);
  set(s, 'rusia', 'b', 7);
  set(s, 'ucrania', 'c', 1);
  s = alliance(s);
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'iran',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    winRolls(),
  );
  s = go(s, 'a', { kind: 'occupy', armies: 2 });
  s = go(s, 'b', { kind: 'occupy', armies: 2 });
  const t = s.territories.find((t) => t.id === 'ucrania');
  t.forces[0].armies = 1;
  t.forces[0].missiles = 3;
  t.forces[1].armies = 8;
  t.forces[1].missiles = 2;
  set(s, 'polonia', 'c', 2, 1);
  set(s, 'albania', 'd', 2, 1);
  s.turnIndex = 2;
  s = go(s, 'c', {
    kind: 'propose-alliance',
    allyId: 'd',
    originId: 'polonia',
    allyOriginId: 'albania',
    targetId: 'ucrania',
  });
  const id = s.alliances.at(-1).id;
  s = go(s, 'd', { kind: 'respond-alliance', allianceId: id, accept: true });
  s = go(s, 'c', { kind: 'start-alliance', allianceId: id });
  s = go(
    s,
    'c',
    {
      kind: 'attack-country',
      originId: 'polonia',
      targetId: 'ucrania',
      defenderId: 'a',
    },
    winRolls(1),
  );
  for (const [actor, origin] of [
    ['d', 'albania'],
    ['c', 'polonia'],
  ]) {
    let rolls = [0, 0.99, 0.99, 0.99, 0.99];
    s = go(
      s,
      actor,
      {
        kind: 'attack-country',
        originId: origin,
        targetId: 'ucrania',
        defenderId: 'b',
      },
      () => rolls.shift(),
    );
  }
  assert.equal(s.activeAllianceId, null);
  assert.equal(s.pending, null);
  assert.deepEqual(s.invasionSpoils, {});
  assert.deepEqual(s.territories.find((t) => t.id === 'ucrania').forces, [
    { playerId: 'b', armies: 8, missiles: 5 },
  ]);
  assert(
    s.pacts.some(
      (p) => p.kind === 'origin' && p.proposerId === 'c' && p.partnerId === 'd',
    ),
  );
});

void test('Campaign invariants reject corrupted ownership, zero armies outside a checkpoint and impossible fixed arrivals', () => {
  let s = game();
  assertCampaign(board, catalog, s);
  let bad = structuredClone(s);
  bad.territories[0].forces[0].armies = 0;
  assert.throws(() => assertCampaign(board, catalog, bad));
  bad = structuredClone(s);
  bad.territories[0].ownership = { kind: 'exclusive', playerId: 'unknown' };
  assert.throws(() => assertCampaign(board, catalog, bad));
  bad = structuredClone(s);
  const t = bad.territories[0];
  bad.fixedMissiles[`${t.forces[0].playerId}:${t.id}`] = 1;
  assert.throws(() => assertCampaign(board, catalog, bad));
});

void test('D60–D62: the second mandatory arrival resolves one joint conquest and declares both qualifying allies winners together', () => {
  let s = game();
  for (const c of board.countries) set(s, c.id, 'c', 1);
  const required = board.countries.filter(
    (c) =>
      ['europe', 'south_america'].includes(c.continentId) && c.id !== 'ucrania',
  );
  const extras = board.countries
    .filter(
      (c) =>
        !['europe', 'south_america'].includes(c.continentId) &&
        !['iran', 'rusia'].includes(c.id),
    )
    .slice(0, 10);
  for (const c of [...required, ...extras]) {
    const t = s.territories.find((t) => t.id === c.id);
    t.ownership = { kind: 'shared', playerIds: ['a', 'b'] };
    t.forces = [
      { playerId: 'a', armies: 1, missiles: 0 },
      { playerId: 'b', armies: 1, missiles: 0 },
    ];
  }
  set(s, 'iran', 'a', 7);
  set(s, 'rusia', 'b', 7);
  s = alliance(s);
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'iran',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    winRolls(),
  );
  assert.deepEqual(s.winners, []);
  s = go(s, 'a', { kind: 'occupy', armies: 2 });
  assert.deepEqual(s.winners, []);
  s = go(s, 'b', { kind: 'occupy', armies: 2 });
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.winners, ['a', 'b']);
});

void test('D51: blockade is per occupant and a shared neighbor breaks the single exclusive enemy enclosure', async () => {
  const { blockedCountry } =
    await import('../packages/game-engine/dist/reconquista/campaign-politics.js');
  let s = sharedGame();
  const ids = board.connections
    .filter((e) => e.endpoints.includes('ucrania'))
    .map((e) => e.endpoints.find((id) => id !== 'ucrania'));
  assert(ids.length >= 3);
  for (const id of ids) set(s, id, 'b', 2);
  assert.equal(blockedCountry(board, s, 'a', 'ucrania'), true);
  assert.equal(blockedCountry(board, s, 'b', 'ucrania'), false);
  const neighbor = s.territories.find((t) => t.id === ids[0]);
  neighbor.ownership = { kind: 'shared', playerIds: ['b', 'c'] };
  neighbor.forces.push({ playerId: 'c', armies: 1, missiles: 0 });
  assert.equal(blockedCountry(board, s, 'a', 'ucrania'), false);
});

void test('Ordinary regroup fixes army and missile arrivals independently and cannot relay them through another country', () => {
  let s = game();
  set(s, 'argentina', 'a', 4, 2);
  set(s, 'brasil', 'a', 1, 0);
  set(s, 'sahara', 'a', 1, 0);
  s = go(s, 'a', { kind: 'finish-attacks' });
  s = go(s, 'a', {
    kind: 'regroup-forces',
    originId: 'argentina',
    targetId: 'brasil',
    armies: 3,
    missiles: 2,
  });
  assert.throws(() =>
    go(s, 'a', {
      kind: 'regroup-forces',
      originId: 'brasil',
      targetId: 'sahara',
      armies: 2,
      missiles: 0,
    }),
  );
  assert.throws(() =>
    go(s, 'a', {
      kind: 'regroup-forces',
      originId: 'brasil',
      targetId: 'sahara',
      armies: 0,
      missiles: 1,
    }),
  );
  assert.equal(s.fixedArmies['a:brasil'], 3);
  assert.equal(s.fixedMissiles['a:brasil'], 2);
});

void test('D75: ending the turn at any moment moves one army into a pending conquest and passes the turn', () => {
  let s = game();
  set(s, 'iran', 'a', 7);
  set(s, 'ucrania', 'c', 1);
  s = go(
    s,
    'a',
    {
      kind: 'attack-country',
      originId: 'iran',
      targetId: 'ucrania',
      defenderId: 'c',
    },
    winRolls(),
  );
  assert(s.pending);
  const legal = campaignLegal(board, s, 'a');
  assert(legal.canEndTurn);
  assert(legal.endTurnMayForfeit);
  assert(!campaignLegal(board, s, 'b').canEndTurn);
  assert.throws(() => go(s, 'a', { kind: 'end-turn', confirmForfeit: false }));
  s = go(s, 'a', { kind: 'end-turn', confirmForfeit: true });
  assert.deepEqual(s.territories.find((t) => t.id === 'ucrania').forces, [
    { playerId: 'a', armies: 1, missiles: 0 },
  ]);
  assert.equal(s.territories.find((t) => t.id === 'iran').forces[0].armies, 6);
  assert.equal(s.cards.hands.a.length, 0);
  assert.equal(s.order[s.turnIndex], 'b');
  assert.equal(s.phase, 'attack');
});

void test('A claimed country card leaves its +3 to an explicit claim', () => {
  let s = game();
  const card = s.cards.drawPile[0];
  set(s, card.countryId, 'a', 1);
  s.phase = 'closing';
  s.conquests.a = { individual: 1, joint: 0 };
  s = go(s, 'a', { kind: 'claim-country' });
  assert.equal(s.cards.hands.a.at(-1).id, card.id);
  assert.equal(
    s.territories.find((t) => t.id === card.countryId).forces[0].armies,
    1,
  );
  assert(campaignLegal(board, s, 'a').bonusCardIds.includes(card.id));
  s = go(s, 'a', { kind: 'claim-bonus', cardId: card.id });
  assert.equal(
    s.territories.find((t) => t.id === card.countryId).forces[0].armies,
    4,
  );
});

void test('Crisis denies the country card only to the players who rolled the minimum', () => {
  let s = game(['crisis']);
  assert.equal(s.cycle.active.typeId, 'crisis');
  s.phase = 'closing';
  s.conquests.a = { individual: 1, joint: 0 };
  s.activation.crisis.affectedPlayerIds = ['a'];
  assert(!campaignLegal(board, s, 'a').canClaimCountry);
  assert.throws(() => go(s, 'a', { kind: 'claim-country' }));
  s.activation.crisis.affectedPlayerIds = ['b'];
  assert(campaignLegal(board, s, 'a').canClaimCountry);
});

void test('Exchange while closing the turn: armies placed before ending, one exchange per round', () => {
  let s = game();
  set(s, 'argentina', 'a', 2);
  const triple = s.cards.drawPile
    .filter((c) => c.symbol === 'ship')
    .slice(0, 3)
    .map((c) => c.id);
  for (const id of triple) take(s, 'a', id);
  s.phase = 'closing';
  assert(campaignLegal(board, s, 'a').canExchange);
  s = go(s, 'a', { kind: 'exchange', cardIds: triple, continentIds: [] });
  const armies = s.freeBudget;
  assert(armies > 0);
  assert.equal(s.phase, 'closing');
  let legal = campaignLegal(board, s, 'a');
  assert(legal.canReinforce && !legal.canFinishTurn && !legal.canEndTurn);
  assert(!legal.canExchange);
  assert.throws(() =>
    go(s, 'a', { kind: 'finish-turn', confirmForfeit: true }),
  );
  s = go(s, 'a', {
    kind: 'reinforce',
    placements: { argentina: armies },
    continentPlacements: {},
    conversions: {},
  });
  assert.equal(s.freeBudget, 0);
  assert.equal(
    s.territories.find((t) => t.id === 'argentina').forces[0].armies,
    2 + armies,
  );
  legal = campaignLegal(board, s, 'a');
  assert(legal.canFinishTurn && !legal.canReinforce);
  const more = s.cards.drawPile
    .filter((c) => c.symbol === 'ship')
    .slice(0, 3)
    .map((c) => c.id);
  for (const id of more) take(s, 'a', id);
  assert(!campaignLegal(board, s, 'a').canExchange);
  assert.throws(() =>
    go(s, 'a', { kind: 'exchange', cardIds: more, continentIds: [] }),
  );
});
void test('Continent pacts need presence; pacts between borders need a border across continents (manual p. 28)', () => {
  let s = game();
  const own = (continentId, p) => {
    for (const c of board.countries.filter(
      (c) => c.continentId === continentId,
    ))
      set(s, c.id, p);
  };
  own('oceania', 'a');
  const pact = (pactKind, continentIds) => ({
    kind: 'propose-pact',
    partnerId: 'b',
    pactKind,
    countryIds: [],
    continentIds,
  });
  const pairs = () => campaignLegal(board, s, 'a').pactScopes.b.continentPairs;
  const has = (pair) => pairs().some((p) => p.join('|') === pair.join('|'));
  assert(
    !campaignLegal(board, s, 'a').pactScopes.b.continents.includes('oceania'),
  );
  assert.throws(() => go(s, 'a', pact('continent', ['oceania'])));
  assert(!has(['oceania', 'south_america']));
  assert.throws(() =>
    go(s, 'a', pact('intercontinental', ['oceania', 'south_america'])),
  );
  // One country of b bordering one of a, in another continent, is enough.
  set(s, 'chile', 'b');
  assert(has(['oceania', 'south_america']));
  // No border between Oceania and Africa.
  assert.throws(() =>
    go(s, 'a', pact('intercontinental', ['oceania', 'africa'])),
  );
  // Either order is accepted.
  s = go(s, 'a', pact('intercontinental', ['south_america', 'oceania']));
  const id = s.pacts.at(-1).id;
  s = go(s, 'b', { kind: 'respond-pact', pactId: id, accept: true });
  assert.equal(s.pacts.find((p) => p.id === id).status, 'active');
  // Without a border left between them there, the pact ends.
  set(s, 'chile', 'c');
  s = go(s, 'a', pact('world', []));
  assert(!s.pacts.some((p) => p.id === id));
  const shared = campaignLegal(board, s, 'a').pactScopes.b.continents[0];
  assert(shared);
  s = go(s, 'a', pact('continent', [shared]));
  assert.equal(s.pacts.at(-1).continentIds[0], shared);
});
