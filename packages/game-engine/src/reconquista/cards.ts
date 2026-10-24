/** Reconquista cards: D36–D42. Pure helpers; all randomness is journalled by the caller. */
import { integer, unique } from './contracts.js';
import type { PreparationRandom } from './preparation.js';
export type CountrySymbol =
  | 'plane'
  | 'tank_grenade'
  | 'ship'
  | 'soldier_wildcard'
  | 'supercard'
  | 'wildcard';
export interface CountryCard {
  id: string;
  countryId: string | null;
  symbol: CountrySymbol;
}
export interface HeldCountryCard extends CountryCard {
  acquisition: 'draw' | 'inheritance';
  bonusUsed: boolean;
}
export interface CardsState {
  drawPile: CountryCard[];
  discards: CountryCard[];
  hands: Record<string, HeldCountryCard[]>;
  exchanges: Record<string, number>;
  exchangedRound: Record<string, number>;
  continents: Record<string, { holderId: string | null; usedBy: string[] }>;
  lastExchange: {
    playerId: string;
    countryCardIds: string[];
    countryCards: CountryCard[];
    continentIds: string[];
    armies: number;
  } | null;
}
export function shuffleCards<T>(
  values: readonly T[],
  random: PreparationRandom,
): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const n = random();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw Error('Invalid card RNG');
    const j = Math.floor(n * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function createCards(
  catalog: unknown,
  players: readonly string[],
  random: PreparationRandom,
): CardsState {
  const c = catalog as {
    territories: { id: string; printedSymbols: string }[];
    continents: { id: string }[];
    standaloneWildcardCount: number;
  };
  if (c.standaloneWildcardCount !== 1)
    throw Error('Expected one standalone wildcard');
  const cards: CountryCard[] = c.territories.map((t) => ({
    id: t.id,
    countryId: t.id,
    symbol: (t.printedSymbols === 'soldier'
      ? 'soldier_wildcard'
      : t.printedSymbols === 'triple'
        ? 'supercard'
        : t.printedSymbols) as CountrySymbol,
  }));
  cards.push({
    id: 'standalone-wildcard',
    countryId: null,
    symbol: 'wildcard',
  });
  unique(cards.map((c) => c.id));
  return {
    drawPile: shuffleCards(cards, random),
    discards: [],
    hands: Object.fromEntries(players.map((id) => [id, []])),
    exchanges: Object.fromEntries(players.map((id) => [id, 0])),
    exchangedRound: {},
    continents: Object.fromEntries(
      c.continents.map((c) => [c.id, { holderId: null, usedBy: [] }]),
    ),
    lastExchange: null,
  };
}
const continentSymbols: Record<string, string[]> = {
  asia: ['complete'],
  europe: ['complete'],
  north_america: ['complete'],
  south_america: ['plane', 'tank_grenade'],
  africa: ['plane', 'ship'],
  central_america: ['tank_grenade'],
  oceania: ['ship'],
};
/** A continent is atomic: its printed variables cannot be split/discarded selectively. */
export function isExchange(
  cards: readonly CountryCard[],
  continents: readonly string[],
): boolean {
  const symbols = [
    ...cards.map((c) => c.symbol),
    ...continents.flatMap((id) => continentSymbols[id] ?? ['invalid']),
  ];
  if (symbols.length === 1 && ['supercard', 'complete'].includes(symbols[0]!))
    return true;
  if (
    symbols.length !== 3 ||
    symbols.some((s) => ['supercard', 'complete', 'invalid'].includes(s))
  )
    return false;
  const ordinary = symbols.filter(
    (s) => s !== 'soldier_wildcard' && s !== 'wildcard',
  );
  return (
    new Set(ordinary).size <= 1 || new Set(ordinary).size === ordinary.length
  );
}
/** Every valid exchange the player could make now, so the screen offers only those. */
export function exchangeOptions(
  state: CardsState,
  playerId: string,
): { cardIds: string[]; continentIds: string[] }[] {
  const hand = state.hands[playerId] ?? [];
  const continents = Object.entries(state.continents)
    .filter(([, c]) => c.holderId === playerId && !c.usedBy.includes(playerId))
    .map(([id]) => id);
  const items = [
    ...hand.map((card) => ({ card, continent: null })),
    ...continents.map((continent) => ({ card: null, continent })),
  ];
  const options: { cardIds: string[]; continentIds: string[] }[] = [];
  // Exchanges use at most three symbols, so subsets of up to three items cover them.
  const visit = (start: number, chosen: typeof items) => {
    if (chosen.length) {
      const cards = chosen.flatMap((i) => (i.card ? [i.card] : []));
      const ids = chosen.flatMap((i) => (i.continent ? [i.continent] : []));
      if (isExchange(cards, ids))
        options.push({ cardIds: cards.map((c) => c.id), continentIds: ids });
    }
    if (chosen.length === 3) return;
    for (let i = start; i < items.length; i++)
      visit(i + 1, [...chosen, items[i]!]);
  };
  visit(0, []);
  return options;
}
export function exchangeCards(
  state: CardsState,
  playerId: string,
  round: number,
  countryIds: readonly string[],
  continentIds: readonly string[],
): { cards: CardsState; armies: number } {
  unique(countryIds);
  unique(continentIds);
  const hand = state.hands[playerId];
  if (!hand || state.exchangedRound[playerId] === round)
    throw Error('Exchange unavailable this round');
  const selected = countryIds.map((id) => {
    const c = hand.find((c) => c.id === id);
    if (!c) throw Error('Foreign exchange card');
    return c;
  });
  if (
    continentIds.some(
      (id) =>
        state.continents[id]?.holderId !== playerId ||
        state.continents[id].usedBy.includes(playerId),
    )
  )
    throw Error('Foreign or spent continent');
  if (!isExchange(selected, continentIds))
    throw Error('Invalid exchange combination');
  const count = integer(state.exchanges[playerId]!) + 1;
  const armies = count === 1 ? 6 : count === 2 ? 10 : count * 5;
  const next = structuredClone(state);
  next.hands[playerId] = hand.filter((c) => !countryIds.includes(c.id));
  next.discards.push(
    ...selected.map(({ id, countryId, symbol }) => ({ id, countryId, symbol })),
  );
  next.exchanges[playerId] = count;
  next.exchangedRound[playerId] = round;
  for (const id of continentIds) {
    next.continents[id]!.holderId = null;
    next.continents[id]!.usedBy.push(playerId);
  }
  next.lastExchange = {
    playerId,
    countryCardIds: [...countryIds],
    countryCards: selected.map(({ id, countryId, symbol }) => ({
      id,
      countryId,
      symbol,
    })),
    continentIds: [...continentIds],
    armies,
  };
  return { cards: next, armies };
}
export function drawCountryCard(
  state: CardsState,
  playerId: string,
  random: PreparationRandom,
): CardsState {
  if (!state.hands[playerId] || state.hands[playerId].length >= 5)
    throw Error('Country hand full');
  const next = structuredClone(state);
  if (next.drawPile.length === 0) {
    next.drawPile = shuffleCards(next.discards, random);
    next.discards = [];
  }
  const card = next.drawPile.shift();
  if (!card) throw Error('Country deck empty');
  next.hands[playerId]!.push({
    ...card,
    acquisition: 'draw',
    bonusUsed: false,
  });
  return next;
}
export function inheritCountryCards(
  state: CardsState,
  winner: string,
  eliminated: string,
  random: PreparationRandom,
): CardsState {
  const next = structuredClone(state);
  const inherited = shuffleCards(next.hands[eliminated]!, random);
  const take = Math.min(5 - next.hands[winner]!.length, inherited.length);
  next.hands[winner]!.push(
    ...inherited.slice(0, take).map((c) => ({
      ...c,
      acquisition: 'inheritance' as const,
      bonusUsed: true,
    })),
  );
  next.hands[eliminated] = [];
  const returned = inherited
    .slice(take)
    .map(({ id, countryId, symbol }) => ({ id, countryId, symbol }));
  if (returned.length)
    next.drawPile = shuffleCards([...next.drawPile, ...returned], random);
  for (const c of Object.values(next.continents))
    if (c.holderId === eliminated) c.holderId = null;
  return next;
}
export function assertCards(
  state: CardsState,
  countryIds: readonly string[],
  playerIds: readonly string[],
): void {
  const all = [
    ...state.drawPile,
    ...state.discards,
    ...Object.values(state.hands).flat(),
  ];
  unique(all.map((c) => c.id));
  if (
    all.length !== countryIds.length + 1 ||
    all.some((c) =>
      c.countryId === null
        ? c.id !== 'standalone-wildcard' || c.symbol !== 'wildcard'
        : c.id !== c.countryId || !countryIds.includes(c.countryId),
    )
  )
    throw Error('Invalid country card conservation');
  for (const [id, hand] of Object.entries(state.hands)) {
    if (!playerIds.includes(id) || hand.length > 5)
      throw Error('Invalid country hand');
    for (const c of hand)
      if (c.acquisition === 'inheritance' && !c.bonusUsed)
        throw Error('Inherited bonus forbidden');
  }
  for (const c of Object.values(state.continents)) {
    unique(c.usedBy);
    if (
      c.usedBy.some((id) => !playerIds.includes(id)) ||
      (c.holderId !== null &&
        (!playerIds.includes(c.holderId) || c.usedBy.includes(c.holderId)))
    )
      throw Error('Invalid continent custody');
  }
}
