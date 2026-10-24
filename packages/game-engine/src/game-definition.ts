import { TERRITORIES, TERRITORY_CARDS, TERRITORY_IDS } from './classic-data.js';

/** Only implemented combinations belong here. Reconquista is planned, not playable. */
export const CLASSIC_GAME_DEFINITION = Object.freeze({
  editionId: 'classic',
  boardId: 'classic',
  rulesVersion: 1,
} as const);
export type GameDefinition = typeof CLASSIC_GAME_DEFINITION;

export class UnsupportedGameDefinitionError extends Error {
  readonly code = 'UNSUPPORTED_GAME_DEFINITION';
  constructor() {
    super(
      'Unsupported game definition; supported: classic / classic / rules 1',
    );
    this.name = 'UnsupportedGameDefinitionError';
  }
}

export function resolveGameDefinition(value: unknown): GameDefinition {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('editionId' in value) ||
    value.editionId !== 'classic' ||
    !('boardId' in value) ||
    value.boardId !== 'classic' ||
    !('rulesVersion' in value) ||
    value.rulesVersion !== 1 ||
    Object.keys(value).length !== 3
  )
    throw new UnsupportedGameDefinitionError();
  return CLASSIC_GAME_DEFINITION;
}

const classicBoard = Object.freeze({
  territoryIds: TERRITORY_IDS,
  territories: TERRITORIES,
  territoryCards: TERRITORY_CARDS,
});

/** Data-only resolution is also safe to use in board presentation. */
export function resolveGameBoard(definition: unknown) {
  resolveGameDefinition(definition);
  return classicBoard;
}
