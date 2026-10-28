import { useEffect, useState } from 'react';
import type { AdminConnectionResponse } from '@game/protocol';
import { api } from './api.js';
import { copyInvitation } from './copy-invitation.js';
import { UiIcon } from './UiIcon.js';
import { tr } from './language.js';

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
          setMessage(
            tr(
              'No se pudieron consultar las direcciones. Reintentá.',
              'Could not look up the addresses. Try again.',
            ),
          );
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
      ? tr(
          'Si aparecen varias redes, elegí la compartida con tus amigos. La conexión desde otro equipo todavía no fue comprobada.',
          'If several networks show up, choose the one you share with your friends. The connection from another computer has not been checked yet.',
        )
      : undefined,
  ].filter((note): note is string => !!note);
  return (
    <section className="host-invitation host-network">
      {!connection && (
        <>
          <p role="status">
            {message ||
              tr(
                'Buscando direcciones de conexión…',
                'Looking for connection addresses…',
              )}
          </p>
          {message && (
            <button type="button" className="secondary" onClick={retry}>
              {tr('Reintentar', 'Retry')}
            </button>
          )}
        </>
      )}
      {!!connection?.choices.length && (
        <label>
          {tr(
            'Elegí una red donde iniciar la partida:',
            'Choose a network to start the game on:',
          )}
          <select
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setMessage('');
            }}
          >
            <option value="">
              {tr(
                'Elegí la red que usan tus amigos',
                'Choose the network your friends use',
              )}
            </option>
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
              {tr(
                'Elegí la red para compartir para ver el enlace.',
                'Choose the network to share to see the link.',
              )}
            </li>
          )}
        </ul>
      )}
      <details open>
        <summary>
          {tr('Ayuda de conexión avanzada', 'Advanced connection help')}
        </summary>
        <p className="host-lobby-notice host-neutral connection-help">
          {tr(
            'El enlace de red local no permite jugar por Internet por sí solo. Revisá el firewall y la red compartida si otro equipo no puede abrirlo. Para escuchar en la red:',
            'The local network link does not allow playing over the Internet on its own. Check the firewall and the shared network if another computer cannot open it. To listen on the network:',
          )}{' '}
          <code>ted --bind 0.0.0.0</code>.
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
          {tr(
            'Invitación no disponible: la partida ya comenzó.',
            'Invitation unavailable: the game already started.',
          )}
        </p>
      )}
      <div className="copy-line">
        <input
          aria-label={tr('Enlace de invitación', 'Invitation link')}
          readOnly
          value={invitation}
          placeholder={tr('Primero elegí una red', 'Choose a network first')}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="secondary copy-button"
          aria-label={tr('Copiar invitación', 'Copy invitation')}
          title={tr('Copiar invitación', 'Copy invitation')}
          onClick={() => {
            if (!invitation)
              setMessage(
                tr('Primero elegí una red.', 'Choose a network first.'),
              );
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
          {tr('Yo también voy a jugar', 'I will play too')}
        </a>
      )}
    </div>
  );
}
