// Reconquista part of the bot simulator (simulate-bots.mjs --mode reconquista).
// Bots play whole games without a server: answers to offers come first, then
// the bot whose turn it is. Express runs the server's clock: each bot move
// takes two seconds of game time, an activation whose time runs out plays its
// timeout moves, and the game ends by time after the two final rounds.
import { readFile } from 'node:fs/promises';
import { preparationBoard } from '../packages/game-engine/dist/reconquista/preparation.js';
import {
  applyReconquistaSetup,
  createReconquistaSession,
} from '../packages/game-engine/dist/reconquista/session.js';
import {
  reconquistaActivationKey,
  reconquistaActivationMs,
  reconquistaActor,
  reconquistaExpressDurationMs,
  reconquistaTimeoutMove,
} from '../packages/game-engine/dist/reconquista/express.js';
import {
  RECONQUISTA_BOT_LEVELS,
  chooseReconquistaBotMove,
} from '../packages/game-engine/dist/reconquista/bot.js';

const catalog = JSON.parse(
  await readFile(
    new URL('../apps/server/assets/reconquista/catalog.json', import.meta.url),
  ),
);
const board = preparationBoard(catalog);
const COLORS = ['white', 'black', 'red', 'blue', 'yellow', 'green'];
/** Time between two bot moves on the server. */
const MOVE_MS = 2_000;
// A game without a time limit past this many rounds is stuck.
const STUCK_ROUNDS = 150;
const LEVEL_NAMES = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const DIPLOMACY = [
  'propose-pact',
  'accepted-pact',
  'withdraw-pact',
  'propose-alliance',
  'accepted-alliance',
  'start-alliance',
  'zone',
  'propose-condominium',
  'accepted-condominium',
];

function play(levels, express, random) {
  const players = levels.map((_, i) => ({ id: `p${i}`, color: COLORS[i] }));
  const levelOf = Object.fromEntries(players.map((p, i) => [p.id, levels[i]]));
  const memory = Object.fromEntries(players.map((p) => [p.id, {}]));
  const counts = Object.fromEntries(DIPLOMACY.map((k) => [k, 0]));
  let s = createReconquistaSession(catalog, players, random);
  const apply = (actor, action) => {
    s = applyReconquistaSetup(board, s, actor, action, random);
    if (action.kind !== 'campaign') return;
    const a = action.action;
    if (a.kind === 'propose-pact')
      counts[a.pactKind === 'zone' ? 'zone' : 'propose-pact']++;
    else if (a.kind === 'respond-pact' && a.accept) counts['accepted-pact']++;
    else if (a.kind === 'respond-alliance' && a.accept)
      counts['accepted-alliance']++;
    else if (a.kind === 'respond-condominium' && a.accept)
      counts['accepted-condominium']++;
    else if (a.kind in counts) counts[a.kind]++;
  };
  let elapsed = 0,
    finalRound,
    key,
    remaining = 0,
    moves = 0;
  for (;;) {
    const c = s.campaign;
    if (c?.phase === 'finished') break;
    if (!express && c && c.round > STUCK_ROUNDS) return { stuck: true, counts };
    if (++moves > 200_000) return { stuck: true, counts };
    if (express) {
      if (finalRound !== undefined && c && c.round > finalRound) {
        apply('clock', { kind: 'time-limit' });
        break;
      }
      const current = reconquistaActivationKey(s);
      if (current !== key) {
        key = current;
        remaining = reconquistaActivationMs(s, finalRound);
      }
      if (remaining <= 0) {
        // The time ran out: the activation plays its timeout moves.
        while (reconquistaActivationKey(s) === key) {
          const move = reconquistaTimeoutMove(board, s, random);
          if (!move) return { stuck: true, noMove: true, counts };
          apply(move.actorId, move.action);
        }
        continue;
      }
      remaining -= MOVE_MS;
      if (c) elapsed += MOVE_MS;
      if (
        finalRound === undefined &&
        c &&
        elapsed >= reconquistaExpressDurationMs(levels.length)
      )
        finalRound = c.round + 2;
    }
    const actor = reconquistaActor(board, s);
    let chosen;
    for (const p of players) {
      if (p.id === actor) continue;
      const move = chooseReconquistaBotMove(
        board,
        s,
        p.id,
        levelOf[p.id],
        random,
        {},
      );
      if (move?.kind === 'campaign' && move.action.kind.startsWith('respond')) {
        chosen = { actor: p.id, move };
        break;
      }
    }
    if (!chosen && actor) {
      const move = chooseReconquistaBotMove(
        board,
        s,
        actor,
        levelOf[actor],
        random,
        memory[actor],
      );
      if (move) chosen = { actor, move };
    }
    if (!chosen) {
      if (!express) return { stuck: true, noMove: true, counts };
      continue;
    }
    apply(chosen.actor, chosen.move);
  }
  const c = s.campaign;
  const winners = c.winners;
  return {
    stuck: false,
    minutes: elapsed / 60_000,
    rounds: c.round,
    reason: c.timeLimit ? 'tiempo' : 'objetivo',
    winnerLevel: winners.length === 1 ? levelOf[winners[0]] : undefined,
    shared: winners.length > 1,
    counts,
  };
}

