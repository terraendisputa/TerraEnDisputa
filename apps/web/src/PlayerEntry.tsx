import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import { errorMessage } from './errors.js';
import { LanguageSelect } from './LanguageSelect.js';
import { COMPETITIVE_BOT_NAMES } from '@game/game-engine';
import {
  PLAYER_COLOR_LABELS,
  playerColorLabel,
  playerColorLabelLower,
} from './colors.js';
import { displayNickname, tr } from './language.js';

const isBotSeat = (name: string) =>
  COMPETITIVE_BOT_NAMES.some((bot) => displayNickname(bot) === name);

export function PlayerEntry({
  gameId,
  onAuthenticated,
}: {
  readonly gameId: string;
  readonly onAuthenticated: () => void;
}) {
  const [entry, setEntry] = useState<Awaited<ReturnType<typeof api.entry>>>();
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState('');
  const [error, setError] = useState<string>();
  // Someone else took the chosen color: a free one replaces it and the player is told which.
  const [colorNotice, setColorNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const report = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === 'COLOR_ALREADY_IN_USE')
      return;
    setError(
      errorMessage(caught instanceof ApiError ? caught.code : 'SERVER_ERROR'),
    );
  };
  const refresh = async () => {
    const next = await api.entry(gameId);
    setEntry(next);
    setColor((previous) => {
      if (next.availableColors.includes(previous)) return previous;
      const replacement = next.availableColors[0] ?? '';
      setColorNotice(
        previous && replacement
          ? tr(
              `El ${playerColorLabelLower(previous)} ya estaba en uso. Se te asignó el ${playerColorLabelLower(replacement)}.`,
              `${playerColorLabel(previous)} was already in use. You got ${playerColorLabelLower(replacement)}.`,
            )
          : undefined,
      );
      return replacement;
    });
  };
  // Seats refresh by themselves every 2 seconds, as in Reconquista.
  useEffect(() => {
    void refresh().catch(report);
    const timer = setInterval(() => void refresh().catch(() => {}), 2_000);
    return () => clearInterval(timer);
  }, [gameId]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onAuthenticated();
    } catch (caught) {
      report(caught);
      await refresh().catch(report);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="entry-layout">
      <section className="panel entry-panel">
        <a className="text-link" href="/">
          {tr('← Inicio', '← Home')}
        </a>
        <p className="eyebrow">
          {tr('Partida', 'Game')} {gameId.slice(0, 8)}
        </p>
        <h1>{tr('Entrar a la mesa', 'Join the table')}</h1>
        {!entry && !error && (
          <p>{tr('Cargando asientos…', 'Loading seats…')}</p>
        )}
        {entry?.canJoin && (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(() => api.join(gameId, nickname, color));
            }}
          >
            <label>
              {tr('Apodo', 'Nickname')}
              <input
                required
                maxLength={40}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
            <label>
              Color
              <select
                value={color}
                onChange={(event) => {
                  setColor(event.target.value);
                  setColorNotice(undefined);
                }}
              >
                {Object.entries(PLAYER_COLOR_LABELS)
                  .filter(([value]) => entry.availableColors.includes(value))
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {colorNotice && (
              <p className="muted-copy" role="status">
                {colorNotice}
              </p>
            )}
            <button disabled={busy || !color} type="submit">
              {busy ? tr('Conectando…', 'Connecting…') : tr('Unirme', 'Join')}
            </button>
          </form>
        )}
        {!!entry?.seats.length && (
          <section aria-label={tr('Asientos disponibles', 'Available seats')}>
            <h2>{tr('Asientos disponibles', 'Available seats')}</h2>
            <p>
              {tr(
                'Continuás con sus países, cartas, objetivo y turno actuales.',
                'You continue with its current countries, cards, objective and turn.',
              )}
            </p>
            {/* A table bot's seat takes the name of the person who joins. */}
            {!entry.canJoin &&
              entry.seats.some((seat) => isBotSeat(seat.nickname)) && (
                <label>
                  {tr('Apodo', 'Nickname')}
                  <input
                    maxLength={40}
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                  />
                </label>
              )}
            {entry.seats.map((seat) => (
              <button
                key={seat.id}
                type="button"
                disabled={
                  busy || (isBotSeat(seat.nickname) && !nickname.trim())
                }
                title={
                  isBotSeat(seat.nickname) && !nickname.trim()
                    ? tr(
                        'Escribí tu apodo para ocupar el asiento del bot.',
                        "Type your nickname to take the bot's seat.",
                      )
                    : undefined
                }
                onClick={() =>
                  void run(() =>
                    api.takeSeat(
                      gameId,
                      seat.id,
                      isBotSeat(seat.nickname) ? nickname : undefined,
                    ),
                  )
                }
              >
                {tr(
                  `Ocupar asiento de ${seat.nickname}`,
                  `Take ${seat.nickname}'s seat`,
                )}{' '}
                · {playerColorLabel(seat.color)}
              </button>
            ))}
          </section>
        )}
        {entry && !entry.canJoin && !entry.seats.length && (
          <p>
            {tr(
              'No hay asientos disponibles. Un jugador debe elegir «Salir de la partida» para liberar el suyo.',
              'There are no seats available. A player must choose «Leave the game» to free theirs.',
            )}
          </p>
        )}
        <p>
          {tr(
            'Cerrar el navegador o desconectarte no libera tu asiento. Usá el mismo navegador para volver.',
            'Closing the browser or disconnecting does not free your seat. Use the same browser to come back.',
          )}
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <LanguageSelect />
      </section>
    </main>
  );
}
