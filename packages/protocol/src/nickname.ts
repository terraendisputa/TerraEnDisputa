import { z } from 'zod';

// Control, format (zero-width, bidirectional overrides), separator, private
// use and unassigned characters can hide or disguise a name as someone else's.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/u;

/** A player's visible name: trimmed, with no invisible or disguising characters. */
export const nicknameSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !HIDDEN.test(value),
      'Hidden characters are not allowed',
    );

/** Two names that read the same to the other players. */
export const sameNickname = (a: string, b: string) =>
  a.normalize('NFKC').toLocaleLowerCase('es') ===
  b.normalize('NFKC').toLocaleLowerCase('es');
