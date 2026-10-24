import type { ReconquistaView } from '@game/protocol/reconquista';

function lastRoll(view: ReconquistaView | undefined) {
  return (
    view?.campaign?.lastCombat ??
    view?.hostility?.lastCombat ??
    view?.campaign?.lastMissile ??
    view?.hostility?.lastMissile ??
    null
  );
}

function armies(view: ReconquistaView, countryId: string, playerId: string) {
  return view.territories
    .find((t) => t.id === countryId)
    ?.forces.find((f) => f.playerId === playerId)?.armies;
}

function owners(view: ReconquistaView, countryId: string) {
  return JSON.stringify(
    view.territories.find((t) => t.id === countryId)?.ownership,
  );
}

/**
 * As Classic's hasNewCombat: an identical repeated roll is recognised by its
 * losses, so the dice replay even when the result object did not change.
 */
export function hasNewRoll(previous: ReconquistaView, next: ReconquistaView) {
  const roll = lastRoll(next);
  if (!roll) return false;
  if (JSON.stringify(lastRoll(previous)) !== JSON.stringify(roll)) return true;
  if (next.revision <= previous.revision || !('attackRolls' in roll))
    return false;
  const combat = roll;
  const forces = (countryId: string) =>
    next.territories.find((t) => t.id === countryId)?.forces ?? [];
  const defender: string | undefined =
    'defenderId' in combat && typeof combat.defenderId === 'string'
      ? combat.defenderId
      : forces(combat.targetId)[0]?.playerId;
  const attacker = forces(combat.originId).find(
    (f) => f.playerId !== defender,
  )?.playerId;
  if (!attacker || !defender || combat.attackLoss + combat.defenseLoss === 0)
    return false;
  const lostBy = (countryId: string, playerId: string) => {
    const before = armies(previous, countryId, playerId);
    const after = armies(next, countryId, playerId);
    return before === undefined || after === undefined
      ? undefined
      : before - after;
  };
  return (
    owners(previous, combat.originId) === owners(next, combat.originId) &&
    owners(previous, combat.targetId) === owners(next, combat.targetId) &&
    lostBy(combat.originId, attacker) === combat.attackLoss &&
    lostBy(combat.targetId, defender) === combat.defenseLoss
  );
}
