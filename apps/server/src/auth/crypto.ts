import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';

import type { RecoveryVerifier, SessionVerifier } from './types.js';

const scrypt = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) =>
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) =>
      error ? reject(error) : resolve(derivedKey),
    ),
  );
const recoveryAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const recoveryGroups = 5;
const recoveryGroupLength = 5;

export const generateSessionToken = (): string =>
  randomBytes(32).toString('base64url');

export function generateRecoveryCode(): string {
  const bytes = randomBytes(recoveryGroups * recoveryGroupLength);
  const characters = [...bytes].map(
    (value) => recoveryAlphabet[value % recoveryAlphabet.length],
  );
  return Array.from({ length: recoveryGroups }, (_, group) =>
    characters
      .slice(group * recoveryGroupLength, (group + 1) * recoveryGroupLength)
      .join(''),
  ).join('-');
}

const normalizeRecoveryCode = (value: string): string =>
  value.trim().toUpperCase();

export const hashSessionToken = (token: string): SessionVerifier => ({
  algorithm: 'sha256',
  digest: createHash('sha256').update(token, 'utf8').digest('base64url'),
});

export function verifySessionToken(
  token: string,
  verifier: SessionVerifier,
): boolean {
  const actual = Buffer.from(hashSessionToken(token).digest, 'base64url');
  const expected = Buffer.from(verifier.digest, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashRecoveryCode(
  recoveryCode: string,
): Promise<RecoveryVerifier> {
  const salt = randomBytes(16);
  const digest = await scrypt(normalizeRecoveryCode(recoveryCode), salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64url'),
    digest: digest.toString('base64url'),
    keyLength: 32,
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
  };
}

export async function verifyRecoveryCode(
  recoveryCode: string,
  verifier: RecoveryVerifier,
): Promise<boolean> {
  const expected = Buffer.from(verifier.digest, 'base64url');
  const actual = await scrypt(
    normalizeRecoveryCode(recoveryCode),
    Buffer.from(verifier.salt, 'base64url'),
    verifier.keyLength,
    {
      N: verifier.cost,
      r: verifier.blockSize,
      p: verifier.parallelization,
      maxmem: 64 * 1024 * 1024,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
