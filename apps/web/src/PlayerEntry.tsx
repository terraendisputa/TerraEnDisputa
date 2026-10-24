import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import { errorMessage } from './errors.js';
import {
  PLAYER_COLOR_LABELS,
  playerColorLabel,
  playerColorLabelLower,
} from './colors.js';

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
          ? `El ${playerColorLabelLower(previous)} ya estaba en uso. Se te asignó el ${playerColorLabelLower(replacement)}.`
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
          ← Inicio
        </a>
        <p className="eyebrow">Partida {gameId.slice(0, 8)}</p>
        <h1>Entrar a la mesa</h1>
        {!entry && !error && <p>Cargando asientos…</p>}
        {entry?.canJoin && (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(() => api.join(gameId, nickname, color));
            }}
          >
            <label>
              Apodo
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
              {busy ? 'Conectando…' : 'Unirme'}
            </button>
          </form>
        )}
        {!!entry?.seats.length && (
          <section aria-label="Asientos disponibles">
            <h2>Asientos disponibles</h2>
            <p>Continuás con sus países, cartas, objetivo y turno actuales.</p>
            {entry.seats.map((seat) => (
              <button
                key={seat.id}
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.takeSeat(gameId, seat.id))}
              >
                Ocupar asiento de {seat.nickname} ·{' '}
                {playerColorLabel(seat.color)}
              </button>
            ))}
          </section>
        )}
        {entry && !entry.canJoin && !entry.seats.length && (
          <p>
            No hay asientos disponibles. Un jugador debe elegir «Salir de la
            partida» para liberar el suyo.
          </p>
        )}
        <p>
          Cerrar el navegador o desconectarte no libera tu asiento. Usá el mismo
          navegador para volver.
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
