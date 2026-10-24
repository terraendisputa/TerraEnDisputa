import type { PlayerGameView } from '@game/protocol';

/** Detect repeated rolls from their losses, without treating other revisions as rolls. */
export function hasNewCombat(previous: PlayerGameView, next: PlayerGameView) {
  const combat = next.turn?.lastCombat;
  if (!combat || previous.gameId !== next.gameId) return false;
  if (JSON.stringify(previous.turn?.lastCombat) !== JSON.stringify(combat))
    return true;
  if (
    next.revision <= previous.revision ||
    previous.turn?.phase !== 'attack' ||
    next.turn?.phase !== 'attack' ||
    previous.turn.playerId !== next.turn.playerId ||
    previous.pendingAction ||
    next.pendingAction
  )
    return false;
  const beforeFrom = previous.territories?.[combat.fromTerritoryId];
  const afterFrom = next.territories?.[combat.fromTerritoryId];
  const beforeTo = previous.territories?.[combat.toTerritoryId];
  const afterTo = next.territories?.[combat.toTerritoryId];
  return Boolean(
    beforeFrom &&
    afterFrom &&
    beforeTo &&
    afterTo &&
    beforeFrom.ownerId === afterFrom.ownerId &&
    beforeTo.ownerId === afterTo.ownerId &&
    combat.attackerLosses + combat.defenderLosses > 0 &&
    beforeFrom.armies - afterFrom.armies === combat.attackerLosses &&
    beforeTo.armies - afterTo.armies === combat.defenderLosses,
  );
}
