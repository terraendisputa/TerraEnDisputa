import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSituationDeck,
  drawSituation,
  assertSituationDeck,
  SituationDeckExhaustedError,
} from '../packages/game-engine/dist/reconquista/situations.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
    'utf8',
  ),
);
const create = () => createSituationDeck(catalog, () => 0.25);
void test('D20: 50 distinct copies with S01 weights rather than uniform type weights', () => {
  const deck = create();
  assert.equal(deck.cards.length, 50);
  assert.equal(new Set(deck.cards.map((c) => c.id)).size, 50);
  const counts = Object.fromEntries(
    [...new Set(deck.cards.map((c) => c.typeId))].map((t) => [
      t,
      deck.cards.filter((c) => c.typeId === t).length,
    ]),
  );
  assert.deepEqual(counts, {
    classic_combat: 20,
    snow: 4,
    tailwind: 4,
    crisis: 4,
    extra_reinforcements: 4,
    open_borders: 4,
    closed_borders: 4,
    rest_white: 1,
    rest_black: 1,
    rest_red: 1,
    rest_blue: 1,
    rest_yellow: 1,
    rest_green: 1,
  });
  assert.deepEqual(deck, create());
  let calls = 0;
  const identity = createSituationDeck(catalog, () => {
    calls++;
    return 0.9999;
  });
  assert.equal(calls, 49);
  assert.notDeepEqual(deck.cards, identity.cards);
});
void test('D20: draw without replacement, without input mutation or automatic recycling', () => {
  let deck = create();
  const initial = structuredClone(deck);
  const drawn = [];
  for (let i = 0; i < 50; i++) {
    const result = drawSituation(deck);
    assert.deepEqual(result, drawSituation(deck));
    drawn.push(result.card.id);
    deck = result.deck;
  }
  assert.equal(new Set(drawn).size, 50);
  assert.equal(deck.nextIndex, 50);
  assert.deepEqual(create(), initial);
  assert.throws(() => drawSituation(deck), SituationDeckExhaustedError);
});
void test('D20: reject corrupted copies, mismatched types, invalid cursors and invalid RNG', () => {
  const deck = create();
  for (const mutate of [
    (d) => {
      d.cards[0] = d.cards[1];
    },
    (d) => {
      d.cards.pop();
    },
    (d) => {
      d.cards[0].typeId = 'unknown';
    },
    (d) => {
      d.nextIndex = -1;
    },
    (d) => {
      d.nextIndex = 51;
    },
    (d) => {
      d.nextIndex = 0.5;
    },
    (d) => {
      d.kind = 'game';
    },
  ]) {
    const copy = structuredClone(deck);
    mutate(copy);
    assert.throws(() => drawSituation(copy));
  }
  for (const value of [-1, 1, NaN, Infinity])
    assert.throws(() => createSituationDeck(catalog, () => value));
});
void test('D20: temporary research roundtrip continues the same sequence without reshuffle or effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ted-reconquista-situations-'));
  try {
    let deck = create();
    for (let i = 0; i < 9; i++) deck = drawSituation(deck).deck;
    await writeFile(join(dir, 'deck.json'), JSON.stringify(deck));
    const restored = JSON.parse(await readFile(join(dir, 'deck.json'), 'utf8'));
    assertSituationDeck(restored);
    assert.deepEqual(drawSituation(restored), drawSituation(deck));
    assert.equal(Object.hasOwn(restored, 'activeSituation'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