/**
 * Prints the report; `only` limits it to some tables (by position) so a
 * long run can be split across processes with the same results.
 */
export function simulateReconquista(gamesPerTable, seedValue, only) {
  const L = RECONQUISTA_BOT_LEVELS;
  const baseTables = [
    ...[2, 3, 4, 5, 6].map((count) => ({
      name: `Mixta de ${count}`,
      levels: Array.from({ length: count }, (_, i) => L[i % 3]),
    })),
    { name: 'Difícil contra Normal (4)', levels: ['hard', 'normal'] },
    { name: 'Normal contra Fácil (4)', levels: ['normal', 'easy'] },
    ...L.map((level) => ({
      name: `Solo ${LEVEL_NAMES[level]} (4)`,
      levels: Array(4).fill(level),
    })),
  ].map((t) =>
    t.levels.length === 2 && t.name.endsWith('(4)')
      ? { ...t, levels: Array.from({ length: 4 }, (_, i) => t.levels[i % 2]) }
      : t,
  );
  const tables = [true, false].flatMap((express) =>
    baseTables.map((t) => ({
      ...t,
      express,
      name: `${t.name}, ${express ? 'Express' : 'sin límite'}`,
    })),
  );
  const percent = (part, whole) =>
    whole ? `${Math.round((100 * part) / whole)} %` : '—';
  if (!only)
    console.log(
      `# Simulación de bots de Reconquista (${gamesPerTable} partidas por mesa, semilla ${seedValue})\n`,
    );
  let stuckTotal = 0;
  for (const [index, table] of tables.entries()) {
    if (only && !only.includes(index)) continue;
    // Each table has its own dice, whatever else runs.
    let seed = (seedValue * 1000 + index) >>> 0;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const wins = Object.fromEntries(L.map((l) => [l, 0]));
    const reasons = {};
    const counts = Object.fromEntries(DIPLOMACY.map((k) => [k, 0]));
    let stuck = 0,
      noMove = 0,
      minutes = 0,
      rounds = 0,
      finished = 0,
      draws = 0,
      shared = 0;
    const started = Date.now();
    for (let g = 0; g < gamesPerTable; g++) {
      // Rotate the seats so no level keeps the same position.
      const levels = table.levels.map(
        (_, i) => table.levels[(i + g) % table.levels.length],
      );
      const result = play(levels, table.express, random);
      for (const k of DIPLOMACY) counts[k] += result.counts[k];
      if (result.stuck) {
        stuck++;
        if (result.noMove) noMove++;
        continue;
      }
      finished++;
      minutes += result.minutes;
      rounds += result.rounds;
      reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
      if (result.winnerLevel) wins[result.winnerLevel]++;
      else if (result.shared) shared++;
      else draws++;
    }
    stuckTotal += stuck;
    const seats = Object.fromEntries(
      L.map((l) => [l, table.levels.filter((x) => x === l).length]),
    );
    console.log(`## ${table.name}\n`);
    console.log('| Dificultad | Asientos | Victorias | Esperado por azar |');
    console.log('| --- | --- | --- | --- |');
    for (const level of L)
      if (seats[level])
        console.log(
          `| ${LEVEL_NAMES[level]} | ${seats[level]} | ${wins[level]} (${percent(wins[level], finished)}) | ${percent(seats[level], table.levels.length)} |`,
        );
    const average = (n) => (finished ? Math.round(n / finished) : '—');
    const length = table.express
      ? `${average(minutes)} min de juego, ${average(rounds)} rondas`
      : `${average(rounds)} rondas`;
    const perGame = (n) => (n / gamesPerTable).toFixed(1);
    console.log(
      `\nCómo terminan: ${Object.entries(reasons)
        .map(([k, n]) => `${k} ${percent(n, finished)}`)
        .join(
          ', ',
        )}. Empates: ${draws}. Victorias compartidas: ${shared}. Duración media: ${length}. Trabadas: ${stuck}${noMove ? ` (${noMove} sin jugada posible)` : ''}.`,
    );
    console.log(
      `Diplomacia por partida: pactos ${perGame(counts['propose-pact'])} propuestos, ${perGame(counts['accepted-pact'])} aceptados, ${perGame(counts['withdraw-pact'])} rotos; zonas ${perGame(counts.zone)}; alianzas ${perGame(counts['propose-alliance'])} propuestas, ${perGame(counts['accepted-alliance'])} aceptadas, ${perGame(counts['start-alliance'])} ataques juntos; condominios aceptados ${perGame(counts['accepted-condominium'])}.`,
    );
    console.log(`<!-- ${Math.round((Date.now() - started) / 1000)} s -->\n`);
  }
  return stuckTotal ? 1 : 0;
}
