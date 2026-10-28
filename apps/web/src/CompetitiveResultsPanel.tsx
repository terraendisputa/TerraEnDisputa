import type { AdminGameView } from '@game/protocol';
import {
  exactPointsText,
  RESULT_EXCLUSIONS,
  resultExport,
} from './competitive-results.js';
import { playerColorLabel } from './colors.js';
import { tr } from './language.js';
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
    link.download = `${tr('competitivo', 'competitive')}-${game.gameId}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="admin-competitive-results"
      aria-label={tr('Clasificación competitiva', 'Competitive ranking')}
    >
      <h3>{tr('Clasificación competitiva', 'Competitive ranking')}</h3>
      <p>
        {results.completedRounds === undefined
          ? tr('Rondas completas desconocidas', 'Completed rounds unknown')
          : tr(
              `${results.completedRounds} rondas normales completas`,
              `${results.completedRounds} normal rounds completed`,
            )}{' '}
        ·{' '}
        {results.scoringEligible
          ? tr('Puntuación válida', 'Valid score')
          : tr('Sin puntuación oficial', 'No official score')}
      </p>
      {results.exclusions.map((reason) => (
        <p key={reason}>{RESULT_EXCLUSIONS[reason]}</p>
      ))}
      <p>
        {tr(
          'Continente ocupado: todos sus países. Los empates comparten el promedio exacto de los puestos ocupados.',
          'Occupied continent: all its countries. Ties share the exact average of the places they hold.',
        )}
      </p>
      <div
        className="competitive-results-scroll"
        tabIndex={0}
        role="region"
        aria-label={tr(
          'Tabla de resultados, desplazamiento horizontal',
          'Results table, horizontal scroll',
        )}
      >
        <table>
          <caption>{tr('Resultado por jugador', 'Result by player')}</caption>
          <thead>
            <tr>
              {[
                tr('Puesto', 'Place'),
                tr('Jugador', 'Player'),
                tr('Total', 'Total'),
                tr('Estado', 'Status'),
                tr('Países', 'Countries'),
                tr('Tropas', 'Troops'),
                tr('Canjes', 'Exchanges'),
                tr('Cartas', 'Cards'),
                tr('Base', 'Base'),
                tr('Objetivo', 'Objective'),
                tr('Eliminaciones', 'Eliminations'),
                tr('Eliminado', 'Eliminated'),
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
                      : `${row.position}${row.tiedPlayers > 1 ? tr(' (empate)', ' (tie)') : ''}`}
                  </td>
                  <th scope="row">
                    {player.nickname} · {playerColorLabel(player.color)}
                    {row.bot === 'table'
                      ? tr(' · bot de la mesa', ' · table bot')
                      : row.bot === 'replacement'
                        ? tr(' · lo reemplazó un bot', ' · replaced by a bot')
                        : ''}
                  </th>
                  <td>
                    <strong>{exactPointsText(row.totalPoints)}</strong>
                  </td>
                  <td>
                    {row.status === 'disqualified'
                      ? tr('Descalificado', 'Disqualified')
                      : row.status === 'eliminated'
                        ? tr('Eliminado', 'Eliminated')
                        : tr('Superviviente', 'Survivor')}
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
        {tr(
          'Los componentes muestran el cálculo; el total oficial es cero cuando la partida no es válida o el jugador está descalificado.',
          'The parts show the calculation; the official total is zero when the game is not valid or the player is disqualified.',
        )}
      </p>
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={() => download('json')}
        >
          {tr('Exportar JSON', 'Export JSON')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => download('csv')}
        >
          {tr('Exportar CSV', 'Export CSV')}
        </button>
      </div>
    </section>
  );
}
