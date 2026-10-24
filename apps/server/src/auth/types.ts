import type { PlayerId } from '@game/game-engine';

export const CURRENT_AUTH_SCHEMA_VERSION = 1 as const;

export type TransportClass = 'HTTP' | 'HTTPS';

export interface SessionVerifier {
  readonly algorithm: 'sha256';
  readonly digest: string;
}

export interface RecoveryVerifier {
  readonly algorithm: 'scrypt';
  readonly salt: string;
  readonly digest: string;
  readonly keyLength: 32;
  readonly cost: 16_384;
  readonly blockSize: 8;
  readonly parallelization: 1;
}

export interface ActiveSession {
  readonly verifier: SessionVerifier;
  readonly transportClass: TransportClass;
  readonly expiresAt: string;
  readonly lastActiveAt: string;
}

export interface ClaimCredential {
  readonly verifier: RecoveryVerifier;
  readonly expiresAt: string;
}

export interface PlayerAuthRecord {
  readonly playerId: PlayerId;
  readonly session?: ActiveSession;
  readonly recovery?: RecoveryVerifier;
  readonly claim?: ClaimCredential;
}

export interface GameAuthState {
  readonly authSchemaVersion: typeof CURRENT_AUTH_SCHEMA_VERSION;
  readonly generation: number;
  readonly players: Readonly<Record<string, PlayerAuthRecord>>;
}

export interface AdminAuthState {
  readonly authSchemaVersion: typeof CURRENT_AUTH_SCHEMA_VERSION;
  readonly generation: number;
  readonly recovery: RecoveryVerifier;
  readonly session?: ActiveSession;
}

export interface IssuedSession {
  readonly token: string;
  readonly session: ActiveSession;
}

export const emptyGameAuthState = (): GameAuthState => ({
  authSchemaVersion: CURRENT_AUTH_SCHEMA_VERSION,
  generation: 0,
  players: {},
});
