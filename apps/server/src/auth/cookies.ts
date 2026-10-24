import { createHash } from 'node:crypto';

import type { TransportClass } from './types.js';

type SessionCookieAuthority =
  | { readonly kind: 'admin' }
  | { readonly kind: 'player'; readonly gameId: string };

interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: 'strict';
    readonly secure: boolean;
    readonly path: '/';
    readonly expires?: Date;
    readonly maxAge?: number;
  };
}

const gameNamespace = (gameId: string) =>
  createHash('sha256').update(gameId, 'utf8').digest('hex').slice(0, 24);

export function sessionCookieName(
  authority: SessionCookieAuthority,
  transportClass: TransportClass,
): string {
  const namespace =
    authority.kind === 'admin'
      ? 'admin'
      : `player_${gameNamespace(authority.gameId)}`;
  const name = `ted_${namespace}_session_${transportClass.toLowerCase()}`;
  return transportClass === 'HTTPS' ? `__Host-${name}` : name;
}

export function readSessionCookie(
  cookies: Readonly<Record<string, string | undefined>>,
  authority: SessionCookieAuthority,
  transportClass: TransportClass,
): string | undefined {
  return cookies[sessionCookieName(authority, transportClass)];
}

const cookieOptions = (transportClass: TransportClass) => ({
  httpOnly: true as const,
  sameSite: 'strict' as const,
  secure: transportClass === 'HTTPS',
  path: '/' as const,
});

export function createSessionCookie(
  authority: SessionCookieAuthority,
  token: string,
  transportClass: TransportClass,
  expiresAt: string,
): SessionCookie {
  return {
    name: sessionCookieName(authority, transportClass),
    value: token,
    options: {
      ...cookieOptions(transportClass),
      expires: new Date(expiresAt),
    },
  };
}

export function clearSessionCookie(
  authority: SessionCookieAuthority,
  transportClass: TransportClass,
): SessionCookie {
  return {
    name: sessionCookieName(authority, transportClass),
    value: '',
    options: { ...cookieOptions(transportClass), maxAge: 0 },
  };
}
