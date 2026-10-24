import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';

type RequestSecurityContext = Pick<
  FastifyRequest,
  'protocol' | 'headers' | 'hostname'
>;
const expectedOrigin = (request: RequestSecurityContext, configured?: string) =>
  configured ??
  `${request.protocol}://${request.headers.host ?? request.hostname}`;
/** State-changing requests must come from the game's own page. */
export const hasValidOrigin = (
  request: RequestSecurityContext,
  configured?: string,
) => {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return (
      new URL(origin).origin ===
      new URL(expectedOrigin(request, configured)).origin
    );
  } catch {
    return false;
  }
};

/**
 * Guards against DNS rebinding: a page on someone else's domain that points
 * its name at this server. The server is reached by address, `localhost`, a
 * `.local` name on the same network, or the configured public origin.
 */
export const isAllowedHost = (hostname: string, configured?: string) => {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) || host === 'localhost') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (!configured) return false;
  try {
    return new URL(configured).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
};
