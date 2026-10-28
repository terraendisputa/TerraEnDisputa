import type { PlayerGameView } from '@game/protocol';
import type { ConnectionStatus } from './live-game.js';
import { tr } from './language.js';

export const PHASE_LABELS: Record<
  NonNullable<PlayerGameView['turn']>['phase'],
  string
> = {
  territory_reinforcement: tr('Refuerzos', 'Reinforcements'),
  continent_reinforcement: tr(
    'Refuerzos continentales',
    'Continent reinforcements',
  ),
  ordinary_exchange: tr('Canje y refuerzos', 'Exchange and reinforcements'),
  attack: tr('Ataque', 'Attack'),
  regroup: tr('Traslado', 'Move'),
  end_of_turn_cards: tr('Cartas', 'Cards'),
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
      ? tr('Resultado', 'Result')
      : snapshot.status === 'LOBBY'
        ? tr('Sala de espera', 'Waiting room')
        : setup
          ? snapshot.setup?.kind === 'card_deal_4_to_6' &&
            snapshot.setup.stage !== 'reinforcement'
            ? tr('Preparación', 'Preparation')
            : tr('Distribución', 'Deployment')
          : snapshot.pendingAction
            ? tr('Traslado', 'Move')
            : snapshot.turn?.phase === 'ordinary_exchange' && required
              ? tr('Canje', 'Exchange')
              : snapshot.turn
                ? PHASE_LABELS[snapshot.turn.phase]
                : tr('Partida', 'Game');
  const status =
    snapshot.status === 'FINISHED'
      ? tr('Partida finalizada', 'Game over')
      : mine
        ? required
          ? tr('Acción obligatoria', 'Required action')
          : tr('Tu turno', 'Your turn')
        : snapshot.players.find((p) => p.id === snapshot.selfPlayerId)
              ?.eliminated
          ? tr('Modo observación', 'Watching')
          : actor
            ? tr(`Turno de ${actor.nickname}`, `${actor.nickname}'s turn`)
            : tr('Preparando la partida', 'Preparing the game');
  const lock = snapshot.competitiveClock?.pauseReason
    ? tr('Partida pausada', 'Game paused')
    : busy
      ? tr('Confirmando…', 'Confirming…')
      : connection === 'connected'
        ? ''
        : connection === 'reconnecting' || connection === 'connecting'
          ? tr('Reconectando…', 'Reconnecting…')
          : tr('Sin conexión', 'Offline');
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
        ? tr(
            `Ganó: ${player?.nickname ?? 'Jugador'}`,
            `Winner: ${player?.nickname ?? 'Player'}`,
          )
        : tr('Partida cerrada', 'Game closed')
      : player
        ? tr(`Juega: ${player.nickname}`, `Playing: ${player.nickname}`)
        : snapshot.status === 'LOBBY'
          ? tr('Sala de espera', 'Waiting room')
          : tr('Preparación', 'Preparation');
  const detail = snapshot.pendingInheritance
    ? tr('Cartas heredadas pendientes', 'Inherited cards pending')
    : snapshot.status === 'FINISHED'
      ? tr('Partida finalizada', 'Game over')
      : snapshot.status === 'SETUP'
        ? tr('Distribución inicial', 'Initial deployment')
        : snapshot.status === 'LOBBY'
          ? tr('Esperando jugadores', 'Waiting for players')
          : !snapshot.pendingAction &&
              snapshot.turn?.phase === 'ordinary_exchange'
            ? tr('Canje', 'Exchange')
            : snapshot.turn?.phase === 'continent_reinforcement'
              ? tr('Refuerzos', 'Reinforcements')
              : presentation.title;
  return { headline, detail, roundNumber };
}
