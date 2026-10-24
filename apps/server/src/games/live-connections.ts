import type { PlayerId } from '@game/game-engine';
import type { ServerMessage } from '@game/protocol';
import type WebSocket from 'ws';

import type { TransportClass } from '../auth/types.js';

export interface LiveConnection {
  readonly socket: WebSocket;
  readonly playerId: PlayerId;
  readonly token: string;
  readonly transportClass: TransportClass;
}

export class LiveConnectionRegistry {
  private readonly games = new Map<string, Set<LiveConnection>>();

  constructor(
    private readonly onDeliveryFailure: (
      gameId: string,
      playerId: PlayerId,
      error: unknown,
    ) => void = () => undefined,
  ) {}

  register(gameId: string, connection: LiveConnection): boolean {
    let registered = false;
    const cleanup = () => {
      if (!registered) return;
      registered = false;
      const gameConnections = this.games.get(gameId);
      gameConnections?.delete(connection);
      if (gameConnections?.size === 0) this.games.delete(gameId);
    };
    connection.socket.once('close', cleanup);
    connection.socket.on('error', cleanup);
    if (connection.socket.readyState !== connection.socket.OPEN) {
      cleanup();
      return false;
    }
    const gameConnections = this.games.get(gameId) ?? new Set();
    registered = true;
    gameConnections.add(connection);
    this.games.set(gameId, gameConnections);
    if (connection.socket.readyState !== connection.socket.OPEN) cleanup();
    return registered;
  }

  send(
    gameId: string,
    connection: LiveConnection,
    message: ServerMessage,
  ): boolean {
    if (!this.games.get(gameId)?.has(connection)) return false;
    try {
      if (connection.socket.readyState !== connection.socket.OPEN) {
        this.remove(gameId, connection);
        return false;
      }
      connection.socket.send(JSON.stringify(message), (error) => {
        if (!error) return;
        this.onDeliveryFailure(gameId, connection.playerId, error);
        this.remove(gameId, connection);
        try {
          connection.socket.close(1011, 'DELIVERY_FAILED');
        } catch {
          // The registry is already clean; a broken socket may reject close.
        }
      });
      return true;
    } catch (error) {
      this.onDeliveryFailure(gameId, connection.playerId, error);
      this.remove(gameId, connection);
      try {
        connection.socket.close(1011, 'DELIVERY_FAILED');
      } catch {
        // The registry is already clean; a broken socket may also reject close.
      }
      return false;
    }
  }

  remove(gameId: string, connection: LiveConnection): void {
    const gameConnections = this.games.get(gameId);
    gameConnections?.delete(connection);
    if (gameConnections?.size === 0) this.games.delete(gameId);
  }

  closePlayer(gameId: string, playerId: PlayerId, reason: string): void {
    for (const connection of [...(this.games.get(gameId) ?? [])])
      if (connection.playerId === playerId) {
        this.remove(gameId, connection);
        try {
          connection.socket.close(1008, reason);
        } catch {
          // Removal is authoritative even if the transport is already broken.
        }
      }
  }

  closeGame(gameId: string, reason: string): void {
    for (const connection of [...(this.games.get(gameId) ?? [])]) {
      this.remove(gameId, connection);
      try {
        connection.socket.close(1008, reason);
      } catch {
        // Removal is authoritative even if the transport is already broken.
      }
    }
  }

  closeAll(): void {
    for (const [gameId, gameConnections] of [...this.games])
      for (const connection of [...gameConnections]) {
        this.remove(gameId, connection);
        connection.socket.terminate();
      }
  }

  forGame(gameId: string): readonly LiveConnection[] {
    return [...(this.games.get(gameId) ?? [])];
  }

  size(gameId: string): number {
    return this.games.get(gameId)?.size ?? 0;
  }
}
