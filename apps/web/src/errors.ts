import type { ProtocolErrorCode } from '@game/protocol';

export const errorMessage = (code: ProtocolErrorCode): string =>
  ({
    GAME_PAUSED: 'La partida está pausada.',
    PLAYER_DISQUALIFIED: 'Estás descalificado; podés observar la partida.',
    INVALID_INHERITANCE: 'Elegí exactamente las cartas heredadas permitidas.',
    UNAUTHENTICATED: 'La sesión no es válida. Volvé a identificarte.',
    UNAUTHORIZED: 'Esta sesión ya no controla el asiento.',
    GAME_NOT_FOUND: 'La partida no existe o fue eliminada.',
    PLAYER_NOT_FOUND: 'El jugador indicado no existe.',
    INVALID_LIFECYCLE_STATE: 'La partida ya no permite esa acción.',
    INVALID_GAME_COMMAND: 'La acción no es válida en el estado actual.',
    SETUP_DEAL_EXHAUSTED:
      'No se pudo repartir países en dos continentes por jugador. La mesa sigue en el lobby; intentá iniciar nuevamente.',
    COLOR_ALREADY_IN_USE: 'Ese color ya está en uso. Elegí otro.',
    NICKNAME_ALREADY_IN_USE: 'Ese nombre ya está en uso. Elegí otro.',
    STALE_REVISION: 'La partida cambió. Se cargará el estado más reciente.',
    DUPLICATE_COMMAND: 'La acción ya fue aplicada.',
    COMMAND_ID_REUSED: 'La acción no pudo reconciliarse de forma segura.',
    PERSISTENCE_FAILURE: 'No se pudo guardar la acción. Intentá nuevamente.',
    GAME_UNAVAILABLE:
      'La partida no está disponible hasta recuperar el servidor.',
    RATE_LIMITED: 'Hay demasiados intentos. Esperá un momento.',
    SERVER_ERROR: 'El servidor no pudo completar la solicitud.',
    PROTOCOL_MISMATCH:
      'Esta interfaz no es compatible con el servidor. Recargá o actualizá.',
    MALFORMED_MESSAGE: 'El servidor recibió un mensaje inválido.',
    GAME_NOT_ACTIVE: 'La partida todavía no está activa.',
    GAME_FINISHED: 'La partida ya terminó.',
    NOT_YOUR_TURN: 'No es tu turno.',
    INVALID_PHASE: 'La acción no corresponde a esta fase.',
    PLAYERS_UNAVAILABLE:
      'Hay jugadores desconectados. Reanudá cuando vuelvan a entrar.',
    PENDING_ACTION: 'Primero completá la acción pendiente.',
    UNKNOWN_PLAYER: 'El jugador no pertenece a esta partida.',
    PLAYER_ELIMINATED: 'El jugador ya fue eliminado.',
    INVALID_TERRITORY: 'El territorio no es válido.',
    NOT_OWNER: 'No controlás ese territorio.',
    NOT_ADJACENT: 'Los territorios no son adyacentes.',
    INSUFFICIENT_ARMIES: 'No hay ejércitos suficientes.',
    PACT_PROHIBITS_ATTACK: 'Un pacto vigente impide esa acción.',
    SUICIDE_ATTACK:
      'Con un solo país no podés atacar hasta tener más de 4 ejércitos en él.',
    INVALID_DICE: 'El resultado de dados no es válido.',
    INVALID_TRANSFER: 'El traslado no es válido.',
    INVALID_PLACEMENT: 'La colocación de ejércitos no es válida.',
    INVALID_EXCHANGE: 'El canje no es válido.',
    MANDATORY_EXCHANGE: 'Debés completar un canje antes de continuar.',
    CARD_LIMIT: 'El límite de tarjetas impide esa acción.',
    NOT_ELIGIBLE: 'La acción todavía no está disponible.',
    INVALID_PACT: 'El pacto propuesto no es válido.',
    DUPLICATE_PACT: 'Ese pacto ya existe.',
    PACT_NOT_FOUND: 'El pacto ya no existe.',
    PACT_LIMIT: 'Ya tenés un pacto con ese jugador.',
    BOT_CONTROLLED:
      'Un bot está jugando en tu lugar. Pedile al administrador que lo quite.',
    PACT_COOLDOWN:
      'Ese jugador rechazó tu pacto. Esperá 5 minutos para volver a proponerle.',
    INTERNATIONAL_ZONE_OBLIGATION:
      'Primero debés resolver la zona internacional.',
  })[code];
