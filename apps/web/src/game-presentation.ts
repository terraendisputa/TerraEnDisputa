import type { PlayerGameView } from '@game/protocol';
import type { ConnectionStatus } from './live-game.js';

export const PHASE_LABELS: Record<
  NonNullable<PlayerGameView['turn']>['phase'],
  string
> = {
  territory_reinforcement: 'Refuerzos',
  continent_reinforcement: 'Refuerzos continentales',
  ordinary_exchange: 'Canje y refuerzos',
  attack: 'Ataque',
  regroup: 'Traslado',
  end_of_turn_cards: 'Cartas',
};

/** Presentation only: permissions and available commands remain server supplied. */
export function gamePresentation(
  snapshot: PlayerGameView,
  connection: ConnectionStatus = 'connected',
  busy = false,
) {
  const active = snapshot.status === 'ACTIVE';
  const setup = snapshot.status === 'SETUP';
  const actorId =
    snapshot.pendingInheritance?.playerId ??
    (active
      ? (snapshot.pendingAction?.playerId ?? snapshot.turn?.playerId)
      : setup
        ? snapshot.setup?.currentPlayerId
        : undefined);
  const actor = snapshot.players.find((p) => p.id === actorId);
  const mine =
    actorId === snapshot.selfPlayerId && !snapshot.legalActions.readOnly;
  const required =
    mine &&
    (Boolean(snapshot.pendingInheritance) ||
      Boolean(snapshot.pendingAction) ||
      (snapshot.mode === 'classic' &&
        snapshot.turn?.phase === 'ordinary_exchange' &&
        snapshot.private.cards.length > 5));
  const title =
    snapshot.status === 'FINISHED'
      ? 'Resultado'
      : snapshot.status === 'LOBBY'
        ? 'Sala de espera'
        : setup
          ? snapshot.setup?.kind === 'card_deal_4_to_6' &&
            snapshot.setup.stage !== 'reinforcement'
            ? 'Preparación'
            : 'Distribución'
          : snapshot.pendingAction
            ? 'Traslado'
            : snapshot.turn?.phase === 'ordinary_exchange' && required
              ? 'Canje'
              : snapshot.turn
                ? PHASE_LABELS[snapshot.turn.phase]
                : 'Partida';
  const status =
    snapshot.status === 'FINISHED'
      ? 'Partida finalizada'
      : mine
        ? required
          ? 'Acción obligatoria'
          : 'Tu turno'
        : snapshot.players.find((p) => p.id === snapshot.selfPlayerId)
              ?.eliminated
          ? 'Modo observación'
          : actor
            ? `Turno de ${actor.nickname}`
            : 'Preparando la partida';
  const lock = snapshot.competitiveClock?.pauseReason
    ? 'Partida pausada'
    : busy
      ? 'Confirmando…'
      : connection === 'connected'
        ? ''
        : connection === 'reconnecting' || connection === 'connecting'
          ? 'Reconectando…'
          : 'Sin conexión';
  return {
    title,
    status,
    actorId,
    mine,
    required,
    lock,
    canAct:
      mine &&
      connection === 'connected' &&
      !busy &&
      !snapshot.competitiveClock?.pauseReason,
    tone: required
      ? 'mandatory'
      : mine
        ? 'mine'
        : snapshot.status === 'FINISHED'
          ? 'finished'
          : 'waiting',
  } as const;
}

/** Classic initial deployment has no round label; Competitive preserves rounds 1/2. */
export function gameContextSummary(
  snapshot: PlayerGameView,
  presentation = gamePresentation(snapshot),
) {
  const playerId =
    snapshot.status === 'FINISHED'
      ? snapshot.result?.winnerId
      : presentation.actorId;
  const player = snapshot.players.find(({ id }) => id === playerId);
  const firstHostilityRound = snapshot.configuredPlayerCount <= 3 ? 2 : 3;
  const roundNumber =
    snapshot.mode === 'competitive' &&
    snapshot.status === 'SETUP' &&
    snapshot.setup?.kind === 'card_deal_4_to_6'
      ? snapshot.setup.reinforcementRound
      : (snapshot.status === 'ACTIVE' ||
            (snapshot.mode === 'competitive' &&
              snapshot.status === 'FINISHED')) &&
          snapshot.turn
        ? snapshot.turn.round.kind === 'initial_hostility'
          ? firstHostilityRound
          : snapshot.turn.round.roundNumber + firstHostilityRound
        : undefined;
  const headline =
    snapshot.status === 'FINISHED'
      ? snapshot.result?.winnerId
        ? `Ganó: ${player?.nickname ?? 'Jugador'}`
        : 'Partida cerrada'
      : player
        ? `Juega: ${player.nickname}`
        : snapshot.status === 'LOBBY'
          ? 'Sala de espera'
          : 'Preparación';
  const detail = snapshot.pendingInheritance
    ? 'Cartas heredadas pendientes'
    : snapshot.status === 'FINISHED'
      ? 'Partida finalizada'
      : snapshot.status === 'SETUP'
        ? 'Distribución inicial'
        : snapshot.status === 'LOBBY'
          ? 'Esperando jugadores'
          : !snapshot.pendingAction &&
              snapshot.turn?.phase === 'ordinary_exchange'
            ? 'Canje'
            : snapshot.turn?.phase === 'continent_reinforcement'
              ? 'Refuerzos'
              : presentation.title;
  return { headline, detail, roundNumber };
}
