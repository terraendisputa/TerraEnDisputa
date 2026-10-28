import { useEffect, useRef, useState } from 'react';
import type { ReconquistaView } from '@game/protocol/reconquista';
import type { PanelNotification } from './use-panel-notifications.js';
import { tr } from './language.js';

/** What changed for this player between two views, as in Classic's panelChanges. */
function reconquistaPanelChanges(
  previous: ReconquistaView,
  next: ReconquistaView,
) {
  const changes: Record<string, PanelNotification> = {};
  const me = next.self?.playerId;
  const oldHand = new Set(
    (previous.self?.campaign?.hand ?? []).map(({ id }) => id),
  );
  const gained = (next.self?.campaign?.hand ?? []).filter(
    ({ id }) => !oldHand.has(id),
  ).length;
  if (gained)
    changes.cards = {
      count: gained,
      message:
        gained === 1
          ? tr('Carta nueva', 'New card')
          : tr(`${gained} cartas nuevas`, `${gained} new cards`),
    };
  if (
    (previous.self?.objectives.length ?? 0) > 0 &&
    JSON.stringify(previous.self?.objectives) !==
      JSON.stringify(next.self?.objectives)
  )
    changes.objective = {
      count: 1,
      message: tr('Tu objetivo cambió', 'Your objective changed'),
    };
  if (next.revision > previous.revision && next.campaign) {
    // Pacts are public: everybody hears about proposals and acceptances by others.
    const before = new Map(
      [
        ...(previous.campaign?.pacts ?? []),
        ...(previous.campaign?.alliances ?? []),
      ].map((p) => [p.id, p.status as string]),
    );
    let proposed = 0;
    let accepted = 0;
    for (const p of next.campaign.pacts) {
      if (!before.has(p.id) && p.proposerId !== me) proposed++;
      else if (
        before.get(p.id) === 'proposed' &&
        p.status === 'active' &&
        p.partnerId !== me
      )
        accepted++;
    }
    for (const a of next.campaign.alliances) {
      if (!before.has(a.id) && a.proposerId !== me) proposed++;
      else if (
        before.get(a.id) === 'proposed' &&
        a.status !== 'proposed' &&
        a.allyId !== me
      )
        accepted++;
    }
    const offer = next.campaign.occupation;
    if (
      offer?.condominium === 'proposed' &&
      previous.campaign?.occupation?.condominium !== 'proposed' &&
      offer.arrivals[0]?.playerId !== me
    )
      proposed++;
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

function objectiveSeenKey(view: ReconquistaView) {
  return `ted-reconquista-objective-seen:${view.gameId}:${view.self?.playerId}`;
}

/**
 * Unread "!" per panel. A notice is read once its panel was open and the
 * player moves to another one; the objective opens by itself the first time.
 */
export function useReconquistaNotifications(
  view: ReconquistaView | null | undefined,
  panel: string | null,
  openPanel: (id: string) => void,
) {
  const previous = useRef<ReconquistaView | null | undefined>(undefined);
  const [unread, setUnread] = useState<Record<string, PanelNotification>>({});
  const hasObjectives = !!view?.self && view.self.objectives.length > 0;
  useEffect(() => {
    if (!view?.self || !hasObjectives) return;
    let seen = false;
    try {
      seen = localStorage.getItem(objectiveSeenKey(view)) === '1';
    } catch {
      // Without storage the objective still opens once per page load.
    }
    if (seen) return;
    setUnread((current) => ({
      ...current,
      objective: { count: 1, message: tr('Tu objetivo', 'Your objective') },
    }));
    openPanel('objective');
    // Only the first view with objectives matters.
  }, [view?.gameId, view?.self?.playerId, hasObjectives]);
  useEffect(() => {
    if (!view) return;
    const before = previous.current;
    previous.current = view;
    if (!before || before.gameId !== view.gameId) return;
    const changes = reconquistaPanelChanges(before, view);
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
  }, [view]);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const left = shown.current;
    shown.current = panel;
    if (!left || left === panel) return;
    setUnread((current) => {
      if (!current[left]) return current;
      const next = { ...current };
      delete next[left];
      return next;
    });
    if (left === 'objective' && view?.self)
      try {
        localStorage.setItem(objectiveSeenKey(view), '1');
      } catch {
        // The notice is still cleared for this page.
      }
  }, [panel]);
  return unread;
}
