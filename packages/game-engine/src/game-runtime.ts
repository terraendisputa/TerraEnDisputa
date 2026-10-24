import { resolveGameBoard } from './game-definition.js';
import { assertClassicInvariants } from './invariants.js';
import { deriveLegalActions } from './legal-actions.js';
import { applyCommand } from './rules.js';
import { applySetupCommand, createClassicSetup } from './setup.js';

const classicOperations = {
  createSetup: createClassicSetup,
  applySetupCommand,
  applyCommand,
  assertInvariants: assertClassicInvariants,
  deriveLegalActions,
};

/** The server dispatches all per-game operations through this boundary. */
export function resolveGameRuntime(definition: unknown) {
  // Resolve on demand: importing board data in the browser must not initialize
  // the authoritative runtime and retain its operations in the client bundle.
  return Object.freeze({
    ...classicOperations,
    board: resolveGameBoard(definition),
  });
}
