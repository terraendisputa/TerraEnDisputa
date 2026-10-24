import type { ReactNode } from 'react';
import {
  InvitationLink,
  InvitationNetwork,
  useInvitation,
} from './HostInvitation.js';

/**
 * The game's administration in three boxes, always shown: the server on the
 * left, the steps to start in the centre and the game's status on the right;
 * on phones the status comes first. Shared by
 * Classic, Competitive and Reconquista.
 */
export function AdminBoxes({
  gameId,
  lobby,
  seats,
  start,
  status,
  advanced,
}: {
  readonly gameId: string;
  readonly lobby: boolean;
  /** Required players, under «Invitar». */
  readonly seats: ReactNode;
  /** Who is missing and the start button, at the end of the game box. */
  readonly start: ReactNode;
  readonly status: ReactNode;
  readonly advanced: ReactNode;
}) {
  const invite = useInvitation(gameId);
  return (
    <div className="admin-columns">
      <section className="admin-box admin-game-box" aria-label="Partida">
        {status}
        {start}
      </section>
      <section
        className="admin-box admin-steps-box"
        aria-label="Invitar y comenzar"
      >
        <div className="host-invite-intro">
          <h3>Invitá a tus amigos</h3>
          <p>
            Necesitan estar en la misma red local o en una red privada ya
            configurada. Mantené Terra en disputa abierto mientras juegan.
          </p>
        </div>
        {seats}
        <InvitationLink invite={invite} gameId={gameId} available={lobby} />
      </section>
      <section
        className="admin-box admin-server-box"
        aria-label="Administración del servidor"
      >
        <h2 className="admin-box-title">Administración del servidor</h2>
        <InvitationNetwork invite={invite} />
        {advanced}
      </section>
    </div>
  );
}
