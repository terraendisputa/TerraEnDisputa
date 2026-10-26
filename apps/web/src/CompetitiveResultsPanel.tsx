import type { AdminGameView } from '@game/protocol';
import {
  exactPointsText,
  RESULT_EXCLUSIONS,
  resultExport,
} from './competitive-results.js';
import { playerColorLabel } from './colors.js';
export function CompetitiveResultsPanel({
  game,
}: {
  readonly game: AdminGameView;
}) {
  const results = game.competitiveResults;
  if (!results) return null;
  function download(format: 'json' | 'csv') {
    const url = URL.createObjectURL(
      new Blob([resultExport(game, format)], {
        type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `competitivo-${game.gameId}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="admin-competitive-results"
      aria-label="Clasificación competitiva"
    >
      <h3>Clasificación competitiva</h3>
      <p>
        {results.completedRounds === undefined
          ? 'Rondas completas desconocidas'
          : `${results.completedRounds} rondas normales completas`}{' '}
        ·{' '}
        {results.scoringEligible
          ? 'Puntuación válida'
          : 'Sin puntuación oficial'}
      </p>
      {results.exclusions.map((reason) => (
        <p key={reason}>{RESULT_EXCLUSIONS[reason]}</p>
      ))}
      <p>
        Continente ocupado: todos sus países. Los empates comparten el promedio
        exacto de los puestos ocupados.
      </p>
      <div
        className="competitive-results-scroll"
        tabIndex={0}
        role="region"
        aria-label="Tabla de resultados, desplazamiento horizontal"
      >
        <table>
          <caption>Resultado por jugador</caption>
          <thead>
            <tr>
              {[
                'Puesto',
                'Jugador',
                'Total',
                'Estado',
                'Países',
                'Tropas',
                'Canjes',
                'Cartas',
                'Base',
                'Objetivo',
                'Eliminaciones',
                'Eliminado',
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row) => {
              const player = game.players.find((p) => p.id === row.playerId)!;
              return (
                <tr key={row.playerId}>
                  <td>
                    {row.position === undefined
                      ? '—'
                      : `${row.position}${row.tiedPlayers > 1 ? ' (empate)' : ''}`}
                  </td>
                  <th scope="row">
                    {player.nickname} · {playerColorLabel(player.color)}
                  </th>
                  <td>
                    <strong>{exactPointsText(row.totalPoints)}</strong>
                  </td>
                  <td>
                    {row.status === 'disqualified'
                      ? 'Descalificado'
                      : row.status === 'eliminated'
                        ? 'Eliminado'
                        : 'Superviviente'}
                  </td>
                  <td>{row.metrics.territories}</td>
                  <td>{row.metrics.armies}</td>
                  <td>{row.metrics.exchanges}</td>
                  <td>{row.metrics.cards}</td>
                  <td>{exactPointsText(row.basePoints)}</td>
                  <td>{row.objectiveBonus}</td>
                  <td>{row.eliminationBonus}</td>
                  <td>{row.eliminationPenalty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        Los componentes muestran el cálculo; el total oficial es cero cuando la
        partida no es válida o el jugador está descalificado.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={() => download('json')}
        >
          Exportar JSON
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => download('csv')}
        >
          Exportar CSV
        </button>
      </div>
    </section>
  );
}
