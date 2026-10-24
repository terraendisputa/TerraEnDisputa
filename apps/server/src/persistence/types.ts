import type { GameState } from '@game/game-engine';
import type { AdminAuthState, GameAuthState } from '../auth/types.js';

export const CURRENT_GAME_SCHEMA_VERSION = 12 as const;
export const CURRENT_BACKUP_FORMAT_VERSION = 3 as const;
export const CURRENT_MARKER_FORMAT_VERSION = 1 as const;
/** Bounded idempotency window; older commands are protected by stale revisions. */
export const RECENT_COMMAND_RETENTION = 256;

export interface CommittedCommandRecord {
  readonly commandId: string;
  readonly fingerprint: string;
  readonly committedRevision: number;
}

export interface DurableGame {
  readonly state: GameState;
  readonly revision: number;
  readonly recentCommands: readonly CommittedCommandRecord[];
  readonly auth: GameAuthState;
}

export interface PersistedGameEnvelope {
  readonly format: 'ted-snapshot';
  readonly gameSchemaVersion: typeof CURRENT_GAME_SCHEMA_VERSION;
  readonly persistenceGeneration: string;
  readonly game: DurableGame;
}

export interface PersistedAdminAuthEnvelope {
  readonly format: 'classic-admin-auth';
  readonly authSchemaVersion: 1;
  readonly auth: AdminAuthState;
}

export type GameLoadFailureCode =
  'CORRUPT' | 'INVALID_STATE' | 'UNSUPPORTED_SCHEMA';

export interface GameLoadFailure {
  readonly fileName: string;
  readonly gameId?: string;
  readonly code: GameLoadFailureCode;
  readonly message: string;
}

export interface DiscoveryResult {
  readonly games: ReadonlyMap<string, DurableGame>;
  readonly failures: readonly GameLoadFailure[];
}

export interface GameStorageStatus {
  readonly writable: boolean;
  readonly outcome?: 'FAILED' | 'INDETERMINATE';
  readonly lastError?: string;
}

export interface CommitResult {
  readonly outcome: 'COMMITTED';
  readonly cleanupError?: string;
}

export interface BackupManifest {
  readonly backupFormatVersion: typeof CURRENT_BACKUP_FORMAT_VERSION;
  readonly serverVersion: string;
  readonly createdAt: string;
  readonly gameCount: number;
  readonly reconquistaGameCount: number;
}
