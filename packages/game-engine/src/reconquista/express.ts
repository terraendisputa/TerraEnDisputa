/**
 * Reconquista Express: who the clock waits for and what happens when the time
 * runs out. A timeout is a series of ordinary commands, so the journal replays
 * it like any other move.
 */
import {
  campaignLegal,
  type Campaign,
  type CampaignAction,
} from './campaign.js';
import { continent, turnActor } from './campaign-politics.js';
import type { PreparationBoard, PreparationRandom } from './preparation.js';
import {
  reconquistaLegalActions,
  type ReconquistaSession,
  type SetupAction,
} from './session.js';

/** Game time before the two final rounds, as in Classic Express. */
export const reconquistaExpressDurationMs = (playerCount: number): number =>
  (playerCount <= 3 ? 40 : playerCount === 4 ? 60 : 80) * 60_000;
/** Initial placement, extras and the first situation. */
export const RECONQUISTA_PREPARATION_MS = 120_000;
export const RECONQUISTA_TURN_MS = 180_000;
export const RECONQUISTA_FINAL_TURN_MS = 240_000;

const activeAlliance = (s: Campaign) =>
  s.alliances.find((a) => a.id === s.activeAllianceId);

/** The player the game waits for, or null once it is over. */
export function reconquistaActor(
  board: PreparationBoard,
  state: ReconquistaSession,
): string | null {
  const c = state.campaign;
  if (c)
    return c.phase === 'finished'
      ? null
      : campaignLegal(board, c, turnActor(c)).actorId;
  if (state.hostility) return state.hostility.actorId;
  return reconquistaLegalActions(board, state, state.preparation.circle[0]!)
    .actorId;
}
/**
 * One clock activation: each placement, each incorporation and each
 * hostility turn (with its occupations, ally windows and zone decisions).
 */
export function reconquistaActivationKey(state: ReconquistaSession): string {
  const c = state.campaign;
  if (c) {
    if (c.phase === 'finished') return 'finished';
    const segment = c.extraPass
      ? 'extra'
      : c.phase === 'incorporation'
        ? 'incorporation'
        : 'hostility';
    return `turn:${c.round}:${segment}:${c.turnIndex}`;
  }
  const p = state.preparation;
  if (state.stage === 'initial-placement')
    return `place:${p.passIndex}:${p.playerIndex}`;
  if (state.stage === 'extra-placement') return `extra:${state.extraIndex}`;
  return state.stage;
}
/** Time for the current activation; `finalRound` is the last round of the game. */
export function reconquistaActivationMs(
  state: ReconquistaSession,
  finalRound: number | undefined,
): number {
  const c = state.campaign;
  if (!c && state.stage !== 'first-hostility')
    return RECONQUISTA_PREPARATION_MS;
  return c && finalRound !== undefined && c.round > finalRound - 2
    ? RECONQUISTA_FINAL_TURN_MS
    : RECONQUISTA_TURN_MS;
}

/** Spreads armies one by one over random countries. */
function spread(
  ids: readonly string[],
  amount: number,
  random: PreparationRandom,
): Record<string, number> {
  if (amount > 0 && !ids.length) throw new Error('No country to reinforce');
  const placed: Record<string, number> = {};
  for (let i = 0; i < amount; i++) {
    const id =
      ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))]!;
    placed[id] = (placed[id] ?? 0) + 1;
  }
  return placed;
}

/**
 * The next automatic move of an activation whose time ran out (decisions
 * 2026-10-27): reinforcements are spread at random, attacks and regroups end,
 * an occupation takes the minimum, a joint attack keeps rolling until it
 * ends, a zone decision keeps the zone pact and unclaimed cards are lost.
 * The caller repeats it until the activation changes.
 */
export function reconquistaTimeoutMove(
  board: PreparationBoard,
  state: ReconquistaSession,
  random: PreparationRandom,
): { readonly actorId: string; readonly action: SetupAction } | null {
  const actorId = reconquistaActor(board, state);
  if (!actorId) return null;
  const c = state.campaign;
  if (!c) {
    if (state.hostility)
      return {
        actorId,
        action: state.hostility.pendingConquest
          ? { kind: 'transfer', armies: 1 }
          : { kind: 'start-campaign' },
      };
    if (state.stage === 'reveal-situation')
      return { actorId, action: { kind: 'reveal' } };
    const legal = reconquistaLegalActions(board, state, actorId);
    return {
      actorId,
      action: {
        kind: state.stage === 'initial-placement' ? 'place' : 'extra',
        placements: spread(legal.placementCountryIds, legal.budget, random),
        conversions: {},
      },
    };
  }
  const campaign = (action: CampaignAction) => ({
    actorId,
    action: { kind: 'campaign', action } as const,
  });
  if (c.phase === 'zone-decision')
    return campaign({
      kind: 'decide-zone',
      pactId: c.zoneDecisions[0]!.pactId,
      keep: true,
    });
  if (c.pending?.arrivals[0]?.playerId === actorId)
    return campaign({ kind: 'occupy', armies: 1 });
  const legal = campaignLegal(board, c, actorId);
  const alliance = activeAlliance(c);
  if (alliance) {
    const route = legal.attacks.find((a) => a.targetId === alliance.targetId);
    if (route) return campaign({ kind: 'attack-country', ...route });
    return campaign({ kind: 'stop-alliance' });
  }
  if (legal.canReinforce) {
    const ids = legal.placementCountryIds;
    return campaign({
      kind: 'reinforce',
      placements: spread(ids, c.freeBudget, random),
      conversions: {},
      continentPlacements:
        c.phase === 'closing'
          ? {}
          : Object.fromEntries(
              Object.entries(c.continentBudgets).map(([id, armies]) => [
                id,
                spread(
                  ids.filter((country) => continent(board, country) === id),
                  armies,
                  random,
                ),
              ]),
            ),
    });
  }
  if (legal.canFinishAllyRegroup)
    return campaign({ kind: 'finish-ally-regroup' });
  if (legal.canEndTurn)
    return campaign({ kind: 'end-turn', confirmForfeit: true });
  if (legal.canFinishRegroup) return campaign({ kind: 'finish-regroup' });
  if (legal.canFinishTurn)
    return campaign({ kind: 'finish-turn', confirmForfeit: true });
  return null;
}

/** Proposals an absent seat leaves unanswered are rejected. */
export function reconquistaDeclines(
  state: ReconquistaSession,
  playerId: string,
): SetupAction[] {
  const c = state.campaign;
  if (!c || c.phase === 'finished') return [];
  return [
    ...c.pacts
      .filter((p) => p.status === 'proposed' && p.partnerId === playerId)
      .map((p) => ({
        kind: 'respond-pact' as const,
        pactId: p.id,
        accept: false,
      })),
    ...c.alliances
      .filter((a) => a.status === 'proposed' && a.allyId === playerId)
      .map((a) => ({
        kind: 'respond-alliance' as const,
        allianceId: a.id,
        accept: false,
      })),
  ].map((action) => ({ kind: 'campaign', action }));
}
