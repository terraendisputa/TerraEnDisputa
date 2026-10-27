import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import {
  newSetupJournal,
  loadSetupJournal,
  commitLoadedSetupCommand,
} from '../packages/game-engine/dist/reconquista/session.js';
import { reconquistaActor } from '../packages/game-engine/dist/reconquista/express.js';
import { chooseReconquistaBotMove } from '../packages/game-engine/dist/reconquista/bot.js';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(
    join(root, 'apps/server/assets/reconquista/catalog.json'),
    'utf8',
  ),
);
const board = preparationBoard(catalog);
const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
function rng(seed) {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** A table of bots plays until someone wins or the round limit. */
function play(levels, seed, rounds = 40) {
  const random = rng(seed);
  const players = levels.map((_, i) => ({ id: `p${i}`, color: colors[i] }));
  const level = Object.fromEntries(players.map((p, i) => [p.id, levels[i]]));
  let loaded = newSetupJournal(catalog, players, random);
  let moves = 0;
  for (;;) {
    const c = loaded.state.campaign;
    if (c?.phase === 'finished' || (c && c.round > rounds)) break;
    // Forces regrouped in a turn are free again once it ends.
    if (c?.phase === 'incorporation')
      assert.deepEqual([c.fixedArmies, c.fixedMissiles], [{}, {}]);
    const actor = reconquistaActor(board, loaded.state);
    const action = chooseReconquistaBotMove(
      board,
      loaded.state,
      actor,
      level[actor],
      random,
    );
    assert(action, `bot ${actor} has a move`);
    loaded = commitLoadedSetupCommand(
      catalog,
      loaded,
      actor,
      `m${++moves}`,
      loaded.revision,
      action,
      random,
    );
    assert(moves < 60000, 'the game moves on');
  }
  return loaded;
}

void test('bot tables play Reconquista from the first placement on', () => {
  const tables = [
    ['easy', 'easy'],
    ['normal', 'easy', 'normal'],
    ['normal', 'normal', 'normal', 'normal'],
    ['easy', 'normal', 'easy', 'normal', 'easy'],
    ['normal', 'normal', 'easy', 'easy', 'normal', 'normal'],
  ];
  let finished = 0;
  tables.forEach((levels, i) => {
    const played = play(levels, 100 + i);
    assert(played.state.campaign, 'full turns start');
    if (played.state.campaign.phase === 'finished') finished++;
    assert.deepEqual(
      loadSetupJournal(catalog, played.journal).state,
      played.state,
    );
  });
  assert(finished > 0, 'some table reaches a winner');
});

void test('normal bots fire missiles and convert armies on crowded borders', () => {
  const played = play(['normal', 'normal', 'normal'], 7, 25);
  const actions = played.journal.commands.map((c) => c.action);
  const campaign = actions.filter((a) => a.kind === 'campaign');
  assert(
    campaign.some(
      (a) =>
        a.action.kind === 'reinforce' &&
        Object.keys(a.action.conversions).length > 0,
    ),
    'some armies became missiles',
  );
  assert(
    campaign.some((a) => a.action.kind === 'fire'),
    'some missile was fired',
  );
});

void test('a bot rejects pacts offered to it', () => {
  const random = rng(3);
  let loaded = play(['normal', 'normal', 'normal'], 3, 1);
  const c = loaded.state.campaign;
  const actor = reconquistaActor(board, loaded.state);
  const bot = c.order.find((id) => id !== actor);
  loaded = commitLoadedSetupCommand(
    catalog,
    loaded,
    actor,
    'offer',
    loaded.revision,
    {
      kind: 'campaign',
      action: {
        kind: 'propose-pact',
        partnerId: bot,
        pactKind: 'world',
        countryIds: [],
        continentIds: [],
      },
    },
    random,
  );
  const answer = chooseReconquistaBotMove(
    board,
    loaded.state,
    bot,
    'normal',
    random,
  );
  assert.equal(answer.action.kind, 'respond-pact');
  assert.equal(answer.action.accept, false);
});
