import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createCards,
  isExchange,
  exchangeCards,
  drawCountryCard,
  inheritCountryCards,
  assertCards,
} from '../packages/game-engine/dist/reconquista/cards.js';
import {
  occupationWitness,
  meetsVictory,
} from '../packages/game-engine/dist/reconquista/victory.js';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
  ),
);
const board = preparationBoard(catalog);
const rng = () => 0.4;
function take(s, p, ids) {
  for (const id of ids) {
    const i = s.drawPile.findIndex((c) => c.id === id);
    assert(i >= 0, id);
    s.hands[p].push({
      ...s.drawPile.splice(i, 1)[0],
      acquisition: 'draw',
      bonusUsed: false,
    });
  }
}
const sample = (symbols) =>
  symbols.map((symbol, i) => ({ id: `c${i}`, countryId: `c${i}`, symbol }));
void test('D36–D40: 73 conserved country cards, explicit wildcard, soldier wildcard, triple supercard and atomic continent equivalences', () => {
  const s = createCards(catalog, ['a', 'b'], rng);
  assert.equal(s.drawPile.length, 73);
  assert.equal(s.drawPile.filter((c) => c.symbol === 'wildcard').length, 1);
  assert.equal(
    s.drawPile.filter((c) => c.symbol === 'soldier_wildcard').length,
    4,
  );
  assert.equal(s.drawPile.filter((c) => c.symbol === 'supercard').length, 5);
  assert(
    isExchange(sample(['tank_grenade', 'tank_grenade', 'tank_grenade']), []),
  );
  assert(isExchange(sample(['plane', 'ship', 'wildcard']), []));
  assert(
    isExchange(sample(['plane', 'soldier_wildcard', 'soldier_wildcard']), []),
  );
  assert(isExchange(sample(['supercard']), []));
  assert(!isExchange(sample(['supercard', 'ship', 'plane']), []));
  assert(isExchange([], ['asia']));
  assert(isExchange(sample(['ship']), ['south_america']));
  assert(isExchange([], ['south_america', 'oceania']));
  assert(!isExchange([], ['south_america', 'central_america']));
  assert(!isExchange(sample(['plane', 'plane', 'ship']), []));
  assertCards(
    s,
    board.countries.map((c) => c.id),
    ['a', 'b'],
  );
});
void test('D37/D40: random inheritance fills at most five, denies inherited bonuses and returns every remaining card to the live deck', () => {
  for (const initial of [0, 3, 4, 5]) {
    const s = createCards(catalog, ['a', 'b'], rng);
    const ids = s.drawPile.map((c) => c.id);
    take(s, 'a', ids.slice(0, initial));
    take(s, 'b', ids.slice(10, 14));
    const before = structuredClone(s),
      next = inheritCountryCards(s, 'a', 'b', rng);
    assert.deepEqual(s, before);
    assert.equal(next.hands.a.length, Math.min(5, initial + 4));
    assert.equal(next.hands.b.length, 0);
    assert(
      next.hands.a
        .slice(initial)
        .every((c) => c.acquisition === 'inheritance' && c.bonusUsed),
    );
    assert.equal(
      next.drawPile.length,
      s.drawPile.length + 4 - Math.min(5 - initial, 4),
    );
    assertCards(
      next,
      board.countries.map((c) => c.id),
      ['a', 'b'],
    );
  }
});
void test('Exchanges obey progression, one per round, private hand ownership, continent usage history and country discard recycling', () => {
  let s = createCards(catalog, ['a', 'b'], rng);
  const triples = s.drawPile
    .filter((c) => c.symbol === 'supercard')
    .map((c) => c.id);
  for (let round = 1; round <= 5; round++) {
    take(s, 'a', [triples[round - 1]]);
    const before = structuredClone(s);
    const result = exchangeCards(s, 'a', round, [triples[round - 1]], []);
    assert.deepEqual(s, before);
    assert.equal(result.armies, [6, 10, 15, 20, 25][round - 1]);
    s = result.cards;
    assert.throws(() => exchangeCards(s, 'a', round, [], ['asia']));
  }
  const onlyDiscard = structuredClone(s);
  onlyDiscard.drawPile = [];
  // A direct draw helper must recycle the discard, never duplicate it.
  const drawn = drawCountryCard(onlyDiscard, 'b', rng);
  assert.equal(drawn.hands.b.length, 1);
  assert.equal(drawn.discards.length, 0);
  assert.equal(drawn.drawPile.length, 4);
  s.continents.asia.holderId = 'a';
  const used = exchangeCards(s, 'a', 6, [], ['asia']).cards;
  assert.deepEqual(used.continents.asia.usedBy, ['a']);
  assert.equal(used.continents.asia.holderId, null);
  assert.throws(() => exchangeCards(used, 'a', 7, [], ['asia']));
});
void test('D60: objective witness chooses islands overlapping continental quotas and requires ten genuinely extra countries', () => {
  const objective = catalog.objectives.find((o) => o.id === 'occupation_11');
  const all = board.countries.map((c) => c.id);
  const witness = occupationWitness(board, all, objective);
  assert(witness);
  assert.equal(new Set(witness).size, witness.length);
  assert(
    witness.filter((id) => board.countries.find((c) => c.id === id).island)
      .length >= 6,
  );
  assert(
    new Set(
      witness
        .filter((id) => board.countries.find((c) => c.id === id).island)
        .map((id) => board.countries.find((c) => c.id === id).continentId),
    ).size >= 3,
  );
  const extras = all.filter((id) => !witness.includes(id)).slice(0, 10);
  const secret = [{ objectiveId: objective.id }];
  assert(
    !meetsVictory(
      board,
      catalog,
      [...witness, ...extras.slice(0, 9)],
      secret,
      3,
      'a',
      {},
    ),
  );
  assert(
    meetsVictory(board, catalog, [...witness, ...extras], secret, 3, 'a', {}),
  );
  assert.equal(
    occupationWitness(
      board,
      all.filter((id) => !board.countries.find((c) => c.id === id).island),
      objective,
    ),
    null,
  );
});
void test('D18/D53/D61: two simultaneous secrets, common45 and elimination credit retain their separate conditions', () => {
  const all = board.countries.map((c) => c.id),
    euSouth = board.countries
      .filter((c) => ['europe', 'south_america'].includes(c.continentId))
      .map((c) => c.id);
  assert(
    meetsVictory(
      board,
      catalog,
      euSouth,
      [{ objectiveId: 'occupation_02' }],
      4,
      'a',
      {},
    ),
  );
  assert(
    !meetsVictory(
      board,
      catalog,
      euSouth,
      [{ objectiveId: 'occupation_02' }, { objectiveId: 'occupation_03' }],
      2,
      'a',
      {},
    ),
  );
  assert(
    meetsVictory(
      board,
      catalog,
      all.slice(0, 45),
      [{ objectiveId: 'destroy_red', targetPlayerId: 'b' }],
      4,
      'a',
      {},
    ),
  );
  assert(
    meetsVictory(
      board,
      catalog,
      euSouth,
      [{ objectiveId: 'destroy_red', targetPlayerId: 'b' }],
      4,
      'a',
      { b: 'a' },
    ),
  );
  assert(
    !meetsVictory(
      board,
      catalog,
      euSouth,
      [{ objectiveId: 'destroy_red', targetPlayerId: 'b' }],
      4,
      'a',
      { b: 'c' },
    ),
  );
});

void test('Every occupation objective has a minimal sufficient witness and requires ten genuinely additional countries with three players', () => {
  const all = board.countries.map((c) => c.id);
  for (const objective of catalog.objectives.filter(
    (o) => o.kind === 'occupation',
  )) {
    const witness = occupationWitness(board, all, objective);
    assert(witness, objective.id);
    assert.equal(new Set(witness).size, witness.length);
    assert(occupationWitness(board, witness, objective));
    for (const id of witness)
      assert.equal(
        occupationWitness(
          board,
          witness.filter((c) => c !== id),
          objective,
        ),
        null,
        `${objective.id}/${id}`,
      );
    const extra = all.filter((id) => !witness.includes(id)).slice(0, 10);
    assert.equal(extra.length, 10);
    assert.equal(
      meetsVictory(
        board,
        catalog,
        [...witness, ...extra.slice(0, 9)],
        [{ objectiveId: objective.id }],
        3,
        'a',
        {},
      ),
      false,
      objective.id,
    );
    assert.equal(
      meetsVictory(
        board,
        catalog,
        [...witness, ...extra],
        [{ objectiveId: objective.id }],
        3,
        'a',
        {},
      ),
      true,
      objective.id,
    );
  }
});
