import { gameIdParamsSchema } from '@game/protocol';
const validId = (gameId: string) =>
  gameIdParamsSchema.safeParse({ gameId }).success;
export function invitationDestination(value: string): string | undefined {
  const input = value.trim();
  if (validId(input)) return `/game/${input}`;
  try {
    const url = new URL(input);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    const match = /^\/game\/([^/]+)\/?$/.exec(url.pathname);
    if (!match?.[1] || !validId(match[1])) return undefined;
    return `${url.origin}/game/${match[1]}`;
  } catch {
    return undefined;
  }
}
