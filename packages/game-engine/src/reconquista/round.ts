/** D24–D27, isolated development rules. No productive runtime registration. */
import {
  CRISIS_TIEBREAK_LIMIT,
  integer,
  RECONQUISTA_COLORS,
  resolveReconquistaCrisis,
  unique,
  type ReconquistaCrisis,
} from './contracts.js';
import {
  assertSituationDeck,
  type SituationCard,
  type SituationDeck,
} from './situations.js';
import type { PreparationRandom } from './preparation.js';

export interface SituationCycle {
  readonly kind: 'reconquista-cycle';
  readonly version: 1;
  readonly drawPile: readonly SituationCard[];
  readonly discards: readonly SituationCard[];
  readonly active: SituationCard | null;
  readonly reshuffles: number;
}
export function initialSituationCycle(deck: SituationDeck): SituationCycle {
  assertSituationDeck(deck);
  if (deck.nextIndex !== 0) throw new Error('Expected unused deck');
  return {
    kind: 'reconquista-cycle',
    version: 1,
    drawPile: deck.cards.map((c) => ({ ...c })),
    discards: [],
    active: null,
    reshuffles: 0,
  };
}
export function assertSituationCycle(cycle: SituationCycle): void {
  if (cycle.kind !== 'reconquista-cycle' || cycle.version !== 1)
    throw new Error('Unknown situation cycle');
  integer(cycle.reshuffles);
  assertSituationDeck({
    kind: 'reconquista-situations',
    version: 1,
    cards: [
      ...cycle.drawPile,
      ...cycle.discards,
      ...(cycle.active ? [cycle.active] : []),
    ],
    nextIndex: 0,
  });
}
function randomDraw(random: PreparationRandom): number {
  const n = random();
  if (!Number.isFinite(n) || n < 0 || n >= 1)
    throw new Error('Invalid round RNG');
  return n;
}
interface RoundParticipant {
  readonly id: string;
  readonly color: string;
}
export interface ActivatedSituation {
  readonly cycle: SituationCycle;
  readonly skipped: readonly SituationCard[];
  readonly crisis: ReconquistaCrisis | null;
  readonly restingPlayerId: string | null;
}
/** Participants are the surviving players. A replacement is committed only after a legal draw. */
export function activateSituation(
  cycle: SituationCycle,
  participants: readonly RoundParticipant[],
  random: PreparationRandom,
): ActivatedSituation {
  assertSituationCycle(cycle);
  if (participants.length < 2 || participants.length > 6)
    throw new Error('Expected 2–6 active players');
  unique(participants.map((p) => p.id));
  unique(participants.map((p) => p.color));
  if (
    participants.some(
      (p) => !p.id || !RECONQUISTA_COLORS.some((c) => c === p.color),
    )
  )
    throw new Error('Invalid participant');
  let drawPile = cycle.drawPile.map((c) => ({ ...c }));
  let discards = cycle.discards.map((c) => ({ ...c }));
  let reshuffles = cycle.reshuffles;
  const skipped: SituationCard[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    if (drawPile.length === 0) {
      drawPile = discards;
      discards = [];
      if (!drawPile.length)
        throw new Error('No cards available for replacement');
      for (let i = drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(randomDraw(random) * (i + 1));
        [drawPile[i], drawPile[j]] = [drawPile[j]!, drawPile[i]!];
      }
      reshuffles++;
    }
    const card = drawPile.shift()!;
    const resting = card.typeId.startsWith('rest_')
      ? participants.find((p) => p.color === card.typeId.slice(5))
      : undefined;
    if (card.typeId.startsWith('rest_') && !resting) {
      discards.push(card);
      skipped.push(card);
      continue;
    }
    if (cycle.active) discards.push({ ...cycle.active });
    const next: SituationCycle = {
      ...cycle,
      drawPile,
      discards,
      active: card,
      reshuffles,
    };
    assertSituationCycle(next);
    return {
      cycle: next,
      skipped,
      restingPlayerId: resting?.id ?? null,
      crisis:
        card.typeId === 'crisis'
          ? rollCrisis(
              participants.map((p) => p.id),
              random,
            )
          : null,
    };
  }
  throw new Error('Situation replacement failed to reach a participating card');
}

/** D77: tied lowest players roll again until one remains. */
function rollCrisis(ids: readonly string[], random: PreparationRandom) {
  const die = () => Math.floor(randomDraw(random) * 6) + 1;
  const rolls = ids.map(die);
  const tiebreaks: number[][] = [];
  let tied = ids.filter((_, i) => rolls[i] === Math.min(...rolls));
  while (tied.length > 1 && tiebreaks.length < CRISIS_TIEBREAK_LIMIT) {
    const dice = tied.map(die);
    tiebreaks.push(dice);
    tied = tied.filter((_, i) => dice[i] === Math.min(...dice));
  }
  return resolveReconquistaCrisis(ids, rolls, tiebreaks);
}
export function combatDice(
  attackerArmies: number,
  defenderArmies: number,
  situationType: string,
) {
  integer(attackerArmies, 2);
  integer(defenderArmies, 1);
  let attack = Math.min(3, attackerArmies - 1);
  if (defenderArmies >= 3 && attackerArmies >= 2 * defenderArmies) attack = 4;
  if (situationType === 'tailwind') attack = Math.min(4, attack + 1);
  const defense = Math.min(
    4,
    Math.min(3, defenderArmies) + (situationType === 'snow' ? 1 : 0),
  );
  return { attack, defense };
}
export function resolveReconquistaCombat(
  attackerArmies: number,
  defenderArmies: number,
  situationType: string,
  random: PreparationRandom,
) {
  const dice = combatDice(attackerArmies, defenderArmies, situationType);
  const attackRolls = Array.from(
    { length: dice.attack },
    () => Math.floor(randomDraw(random) * 6) + 1,
  ).toSorted((a, b) => b - a);
  const defenseRolls = Array.from(
    { length: dice.defense },
    () => Math.floor(randomDraw(random) * 6) + 1,
  ).toSorted((a, b) => b - a);
  let attackLoss = 0,
    defenseLoss = 0;
  for (let i = 0; i < Math.min(dice.attack, dice.defense); i++) {
    if (attackRolls[i]! > defenseRolls[i]!) defenseLoss++;
    else attackLoss++;
  }
  return {
    attackRolls,
    defenseRolls,
    attackLoss: Math.min(attackLoss, attackerArmies - 1),
    defenseLoss: Math.min(defenseLoss, defenderArmies),
  };
}
/** Only source/destination continents: missile path restrictions remain P10. */
export function permitsDiceAttack(
  situationType: string,
  originContinent: string,
  targetContinent: string,
): boolean {
  if (situationType === 'open_borders')
    return originContinent !== targetContinent;
  if (situationType === 'closed_borders')
    return originContinent === targetContinent;
  return true;
}
