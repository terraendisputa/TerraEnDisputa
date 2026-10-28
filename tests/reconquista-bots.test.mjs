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
function play(levels, seed, rounds = 40, offers = true) {
  const random = rng(seed);
  const players = levels.map((_, i) => ({ id: `p${i}`, color: colors[i] }));
  const level = Object.fromEntries(players.map((p, i) => [p.id, levels[i]]));
  let loaded = newSetupJournal(catalog, players, random);
  // Each bot remembers its offers, so it makes one a turn at most.
  const memory = Object.fromEntries(players.map((p) => [p.id, {}]));
  let moves = 0;
  for (;;) {
    const c = loaded.state.campaign;
    if (c?.phase === 'finished' || (c && c.round > rounds)) break;
    // Forces regrouped in a turn are free again once it ends.
    if (c?.phase === 'incorporation')
      assert.deepEqual([c.fixedArmies, c.fixedMissiles], [{}, {}]);
    // Answers to offers come first, from whoever received them.
    let actor = reconquistaActor(board, loaded.state);
    let action = null;
    for (const p of players) {
      const move = chooseReconquistaBotMove(
        board,
        loaded.state,
        p.id,
        level[p.id],
        random,
        offers ? memory[p.id] : undefined,
      );
      if (move && (p.id === actor || /^respond/.test(move.action?.kind))) {
        action = move;
        actor = p.id;
        if (p.id !== reconquistaActor(board, loaded.state)) break;
      }
    }
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
    ['hard', 'hard'],
    ['hard', 'normal', 'easy', 'hard'],
    ['hard', 'normal', 'normal', 'hard', 'easy', 'hard'],
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

void test('hard bots outplay normal ones on the board', () => {
  let wins = 0;
  for (const seed of [1, 2, 3, 4]) {
    const levels =
      seed % 2 ? ['hard', 'normal', 'normal'] : ['normal', 'normal', 'hard'];
    // Without offers: the board play alone.
    const c = play(levels, seed, 60, false).state.campaign;
    if (c.winners.some((id) => levels[Number(id.slice(1))] === 'hard')) wins++;
  }
  assert(wins >= 2, `hard won ${wins} of 4`);
});

void test('bots offer and answer pacts, alliances and zones', () => {
  const kinds = new Map();
  for (const [i, levels] of [
    ['normal', 'hard', 'normal', 'hard'],
    ['hard', 'easy', 'normal'],
    ['hard', 'hard', 'normal', 'easy', 'normal'],
  ].entries()) {
    const played = play(levels, 200 + i, 30);
    for (const { action } of played.journal.commands)
      if (action.kind === 'campaign') {
        const a = action.action;
        const key = a.pactKind ? `${a.kind}:${a.pactKind}` : a.kind;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
      }
  }
  for (const kind of [
    'propose-pact:countries',
    'respond-pact',
    'propose-alliance',
    'respond-alliance',
    'start-alliance',
  ])
    assert(kinds.get(kind) > 0, `bots used ${kind}`);
});

void test('a bot never pacts with the color it must destroy', () => {
  const random = rng(3);
  for (let seed = 1; seed < 40; seed++) {
    let loaded = play(['normal', 'normal', 'normal', 'normal'], seed, 1);
    const c = loaded.state.campaign;
    const actor = reconquistaActor(board, loaded.state);
    const bot = c.objectives.find((o) =>
      o.objectives.some((s) => s.targetPlayerId === actor),
    )?.playerId;
    if (!bot) continue;
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
    return;
  }
  assert.fail('no game dealt a destruction objective');
});
