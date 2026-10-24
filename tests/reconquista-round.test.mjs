import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSituationDeck } from '../packages/game-engine/dist/reconquista/situations.js';
import {
  initialSituationCycle,
  activateSituation,
  assertSituationCycle,
  combatDice,
  resolveReconquistaCombat,
  permitsDiceAttack,
} from '../packages/game-engine/dist/reconquista/round.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const players = [
  { id: 'a', color: 'white' },
  { id: 'b', color: 'red' },
];
function first(type) {
  const cycle = initialSituationCycle(createSituationDeck(catalog, () => 0.5));
  const card = cycle.drawPile.find((c) => c.typeId === type);
  return {
    ...cycle,
    drawPile: [card, ...cycle.drawPile.filter((c) => c.id !== card.id)],
  };
}
void test('D26: absent and eliminated rest colors are skipped; active player rest persists', () => {
  const missing = first('rest_blue');
  const before = structuredClone(missing);
  const result = activateSituation(missing, players, () => 0.5);
  assert.equal(result.skipped[0].typeId, 'rest_blue');
  assert.notEqual(result.cycle.active.typeId, 'rest_blue');
  assert.deepEqual(missing, before);
  const rest = activateSituation(first('rest_red'), players, () => 0.5);
  assert.equal(rest.restingPlayerId, 'b');
});
void test('D27: repeated cycles keep all 50 copy identities and exclude the active card from reshuffling', () => {
  let cycle = first('classic_combat');
  for (let i = 0; i < 155; i++) {
    const before = structuredClone(cycle);
    cycle = activateSituation(cycle, players, () => 0.5).cycle;
    assertSituationCycle(cycle);
    assert.notEqual(cycle.active.id, before.active?.id);
    if (before.drawPile.length === 0)
      assert.equal(cycle.reshuffles, before.reshuffles + 1);
  }
  assert(cycle.reshuffles >= 3);
  const active = cycle.active;
  cycle = {
    ...cycle,
    discards: [...cycle.discards, ...cycle.drawPile],
    drawPile: [],
  };
  const replaced = activateSituation(cycle, players, () => 0.5).cycle;
  assert(!replaced.drawPile.some((c) => c.id === active.id));
  assert(replaced.discards.some((c) => c.id === active.id));
  assert.throws(() => activateSituation(cycle, players, () => NaN));
});
void test('Crisis rolls once per participant; D77: tied players roll again until one remains', () => {
  const cycle = first('crisis');
  let i = 0;
  const draws = [0, 0.99];
  const activation = activateSituation(cycle, players, () => draws[i++]);
  assert.equal(i, 2);
  assert.deepEqual(activation.crisis.rolls, [1, 6]);
  assert.deepEqual(activation.crisis.affectedPlayerIds, ['a']);
  assert.deepEqual(activation.crisis.tiebreaks, []);
  let j = 0;
  const tiedDraws = [0.5, 0.5, 0.2, 0.2, 0.99, 0];
  const tied = activateSituation(cycle, players, () => tiedDraws[j++]);
  assert.deepEqual(tied.crisis.rolls, [4, 4]);
  assert.deepEqual(tied.crisis.tiebreaks, [
    [2, 2],
    [6, 1],
  ]);
  assert.deepEqual(tied.crisis.affectedPlayerIds, ['b']);
  // A constant random source stops after the last reroll with the manual's rule.
  const stuck = activateSituation(cycle, players, () => 0.5);
  assert.equal(stuck.crisis.tiebreaks.length, 20);
  assert.deepEqual(stuck.crisis.affectedPlayerIds, ['a', 'b']);
});
void test('D25: total-army superiority, max4, wind/snow and sorted defender-winning ties', () => {
  assert.deepEqual(combatDice(6, 3, 'classic_combat'), {
    attack: 4,
    defense: 3,
  });
  assert.equal(combatDice(5, 3, 'classic_combat').attack, 3);
  assert.equal(combatDice(4, 2, 'classic_combat').attack, 3);
  assert.equal(combatDice(6, 3, 'tailwind').attack, 4);
  assert.deepEqual(combatDice(2, 1, 'snow'), { attack: 1, defense: 2 });
  assert.deepEqual(combatDice(2, 2, 'tailwind'), { attack: 2, defense: 2 });
  let i = 0;
  const values = [0.99, 0, 0.99, 0];
  const wind = resolveReconquistaCombat(2, 2, 'tailwind', () => values[i++]);
  assert.deepEqual(wind.attackRolls, [6, 1]);
  assert.equal(wind.attackLoss, 1);
  assert.equal(wind.defenseLoss, 0);
  const snow = resolveReconquistaCombat(3, 1, 'snow', () => 0.5);
  assert.equal(snow.attackLoss, 2);
  assert.equal(snow.defenseLoss, 0);
  i = 0;
  const wins = [0.99, 0.99, 0, 0];
  assert.equal(
    resolveReconquistaCombat(3, 1, 'snow', () => wins[i++]).defenseLoss,
    1,
  );
  assert.throws(() => combatDice(1, 1, 'snow'));
  assert.throws(() => resolveReconquistaCombat(2, 1, 'snow', () => 1));
});
void test('Open/closed border restrictions compare continents without inventing missile routes', () => {
  assert(!permitsDiceAttack('open_borders', 'asia', 'asia'));
  assert(permitsDiceAttack('open_borders', 'asia', 'europe'));
  assert(!permitsDiceAttack('closed_borders', 'asia', 'europe'));
  assert(permitsDiceAttack('closed_borders', 'asia', 'asia'));
});
