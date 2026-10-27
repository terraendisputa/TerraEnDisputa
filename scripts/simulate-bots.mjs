// Plays Competitive games with bots only, without a server, and reports how
// each difficulty does. Build first (pnpm build), then:
//   node scripts/simulate-bots.mjs [--games 100] [--seed 1]
// Mixed tables rotate the levels across seats, so every level sits in every
// position. Each bot move takes one second of game time, as on the server.
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
// A game that has not ended after this much play is stuck.
const STUCK_MS = 6 * 60 * 60_000;

function play(levels) {
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
  let now = 0;
  let s = startCompetitiveClock(
    createClassicSetup(randomUUID(), players, random, 'competitive'),
    now,
  );
  while (s.status !== 'FINISHED' && now < STUCK_MS) {
    now += 1000;
    s = tickCompetitiveClock(s, now, true, random);
    if (s.status === 'FINISHED') break;
    const actor = competitiveActor(s);
    const command = actor
      ? chooseBotCommand(s, actor, levelOf.get(actor), random)
      : undefined;
    if (!command) continue;
    const result = applyBotCommand(s, command, {
      dice: random,
      shuffle: random,
    });
    if (!result.ok) throw new Error(`${command.type}: ${result.error.code}`);
    s = synchronizeCompetitiveClock(s, result.state, now);
  }
  if (s.status !== 'FINISHED') return { stuck: true, minutes: now / 60_000 };
  // When time runs out the tiebreak decides; a shared first place has no winner.
  const first = competitiveResults(s)?.rows.filter((r) => r.position === 1);
  const winner =
    s.result.winnerId ?? (first?.length === 1 ? first[0].playerId : undefined);
  return {
    stuck: false,
    minutes: now / 60_000,
    rounds: s.competitiveClock.completedRounds,
    reason: s.result.victoryReason.kind,
    winnerLevel: winner ? levelOf.get(winner) : undefined,
  };
}

const LEVEL_NAMES = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const tables = [
  ...[4, 5, 6].map((count) => ({
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
  table.levels.length === 2
    ? {
        ...table,
        levels: Array.from({ length: 6 }, (_, i) => table.levels[i % 2]),
      }
    : table,
);

const REASONS = {
  secret_objective: 'misión',
  control_territories: '30 países',
  time_limit: 'tiempo',
  no_competitors: 'sin rivales',
};
const percent = (part, whole) =>
  whole ? `${Math.round((100 * part) / whole)} %` : '—';
console.log(
  `# Simulación de bots (${gamesPerTable} partidas por mesa, semilla ${values.seed})\n`,
);
let stuckTotal = 0;
for (const table of tables) {
  const wins = Object.fromEntries(BOT_LEVELS.map((l) => [l, 0]));
  const reasons = {};
  let stuck = 0,
    minutes = 0,
    rounds = 0,
    finished = 0;
  for (let g = 0; g < gamesPerTable; g++) {
    // Rotate the seats so no level keeps the same position.
    const levels = table.levels.map(
      (_, i) => table.levels[(i + g) % table.levels.length],
    );
    const result = play(levels);
    if (result.stuck) {
      stuck++;
      continue;
    }
    finished++;
    minutes += result.minutes;
    rounds += result.rounds;
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (result.winnerLevel) wins[result.winnerLevel]++;
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
  console.log(
    `\nCómo terminan: ${Object.entries(reasons)
      .map(([k, n]) => `${REASONS[k] ?? k} ${percent(n, finished)}`)
      .join(
        ', ',
      )}. Duración media: ${finished ? Math.round(minutes / finished) : '—'} min de juego, ${finished ? Math.round(rounds / finished) : '—'} rondas. Trabadas: ${stuck}.\n`,
  );
}
if (stuckTotal) process.exitCode = 1;
