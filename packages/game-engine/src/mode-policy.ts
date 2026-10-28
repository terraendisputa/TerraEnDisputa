import type { GameMode } from './domain.js';

export const setupArmies = (mode: GameMode, round: 1 | 2): number =>
  mode === 'competitive' ? 4 : round === 1 ? 5 : 3;
export const validPlayerCount = (mode: GameMode, count: number): boolean =>
  (mode === 'classic' || mode === 'competitive') &&
  Number.isInteger(count) &&
  count >= (mode === 'competitive' ? 4 : 2) &&
  count <= 6;
/** Competitive with four players, or four plus two bots, plays without pacts. */
export const pactsAllowed = (
  mode: GameMode,
  count: number,
  botSeats = 0,
): boolean => mode !== 'competitive' || count - botSeats !== 4;
/** The Superliga table of four players and two bots. */
export const COMPETITIVE_BOT_SEATS = 2;
/** Seats people take in the lobby; bots fill the rest at the start. */
export const humanSeats = (state: {
  readonly configuredPlayerCount: number;
  readonly competitiveBotSeats?: number | undefined;
}): number => state.configuredPlayerCount - (state.competitiveBotSeats ?? 0);
