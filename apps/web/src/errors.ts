import type { ProtocolErrorCode } from '@game/protocol';
import { tr } from './language.js';

export const errorMessage = (code: ProtocolErrorCode): string =>
  ({
    GAME_PAUSED: tr('La partida está pausada.', 'The game is paused.'),
    PLAYER_DISQUALIFIED: tr(
      'Estás descalificado; podés observar la partida.',
      'You are disqualified; you can watch the game.',
    ),
    INVALID_INHERITANCE: tr(
      'Elegí exactamente las cartas heredadas permitidas.',
      'Choose exactly the inherited cards allowed.',
    ),
    UNAUTHENTICATED: tr(
      'La sesión no es válida. Volvé a identificarte.',
      'The session is not valid. Identify yourself again.',
    ),
    UNAUTHORIZED: tr(
      'Esta sesión ya no controla el asiento.',
      'This session no longer controls the seat.',
    ),
    GAME_NOT_FOUND: tr(
      'La partida no existe o fue eliminada.',
      'The game does not exist or was deleted.',
    ),
    PLAYER_NOT_FOUND: tr(
      'El jugador indicado no existe.',
      'That player does not exist.',
    ),
    INVALID_LIFECYCLE_STATE: tr(
      'La partida ya no permite esa acción.',
      'The game no longer allows that action.',
    ),
    INVALID_GAME_COMMAND: tr(
      'La acción no es válida en el estado actual.',
      'The action is not valid right now.',
    ),
    SETUP_DEAL_EXHAUSTED: tr(
      'No se pudo repartir países en dos continentes por jugador. La mesa sigue en el lobby; intentá iniciar nuevamente.',
      'Countries could not be dealt over two continents per player. The table stays in the lobby; try starting again.',
    ),
    COLOR_ALREADY_IN_USE: tr(
      'Ese color ya está en uso. Elegí otro.',
      'That color is already in use. Choose another.',
    ),
    NICKNAME_ALREADY_IN_USE: tr(
      'Ese nombre ya está en uso. Elegí otro.',
      'That name is already in use. Choose another.',
    ),
    STALE_REVISION: tr(
      'La partida cambió. Se cargará el estado más reciente.',
      'The game changed. The latest state will load.',
    ),
    DUPLICATE_COMMAND: tr(
      'La acción ya fue aplicada.',
      'The action was already applied.',
    ),
    COMMAND_ID_REUSED: tr(
      'La acción no pudo reconciliarse de forma segura.',
      'The action could not be reconciled safely.',
    ),
    PERSISTENCE_FAILURE: tr(
      'No se pudo guardar la acción. Intentá nuevamente.',
      'The action could not be saved. Try again.',
    ),
    GAME_UNAVAILABLE: tr(
      'La partida no está disponible hasta recuperar el servidor.',
      'The game is unavailable until the server recovers.',
    ),
    RATE_LIMITED: tr(
      'Hay demasiados intentos. Esperá un momento.',
      'Too many attempts. Wait a moment.',
    ),
    SERVER_ERROR: tr(
      'El servidor no pudo completar la solicitud.',
      'The server could not complete the request.',
    ),
    PROTOCOL_MISMATCH: tr(
      'Esta interfaz no es compatible con el servidor. Recargá o actualizá.',
      'This interface is not compatible with the server. Reload or update.',
    ),
    MALFORMED_MESSAGE: tr(
      'El servidor recibió un mensaje inválido.',
      'The server received an invalid message.',
    ),
    GAME_NOT_ACTIVE: tr(
      'La partida todavía no está activa.',
      'The game is not active yet.',
    ),
    GAME_FINISHED: tr('La partida ya terminó.', 'The game is over.'),
    NOT_YOUR_TURN: tr('No es tu turno.', 'It is not your turn.'),
    INVALID_PHASE: tr(
      'La acción no corresponde a esta fase.',
      'The action does not belong to this phase.',
    ),
    PLAYERS_UNAVAILABLE: tr(
      'Hay jugadores desconectados. Reanudá cuando vuelvan a entrar.',
      'Some players are disconnected. Resume when they come back.',
    ),
    PENDING_ACTION: tr(
      'Primero completá la acción pendiente.',
      'Complete the pending action first.',
    ),
    UNKNOWN_PLAYER: tr(
      'El jugador no pertenece a esta partida.',
      'The player is not in this game.',
    ),
    PLAYER_ELIMINATED: tr(
      'El jugador ya fue eliminado.',
      'The player was already eliminated.',
    ),
    INVALID_TERRITORY: tr(
      'El territorio no es válido.',
      'The territory is not valid.',
    ),
    NOT_OWNER: tr(
      'No controlás ese territorio.',
      "You don't control that territory.",
    ),
    NOT_ADJACENT: tr(
      'Los territorios no son adyacentes.',
      'The territories are not adjacent.',
    ),
    INSUFFICIENT_ARMIES: tr(
      'No hay ejércitos suficientes.',
      'There are not enough armies.',
    ),
    PACT_PROHIBITS_ATTACK: tr(
      'Un pacto vigente impide esa acción.',
      'A pact in force prevents that action.',
    ),
    SUICIDE_ATTACK: tr(
      'Con un solo país no podés atacar hasta tener más de 4 ejércitos en él.',
      "With a single country you can't attack until it has more than 4 armies.",
    ),
    INVALID_DICE: tr(
      'El resultado de dados no es válido.',
      'The dice result is not valid.',
    ),
    INVALID_TRANSFER: tr('El traslado no es válido.', 'The move is not valid.'),
    INVALID_PLACEMENT: tr(
      'La colocación de ejércitos no es válida.',
      'The army placement is not valid.',
    ),
    INVALID_EXCHANGE: tr(
      'El canje no es válido.',
      'The exchange is not valid.',
    ),
    MANDATORY_EXCHANGE: tr(
      'Debés completar un canje antes de continuar.',
      'You must complete an exchange before continuing.',
    ),
    CARD_LIMIT: tr(
      'El límite de tarjetas impide esa acción.',
      'The card limit prevents that action.',
    ),
    NOT_ELIGIBLE: tr(
      'La acción todavía no está disponible.',
      'The action is not available yet.',
    ),
    INVALID_PACT: tr(
      'El pacto propuesto no es válido.',
      'The proposed pact is not valid.',
    ),
    DUPLICATE_PACT: tr('Ese pacto ya existe.', 'That pact already exists.'),
    PACT_NOT_FOUND: tr('El pacto ya no existe.', 'The pact no longer exists.'),
    PACT_LIMIT: tr(
      'Ya tenés un pacto con ese jugador.',
      'You already have a pact with that player.',
    ),
    BOT_CONTROLLED: tr(
      'Un bot está jugando en tu lugar. Pedile al administrador que lo quite.',
      'A bot is playing in your place. Ask the administrator to remove it.',
    ),
    PACT_COOLDOWN: tr(
      'Ese jugador rechazó tu pacto. Esperá 5 minutos para volver a proponerle.',
      'That player rejected your pact. Wait 5 minutes to propose again.',
    ),
    INTERNATIONAL_ZONE_OBLIGATION: tr(
      'Primero debés resolver la zona internacional.',
      'You must resolve the international zone first.',
    ),
  })[code];
