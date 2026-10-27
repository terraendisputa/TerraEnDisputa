// Plays games with bots only, without a server, and reports how each
// difficulty does. Build first (pnpm build), then:
//   node scripts/simulate-bots.mjs [--mode competitive|classic] [--games 100] [--seed 1]
// Classic plays every table in Express and without a time limit. Mixed
// tables rotate the levels across seats, so every level sits in every
// position. Each bot move takes one second of game time, as on the server,
// and a bot answers a pact offered to it before anyone else moves.
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  BOT_LEVELS,
  PLAYER_COLORS,
  applyBotCommand,
  chooseBotCommand,
  competitiveActor,
  competitiveResults,
  createClassicSetup,
  startCompetitiveClock,
  synchronizeCompetitiveClock,
  tickCompetitiveClock,
} from '../packages/game-engine/dist/index.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'competitive' },
    games: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
  },
});
const gamesPerTable = Math.max(1, Number(values.games));
let seed = Number(values.seed) >>> 0;
const next = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const random = {
  rollDie: () => 1 + Math.floor(next() * 6),
  shuffle: (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
};
// A game that has not ended after this much play, or a Classic game without
// a time limit after this many rounds, is stuck.
const STUCK_MS = 6 * 60 * 60_000;
const STUCK_ROUNDS = 300;
const PACT_MOVES = [
  'propose_pact',
  'accept_pact',
  'reject_pact',
  'withdraw_pact',
];

/** Who moves next: a bot with a pact offer waiting, else whoever must act. */
const nextActor = (s) =>
  (s.status === 'ACTIVE' && s.pacts.proposals[0]?.recipientId) ||
  competitiveActor(s);

function play(levels, variant) {
  const players = levels.map((level, seatIndex) => ({
    id: randomUUID(),
    nickname: `${level} ${seatIndex}`,
    seatIndex,
    color: PLAYER_COLORS[seatIndex],
    controller: 'controlled',
    eliminated: false,
    cards: [],
    completedExchangeCount: 0,
  }));
  const levelOf = new Map(players.map((p, i) => [p.id, levels[i]]));
  const pacts = Object.fromEntries(PACT_MOVES.map((type) => [type, 0]));
  const timed = variant !== 'free';
  let now = 0;
  const setup = createClassicSetup(
    randomUUID(),
    players,
    random,
    variant === 'competitive' ? 'competitive' : 'classic',
  );
  let s = timed
    ? startCompetitiveClock(
        variant === 'express' ? { ...setup, classicExpress: true } : setup,
        now,
      )
    : setup;
  const round = (state) =>
    state.status !== 'SETUP' && state.turn.round.kind === 'normal'
      ? state.turn.round.roundNumber
      : 0;
  while (s.status !== 'FINISHED') {
    if (timed ? now >= STUCK_MS : round(s) > STUCK_ROUNDS) break;
    now += 1000;
    if (timed) {
      s = tickCompetitiveClock(s, now, true, random);
      if (s.status === 'FINISHED') break;
    }
    const actor = nextActor(s);
    const command = actor
      ? chooseBotCommand(s, actor, levelOf.get(actor), random)
      : undefined;
    if (!command) {
      // Without a clock nothing moves the turn on: the game is stuck.
      if (!timed) break;
      continue;
    }
    const result = applyBotCommand(s, command, {
      dice: random,
      shuffle: random,
    });
    if (!result.ok) throw new Error(`${command.type}: ${result.error.code}`);
    if (command.type in pacts) pacts[command.type]++;
    s = timed
      ? synchronizeCompetitiveClock(s, result.state, now)
      : result.state;
  }
  if (s.status !== 'FINISHED')
    return { stuck: true, minutes: now / 60_000, pacts };
  // When time runs out the tiebreak decides; a shared first place has no winner.
  const first = competitiveResults(s)?.rows.filter((r) => r.position === 1);
  const winner =
    s.result.winnerId ?? (first?.length === 1 ? first[0].playerId : undefined);
  return {
    stuck: false,
    minutes: now / 60_000,
    rounds: s.competitiveClock?.completedRounds ?? round(s),
    reason: s.result.victoryReason.kind,
    winnerLevel: winner ? levelOf.get(winner) : undefined,
    pacts,
  };
}

const LEVEL_NAMES = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const classic = values.mode === 'classic';
const counts = classic ? [2, 3, 4, 5, 6] : [4, 5, 6];
const baseTables = [
  ...counts.map((count) => ({
    name: `Mixta de ${count}`,
    levels: Array.from({ length: count }, (_, i) => BOT_LEVELS[i % 3]),
  })),
  { name: 'Difícil contra Normal (6)', levels: ['hard', 'normal'] },
  { name: 'Normal contra Fácil (6)', levels: ['normal', 'easy'] },
  ...BOT_LEVELS.map((level) => ({
    name: `Solo ${LEVEL_NAMES[level]} (5)`,
    levels: Array(5).fill(level),
  })),
].map((table) =>
  table.levels.length === 2 && table.name.endsWith('(6)')
    ? {
        ...table,
        levels: Array.from({ length: 6 }, (_, i) => table.levels[i % 2]),
      }
    : table,
);
const VARIANTS = { express: 'Express', free: 'sin límite' };
const tables = classic
  ? Object.entries(VARIANTS).flatMap(([variant, label]) =>
      baseTables.map((table) => ({
        ...table,
        name: `${table.name}, ${label}`,
        variant,
      })),
    )
  : baseTables.map((table) => ({ ...table, variant: 'competitive' }));

const REASONS = {
  secret_objective: 'misión',
  control_territories: '30 países',
  control_all_territories: '50 países',
  time_limit: 'tiempo',
  no_competitors: 'sin rivales',
};
const percent = (part, whole) =>
  whole ? `${Math.round((100 * part) / whole)} %` : '—';
console.log(
  `# Simulación de bots de ${classic ? 'Clásico' : 'Competitivo'} (${gamesPerTable} partidas por mesa, semilla ${values.seed})\n`,
);
let stuckTotal = 0;
for (const table of tables) {
  const wins = Object.fromEntries(BOT_LEVELS.map((l) => [l, 0]));
  const reasons = {};
  let stuck = 0,
    minutes = 0,
    rounds = 0,
    finished = 0,
    draws = 0;
  const pacts = Object.fromEntries(PACT_MOVES.map((type) => [type, 0]));
  for (let g = 0; g < gamesPerTable; g++) {
    // Rotate the seats so no level keeps the same position.
    const levels = table.levels.map(
      (_, i) => table.levels[(i + g) % table.levels.length],
    );
    const result = play(levels, table.variant);
    for (const type of PACT_MOVES) pacts[type] += result.pacts[type];
    if (result.stuck) {
      stuck++;
      continue;
    }
    finished++;
    minutes += result.minutes;
    rounds += result.rounds;
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (result.winnerLevel) wins[result.winnerLevel]++;
    else draws++;
  }
  stuckTotal += stuck;
  const seats = Object.fromEntries(
    BOT_LEVELS.map((l) => [l, table.levels.filter((x) => x === l).length]),
  );
  console.log(`## ${table.name}\n`);
  console.log('| Dificultad | Asientos | Victorias | Esperado por azar |');
  console.log('| --- | --- | --- | --- |');
  for (const level of BOT_LEVELS)
    if (seats[level])
      console.log(
        `| ${LEVEL_NAMES[level]} | ${seats[level]} | ${wins[level]} (${percent(wins[level], finished)}) | ${percent(seats[level], table.levels.length)} |`,
      );
  const average = (n) => (finished ? Math.round(n / finished) : '—');
  // Without a time limit only the rounds measure how long a game lasts.
  const length =
    table.variant === 'free'
      ? `${average(rounds)} rondas`
      : `${average(minutes)} min de juego, ${average(rounds)} rondas`;
  console.log(
    `\nCómo terminan: ${Object.entries(reasons)
      .map(([k, n]) => `${REASONS[k] ?? k} ${percent(n, finished)}`)
      .join(
        ', ',
      )}. Empates: ${draws}. Duración media: ${length}. Trabadas: ${stuck}.`,
  );
  if (table.variant !== 'competitive') {
    const games = gamesPerTable;
    const perGame = (n) => (n / games).toFixed(1);
    console.log(
      `Pactos por partida: ${perGame(pacts.propose_pact)} propuestos, ${perGame(pacts.accept_pact)} aceptados, ${perGame(pacts.reject_pact)} rechazados, ${perGame(pacts.withdraw_pact)} rotos.`,
    );
  }
  console.log('');
}
if (stuckTotal) process.exitCode = 1;
