import type {
  AdminGameView,
  CompetitiveResults,
  ExactPoints,
  PlayerGameView,
} from '@game/protocol';
import { tr } from './language.js';
export function exactPointsText(points: ExactPoints): string {
  return points.denominator === 1
    ? String(points.numerator)
    : `${points.numerator}/${points.denominator}`;
}
export function competitiveRoundLabel(
  view: Pick<PlayerGameView, 'mode' | 'setup' | 'turn'>,
): string | undefined {
  if (view.mode !== 'competitive') return undefined;
  if (!view.turn)
    return view.setup?.kind === 'card_deal_4_to_6'
      ? `${tr('Ronda', 'Round')} ${view.setup.reinforcementRound}`
      : undefined;
  return `${tr('Ronda', 'Round')} ${view.turn.round.kind === 'initial_hostility' ? 3 : view.turn.round.roundNumber + 3}`;
}
export const RESULT_EXCLUSIONS: Record<
  CompetitiveResults['exclusions'][number],
  string
> = {
  incomplete_history: tr(
    'Historial de eliminaciones incompleto.',
    'Incomplete elimination history.',
  ),
  unknown_rounds: tr(
    'No se conoce la cantidad de rondas completas.',
    'The number of completed rounds is unknown.',
  ),
  minimum_rounds: tr(
    'No se completaron seis rondas normales.',
    'Six normal rounds were not completed.',
  ),
  no_competitors: tr(
    'Todos los jugadores están descalificados.',
    'All players are disqualified.',
  ),
  pending_inheritance: tr(
    'Falta resolver la selección de cartas heredadas.',
    'The inherited card choice is still pending.',
  ),
};
export function resultExport(
  view: AdminGameView,
  format: 'json' | 'csv',
): string {
  const results = view.competitiveResults;
  if (!results) throw new Error('No competitive results available');
  // Export only the administrator summary; no hands, credentials or hidden objectives.
  if (format === 'json')
    return JSON.stringify(
      {
        gameId: view.gameId,
        revision: view.revision,
        outcome: {
          kind: view.result?.victoryReason.kind,
          winnerId: view.result?.winnerId,
        },
        results,
        players: view.players.map(({ id, nickname, color }) => ({
          id,
          nickname,
          color,
        })),
      },
      null,
      2,
    );
  const fields = [
    'partida',
    'revision',
    'reglas',
    'motivo_cierre',
    'ganador_id',
    'puntuacion_valida',
    'historial_completo',
    'rondas_completas',
    'exclusiones',
    'jugador_id',
    'nombre',
    'color',
    'bot',
    'estado',
    'posicion',
    'empatados',
    'paises',
    'tropas',
    'canjes',
    'cartas',
    'continentes_completos',
    'paises_continentes_completos',
    'tropas_continentes_completos',
    'base_numerador',
    'base_denominador',
    'bonus_objetivo',
    'bonus_eliminaciones',
    'penalidad_eliminado',
    'total_numerador',
    'total_denominador',
  ];
  const csvCell = (value: string | number | boolean | undefined) => {
    let text = String(value ?? '');
    // Neutralize spreadsheet formulas in arbitrary player names; some
    // spreadsheets also read a leading tab or carriage return as one.
    if (typeof value === 'string' && /^(?:[\t\r]|\s*[=+@-])/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    fields,
    ...results.rows.map((row) => {
      const player = view.players.find((p) => p.id === row.playerId)!;
      const m = row.metrics;
      return [
        view.gameId,
        view.revision,
        results.rulesVersion,
        view.result?.victoryReason.kind,
        view.result?.winnerId,
        results.scoringEligible,
        results.historyComplete,
        results.completedRounds,
        results.exclusions.join(';'),
        row.playerId,
        player.nickname,
        player.color,
        row.bot,
        row.status,
        row.position,
        row.tiedPlayers,
        m.territories,
        m.armies,
        m.exchanges,
        m.cards,
        m.fullContinents.join(';'),
        m.continentTerritories,
        m.continentArmies,
        row.basePoints.numerator,
        row.basePoints.denominator,
        row.objectiveBonus,
        row.eliminationBonus,
        row.eliminationPenalty,
        row.totalPoints.numerator,
        row.totalPoints.denominator,
      ];
    }),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
