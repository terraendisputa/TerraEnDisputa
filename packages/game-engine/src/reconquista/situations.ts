/** D20: development deck only. No effects, automatic recycling or playable admission. */
import { RECONQUISTA_COLORS, validateReconquistaCatalog } from './contracts.js';
import type { PreparationRandom } from './preparation.js';
const COPIES: Readonly<Record<string, number>> = Object.freeze({
  classic_combat: 20,
  snow: 4,
  tailwind: 4,
  crisis: 4,
  extra_reinforcements: 4,
  open_borders: 4,
  closed_borders: 4,
  ...Object.fromEntries(
    RECONQUISTA_COLORS.map((color) => [`rest_${color}`, 1]),
  ),
});
export interface SituationCard {
  readonly id: string;
  readonly typeId: string;
}
export interface SituationDeck {
  readonly kind: 'reconquista-situations';
  readonly version: 1;
  readonly cards: readonly SituationCard[];
  readonly nextIndex: number;
}
export class SituationDeckExhaustedError extends Error {
  constructor() {
    super('Situation deck exhausted: recycling policy has not been approved');
    this.name = 'SituationDeckExhaustedError';
  }
}
export function assertSituationDeck(deck: SituationDeck): void {
  if (
    deck.kind !== 'reconquista-situations' ||
    deck.version !== 1 ||
    !Number.isSafeInteger(deck.nextIndex) ||
    deck.nextIndex < 0 ||
    deck.nextIndex > 50 ||
    deck.cards.length !== 50
  )
    throw new Error('Invalid development situation deck');
  const expected = new Set(
    Object.entries(COPIES).flatMap(([type, count]) =>
      Array.from({ length: count }, (_, i) => `${type}#${i + 1}`),
    ),
  );
  for (const card of deck.cards) {
    if (
      !Object.hasOwn(COPIES, card.typeId) ||
      !card.id.startsWith(`${card.typeId}#`) ||
      !expected.delete(card.id)
    )
      throw new Error('Invalid situation identity or multiplicity');
  }
  if (expected.size !== 0) throw new Error('Incomplete situation deck');
}
/** Equal shuffle weight per physical copy, not per type. Injected RNG in [0,1). */
export function createSituationDeck(
  catalog: unknown,
  random: PreparationRandom,
): SituationDeck {
  validateReconquistaCatalog(catalog);
  const cards = Object.entries(COPIES).flatMap(([typeId, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${typeId}#${i + 1}`,
      typeId,
    })),
  );
  for (let i = cards.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error('Invalid situation RNG draw');
    const j = Math.floor(value * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  const deck: SituationDeck = {
    kind: 'reconquista-situations',
    version: 1,
    cards,
    nextIndex: 0,
  };
  assertSituationDeck(deck);
  return deck;
}
/** Draw consumes no RNG. Activation, rest filtering and deduplication belong to later boundaries. */
export function drawSituation(deck: SituationDeck): {
  readonly card: SituationCard;
  readonly deck: SituationDeck;
} {
  assertSituationDeck(deck);
  if (deck.nextIndex === deck.cards.length)
    throw new SituationDeckExhaustedError();
  return {
    card: { ...deck.cards[deck.nextIndex]! },
    deck: {
      ...deck,
      cards: deck.cards.map((c) => ({ ...c })),
      nextIndex: deck.nextIndex + 1,
    },
  };
}
