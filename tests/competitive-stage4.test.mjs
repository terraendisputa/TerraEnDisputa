import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '../node_modules/esbuild/lib/main.js';
import {
  applyCommand,
  createClassicSetup,
  startCompetitiveClock,
  tickCompetitiveClock,
  competitiveResults,
  assertClassicInvariants,
  victoryReason,
  TERRITORY_IDS,
  CONTINENTS,
  PLAYER_COLORS,
} from '../packages/game-engine/dist/index.js';
import {
  projectGameFor,
  projectGameForAdmin,
} from '../apps/server/dist/games/projection.js';
import {
  encodeGame,
  decodeGame,
} from '../apps/server/dist/persistence/schema.js';
import { emptyGameAuthState } from '../apps/server/dist/auth/types.js';
import { FileGameStore } from '../apps/server/dist/persistence/file-game-store.js';
import { AuthenticationService } from '../apps/server/dist/auth/authentication.js';
import { secureGameRandomness } from '../apps/server/dist/games/randomness.js';
import { GameService } from '../apps/server/dist/games/game-service.js';
import { buildServer } from '../apps/server/dist/app.js';
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from '../packages/protocol/dist/index.js';
const rng = { shuffle: (items) => [...items] };
function fixture(count = 4) {
  const players = Array.from({ length: count }, (_, seatIndex) => ({
    id: randomUUID(),
    seatIndex,
    nickname: `Resultado ${seatIndex}`,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
  let roll = 0,
    now = 1000000;
  let state = startCompetitiveClock(
    createClassicSetup(
      randomUUID(),
      players,
      { ...rng, rollDie: () => (++roll % 6) + 1 },
      'competitive',
    ),
    now,
  );
  while (
    state.status === 'SETUP' ||
    state.turn.round.kind === 'initial_hostility'
  ) {
    now += state.competitiveClock.activationRemainingMs;
    state = tickCompetitiveClock(state, now, true, rng);
  }
  return state;
}
function finish(state, completedRounds = 6, winnerId) {
  return {
    ...state,
    status: 'FINISHED',
    competitiveClock: {
      ...state.competitiveClock,
      completedRounds,
      finalRoundNumber: completedRounds,
    },
    result: winnerId
      ? {
          winnerId,
          scoringEligible: completedRounds >= 6,
          victoryReason: { kind: 'control_territories', territoryCount: 30 },
        }
      : {
          scoringEligible: completedRounds >= 6,
          victoryReason: { kind: 'time_limit' },
        },
  };
}
function board(state, counts) {
  let index = 0;
  return {
    ...state,
    territories: Object.fromEntries(
      counts.flatMap((count, playerIndex) =>
        Array.from({ length: count }, () => [
          TERRITORY_IDS[index++],
          {
            ownerId: state.players[playerIndex].id,
            armies: 1,
            fixedArmiesThisTurn: 0,
          },
        ]),
      ),
    ),
  };
}
function durable(state) {
  return {
    state,
    revision: 0,
    recentCommands: [],
    auth: {
      ...emptyGameAuthState(),
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
const rowFor = (results, player) =>
  results.rows.find((row) => row.playerId === player.id);
const fraction = (numerator, denominator = 1) => ({ numerator, denominator });
const web = await build({
  entryPoints: ['apps/web/src/competitive-results.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { resultExport, exactPointsText, competitiveRoundLabel } = await import(
  `data:text/javascript;base64,${Buffer.from(web.outputFiles[0].text).toString('base64')}`
);

void test('all base positions for 4/5/6 players; objective winner is first and rewarded once', () => {
  for (const counts of [
    [20, 13, 10, 7],
    [20, 12, 8, 6, 4],
    [18, 12, 8, 6, 4, 2],
  ]) {
    const s = board(fixture(counts.length), counts),
      result = competitiveResults(finish(s));
    assert.equal(result.scoringEligible, true);
    assert.deepEqual(
      result.rows.map((r) => r.basePoints),
      [25, 18, 15, 12, 10, 8].slice(0, counts.length).map((p) => fraction(p)),
    );
    const winner = s.players.at(-1).id;
    const objective = competitiveResults(finish(s, 6, winner));
    assert.equal(objective.rows[0].playerId, winner);
    assert.equal(objective.rows[0].objectiveBonus, 25);
    assert.deepEqual(objective.rows[0].totalPoints, fraction(50));
    assert.equal(
      objective.rows.reduce((sum, r) => sum + r.objectiveBonus, 0),
      25,
    );
  }
});
void test('full continents require every country and count only their countries/armies', () => {
  let s = board(fixture(), [10, 10, 15, 15]);
  const a = s.players[0].id,
    b = s.players[1].id;
  // Move all Oceania to A; Asia remains divided.
  for (const id of CONTINENTS.oceania.territoryIds)
    s = {
      ...s,
      territories: {
        ...s.territories,
        [id]: { ownerId: a, armies: 3, fixedArmiesThisTurn: 0 },
      },
    };
  const r = rowFor(competitiveResults(finish(s)), s.players[0]);
  assert.deepEqual(r.metrics.fullContinents, ['north_america', 'oceania']);
  assert.equal(r.metrics.continentTerritories, 14);
  assert.equal(r.metrics.continentArmies, 22);
  s = {
    ...s,
    territories: {
      ...s.territories,
      java: { ownerId: b, armies: 3, fixedArmiesThisTurn: 0 },
    },
  };
  assert.deepEqual(
    rowFor(competitiveResults(finish(s)), s.players[0]).metrics.fullContinents,
    ['north_america'],
  );
});
void test('metric hierarchy breaks ties in order, with exact shared positions for complete ties', () => {
  // Alternate owners so neither tied player accidentally owns a complete continent.
  let s = fixture();
  s = {
    ...s,
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id, i) => [
        id,
        {
          ownerId: s.players[i < 24 ? i % 2 : i < 37 ? 2 : 3].id,
          armies: 1,
          fixedArmiesThisTurn: 0,
        },
      ]),
    ),
  };
  const a = s.players[0],
    b = s.players[1];
  const tied = competitiveResults(finish(s));
  assert.equal(rowFor(tied, a).position, 3);
  assert.equal(rowFor(tied, b).position, 3);
  assert.equal(rowFor(tied, a).tiedPlayers, 2);
  assert.deepEqual(rowFor(tied, a).totalPoints, fraction(27, 2));
  assert.equal(exactPointsText(rowFor(tied, a).totalPoints), '27/2');
  for (const field of ['completedExchangeCount', 'cards']) {
    const changed = {
      ...s,
      players: s.players.map((p) =>
        p.id === b.id
          ? {
              ...p,
              [field]:
                field === 'cards'
                  ? [{ cardId: 'alaska', territoryBonusClaimed: false }]
                  : 1,
            }
          : p,
      ),
    };
    assert.equal(rowFor(competitiveResults(finish(changed)), b).position, 3);
    assert.equal(rowFor(competitiveResults(finish(changed)), a).position, 4);
  }
  const troop = {
    ...s,
    territories: {
      ...s.territories,
      alaska: { ...s.territories.alaska, armies: 2 },
    },
  };
  assert.equal(rowFor(competitiveResults(finish(troop)), a).position, 3);
});
void test('eliminated follow survivors in reverse elimination order; awards and penalty accumulate', () => {
  let s = board(fixture(6), [25, 15, 10, 0, 0, 0]);
  const [a, b, c, d, e, f] = s.players;
  s = {
    ...s,
    players: s.players.map((p) =>
      [d.id, e.id, f.id].includes(p.id) ? { ...p, eliminated: true } : p,
    ),
    competitiveHistory: {
      complete: true,
      eliminations: [
        { eliminatedPlayerId: f.id, eliminatingPlayerId: a.id, turnNumber: 1 },
        { eliminatedPlayerId: e.id, eliminatingPlayerId: d.id, turnNumber: 2 },
        { eliminatedPlayerId: d.id, eliminatingPlayerId: a.id, turnNumber: 3 },
      ],
    },
  };
  const result = competitiveResults(finish(s));
  assert.deepEqual(
    result.rows.map((r) => r.playerId),
    [a, b, c, d, e, f].map((p) => p.id),
  );
  assert.deepEqual(rowFor(result, a).totalPoints, fraction(45));
  assert.deepEqual(rowFor(result, d).totalPoints, fraction(17));
  assert.deepEqual(rowFor(result, f).totalPoints, fraction(3));
});
void test('disqualified have no position/points, compress ranking, but elimination earns killer bonus', () => {
  let s = board(fixture(5), [25, 15, 10, 0, 0]);
  const [a, b, , d, e] = s.players;
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a.id
        ? { ...p, disqualified: true }
        : p.id === e.id
          ? { ...p, eliminated: true, disqualified: true }
          : p.id === d.id
            ? { ...p, eliminated: true }
            : p,
    ),
    competitiveHistory: {
      complete: true,
      eliminations: [
        { eliminatedPlayerId: e.id, eliminatingPlayerId: b.id, turnNumber: 1 },
        { eliminatedPlayerId: d.id, eliminatingPlayerId: a.id, turnNumber: 2 },
      ],
    },
  };
  const result = competitiveResults(finish(s));
  assert.equal(rowFor(result, b).position, 1);
  assert.deepEqual(rowFor(result, b).totalPoints, fraction(35));
  assert.equal(rowFor(result, d).position, 3);
  for (const p of [a, e]) {
    assert.equal(rowFor(result, p).position, undefined);
    assert.deepEqual(rowFor(result, p).totalPoints, fraction(0));
  }
  const all = competitiveResults(
    finish({
      ...s,
      players: s.players.map((p) => ({ ...p, disqualified: true })),
    }),
  );
  assert.equal(all.scoringEligible, false);
  assert.ok(all.exclusions.includes('no_competitors'));
  assert.ok(
    all.rows.every(
      (r) => r.position === undefined && r.totalPoints.numerator === 0,
    ),
  );
});
void test('minimum rounds, incomplete historical eliminations and pending inheritance disable official points', () => {
  const s = board(fixture(), [20, 13, 10, 7]);
  for (const rounds of [0, 5, 6]) {
    const result = competitiveResults(finish(s, rounds));
    assert.equal(result.scoringEligible, rounds >= 6);
    assert.ok(
      result.rows.every((r) => rounds >= 6 || r.totalPoints.numerator === 0),
    );
  }
  let legacy = {
    ...finish(s),
    competitiveHistory: undefined,
    players: s.players.map((p, i) =>
      i === 3 ? { ...p, eliminated: true } : p,
    ),
  };
  const incomplete = competitiveResults(legacy);
  assert.equal(incomplete.historyComplete, false);
  assert.equal(incomplete.scoringEligible, false);
  assert.equal(
    projectGameFor(legacy, 0, legacy.players[0].id).result.scoringEligible,
    false,
  );
  assert.equal(projectGameForAdmin(legacy, 0).result.scoringEligible, false);
  assert.ok(incomplete.rows.every((r) => r.eliminationBonus === 0));
  assert.equal(
    incomplete.rows.find((r) => r.status === 'eliminated').position,
    undefined,
  );
  assert.ok(
    competitiveResults({
      ...finish(s),
      competitiveClock: undefined,
    }).exclusions.includes('unknown_rounds'),
  );
  assert.ok(
    competitiveResults({
      ...finish(s),
      pendingInheritance: {
        playerId: s.players[0].id,
        cards: [],
        takeCount: 1,
      },
    }).exclusions.includes('pending_inheritance'),
  );
});
void test('common objective takes priority only in competitive; result projection is admin-only', () => {
  const s = board(fixture(), [50, 0, 0, 0]),
    a = s.players[0];
  assert.equal(victoryReason(s, a.id).kind, 'control_territories');
  assert.equal(
    victoryReason({ ...s, mode: 'classic' }, a.id).kind,
    'secret_objective',
  );
  const done = finish(s, 6, a.id),
    admin = projectGameForAdmin(done, 7),
    player = projectGameFor(done, 7, a.id);
  assert.ok(admin.competitiveResults);
  assert.equal(player.competitiveResults, undefined);
  serverMessageSchema.parse({
    type: 'STATE',
    protocolVersion: PROTOCOL_VERSION,
    state: player,
  });
  const serialized = JSON.stringify(admin.competitiveResults);
  for (const secret of [
    'secretObjectiveId',
    'cardId',
    'effectiveDestructionTargetPlayerId',
  ])
    assert.ok(!serialized.includes(secret));
  assert.equal(competitiveResults({ ...done, mode: 'classic' }), undefined);
  assert.equal(
    projectGameForAdmin({ ...done, mode: 'classic' }, 7).competitiveResults,
    undefined,
  );
});
void test('JSON/CSV exports preserve exact points and exclusions, escape names, reveal no private data', () => {
  let s = finish(board(fixture(), [20, 13, 10, 7]));
  s = {
    ...s,
    players: s.players.map((p, i) =>
      i === 0
        ? { ...p, nickname: '=SUM(1,2) "test"\nname' }
        : i === 1
          ? { ...p, nickname: '\tcmd' }
          : p,
    ),
  };
  const view = projectGameForAdmin(s, 8),
    json = resultExport(view, 'json'),
    csv = resultExport(view, 'csv');
  assert.equal(JSON.parse(json).results.rulesVersion, 1);
  assert.ok(csv.includes(`"'=SUM(1,2) ""test""\nname"`));
  assert.ok(csv.includes(`"'\tcmd"`));
  assert.ok(csv.includes('total_denominador'));
  for (const secret of [
    'secretObjectiveId',
    'cardId',
    'verifier',
    'recovery',
  ]) {
    assert.ok(!json.includes(secret));
    assert.ok(!csv.includes(secret));
  }
});
void test('display rounds 1/2/3 then normal 4, without renumbering Classic', () => {
  const s = fixture();
  assert.equal(competitiveRoundLabel(s), 'Ronda 4');
  assert.equal(
    competitiveRoundLabel({
      ...s,
      turn: { ...s.turn, round: { kind: 'initial_hostility' } },
    }),
    'Ronda 3',
  );
  for (const round of [1, 2])
    assert.equal(
      competitiveRoundLabel({
        mode: 'competitive',
        setup: { kind: 'card_deal_4_to_6', reinforcementRound: round },
      }),
      `Ronda ${round}`,
    );
  assert.equal(competitiveRoundLabel({ ...s, mode: 'classic' }), undefined);
});
void test('durable elimination awards once across duplicate command, restart; validates ledger and schema9 migration', async () => {
  let s = fixture();
  const a = s.turn.playerId,
    b = s.players.find((p) => p.id !== a).id,
    c = s.players.find((p) => p.id !== a && p.id !== b).id;
  s = {
    ...s,
    turn: {
      ...s.turn,
      phase: 'attack',
      reinforcementArmiesRemaining: undefined,
      continentReinforcementsRemaining: undefined,
      round: { ...s.turn.round, pass: 'hostility' },
    },
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id) => [
        id,
        id === 'oregon'
          ? { ownerId: a, armies: 5, fixedArmiesThisTurn: 0 }
          : id === 'yukon'
            ? { ownerId: b, armies: 1, fixedArmiesThisTurn: 0 }
            : s.territories[id].ownerId === b
              ? { ...s.territories[id], ownerId: c }
              : s.territories[id],
      ]),
    ),
  };
  const directory = await mkdtemp(join(tmpdir(), 'ted-stage4-'));
  let store = await FileGameStore.open(directory);
  try {
    await store.commitGame(durable(s), { revision: null });
    const service = new GameService(
      store,
      undefined,
      () => s.competitiveClock.updatedAtMs,
    );
    let rolls = 0;
    // Inject deterministic dice into normal service command pipeline.
    const command = {
      type: 'COMMAND',
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      baseRevision: 0,
      command: { type: 'attack', from: 'oregon', to: 'yukon' },
    };
    const originalDie = secureGameRandomness.rollDie;
    try {
      secureGameRandomness.rollDie = () => (++rolls <= 3 ? 6 : 1);
      const first = await service.process(s.id, a, command);
      const again = await service.process(s.id, a, command);
      assert.equal(first.kind, 'COMMITTED');
      assert.equal(again.kind, 'DUPLICATE');
      assert.equal(
        (await store.loadGame(s.id)).state.competitiveHistory.eliminations
          .length,
        1,
      );
    } finally {
      secureGameRandomness.rollDie = originalDie;
    }
    const saved = await store.loadGame(s.id);
    assert.equal(saved.state.competitiveHistory.eliminations.length, 1);
    await store.close();
    store = await FileGameStore.open(directory);
    const restored = (await store.loadGame(s.id)).state;
    assert.deepEqual(
      restored.competitiveHistory,
      saved.state.competitiveHistory,
    );
    const bad = structuredClone(encodeGame(saved));
    bad.game.state.competitiveHistory.eliminations.push({
      ...bad.game.state.competitiveHistory.eliminations[0],
    });
    assert.throws(() => decodeGame(bad));
    const older = encodeGame(durable(s));
    older.gameSchemaVersion = 9;
    delete older.game.state.definition;
    assert.throws(() => decodeGame(older), /stage 4/);
    delete older.game.state.competitiveHistory;
    const migrated = decodeGame(older).game.state;
    assert.deepEqual(migrated.territories, s.territories);
    assert.deepEqual(migrated.players, s.players);
    assert.equal(migrated.competitiveHistory, undefined);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('HTTP detailed results require administrator session and remain available in finished list', async () => {
  const s = finish(board(fixture(), [20, 13, 10, 7]));
  assertClassicInvariants(s);
  const directory = await mkdtemp(join(tmpdir(), 'ted-stage4-admin-'));
  const store = await FileGameStore.open(directory);
  await store.commitGame(durable(s), { revision: null });
  const auth = new AuthenticationService(store),
    code = await auth.initializeAdmin(),
    origin = 'http://results-test.local';
  const server = buildServer({
    store,
    logger: false,
    clockIntervalMs: 0,
    publicOrigin: origin,
  });
  try {
    const path = `/api/admin/games/${s.id}/state`;
    assert.equal(
      (await server.inject({ method: 'GET', url: path })).statusCode,
      401,
    );
    const login = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { recoveryCode: code },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      origin,
      cookie: [login.headers['set-cookie']]
        .flat()
        .map((v) => v.split(';')[0])
        .join('; '),
    };
    const response = await server.inject({ method: 'GET', url: path, headers });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.json().state.competitiveResults.scoringEligible,
      true,
    );
    const list = await server.inject({
      method: 'GET',
      url: '/api/admin/games',
      headers,
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().games[0].status, 'FINISHED');
    assert.ok(list.json().games[0].competitiveResults);
  } finally {
    await server.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('after countries, armies, exchanges and cards, tied players share their points', () => {
  let s = fixture(),
    [a, b, c, d] = s.players;
  // Equal countries, armies, exchanges and cards; only continents differ.
  const aIds = new Set([
    ...CONTINENTS.africa.territoryIds,
    ...CONTINENTS.north_america.territoryIds.slice(0, 4),
  ]);
  const bIds = new Set([
    ...CONTINENTS.south_america.territoryIds,
    ...CONTINENTS.europe.territoryIds.slice(0, 4),
  ]);
  let remaining = 0;
  s = {
    ...s,
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id) => [
        id,
        {
          ownerId: aIds.has(id)
            ? a.id
            : bIds.has(id)
              ? b.id
              : remaining++ < 15
                ? c.id
                : d.id,
          armies: id === 'sahara' || id === 'spain' ? 2 : 1,
          fixedArmiesThisTurn: 0,
        },
      ]),
    ),
  };
  const result = competitiveResults(finish(s));
  assert.equal(rowFor(result, a).metrics.continentArmies, 7);
  assert.equal(rowFor(result, b).metrics.continentArmies, 6);
  for (const player of [a, b]) {
    assert.equal(rowFor(result, player).position, 3);
    assert.equal(rowFor(result, player).tiedPlayers, 2);
    assert.deepEqual(rowFor(result, player).basePoints, fraction(27, 2));
  }
});
void test('the elimination that completes a destruction objective earns no +10', () => {
  let s = board(fixture(5), [30, 10, 10, 0, 0]);
  const [a, b, , d, e] = s.players;
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a.id
        ? {
            ...p,
            secretObjectiveId: `destroy_${d.color}`,
            effectiveDestructionTargetPlayerId: d.id,
          }
        : p.id === d.id || p.id === e.id
          ? { ...p, eliminated: true }
          : p,
    ),
    competitiveHistory: {
      complete: true,
      eliminations: [
        { eliminatedPlayerId: e.id, eliminatingPlayerId: a.id, turnNumber: 1 },
        { eliminatedPlayerId: d.id, eliminatingPlayerId: a.id, turnNumber: 2 },
      ],
    },
  };
  const finished = {
    ...finish(s, 6, a.id),
    result: {
      winnerId: a.id,
      scoringEligible: true,
      victoryReason: {
        kind: 'secret_objective',
        objectiveId: `destroy_${d.color}`,
      },
    },
  };
  const result = competitiveResults(finished);
  assert.equal(rowFor(result, a).objectiveBonus, 25);
  assert.equal(rowFor(result, a).eliminationBonus, 10);
  assert.equal(rowFor(result, b).eliminationBonus, 0);
  // Winning by the common objective keeps both elimination bonuses.
  const common = competitiveResults(finish(s, 6, a.id));
  assert.equal(rowFor(common, a).eliminationBonus, 20);
});
void test('three-way tie shares occupied positions without rounding or awarding a spurious objective', () => {
  let s = fixture();
  s = {
    ...s,
    territories: Object.fromEntries(
      TERRITORY_IDS.map((id, i) => [
        id,
        {
          ownerId: s.players[i < 39 ? i % 3 : 3].id,
          armies: 1,
          fixedArmiesThisTurn: 0,
        },
      ]),
    ),
  };
  const result = competitiveResults(finish(s));
  for (const p of s.players.slice(0, 3)) {
    const row = rowFor(result, p);
    assert.equal(row.position, 1);
    assert.equal(row.tiedPlayers, 3);
    assert.deepEqual(row.totalPoints, fraction(58, 3));
    assert.equal(row.objectiveBonus, 0);
  }
  assert.equal(rowFor(result, s.players[3]).position, 4);
});
void test('finished inheritance remains provisional until manual choice, then uses final hand and immutable history', () => {
  let s = finish(board(fixture(), [20, 13, 10, 7]), 6);
  const a = s.players[0],
    held = TERRITORY_IDS.slice(0, 4),
    options = TERRITORY_IDS.slice(4, 6);
  s = {
    ...s,
    players: s.players.map((p) =>
      p.id === a.id
        ? {
            ...p,
            cards: held.map((cardId) => ({
              cardId,
              territoryBonusClaimed: false,
            })),
          }
        : p,
    ),
    pendingInheritance: {
      playerId: a.id,
      takeCount: 1,
      cards: options.map((cardId) => ({
        cardId,
        territoryBonusClaimed: false,
      })),
    },
    cardDeck: { drawPile: TERRITORY_IDS.slice(6), discardPile: [] },
  };
  assertClassicInvariants(s);
  const before = competitiveResults(s);
  assert.equal(before.scoringEligible, false);
  assert.ok(before.rows.every((r) => r.totalPoints.numerator === 0));
  const choice = applyCommand(s, {
    type: 'select_inherited_cards',
    playerId: a.id,
    cardIds: [options[1]],
  });
  assert.equal(choice.ok, true);
  assertClassicInvariants(choice.state);
  const after = competitiveResults(choice.state);
  assert.equal(after.scoringEligible, true);
  assert.equal(rowFor(after, a).metrics.cards, 5);
  assert.deepEqual(choice.state.competitiveHistory, s.competitiveHistory);
  assert.deepEqual(competitiveResults(choice.state), after);
});

