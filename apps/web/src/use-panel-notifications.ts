import { useEffect, useRef, useState } from 'react';
import type { PlayerGameView } from '@game/protocol';
import { tr } from './language.js';

export interface PanelNotification {
  readonly count: number;
  readonly message: string;
}

export function panelChanges(previous: PlayerGameView, next: PlayerGameView) {
  const changes: Record<string, PanelNotification> = {};
  const oldCards = new Set(previous.private.cards.map(({ cardId }) => cardId));
  const gained = next.private.cards.filter(
    ({ cardId }) => !oldCards.has(cardId),
  ).length;
  if (gained)
    changes.cards = {
      count: gained,
      message: tr(`${gained} cartas nuevas`, `${gained} new cards`),
    };
  if (
    previous.private.secretObjectiveId !== next.private.secretObjectiveId ||
    previous.private.effectiveDestructionTargetPlayerId !==
      next.private.effectiveDestructionTargetPlayerId
  )
    changes.objective = {
      count: 1,
      message: tr('Tu objetivo cambió', 'Your objective changed'),
    };
  const playerStatus = (view: PlayerGameView) =>
    JSON.stringify(
      view.players.map(({ id, nickname, color, eliminated }) => ({
        id,
        nickname,
        color,
        eliminated,
      })),
    );
  if (
    previous.status !== next.status ||
    playerStatus(previous) !== playerStatus(next)
  )
    changes.players = {
      count: 1,
      message: tr('Hay novedades en la partida', 'There is news in the game'),
    };
  if (next.revision > previous.revision) {
    const oldProposals = new Set(
      previous.pacts?.proposals.map(({ id }) => id) ?? [],
    );
    const proposed =
      next.pacts?.proposals.filter(
        (proposal) =>
          !oldProposals.has(proposal.id) &&
          proposal.proposerId !== next.selfPlayerId,
      ).length ?? 0;
    const oldPacts = new Set(previous.pacts?.active.map(({ id }) => id) ?? []);
    const accepted =
      next.pacts?.active.filter(
        (pact) =>
          !oldPacts.has(pact.id) &&
          // Active parties retain proposal order: proposer, accepting recipient.
          pact.parties[1] !== next.selfPlayerId,
      ).length ?? 0;
    const messages = [
      proposed > 0 &&
        (proposed === 1
          ? tr('Nueva propuesta de pacto', 'New pact proposal')
          : tr(`${proposed} propuestas nuevas`, `${proposed} new proposals`)),
      accepted > 0 &&
        (accepted === 1
          ? tr('Un jugador aceptó un pacto', 'A player accepted a pact')
          : tr(`${accepted} pactos aceptados`, `${accepted} pacts accepted`)),
    ].filter(Boolean);
    if (proposed + accepted > 0)
      changes.pacts = {
        count: proposed + accepted,
        message: messages.join(' · '),
      };
  }
  return changes;
}

export function usePanelNotifications(snapshot: PlayerGameView | undefined) {
  const previous = useRef<PlayerGameView | undefined>(undefined);
  const [unread, setUnread] = useState<Record<string, PanelNotification>>({});
  useEffect(() => {
    if (!snapshot) return;
    const before = previous.current;
    previous.current = snapshot;
    if (
      !before ||
      before.gameId !== snapshot.gameId ||
      before.selfPlayerId !== snapshot.selfPlayerId
    ) {
      setUnread({});
      return;
    }
    const changes = panelChanges(before, snapshot);
    if (Object.keys(changes).length)
      setUnread((current) => {
        const result = { ...current };
        for (const [id, notice] of Object.entries(changes))
          result[id] = {
            ...notice,
            count: (current[id]?.count ?? 0) + notice.count,
          };
        return result;
      });
  }, [snapshot]);
  const notifications = { ...unread };
  if (snapshot) {
    const isYourTurn =
      snapshot.status === 'ACTIVE'
        ? snapshot.turn?.playerId === snapshot.selfPlayerId
        : snapshot.status === 'SETUP' &&
          snapshot.setup?.currentPlayerId === snapshot.selfPlayerId;
    if (isYourTurn)
      notifications.players = {
        count: 1,
        message: tr('Tu turno', 'Your turn'),
      };
    const pending =
      snapshot.pacts?.proposals.filter(
        (p) => p.recipientId === snapshot.selfPlayerId,
      ).length ?? 0;
    if (pending)
      notifications.pacts = {
        count: Math.max(pending, unread.pacts?.count ?? 0),
        message: [
          unread.pacts?.message,
          tr(
            `${pending} propuestas pendientes`,
            `${pending} pending proposals`,
          ),
        ]
          .filter(Boolean)
          .join(' · '),
      };
  }
  const markRead = (id: string) =>
    setUnread((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  return { notifications, markRead };
}
