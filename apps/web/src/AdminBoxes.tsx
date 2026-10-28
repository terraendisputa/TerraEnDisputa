import type { ReactNode } from 'react';
import {
  InvitationLink,
  InvitationNetwork,
  useInvitation,
} from './HostInvitation.js';
import { tr } from './language.js';

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
      <section
        className="admin-box admin-game-box"
        aria-label={tr('Partida', 'Game')}
      >
        {status}
        {start}
      </section>
      <section
        className="admin-box admin-steps-box"
        aria-label={tr('Invitar y comenzar', 'Invite and start')}
      >
        <div className="host-invite-intro">
          <h3>{tr('Invitá a tus amigos', 'Invite your friends')}</h3>
          <p>
            {tr(
              'Necesitan estar en la misma red local o en una red privada ya configurada. Mantené Terra en disputa abierto mientras juegan.',
              'They need to be on the same local network or on a private network already set up. Keep Terra en disputa open while you play.',
            )}
          </p>
        </div>
        {seats}
        <InvitationLink invite={invite} gameId={gameId} available={lobby} />
      </section>
      <section
        className="admin-box admin-server-box"
        aria-label={tr('Administración del servidor', 'Server administration')}
      >
        <h2 className="admin-box-title">
          {tr('Administración del servidor', 'Server administration')}
        </h2>
        <InvitationNetwork invite={invite} />
        {advanced}
      </section>
    </div>
  );
}