const summaryBundle = await build({
  stdin: {
    contents: `import {createElement} from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {TurnSummary} from './TurnSummary.js';
      import {gameContextSummary,gamePresentation} from './game-presentation.js';
      export {gameContextSummary,gamePresentation};
      export const renderSummary=(snapshot)=>renderToStaticMarkup(createElement(TurnSummary,{snapshot,presentation:gamePresentation(snapshot)}));`,
    resolveDir: resolve('apps/web/src'),
    loader: 'tsx',
  },
  nodePaths: [resolve('apps/web/node_modules')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
});
const summaryDirectory = await mkdtemp(
  join(tmpdir(), 'ted-summary-regression-'),
);
after(() => rm(summaryDirectory, { recursive: true, force: true }));
const summaryPath = join(summaryDirectory, 'summary.cjs');
await writeFile(summaryPath, summaryBundle.outputFiles[0].text);
const { renderSummary, gameContextSummary } = createRequire(import.meta.url)(
  summaryPath,
);

void test('shared summary preserves Classic numbering for 2–6 players without setup round labels', () => {
  const players = fixture(6).players;
  for (const count of [2, 3, 4, 5, 6]) {
    let roll = 0;
    const setup = createClassicSetup(
      randomUUID(),
      players.slice(0, count),
      { shuffle: rng.shuffle, rollDie: () => (roll++ % 6) + 1 },
      'classic',
    );
    const view = projectGameFor(setup, 0, setup.players[0].id);
    const initialRound = count <= 3 ? 2 : 3;
    assert.equal(gameContextSummary(view).roundNumber, undefined);
    assert.match(renderSummary(view), /Distribución inicial/);
    const active = {
      ...view,
      status: 'ACTIVE',
      setup: undefined,
      turn: { ...fixture().turn, round: { kind: 'initial_hostility' } },
    };
    assert.equal(gameContextSummary(active).roundNumber, initialRound);
    assert.match(renderSummary(active), new RegExp(`Ronda ${initialRound}`));
    assert.equal(
      gameContextSummary({
        ...active,
        turn: { ...active.turn, round: { kind: 'normal', roundNumber: 1 } },
      }).roundNumber,
      initialRound + 1,
    );
    assert.doesNotMatch(renderSummary(active), /Turno:|Partida:/);
  }
});

void test('shared summary retains competitive clocks, setup rounds, pause and final notices', () => {
  const state = fixture(5),
    pid = state.turn.playerId;
  const view = projectGameFor(state, 0, pid);
  const paused = {
    ...view,
    competitiveClock: {
      ...view.competitiveClock,
      elapsedMs: 300000,
      activationRemainingMs: 47000,
      pauseReason: 'disconnection',
      technicalRemainingMs: 120000,
      disconnectedPlayerId: pid,
      finalRoundNumber: 3,
      lastUnplacedArmiesLost: 2,
    },
  };
  const markup = renderSummary(paused);
  assert.match(markup, /<strong>Ronda 4<\/strong>/);
  // During a disconnection pause the clock box names the absent player.
  const absent = paused.players.find(({ id }) => id === pid);
  assert.match(markup, /Pausa · Esperando a/);
  assert.match(markup, new RegExp(`color-${absent.color}`));
  assert.ok(markup.includes(absent.nickname));
  assert.match(markup, /Reconexión: 2:00/);
  assert.doesNotMatch(markup, /Partida:/);
  const running = renderSummary({
    ...paused,
    competitiveClock: {
      ...paused.competitiveClock,
      pauseReason: undefined,
      disconnectedPlayerId: undefined,
    },
  });
  assert.match(running, /<strong>0:47<\/strong>/);
  // Five players play 80 minutes; the clock counts down.
  assert.match(running, /Partida: 75 min/);
  assert.doesNotMatch(running, /Pausa/);
  assert.match(markup, /Rondas finales anunciadas/);
  assert.match(markup, /2 refuerzos perdidos/);
  assert.match(markup, /Canje/);
  for (const round of [1, 2])
    assert.equal(
      gameContextSummary({
        ...view,
        status: 'SETUP',
        turn: undefined,
        setup: {
          kind: 'card_deal_4_to_6',
          reinforcementRound: round,
          currentPlayerId: pid,
        },
      }).roundNumber,
      round,
    );
});

void test('shared summary never invents a winner for time/no-competitors and retains pending inheritance and escaped names', () => {
  const state = fixture(5),
    pid = state.turn.playerId;
  const base = projectGameFor(finish(state), 0, pid);
  for (const kind of ['time_limit', 'no_competitors']) {
    const view = { ...base, result: { victoryReason: { kind } } };
    assert.equal(gameContextSummary(view).headline, 'Partida cerrada');
    assert.doesNotMatch(renderSummary(view), /Ganó:/);
  }
  const won = {
    ...base,
    result: { ...base.result, winnerId: pid },
    players: base.players.map((p) =>
      p.id === pid ? { ...p, nickname: '<script>alert(1)</script>' } : p,
    ),
  };
  assert.match(renderSummary(won), /Ganó: &lt;script&gt;/);
  assert.doesNotMatch(renderSummary(won), /<script>/);
  assert.match(
    renderSummary({
      ...won,
      pendingInheritance: { playerId: pid, takeCount: 1, cardCount: 3 },
    }),
    /Cartas heredadas pendientes/,
  );
});
