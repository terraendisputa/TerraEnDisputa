import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  dealInitialObjectives,
  privateInitialObjectives,
} from '../packages/game-engine/dist/reconquista/objectives.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
const players = colors.map((color, i) => ({ id: `p${i}`, color }));
void test('S01/D04: initial secrets are unique, reserve excluded and 2/3-player restrictions apply', () => {
  for (let n = 2; n <= 6; n++) {
    const p = players.slice(0, n);
    const deal = dealInitialObjectives(
      catalog,
      p,
      p.map((x) => x.id),
      () => 0.5,
    );
    assert(
      deal.secrets.every((s) => s.objectives.length === (n === 2 ? 2 : 1)),
    );
    const assigned = deal.secrets.flatMap((s) =>
      s.objectives.map((o) => o.objectiveId),
    );
    assert.equal(
      new Set([
        ...assigned,
        ...deal.removedObjectiveIds,
        ...deal.excludedObjectiveIds,
      ]).size,
      19,
    );
    if (n <= 3) {
      assert.equal(deal.excludedObjectiveIds.length, 8);
      assert(
        assigned.every(
          (id) => id.startsWith('occupation_') && id !== 'occupation_12',
        ),
      );
    }
    assert.equal(privateInitialObjectives(deal, 'p0').length, n === 2 ? 2 : 1);
    assert.throws(() => privateInitialObjectives(deal, 'unknown'));
    const view = privateInitialObjectives(deal, 'p0');
    view[0].objectiveId = 'changed';
    assert.notEqual(deal.secrets[0].objectives[0].objectiveId, 'changed');
  }
});
void test('S01/D11/D80: absent colors leave the deck, own color targets right neighbor, left target follows fixed circle', () => {
  const p = players.slice(0, 4);
  const circle = ['p2', 'p0', 'p3', 'p1'];
  const seen = new Set();
  const excluded = dealInitialObjectives(
    catalog,
    p,
    circle,
    () => 0.5,
  ).excludedObjectiveIds;
  assert.deepEqual(excluded.toSorted(), ['destroy_green', 'destroy_yellow']);
  // Place each remaining destruction card first using a legal deterministic Fisher–Yates sequence.
  for (let selected = 12; selected < 17; selected++) {
    let i = 16;
    const deal = dealInitialObjectives(catalog, p, circle, () => {
      const j = i === selected ? 0 : i;
      const value = (j + 0.25) / (i + 1);
      i--;
      return value;
    });
    const secret = deal.secrets[0].objectives[0];
    const card = catalog.objectives.find((o) => o.id === secret.objectiveId);
    seen.add(card.id);
    const right = 'p3',
      left = 'p2';
    const target = p.find((x) => x.color === card.target)?.id;
    assert(card.target === 'left_neighbor' || target);
    assert.equal(
      secret.targetPlayerId,
      card.target === 'left_neighbor' ? left : target === 'p0' ? right : target,
    );
  }
  assert.equal(seen.size, 5);
  assert.throws(() => dealInitialObjectives(catalog, p, circle, () => NaN));
  assert.throws(() =>
    dealInitialObjectives(catalog, [p[0], p[0]], ['p0', 'p0'], () => 0),
  );
});
