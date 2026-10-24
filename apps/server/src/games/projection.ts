import {
  resolveGameRuntime,
  competitiveResults,
  type GameState,
  type PlayerId,
} from '@game/game-engine';
import type { AdminGameView, PlayerGameView } from '@game/protocol';

const publicPlayers = (state: GameState): AdminGameView['players'] =>
  state.players.map((player) => ({
    id: player.id,
    seatIndex: player.seatIndex,
    nickname: player.nickname,
    color: player.color,
    controller: player.controller,
    eliminated: player.eliminated,
    ...(player.disqualified === undefined
      ? {}
      : { disqualified: player.disqualified }),
    cardCount: player.cards.length,
    completedExchangeCount: player.completedExchangeCount,
  }));

export function projectGameForAdmin(
  state: GameState,
  revision: number,
): AdminGameView {
  resolveGameRuntime(state.definition);
  const common = {
    definition: { ...state.definition },
    gameId: state.id,
    revision,
    status: state.status,
    mode: state.mode,
    ...(state.competitiveClock
      ? { competitiveClock: structuredClone(state.competitiveClock) }
      : {}),
    configuredPlayerCount: state.configuredPlayerCount,
    players: publicPlayers(state),
    ...(state.pendingInheritance
      ? {
          pendingInheritance: {
            playerId: state.pendingInheritance.playerId,
            takeCount: state.pendingInheritance.takeCount,
            cardCount: state.pendingInheritance.cards.length,
          },
        }
      : {}),
  };
  if (state.status === 'LOBBY')
    return { ...common, readyPlayerIds: [...state.readyPlayerIds] };
  if (state.status === 'SETUP')
    return { ...common, setup: structuredClone(state.setup) };
  if (state.status === 'ACTIVE')
    return { ...common, turn: structuredClone(state.turn) };
  const competitiveSummary = competitiveResults(state);
  const eligibility =
    competitiveSummary?.scoringEligible ?? state.result.scoringEligible;
  const winner = state.players.find(({ id }) => id === state.result.winnerId)!;
  const effectiveTargetColor = winner?.effectiveDestructionTargetPlayerId
    ? state.players.find(
        ({ id }) => id === winner.effectiveDestructionTargetPlayerId,
      )?.color
    : undefined;
  return {
    ...common,
    turn: structuredClone(state.turn),
    ...(competitiveSummary ? { competitiveResults: competitiveSummary } : {}),
    result: {
      ...(state.result.winnerId ? { winnerId: state.result.winnerId } : {}),
      ...(eligibility === undefined ? {} : { scoringEligible: eligibility }),
      victoryReason:
        state.result.victoryReason.kind === 'secret_objective'
          ? {
              ...state.result.victoryReason,
              ...(effectiveTargetColor
                ? { effectiveDestructionTargetColor: effectiveTargetColor }
                : {}),
            }
          : structuredClone(state.result.victoryReason),
    },
  };
}

export function projectGameFor(
  state: GameState,
  revision: number,
  playerId: PlayerId,
): PlayerGameView {
  const self = state.players.find((player) => player.id === playerId);
  if (!self) throw new Error('Cannot project a game for a missing player');
  const runtime = resolveGameRuntime(state.definition);
  const common = {
    definition: { ...state.definition },
    gameId: state.id,
    revision,
    status: state.status,
    mode: state.mode,
    ...(state.competitiveClock
      ? { competitiveClock: structuredClone(state.competitiveClock) }
      : {}),
    configuredPlayerCount: state.configuredPlayerCount,
    selfPlayerId: playerId,
    legalActions: runtime.deriveLegalActions(state, playerId),
    players: publicPlayers(state),
    ...(state.pendingInheritance
      ? {
          pendingInheritance: {
            playerId: state.pendingInheritance.playerId,
            takeCount: state.pendingInheritance.takeCount,
            cardCount: state.pendingInheritance.cards.length,
          },
        }
      : {}),
    private: {
      ...(state.pendingInheritance?.playerId === playerId
        ? {
            inheritedCards: state.pendingInheritance.cards.map((card) => ({
              ...card,
              symbol: runtime.board.territoryCards[card.cardId].symbol,
            })),
          }
        : {}),
      cards: self.cards.map((card) => ({
        ...card,
        symbol: runtime.board.territoryCards[card.cardId].symbol,
      })),
      ...(self.secretObjectiveId === undefined
        ? {}
        : { secretObjectiveId: self.secretObjectiveId }),
      ...(self.effectiveDestructionTargetPlayerId === undefined
        ? {}
        : {
            effectiveDestructionTargetPlayerId:
              self.effectiveDestructionTargetPlayerId,
          }),
    },
  };
  if (state.status === 'LOBBY')
    return { ...common, readyPlayerIds: [...state.readyPlayerIds] };
  const started = {
    ...common,
    territories: Object.fromEntries(
      Object.entries(state.territories).map(([id, territory]) => [
        id,
        { ...territory },
      ]),
    ),
    pacts: structuredClone(state.pacts),
  };
  if (state.status === 'SETUP')
    return { ...started, setup: structuredClone(state.setup) };
  if (state.status === 'ACTIVE')
    return {
      ...started,
      turn: structuredClone(state.turn),
      ...(state.pendingAction === undefined
        ? {}
        : { pendingAction: structuredClone(state.pendingAction) }),
    };
  const competitiveSummary = competitiveResults(state);
  const eligibility =
    competitiveSummary?.scoringEligible ?? state.result.scoringEligible;
  const winner = state.players.find(({ id }) => id === state.result.winnerId)!;
  const effectiveTargetColor = winner?.effectiveDestructionTargetPlayerId
    ? state.players.find(
        ({ id }) => id === winner.effectiveDestructionTargetPlayerId,
      )?.color
    : undefined;
  return {
    ...started,
    turn: structuredClone(state.turn),
    result: {
      ...(state.result.winnerId ? { winnerId: state.result.winnerId } : {}),
      ...(eligibility === undefined ? {} : { scoringEligible: eligibility }),
      victoryReason:
        state.result.victoryReason.kind === 'secret_objective'
          ? {
              ...state.result.victoryReason,
              ...(effectiveTargetColor
                ? { effectiveDestructionTargetColor: effectiveTargetColor }
                : {}),
            }
          : structuredClone(state.result.victoryReason),
    },
  };
}
