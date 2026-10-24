import type { GameMode } from './domain.js';

export const setupArmies = (mode: GameMode, round: 1 | 2): number =>
  mode === 'competitive' ? 4 : round === 1 ? 5 : 3;
export const validPlayerCount = (mode: GameMode, count: number): boolean =>
  (mode === 'classic' || mode === 'competitive') &&
  Number.isInteger(count) &&
  count >= (mode === 'competitive' ? 4 : 2) &&
  count <= 6;
export const pactsAllowed = (mode: GameMode, count: number): boolean =>
  mode !== 'competitive' || count !== 4;
