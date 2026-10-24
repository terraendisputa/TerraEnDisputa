import { CONTINENTS, TERRITORY_IDS } from './classic-data.js';
import type {
  ActiveGameState,
  FinishedGameState,
  CompetitiveHistory,
  CompetitiveResults,
  CompetitiveResultRow,
  ExactPoints,
  PlayerId,
} from './domain.js';

const POSITION_POINTS = [25, 18, 15, 12, 10, 8] as const;
export function competitiveHistory(
  state: ActiveGameState | FinishedGameState,
): CompetitiveHistory {
  return (
    state.competitiveHistory ?? {
      complete: !state.players.some((p) => p.eliminated),
      eliminations: [],
    }
  );
}
export function recordCompetitiveElimination(
  state: ActiveGameState,
  eliminatedPlayerId: PlayerId,
  eliminatingPlayerId: PlayerId,
): CompetitiveHistory {
  const history = competitiveHistory(state);
  return {
    ...history,
    eliminations: [
      ...history.eliminations,
      {
        eliminatedPlayerId,
        eliminatingPlayerId,
        turnNumber: state.turn.turnNumber,
      },
    ],
  };
}
function exact(numerator: number, denominator = 1): ExactPoints {
  let a = Math.abs(numerator),
    b = denominator;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  const divisor = a || 1;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export function competitiveResults(
  state: FinishedGameState,
): CompetitiveResults | undefined {
  if (state.mode !== 'competitive') return undefined;
  const history = competitiveHistory(state);
  const eliminatedIds = history.eliminations.map((e) => e.eliminatedPlayerId);
  const historyComplete =
    history.complete &&
    state.players.every((p) => !p.eliminated || eliminatedIds.includes(p.id));
  const completedRounds = state.competitiveClock?.completedRounds;
  const exclusions: CompetitiveResults['exclusions'][number][] = [];
  if (!historyComplete) exclusions.push('incomplete_history');
  if (completedRounds === undefined) exclusions.push('unknown_rounds');
  else if (completedRounds < 6) exclusions.push('minimum_rounds');
  if (state.players.every((p) => p.disqualified))
    exclusions.push('no_competitors');
  if (state.pendingInheritance) exclusions.push('pending_inheritance');
  const scoringEligible = exclusions.length === 0;
  const rows: CompetitiveResultRow[] = state.players.map((p) => {
    const owned = TERRITORY_IDS.filter(
      (id) => state.territories[id].ownerId === p.id,
    );
    const fullContinents = Object.entries(CONTINENTS).filter(([, c]) =>
      c.territoryIds.every((id) => state.territories[id].ownerId === p.id),
    );
    const continentIds = fullContinents.flatMap(([, c]) => [...c.territoryIds]);
    const metrics = {
      territories: owned.length,
      armies: owned.reduce((sum, id) => sum + state.territories[id].armies, 0),
      exchanges: p.completedExchangeCount,
      cards: p.cards.length,
      fullContinents: fullContinents.map(([id]) => id),
      continentTerritories: continentIds.length,
      continentArmies: continentIds.reduce(
        (sum, id) => sum + state.territories[id].armies,
        0,
      ),
    };
    return {
      playerId: p.id,
      status: p.disqualified
        ? 'disqualified'
        : p.eliminated
          ? 'eliminated'
          : 'survivor',
      tiedPlayers: 1,
      metrics,
      basePoints: exact(0),
      objectiveBonus: state.result.winnerId === p.id ? 25 : 0,
      eliminationBonus:
        history.eliminations.filter((e) => e.eliminatingPlayerId === p.id)
          .length * 10,
      eliminationPenalty: p.eliminated ? -5 : 0,
      totalPoints: exact(0),
    };
  });
  const metricKeys = [
    'territories',
    'armies',
    'exchanges',
    'cards',
    'continentTerritories',
    'continentArmies',
  ] as const;
  const compare = (a: CompetitiveResultRow, b: CompetitiveResultRow) => {
    if (a.playerId === state.result.winnerId)
      return b.playerId === a.playerId ? 0 : -1;
    if (b.playerId === state.result.winnerId) return 1;
    if (a.status !== b.status) return a.status === 'survivor' ? -1 : 1;
    if (a.status === 'eliminated')
      return (
        eliminatedIds.indexOf(b.playerId) - eliminatedIds.indexOf(a.playerId)
      );
    for (const key of metricKeys) {
      const difference = b.metrics[key] - a.metrics[key];
      if (difference) return difference;
    }
    return 0;
  };
  // Unknown historical elimination order receives no invented position.
  const ordered = rows
    .filter(
      (r) =>
        r.status !== 'disqualified' &&
        (r.status !== 'eliminated' || eliminatedIds.includes(r.playerId)),
    )
    .sort(compare);
  const ranked: CompetitiveResultRow[] = [];
  for (let index = 0; index < ordered.length;) {
    let end = index + 1;
    while (
      end < ordered.length &&
      compare(ordered[index]!, ordered[end]!) === 0
    )
      end++;
    const basePoints = exact(
      POSITION_POINTS.slice(index, end).reduce((sum, value) => sum + value, 0),
      end - index,
    );
    for (const row of ordered.slice(index, end))
      ranked.push({
        ...row,
        position: index + 1,
        tiedPlayers: end - index,
        basePoints,
        totalPoints: scoringEligible
          ? exact(
              basePoints.numerator +
                (row.objectiveBonus +
                  row.eliminationBonus +
                  row.eliminationPenalty) *
                  basePoints.denominator,
              basePoints.denominator,
            )
          : exact(0),
      });
    index = end;
  }
  ranked.push(...rows.filter((r) => !ordered.includes(r)));
  return {
    rulesVersion: 1,
    eliminations: history.eliminations.map((e) => ({ ...e })),
    historyComplete,
    ...(completedRounds === undefined ? {} : { completedRounds }),
    scoringEligible,
    exclusions,
    rows: ranked,
  };
}
