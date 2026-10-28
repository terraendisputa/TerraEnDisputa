import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientCommand,
  type CommandPayload,
  type PlayerGameView,
  type ProtocolErrorCode,
  type ServerMessage,
} from '@game/protocol';
import { createCommandId } from './command-id.js';
import { parseServerJson } from './language.js';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unauthorized'
  | 'unavailable'
  | 'incompatible';

export interface LiveGameState {
  readonly connection: ConnectionStatus;
  readonly helloPlayerId: string | undefined;
  readonly snapshot: PlayerGameView | undefined;
  readonly inFlight: ClientCommand | undefined;
  readonly error: ProtocolErrorCode | undefined;
}

type SocketLike = Pick<
  WebSocket,
  'readyState' | 'send' | 'close' | 'addEventListener'
>;
type SocketFactory = (url: string, protocols: string | string[]) => SocketLike;

const websocketUrl = (gameId: string) => {
  const url = new URL(`/api/games/${gameId}/live`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const INITIAL_RECONNECT_DELAY_MS = 750;
const MAX_RECONNECT_DELAY_MS = 6_000;

export class LiveGameClient {
  private state: LiveGameState = {
    connection: 'disconnected',
    helloPlayerId: undefined,
    snapshot: undefined,
    inFlight: undefined,
    error: undefined,
  };
  private socket: SocketLike | undefined;
  private listeners = new Set<() => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private retryInFlight = false;
  private reconnectAttempts = 0;

  constructor(
    readonly gameId: string,
    private readonly createSocket: SocketFactory = (url, protocols) =>
      new WebSocket(url, protocols),
    private readonly schedule: (
      callback: () => void,
      milliseconds: number,
    ) => ReturnType<typeof setTimeout> = (callback, milliseconds) =>
      setTimeout(callback, milliseconds),
  ) {}

  getState = (): LiveGameState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(): void {
    this.stopped = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.open(this.state.snapshot ? 'reconnecting' : 'connecting');
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.update({ ...this.state, connection: 'disconnected' });
  }

  submit(command: CommandPayload): string | undefined {
    if (
      !this.state.snapshot ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.state.inFlight
    )
      return undefined;
    const message: ClientCommand = {
      type: 'COMMAND',
      protocolVersion: PROTOCOL_VERSION,
      commandId: createCommandId(),
      baseRevision: this.state.snapshot.revision,
      command,
    };
    this.update({ ...this.state, inFlight: message, error: undefined });
    this.retryInFlight = false;
    this.socket.send(JSON.stringify(message));
    return message.commandId;
  }

  private open(status: 'connecting' | 'reconnecting') {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    this.update({ ...this.state, connection: status });
    const socket = this.createSocket(
      websocketUrl(this.gameId),
      `classic-v${PROTOCOL_VERSION}`,
    );
    this.socket = socket;
    let receivedHello = false;
    socket.addEventListener('open', () => undefined);
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.stopped) return;
      let decoded: unknown;
      try {
        decoded = parseServerJson(String(event.data));
      } catch {
        this.failProtocol(socket);
        return;
      }
      const parsed = serverMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        this.failProtocol(socket);
        return;
      }
      const message = parsed.data as ServerMessage;
      if (message.type === 'HELLO') {
        if (message.gameId !== this.gameId) {
          this.failProtocol(socket);
          return;
        }
        if (
          this.state.snapshot &&
          message.playerId !== this.state.snapshot.selfPlayerId
        ) {
          this.failProtocol(socket);
          return;
        }
        receivedHello = true;
        this.update({
          ...this.state,
          connection: 'connected',
          helloPlayerId: message.playerId,
          error: undefined,
        });
        return;
      }
      if (message.type === 'STATE') {
        if (
          !receivedHello ||
          message.state.gameId !== this.gameId ||
          message.state.selfPlayerId !== this.state.helloPlayerId
        ) {
          this.failProtocol(socket);
          return;
        }
        if (
          this.state.snapshot &&
          message.state.revision < this.state.snapshot.revision
        )
          return;
        this.update({
          ...this.state,
          connection: 'connected',
          snapshot: message.state,
          error: undefined,
        });
        this.reconnectAttempts = 0;
        if (
          this.retryInFlight &&
          this.state.inFlight &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send(JSON.stringify(this.state.inFlight));
          this.retryInFlight = false;
        }
        return;
      }
      if (message.type === 'COMMAND_RESULT') {
        if (message.commandId === this.state.inFlight?.commandId)
          this.retryInFlight = false;
        if (message.commandId === this.state.inFlight?.commandId)
          this.update({ ...this.state, inFlight: undefined, error: undefined });
        return;
      }
      if (message.type === 'COMMAND_REJECTED') {
        if (
          message.commandId === undefined ||
          message.commandId === this.state.inFlight?.commandId
        ) {
          this.retryInFlight = false;
          this.update({
            ...this.state,
            inFlight: undefined,
            error: message.code,
          });
        }
        return;
      }
      if (message.code === 'PROTOCOL_MISMATCH') {
        this.failProtocol(socket);
        return;
      }
      if (
        message.code === 'GAME_UNAVAILABLE' ||
        message.code === 'GAME_NOT_FOUND'
      ) {
        this.stopped = true;
        this.update({
          ...this.state,
          connection: 'unavailable',
          inFlight: undefined,
          error: message.code,
        });
      } else if (
        message.code === 'UNAUTHORIZED' ||
        message.code === 'UNAUTHENTICATED'
      ) {
        this.stopped = true;
        this.update({
          ...this.state,
          connection: 'unauthorized',
          inFlight: undefined,
          error: message.code,
        });
      } else {
        this.retryInFlight = false;
        this.update({
          ...this.state,
          inFlight: undefined,
          error: message.code,
        });
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket || this.stopped) return;
      const terminalAuthority =
        event.code === 1008 &&
        ['UNAUTHORIZED', 'SESSION_REVOKED'].includes(event.reason);
      if (event.code === 1008 && event.reason === 'PROTOCOL_MISMATCH') {
        this.failProtocol(socket);
        return;
      }
      if (event.code === 1008 && event.reason === 'GAME_DELETED') {
        this.stopped = true;
        this.update({
          ...this.state,
          connection: 'unavailable',
          inFlight: undefined,
          error: 'GAME_NOT_FOUND',
        });
        return;
      }
      if (terminalAuthority) {
        this.stopped = true;
        this.update({
          ...this.state,
          connection: 'unauthorized',
          inFlight: undefined,
          error:
            event.reason === 'GAME_DELETED' ? 'GAME_NOT_FOUND' : 'UNAUTHORIZED',
        });
        return;
      }
      this.update({ ...this.state, connection: 'reconnecting' });
      this.retryInFlight = Boolean(this.state.inFlight);
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
        MAX_RECONNECT_DELAY_MS,
      );
      this.reconnectAttempts += 1;
      this.reconnectTimer = this.schedule(() => {
        if (this.socket !== socket || this.stopped) return;
        this.reconnectTimer = undefined;
        this.open('reconnecting');
      }, delay);
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket && !this.stopped)
        this.update({ ...this.state, connection: 'reconnecting' });
    });
  }

  private failProtocol(socket: SocketLike) {
    if (this.socket !== socket || this.stopped) return;
    this.stopped = true;
    try {
      socket.close(4002, 'PROTOCOL_MISMATCH');
    } catch {
      // Client state still fails closed when the transport cannot be closed.
    }
    this.update({
      ...this.state,
      connection: 'incompatible',
      inFlight: undefined,
      error: 'PROTOCOL_MISMATCH',
    });
  }

  private update(state: LiveGameState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
