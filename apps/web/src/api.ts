import {
  PROTOCOL_VERSION,
  type AdminGameView,
  type AdminConnectionResponse,
  type BootstrapResponse,
  type ProtocolErrorCode,
  type PlayerGameView,
} from '@game/protocol';

export class ApiError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('SERVER_ERROR', 0);
  }
  const body: unknown =
    response.status === 204 ? undefined : ((await response.json()) as unknown);
  if (!response.ok) {
    const code =
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
        ? (body.code as ProtocolErrorCode)
        : 'SERVER_ERROR';
    throw new ApiError(code, response.status);
  }
  return body as T;
}

export async function bootstrap(): Promise<BootstrapResponse> {
  const value = await request<BootstrapResponse>('/api/bootstrap');
  if (value.protocolVersion !== PROTOCOL_VERSION)
    throw new ApiError('PROTOCOL_MISMATCH', 409);
  return value;
}

export const api = {
  adminConnections: () =>
    request<AdminConnectionResponse>('/api/admin/connections'),
  adminLogin: (recoveryCode: string) =>
    request<{ authenticated: true }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ recoveryCode }),
    }),
  adminGames: () => request<{ games: AdminGameView[] }>('/api/admin/games'),
  createGame: (
    configuredPlayerCount: number,
    mode: 'classic' | 'competitive' = 'classic',
  ) =>
    request<{ gameId: string; revision: number }>('/api/admin/games', {
      method: 'POST',
      body: JSON.stringify({ configuredPlayerCount, mode }),
    }),
  configureGame: (
    gameId: string,
    configuredPlayerCount: number,
    competitiveDurationMinutes?: 60 | 80,
    competitiveBotSeats?: 2,
  ) =>
    request<{ gameId: string; revision: number }>(
      `/api/admin/games/${gameId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          configuredPlayerCount,
          competitiveDurationMinutes,
          competitiveBotSeats,
        }),
      },
    ),
  pauseGame: (gameId: string, paused: boolean) =>
    request<{ revision: number }>(`/api/admin/games/${gameId}/pause`, {
      method: 'POST',
      body: JSON.stringify({ paused }),
    }),
  configureBots: (
    gameId: string,
    change: {
      readonly level?: 'easy' | 'normal' | 'hard';
      readonly replaceAbsent?: boolean;
    },
  ) =>
    request<{ revision: number }>(`/api/admin/games/${gameId}/bots`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),
  assignBot: (gameId: string, playerId: string, enabled: boolean) =>
    request<{ revision: number }>(
      `/api/admin/games/${gameId}/players/${playerId}/bot`,
      { method: 'POST', body: JSON.stringify({ enabled }) },
    ),
  startGame: (gameId: string) =>
    request<{ gameId: string; revision: number }>(
      `/api/admin/games/${gameId}/start`,
      { method: 'POST' },
    ),
  removePlayer: (gameId: string, playerId: string) =>
    request<void>(`/api/admin/games/${gameId}/players/${playerId}`, {
      method: 'DELETE',
    }),
  deleteGame: (gameId: string) =>
    request<void>(`/api/admin/games/${gameId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmGameId: gameId }),
    }),
  playerState: (gameId: string) =>
    request<{ protocolVersion: number; state: PlayerGameView }>(
      `/api/games/${gameId}/state`,
    ),
  entry: (gameId: string) =>
    request<{
      status: string;
      canJoin: boolean;
      availableColors: string[];
      seats: {
        id: string;
        nickname: string;
        color: string;
        seatIndex: number;
      }[];
    }>(`/api/games/${gameId}/entry`),
  join: (gameId: string, nickname: string, color: string) =>
    request<{ playerId: string }>(`/api/games/${gameId}/join`, {
      method: 'POST',
      body: JSON.stringify({ nickname, color }),
    }),
  takeSeat: (gameId: string, playerId: string) =>
    request<{ authenticated: true; playerId: string }>(
      `/api/games/${gameId}/take-seat`,
      {
        method: 'POST',
        body: JSON.stringify({ playerId }),
      },
    ),
  leave: (gameId: string) =>
    request<void>(`/api/games/${gameId}/leave`, { method: 'POST' }),
};
