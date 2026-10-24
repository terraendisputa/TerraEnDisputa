import { useEffect, useState } from 'react';
import type { AdminConnectionResponse } from '@game/protocol';
import { api } from './api.js';
import { copyInvitation } from './copy-invitation.js';
import { UiIcon } from './UiIcon.js';

type Invitation = ReturnType<typeof useInvitation>;

/** Network choice and invitation link, shared by the server and steps boxes. */
export function useInvitation(gameId: string) {
  const [connection, setConnection] = useState<AdminConnectionResponse>();
  const [origin, setOrigin] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setConnection(undefined);
    void api
      .adminConnections()
      .then((result) => {
        if (!active) return;
        setConnection(result);
        const current = result.choices.find(
          (choice) => choice.origin === window.location.origin,
        );
        setOrigin(
          current?.origin ??
            (result.choices.length === 1 &&
            !result.choices[0]?.requiresSelection
              ? (result.choices[0]?.origin ?? '')
              : ''),
        );
        setMessage('');
      })
      .catch(() => {
        if (active)
          setMessage('No se pudieron consultar las direcciones. Reintentá.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const invitation = origin ? `${origin}/game/${gameId}` : '';
  return {
    connection,
    origin,
    setOrigin,
    message,
    setMessage,
    retry: () => setAttempt((value) => value + 1),
    invitation,
  };
}

/** Server box: which network friends use to reach this computer. */
export function InvitationNetwork({ invite }: { readonly invite: Invitation }) {
  const { connection, origin, setOrigin, message, setMessage, retry } = invite;
  const notes = [
    connection?.reason,
    connection?.choices.length
      ? 'Si aparecen varias redes, elegí la compartida con tus amigos. La conexión desde otro equipo todavía no fue comprobada.'
      : undefined,
  ].filter((note): note is string => !!note);
  return (
    <section className="host-invitation host-network">
      {!connection && (
        <>
          <p role="status">{message || 'Buscando direcciones de conexión…'}</p>
          {message && (
            <button type="button" className="secondary" onClick={retry}>
              Reintentar
            </button>
          )}
        </>
      )}
      {!!connection?.choices.length && (
        <label>
          Elegí una red donde iniciar la partida:
          <select
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setMessage('');
            }}
          >
            <option value="">Elegí la red que usan tus amigos</option>
            {connection.choices.map((choice) => (
              <option key={choice.origin} value={choice.origin}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {connection && (notes.length > 0 || !origin) && (
        <ul className="host-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
          {!origin && (
            <li className="host-note-pending">
              Elegí la red para compartir para ver el enlace.
            </li>
          )}
        </ul>
      )}
      <details open>
        <summary>Ayuda de conexión avanzada</summary>
        <p className="host-lobby-notice host-neutral connection-help">
          El enlace de red local no permite jugar por Internet por sí solo.
          Revisá el firewall y la red compartida si otro equipo no puede
          abrirlo. Para escuchar en la red: <code>ted --bind 0.0.0.0</code>.
        </p>
      </details>
    </section>
  );
}

/** Steps box, under «Invitar»: the link to share and one's own seat. */
export function InvitationLink({
  invite,
  gameId,
  available,
}: {
  readonly invite: Invitation;
  readonly gameId: string;
  /** Once the game starts the link stays in place, unavailable. */
  readonly available: boolean;
}) {
  const { invitation, message, setMessage } = invite;
  return (
    <div className="host-invitation host-invitation-link">
      {!available && (
        <p className="host-lobby-notice host-neutral" role="status">
          Invitación no disponible: la partida ya comenzó.
        </p>
      )}
      <div className="copy-line">
        <input
          aria-label="Enlace de invitación"
          readOnly
          value={invitation}
          placeholder="Primero elegí una red"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="secondary copy-button"
          aria-label="Copiar invitación"
          title="Copiar invitación"
          onClick={() => {
            if (!invitation) setMessage('Primero elegí una red.');
            else
              void copyInvitation(invitation, navigator.clipboard).then(
                setMessage,
              );
          }}
        >
          <UiIcon name="copy" />
        </button>
      </div>
      {message && invite.connection && <p role="status">{message}</p>}
      {available && (
        <a
          className="button-link secondary"
          href={`/game/${gameId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Yo también voy a jugar
        </a>
      )}
    </div>
  );
}
