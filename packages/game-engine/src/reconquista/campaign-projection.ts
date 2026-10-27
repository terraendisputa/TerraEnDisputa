import type { PreparationBoard } from './preparation.js';
import type { Campaign } from './campaign-types.js';
import { campaignLegal } from './campaign.js';
import { turnActor } from './campaign-politics.js';
export function projectCampaign(
  board: PreparationBoard,
  s: Campaign,
  viewer: string | null,
) {
  return {
    public: {
      round: s.round,
      order: [...s.order],
      actorId: turnActor(s),
      phase: s.phase,
      extraPass: s.extraPass,
      players: s.players.map((p) => ({
        playerId: p.id,
        cardCount: s.cards.hands[p.id]!.length,
        continentIds: Object.entries(s.cards.continents)
          .filter(([, c]) => c.holderId === p.id)
          .map(([id]) => id),
        usedContinentIds: Object.entries(s.cards.continents)
          .filter(([, c]) => c.usedBy.includes(p.id))
          .map(([id]) => id),
        exchanges: s.cards.exchanges[p.id]!,
        penaltyDebt: s.penaltyDebts[p.id] ?? 0,
      })),
      pacts: structuredClone(s.pacts),
      alliances: structuredClone(s.alliances),
      activeAllianceId: s.activeAllianceId,
      occupation: structuredClone(s.pending),
      zoneDecisions: structuredClone(s.zoneDecisions),
      eliminations: { ...s.eliminations },
      winners: [...s.winners],
      ...(s.timeLimit ? { timeLimit: true } : {}),
      lastCombat: structuredClone(s.lastCombat),
      lastMissile: structuredClone(s.lastMissile),
      lastExchange: structuredClone(s.cards.lastExchange),
    },
    ...(viewer
      ? {
          private: {
            hand: structuredClone(s.cards.hands[viewer]!),
            legal: campaignLegal(board, s, viewer),
          },
        }
      : {}),
  };
}
