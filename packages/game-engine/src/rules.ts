import { recordCompetitiveElimination } from './competitive-results.js';
import { pactsAllowed } from './mode-policy.js';
import {
  CONTINENTS,
  SECRET_OBJECTIVES,
  TERRITORIES,
  TERRITORY_CARDS,
  TERRITORY_IDS,
  type ContinentId,
  type SecretObjectiveId,
  type TerritoryCardId,
  type TerritoryId,
} from './classic-data.js';
import type {
  ActiveGameState,
  FinishedGameState,
  GameState,
  PactId,
  PactProposalId,
  PactTerms,
  PlayerId,
  TerritoryCardPossession,
  VictoryReason,
} from './domain.js';

export type DomainErrorCode =
  | 'GAME_PAUSED'
  | 'PLAYER_DISQUALIFIED'
  | 'INVALID_INHERITANCE'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_FINISHED'
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'PENDING_ACTION'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_ELIMINATED'
  | 'INVALID_TERRITORY'
  | 'NOT_OWNER'
  | 'NOT_ADJACENT'
  | 'INSUFFICIENT_ARMIES'
  | 'PACT_PROHIBITS_ATTACK'
  | 'SUICIDE_ATTACK'
  | 'INVALID_DICE'
  | 'INVALID_TRANSFER'
  | 'INVALID_PLACEMENT'
  | 'INVALID_EXCHANGE'
  | 'MANDATORY_EXCHANGE'
  | 'CARD_LIMIT'
  | 'NOT_ELIGIBLE'
  | 'INVALID_PACT'
  | 'DUPLICATE_PACT'
  | 'PACT_NOT_FOUND'
  | 'PACT_LIMIT'
  | 'PACT_COOLDOWN'
  | 'INTERNATIONAL_ZONE_OBLIGATION';

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}
export type DomainResult<T> =
  | { readonly ok: true; readonly state: T; readonly result?: unknown }
  | { readonly ok: false; readonly error: DomainError };
export interface DiceSource {
  rollDie(): number;
}
export interface ShuffleSource {
  shuffle<T>(values: readonly T[]): readonly T[];
}

export type GameplayCommand =
  | {
      readonly type: 'select_inherited_cards';
      readonly playerId: PlayerId;
      readonly cardIds: readonly TerritoryCardId[];
    }
  | {
      readonly type: 'place_reinforcements';
      readonly playerId: PlayerId;
      readonly placements: Readonly<Partial<Record<TerritoryId, number>>>;
    }
  | { readonly type: 'advance_phase'; readonly playerId: PlayerId }
  | {
      readonly type: 'exchange_cards';
      readonly playerId: PlayerId;
      readonly cardIds: readonly [
        TerritoryCardId,
        TerritoryCardId,
        TerritoryCardId,
      ];
    }
  | {
      readonly type: 'attack';
      readonly playerId: PlayerId;
      readonly from: TerritoryId;
      readonly to: TerritoryId;
    }
  | {
      readonly type: 'complete_conquest_transfer';
      readonly playerId: PlayerId;
      readonly armies: 1 | 2 | 3;
    }
  | {
      readonly type: 'regroup';
      readonly playerId: PlayerId;
      readonly from: TerritoryId;
      readonly to: TerritoryId;
      readonly armies: number;
    }
  | { readonly type: 'claim_card'; readonly playerId: PlayerId }
  | {
      readonly type: 'claim_territory_bonus';
      readonly playerId: PlayerId;
      readonly cardId: TerritoryCardId;
    }
  | { readonly type: 'end_turn'; readonly playerId: PlayerId }
  | {
      readonly type: 'propose_pact';
      readonly playerId: PlayerId;
      readonly proposalId: PactProposalId;
      readonly recipientId: PlayerId;
      readonly terms: PactTerms;
    }
  | {
      readonly type: 'reject_pact' | 'cancel_pact';
      readonly playerId: PlayerId;
      readonly proposalId: PactProposalId;
    }
  | {
      readonly type: 'accept_pact';
      readonly playerId: PlayerId;
      readonly proposalId: PactProposalId;
      readonly pactId: PactId;
    }
  | {
      readonly type: 'withdraw_pact';
      readonly playerId: PlayerId;
      readonly pactId: PactId;
    };

const reject = <T>(code: DomainErrorCode, message = code): DomainResult<T> => ({
  ok: false,
  error: { code, message },
});
const accepted = <T>(state: T, result?: unknown): DomainResult<T> =>
  result === undefined ? { ok: true, state } : { ok: true, state, result };
const isPositiveInteger = (value: number): boolean =>
  Number.isFinite(value) && Number.isInteger(value) && value > 0;
type RuleEvaluationState = Pick<
  ActiveGameState,
  'players' | 'territories' | 'commonVictoryCondition' | 'mode'
>;
const player = (s: Pick<ActiveGameState, 'players'>, id: PlayerId) =>
  s.players.find((p) => p.id === id);
const ownedIds = (s: Pick<ActiveGameState, 'territories'>, id: PlayerId) =>
  TERRITORY_IDS.filter((t) => s.territories[t].ownerId === id);
const ownsContinent = (
  s: ActiveGameState,
  id: PlayerId,
  continent: ContinentId,
) =>
  CONTINENTS[continent].territoryIds.every(
    (t) => s.territories[t].ownerId === id,
  );

export function baseReinforcements(territoryCount: number): number {
  return territoryCount < 6 ? 3 : Math.floor(territoryCount / 2);
}
export function continentBonuses(
  state: ActiveGameState,
  playerId: PlayerId,
): Readonly<Partial<Record<ContinentId, number>>> {
  return Object.fromEntries(
    Object.values(CONTINENTS)
      .filter((c) => ownsContinent(state, playerId, c.id))
      .map((c) => [c.id, c.reinforcementBonus]),
  );
}
export function exchangeValue(completedCount: number): number {
  const ordinal = completedCount + 1;
  return ordinal <= 3 ? 1 + ordinal * 3 : ordinal * 5 - 5;
}
export function isLegalExchange(cards: readonly TerritoryCardId[]): boolean {
  if (cards.length !== 3 || new Set(cards).size !== 3) return false;
  const symbols = cards.map((id) => TERRITORY_CARDS[id].symbol);
  const wild = symbols.filter((s) => s === 'wildcard').length;
  const ordinary = symbols.filter((s) => s !== 'wildcard');
  const counts = new Map(
    ordinary.map((s) => [s, ordinary.filter((x) => x === s).length]),
  );
  return (
    [...counts.values()].some((n) => n + wild === 3) ||
    new Set(ordinary).size + wild === 3
  );
}
export function hasLegalExchange(
  cards: readonly TerritoryCardPossession[],
): boolean {
  for (let a = 0; a < cards.length - 2; a++)
    for (let b = a + 1; b < cards.length - 1; b++)
      for (let c = b + 1; c < cards.length; c++) {
        const x = cards[a],
          y = cards[b],
          z = cards[c];
        if (x && y && z && isLegalExchange([x.cardId, y.cardId, z.cardId]))
          return true;
      }
  return false;
}
export interface CombatResolution {
  readonly attackerDice: readonly number[];
  readonly defenderDice: readonly number[];
  readonly attackerLosses: number;
  readonly defenderLosses: number;
}
export function resolveCombat(
  attackerArmies: number,
  defenderArmies: number,
  dice: DiceSource,
): DomainResult<CombatResolution> {
  if (attackerArmies < 2 || defenderArmies < 1)
    return reject('INSUFFICIENT_ARMIES');
  const roll = (count: number): readonly number[] | undefined => {
    const values = Array.from({ length: count }, () => dice.rollDie());
    return values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)
      ? [...values].sort((a, b) => b - a)
      : undefined;
  };
  const attackerDice = roll(Math.min(3, attackerArmies - 1));
  const defenderDice = roll(Math.min(3, defenderArmies));
  if (!attackerDice || !defenderDice) return reject('INVALID_DICE');
  let attackerLosses = 0,
    defenderLosses = 0;
  for (let i = 0; i < Math.min(attackerDice.length, defenderDice.length); i++) {
    if ((attackerDice[i] ?? 0) > (defenderDice[i] ?? 0)) defenderLosses++;
    else attackerLosses++;
  }
  return accepted({
    attackerDice,
    defenderDice,
    attackerLosses,
    defenderLosses,
  });
}
export function hasPairwiseAdjacentTerritoryTrio(
  state: Pick<ActiveGameState, 'territories'>,
  id: PlayerId,
): boolean {
  const ids = ownedIds(state, id);
  return ids.some((a, i) =>
    ids
      .slice(i + 1)
      .some(
        (b, j) =>
          TERRITORIES[a].adjacentTerritoryIds.includes(b) &&
          ids
            .slice(i + j + 2)
            .some(
              (c) =>
                TERRITORIES[a].adjacentTerritoryIds.includes(c) &&
                TERRITORIES[b].adjacentTerritoryIds.includes(c),
            ),
      ),
  );
}
export function secretObjectiveSatisfied(
  state: Pick<ActiveGameState, 'players' | 'territories'>,
  playerId: PlayerId,
  objectiveId: SecretObjectiveId,
): boolean {
  const objective = SECRET_OBJECTIVES[objectiveId];
  if (objective.kind === 'destruction') {
    const p = player(state, playerId);
    return (
      p?.effectiveDestructionTargetPlayerId !== undefined &&
      player(state, p.effectiveDestructionTargetPlayerId)?.eliminated === true
    );
  }
  const counts = new Map<ContinentId, number>();
  for (const id of ownedIds(state, playerId)) {
    const c = TERRITORIES[id].continentId;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return (
    Object.entries(objective.continentMinimums).every(
      ([c, n]) => (counts.get(c as ContinentId) ?? 0) >= n,
    ) &&
    (!('requiresPairwiseAdjacentTerritoryTrio' in objective) ||
      hasPairwiseAdjacentTerritoryTrio(state, playerId))
  );
}
export function victoryReason(
  state: RuleEvaluationState,
  playerId: PlayerId,
): VictoryReason | undefined {
  const p = player(state, playerId);
  if (p?.disqualified) return undefined;
  if (
    state.mode === 'competitive' &&
    ownedIds(state, playerId).length >=
      state.commonVictoryCondition.territoryCount
  )
    return state.commonVictoryCondition;
  if (
    p?.secretObjectiveId &&
    secretObjectiveSatisfied(state, playerId, p.secretObjectiveId)
  )
    return { kind: 'secret_objective', objectiveId: p.secretObjectiveId };
  const count = ownedIds(state, playerId).length;
  return count >= state.commonVictoryCondition.territoryCount
    ? state.commonVictoryCondition
    : undefined;
}
function finishIfWon(
  state: ActiveGameState,
  id: PlayerId,
): ActiveGameState | FinishedGameState {
  const reason = victoryReason(state, id);
  return reason
    ? {
        ...state,
        status: 'FINISHED',
        result: {
          winnerId: id,
          victoryReason: reason,
          ...(state.competitiveClock
            ? { scoringEligible: state.competitiveClock.completedRounds >= 6 }
            : {}),
        },
      }
    : state;
}
function assertTurn(
  s: ActiveGameState,
  id: PlayerId,
): DomainResult<ActiveGameState> | undefined {
  const p = player(s, id);
  if (!p) return reject('UNKNOWN_PLAYER');
  if (p.disqualified) return reject('PLAYER_DISQUALIFIED');
  if (p.eliminated) return reject('PLAYER_ELIMINATED');
  if (s.turn.playerId !== id) return reject('NOT_YOUR_TURN');
  if (s.pendingAction) return reject('PENDING_ACTION');
  return undefined;
}
export function pactBlocks(
  s: ActiveGameState,
  a: PlayerId,
  d: PlayerId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  const waiting = (s.pacts.competitiveWithdrawals ?? []).some(
    (p) =>
      p.withdrawingPlayerId === a &&
      p.recipientId === d &&
      (p.terms.kind === 'general_non_aggression' ||
        (p.terms.kind === 'border_non_aggression' &&
          p.terms.territoryIds.includes(from) &&
          p.terms.territoryIds.includes(to)) ||
        (p.terms.kind === 'international_zone' && p.terms.territoryId === to)),
  );
  return (
    waiting ||
    s.pacts.active.some((p) => {
      if (p.kind === 'international_zone') return false;
      const parties = p.parties.includes(a) && p.parties.includes(d);
      if (!parties) return false;
      return (
        p.kind === 'general_non_aggression' ||
        (p.terms.kind === 'border_non_aggression' &&
          p.terms.territoryIds.includes(from) &&
          p.terms.territoryIds.includes(to))
      );
    })
  );
}
/**
 * Competitive forbids attacking from a player's only territory while it holds
 * four armies or fewer, so nobody can throw their last armies away.
 */
export function suicideBlocks(
  s: Pick<ActiveGameState, 'mode' | 'territories'>,
  pid: PlayerId,
  from: TerritoryId,
): boolean {
  return (
    s.mode === 'competitive' &&
    s.territories[from].armies <= 4 &&
    ownedIds(s, pid).length === 1
  );
}
function zoneAttackAvailable(
  s: ActiveGameState,
  pid: PlayerId,
  pact: Extract<
    ActiveGameState['pacts']['active'][number],
    { kind: 'international_zone' }
  >,
): boolean {
  const z = pact.terms.territoryId;
  const defenderId = s.territories[z].ownerId;
  return (
    defenderId !== undefined &&
    defenderId !== pid &&
    TERRITORIES[z].adjacentTerritoryIds.some(
      (t) =>
        s.territories[t].ownerId === pid &&
        s.territories[t].armies >= 2 &&
        !pactBlocks(s, pid, defenderId, t, z),
    )
  );
}
function zoneRouteAvailable(
  s: ActiveGameState,
  expectedId: PlayerId,
  zone: TerritoryId,
  additionalBlockedBorder?: readonly [TerritoryId, TerritoryId],
): boolean {
  const holderId = s.territories[zone].ownerId;
  if (!holderId || holderId === expectedId) return false;
  return TERRITORIES[zone].adjacentTerritoryIds.some(
    (source) =>
      s.territories[source].ownerId === expectedId &&
      !pactBlocks(s, expectedId, holderId, source, zone) &&
      !(
        additionalBlockedBorder?.includes(source) &&
        additionalBlockedBorder.includes(zone)
      ),
  );
}
export function blockedByZone(s: ActiveGameState, pid: PlayerId): boolean {
  return s.pacts.active.some(
    (p) =>
      p.kind === 'international_zone' &&
      p.expectedConquerorId === pid &&
      zoneAttackAvailable(s, pid, p),
  );
}
function cleanInternationalZones(s: ActiveGameState): ActiveGameState {
  if (s.mode === 'competitive') {
    const alive = (id: PlayerId) => {
      const p = player(s, id);
      return p !== undefined && !p.eliminated && !p.disqualified;
    };
    s = {
      ...s,
      pacts: {
        ...s.pacts,
        proposals: s.pacts.proposals.filter(
          (p) => alive(p.proposerId) && alive(p.recipientId),
        ),
        active: s.pacts.active.filter((p) => p.parties.every(alive)),
        ...(s.pacts.competitiveWithdrawals
          ? {
              competitiveWithdrawals: s.pacts.competitiveWithdrawals.filter(
                (p) =>
                  p.parties.every(alive) &&
                  (p.terms.kind === 'general_non_aggression' ||
                    (p.terms.kind === 'international_zone'
                      ? p.parties.includes(
                          s.territories[p.terms.territoryId].ownerId!,
                        )
                      : p.terms.territoryIds.every((t) =>
                          p.parties.includes(s.territories[t].ownerId!),
                        ))),
              ),
            }
          : {}),
      },
    };
  }
  const active = s.pacts.active.filter((p) => {
    if (p.kind !== 'international_zone') return true;
    const [first, second] = p.parties;
    const firstPlayer = player(s, first),
      secondPlayer = player(s, second);
    if (
      !firstPlayer ||
      !secondPlayer ||
      firstPlayer.eliminated ||
      secondPlayer.eliminated
    )
      return false;
    const zone = p.terms.territoryId,
      holderId = s.territories[zone].ownerId;
    const pendingConquest =
      s.pendingAction?.kind === 'conquest_transfer' &&
      s.pendingAction.conqueredTerritoryId === zone;
    if (
      s.territories[zone].armies !== (pendingConquest ? 0 : 1) ||
      !holderId ||
      !p.parties.includes(holderId) ||
      holderId === p.expectedConquerorId
    )
      return false;
    const neighbors = TERRITORIES[zone].adjacentTerritoryIds;
    return (
      neighbors.some((t) => s.territories[t].ownerId === holderId) &&
      zoneRouteAvailable(s, p.expectedConquerorId, zone)
    );
  });
  return active.length === s.pacts.active.length
    ? s
    : { ...s, pacts: { ...s.pacts, active } };
}
export function isActiveInternationalZone(
  s: ActiveGameState,
  territoryId: TerritoryId,
): boolean {
  return s.pacts.active.some(
    (p) =>
      p.kind === 'international_zone' && p.terms.territoryId === territoryId,
  );
}
function terminateImpossibleZonesAfterCombat(
  s: ActiveGameState,
  playerId: PlayerId,
): ActiveGameState {
  const active = s.pacts.active.filter(
    (p) =>
      p.kind !== 'international_zone' ||
      p.expectedConquerorId !== playerId ||
      zoneAttackAvailable(s, playerId, p),
  );
  return active.length === s.pacts.active.length
    ? s
    : { ...s, pacts: { ...s.pacts, active } };
}

function normalizedParties(a: PlayerId, b: PlayerId): string {
  return [a, b].sort().join('|');
}
function normalizedTerms(terms: PactTerms): string {
  if (terms.kind === 'general_non_aggression') return terms.kind;
  if (terms.kind === 'border_non_aggression')
    return `${terms.kind}:${[...terms.territoryIds].sort().join('|')}`;
  return `${terms.kind}:${terms.territoryId}`;
}
function samePact(
  a: {
    readonly proposerId: PlayerId;
    readonly recipientId: PlayerId;
    readonly terms: PactTerms;
  },
  b: {
    readonly parties: readonly [PlayerId, PlayerId];
    readonly terms: PactTerms;
  },
): boolean {
  return (
    normalizedParties(a.proposerId, a.recipientId) ===
      normalizedParties(...b.parties) &&
    normalizedTerms(a.terms) === normalizedTerms(b.terms)
  );
}
function pactConflict(
  s: ActiveGameState,
  proposerId: PlayerId,
  recipientId: PlayerId,
  terms: PactTerms,
): boolean {
  const samePartyPacts = s.pacts.active.filter(
    (p) =>
      normalizedParties(proposerId, recipientId) ===
      normalizedParties(...p.parties),
  );
  if (terms.kind === 'international_zone') {
    if (samePartyPacts.some((p) => p.kind === 'general_non_aggression'))
      return true;
    return !zoneRouteAvailable(s, recipientId, terms.territoryId);
  }
  if (terms.kind === 'general_non_aggression')
    return samePartyPacts.some((p) => p.kind === 'international_zone');
  return samePartyPacts.some(
    (p) =>
      p.kind === 'international_zone' &&
      !zoneRouteAvailable(
        s,
        p.expectedConquerorId,
        p.terms.territoryId,
        terms.territoryIds,
      ),
  );
}
export const PACT_REJECTION_WAIT_MS = 300_000;
/** Game time the proposer still waits after the recipient rejected them. */
export function pactRejectionWaitMs(
  s: Pick<ActiveGameState, 'pacts' | 'competitiveClock'>,
  proposerId: PlayerId,
  recipientId: PlayerId,
): number {
  const rejection = s.pacts.competitiveRejections?.find(
    (r) => r.proposerId === proposerId && r.recipientId === recipientId,
  );
  return rejection
    ? Math.max(
        0,
        rejection.elapsedMs +
          PACT_REJECTION_WAIT_MS -
          (s.competitiveClock?.elapsedMs ?? 0),
      )
    : 0;
}
/** Competitive allows one pact per color, so one proposal per pair at a time. */
export function competitiveProposalError(
  s: ActiveGameState,
  proposerId: PlayerId,
  recipientId: PlayerId,
): DomainErrorCode | undefined {
  if (s.mode !== 'competitive') return undefined;
  const pair = normalizedParties(proposerId, recipientId);
  if (
    s.pacts.proposals.some(
      (p) => normalizedParties(p.proposerId, p.recipientId) === pair,
    )
  )
    return 'PACT_LIMIT';
  if (pactRejectionWaitMs(s, proposerId, recipientId) > 0)
    return 'PACT_COOLDOWN';
  return undefined;
}
function validatePactFormation(
  s: ActiveGameState,
  proposerId: PlayerId,
  recipientId: PlayerId,
  terms: PactTerms,
): DomainErrorCode | undefined {
  if (!pactsAllowed(s.mode, s.configuredPlayerCount, s.competitiveBotSeats))
    return 'INVALID_PACT';
  const proposer = player(s, proposerId),
    recipient = player(s, recipientId);
  if (
    !proposer ||
    !recipient ||
    proposer.eliminated ||
    recipient.eliminated ||
    proposer.disqualified ||
    recipient.disqualified ||
    proposer.absent ||
    recipient.absent ||
    proposer.bot ||
    recipient.bot ||
    proposerId === recipientId
  )
    return 'INVALID_PACT';
  if (s.mode === 'competitive') {
    // Superliga: only border pacts, one per color while it lasts or is being withdrawn.
    if (terms.kind !== 'border_non_aggression') return 'INVALID_PACT';
    const pair = normalizedParties(proposerId, recipientId);
    if (
      [...s.pacts.active, ...(s.pacts.competitiveWithdrawals ?? [])].some(
        (p) => normalizedParties(...p.parties) === pair,
      )
    )
      return 'PACT_LIMIT';
  }
  const candidate = { proposerId, recipientId, terms };
  if (s.pacts.active.some((p) => samePact(candidate, p)))
    return 'DUPLICATE_PACT';
  if (pactConflict(s, proposerId, recipientId, terms)) return 'INVALID_PACT';
  if (terms.kind === 'border_non_aggression') {
    const [a, b] = terms.territoryIds;
    const owners = [s.territories[a].ownerId, s.territories[b].ownerId];
    if (
      !TERRITORIES[a].adjacentTerritoryIds.includes(b) ||
      !owners.includes(proposerId) ||
      !owners.includes(recipientId)
    )
      return 'INVALID_PACT';
  }
  if (terms.kind === 'international_zone') {
    const zone = terms.territoryId,
      neighbors = TERRITORIES[zone].adjacentTerritoryIds;
    if (
      s.territories[zone].ownerId !== proposerId ||
      s.territories[zone].armies !== 1 ||
      terms.firstExpectedConquerorId !== recipientId ||
      !neighbors.some((t) => s.territories[t].ownerId === proposerId) ||
      !neighbors.some((t) => s.territories[t].ownerId === recipientId)
    )
      return 'INVALID_PACT';
  }
  return undefined;
}

export function isPactProposalLegal(
  state: ActiveGameState,
  proposerId: PlayerId,
  recipientId: PlayerId,
  terms: PactTerms,
): boolean {
  return (
    validatePactFormation(state, proposerId, recipientId, terms) === undefined
  );
}

export function applyCommand(
  state: GameState,
  command: GameplayCommand,
  dependencies: {
    readonly dice?: DiceSource;
    readonly shuffle?: ShuffleSource;
  } = {},
): DomainResult<GameState> {
  if (state.competitiveClock?.pauseReason) return reject('GAME_PAUSED');
  if (command.type === 'select_inherited_cards')
    return selectInheritedCards(state, command.playerId, command.cardIds);
  if (state.status === 'FINISHED') return reject('GAME_FINISHED');
  if (state.status !== 'ACTIVE') return reject('GAME_NOT_ACTIVE');
  if (
    !pactsAllowed(
      state.mode,
      state.configuredPlayerCount,
      state.competitiveBotSeats,
    ) &&
    (command.type === 'propose_pact' || command.type === 'accept_pact')
  )
    return reject('INVALID_PACT');
  state = cleanInternationalZones(state);
  const actor = player(state, command.playerId);
  if (!actor) return reject('UNKNOWN_PLAYER');
  if (actor.disqualified) return reject('PLAYER_DISQUALIFIED');
  if (actor.eliminated) return reject('PLAYER_ELIMINATED');
  if (
    state.pendingInheritance &&
    ![
      'accept_pact',
      'reject_pact',
      'cancel_pact',
      'complete_conquest_transfer',
    ].includes(command.type)
  )
    return reject('PENDING_ACTION');
  // Answering another player's proposal does not consume or resolve a transfer.
  if (command.type === 'accept_pact') return acceptPact(state, command);
  if (command.type === 'reject_pact') return removeProposal(state, command);
  if (state.mode === 'competitive' && command.type === 'cancel_pact')
    return removeProposal(state, command);
  if (state.pendingAction) {
    if (command.type === 'complete_conquest_transfer')
      return completeConquestTransfer(state, command.playerId, command.armies);
    return reject('PENDING_ACTION');
  }
  if (command.type === 'cancel_pact') return removeProposal(state, command);
  if (command.type === 'complete_conquest_transfer')
    return completeConquestTransfer(state, command.playerId, command.armies);
  const turnError = assertTurn(state, command.playerId);
  if (turnError) return turnError;
  if (command.type === 'propose_pact') return propose(state, command);
  if (command.type === 'withdraw_pact') return withdraw(state, command);
  if (command.type === 'place_reinforcements') return place(state, command);
  if (command.type === 'advance_phase') return advance(state, command.playerId);
  if (command.type === 'exchange_cards') return exchange(state, command);
  if (command.type === 'attack') {
    if (!dependencies.dice) return reject('INVALID_DICE');
    return attack(state, command, dependencies.dice);
  }
  if (command.type === 'regroup') return regroup(state, command);
  if (command.type === 'claim_card') {
    if (!dependencies.shuffle) return reject('NOT_ELIGIBLE');
    return claimCard(state, command.playerId, dependencies.shuffle);
  }
  if (command.type === 'claim_territory_bonus')
    return claimBonus(state, command.playerId, command.cardId);
  return endTurn(state);
}

function place(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'place_reinforcements' }>,
): DomainResult<GameState> {
  const entries = Object.entries(c.placements) as [TerritoryId, number][];
  if (
    entries.length === 0 ||
    entries.some(
      ([territoryId, armies]) =>
        !isPositiveInteger(armies) ||
        s.territories[territoryId].ownerId !== c.playerId ||
        isActiveInternationalZone(s, territoryId),
    )
  )
    return reject('INVALID_PLACEMENT');
  const phase = s.turn.phase;
  if (phase === 'territory_reinforcement') {
    const r = s.turn.reinforcementArmiesRemaining ?? 0;
    if (entries.reduce((sum, [, armies]) => sum + armies, 0) !== r)
      return reject('INVALID_PLACEMENT');
    let territories = { ...s.territories };
    for (const [territoryId, armies] of entries)
      territories = {
        ...territories,
        [territoryId]: {
          ...territories[territoryId],
          armies: territories[territoryId].armies + armies,
        },
      };
    return accepted(
      cleanInternationalZones({
        ...s,
        territories,
        turn: { ...s.turn, reinforcementArmiesRemaining: 0 },
      }),
    );
  }
  if (phase === 'continent_reinforcement') {
    const remaining = s.turn.continentReinforcementsRemaining ?? {};
    const allocated = entries.reduce<Partial<Record<ContinentId, number>>>(
      (totals, [territoryId, armies]) => ({
        ...totals,
        [TERRITORIES[territoryId].continentId]:
          (totals[TERRITORIES[territoryId].continentId] ?? 0) + armies,
      }),
      {},
    );
    if (
      Object.entries(remaining).some(
        ([continent, armies]) =>
          (allocated[continent as ContinentId] ?? 0) !== armies,
      ) ||
      Object.keys(allocated).some(
        (continent) => (remaining[continent as ContinentId] ?? 0) === 0,
      )
    )
      return reject('INVALID_PLACEMENT');
    let territories = { ...s.territories };
    for (const [territoryId, armies] of entries)
      territories = {
        ...territories,
        [territoryId]: {
          ...territories[territoryId],
          armies: territories[territoryId].armies + armies,
        },
      };
    const placed = cleanInternationalZones({
      ...s,
      territories,
      turn: {
        ...s.turn,
        continentReinforcementsRemaining: Object.fromEntries(
          Object.keys(remaining).map((continent) => [continent, 0]),
        ),
      },
    });
    return s.turn.round.kind === 'normal' &&
      s.turn.round.pass === 'incorporation'
      ? finishReinforcementActivation(placed)
      : accepted(placed);
  }
  if (phase === 'ordinary_exchange') {
    if (s.mode === 'classic' && player(s, c.playerId)!.cards.length > 5)
      return reject('MANDATORY_EXCHANGE');
    const due = s.turn.reinforcementArmiesRemaining ?? 0;
    if (entries.reduce((sum, [, armies]) => sum + armies, 0) !== due)
      return reject('INVALID_PLACEMENT');
    let territories = { ...s.territories };
    for (const [territoryId, armies] of entries)
      territories = {
        ...territories,
        [territoryId]: {
          ...territories[territoryId],
          armies: territories[territoryId].armies + armies,
        },
      };
    const placed = cleanInternationalZones({
      ...s,
      territories,
      turn: { ...s.turn, reinforcementArmiesRemaining: 0 },
    });
    const hasContinentReinforcements = Object.values(
      s.turn.continentReinforcementsRemaining ?? {},
    ).some((armies) => armies > 0);
    return hasContinentReinforcements
      ? accepted({
          ...placed,
          turn: { ...placed.turn, phase: 'continent_reinforcement' },
        })
      : finishReinforcementActivation(placed);
  }
  return reject('INVALID_PHASE');
}
function advance(s: ActiveGameState, id: PlayerId): DomainResult<GameState> {
  const t = s.turn;
  if (t.phase === 'territory_reinforcement') {
    if ((t.reinforcementArmiesRemaining ?? 0) !== 0)
      return reject('INVALID_PLACEMENT');
    const hasContinentReinforcements = Object.values(
      t.continentReinforcementsRemaining ?? {},
    ).some((armies) => armies > 0);
    return hasContinentReinforcements
      ? accepted({ ...s, turn: { ...t, phase: 'continent_reinforcement' } })
      : finishReinforcementActivation(s);
  }
  if (t.phase === 'continent_reinforcement') {
    if (
      Object.values(t.continentReinforcementsRemaining ?? {}).some(
        (n) => n !== 0,
      )
    )
      return reject('INVALID_PLACEMENT');
    return finishReinforcementActivation(s);
  }
  if (t.phase === 'ordinary_exchange') {
    const p = player(s, id)!;
    if (s.mode === 'classic' && p.cards.length > 5)
      return reject('MANDATORY_EXCHANGE');
    return accepted({ ...s, turn: { ...t, phase: 'territory_reinforcement' } });
  }
  if (t.phase === 'attack') {
    if (blockedByZone(s, id)) return reject('INTERNATIONAL_ZONE_OBLIGATION');
    return accepted({ ...s, turn: { ...t, phase: 'regroup' } });
  }
  if (t.phase === 'regroup')
    return accepted({ ...s, turn: { ...t, phase: 'end_of_turn_cards' } });
  return reject('INVALID_PHASE');
}
function exchange(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'exchange_cards' }>,
): DomainResult<GameState> {
  const p = player(s, c.playerId)!;
  if (s.turn.phase !== 'ordinary_exchange') return reject('INVALID_PHASE');
  if (
    !c.cardIds.every((id) => p.cards.some((x) => x.cardId === id)) ||
    !isLegalExchange(c.cardIds)
  )
    return reject('INVALID_EXCHANGE');
  const reward = exchangeValue(p.completedExchangeCount);
  return accepted({
    ...s,
    players: s.players.map((x) =>
      x.id === c.playerId
        ? {
            ...x,
            cards: x.cards.filter((card) => !c.cardIds.includes(card.cardId)),
            completedExchangeCount: x.completedExchangeCount + 1,
          }
        : x,
    ),
    cardDeck: {
      ...s.cardDeck,
      discardPile: [...s.cardDeck.discardPile, ...c.cardIds],
    },
    turn: {
      ...s.turn,
      reinforcementArmiesRemaining:
        (s.turn.reinforcementArmiesRemaining ?? 0) + reward,
    },
  });
}
function attack(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'attack' }>,
  dice: DiceSource,
): DomainResult<GameState> {
  if (s.turn.phase !== 'attack') return reject('INVALID_PHASE');
  const from = s.territories[c.from],
    to = s.territories[c.to];
  if (from.ownerId !== c.playerId) return reject('NOT_OWNER');
  if (to.ownerId === c.playerId) return reject('NOT_OWNER');
  if (!TERRITORIES[c.from].adjacentTerritoryIds.includes(c.to))
    return reject('NOT_ADJACENT');
  if (from.armies < 2) return reject('INSUFFICIENT_ARMIES');
  if (suicideBlocks(s, c.playerId, c.from)) return reject('SUICIDE_ATTACK');
  if (to.ownerId && pactBlocks(s, c.playerId, to.ownerId, c.from, c.to))
    return reject('PACT_PROHIBITS_ATTACK');
  const combat = resolveCombat(from.armies, to.armies, dice);
  if (!combat.ok) return combat;
  let next: ActiveGameState = {
    ...s,
    territories: {
      ...s.territories,
      [c.from]: { ...from, armies: from.armies - combat.state.attackerLosses },
      [c.to]: { ...to, armies: to.armies - combat.state.defenderLosses },
    },
  };
  if (next.territories[c.to].armies > 0) {
    next = {
      ...next,
      turn: {
        ...next.turn,
        lastCombat: {
          fromTerritoryId: c.from,
          toTerritoryId: c.to,
          ...combat.state,
          conquered: false,
        },
      },
    };
    next = terminateImpossibleZonesAfterCombat(
      cleanInternationalZones(next),
      c.playerId,
    );
    return accepted(next, combat.state);
  }
  const defeated = to.ownerId;
  const partiesForZone = s.pacts.active.find(
    (p) =>
      p.kind === 'international_zone' &&
      p.terms.territoryId === c.to &&
      p.expectedConquerorId === c.playerId,
  );
  const active = s.pacts.active.flatMap((p) => {
    if (
      p.kind === 'border_non_aggression' &&
      p.terms.kind === 'border_non_aggression' &&
      p.terms.territoryIds.includes(c.to) &&
      !p.parties.includes(c.playerId)
    )
      return [];
    if (p.kind === 'international_zone' && p.id === partiesForZone?.id)
      return [
        {
          ...p,
          expectedConquerorId: p.parties.find((id) => id !== c.playerId)!,
        },
      ];
    return [p];
  });
  next = {
    ...next,
    pacts: { ...next.pacts, active },
    territories: {
      ...next.territories,
      [c.from]: {
        ...next.territories[c.from],
        armies: next.territories[c.from].armies - 1,
      },
      [c.to]: { ownerId: c.playerId, armies: 1, fixedArmiesThisTurn: 0 },
    },
    turn: {
      ...next.turn,
      conqueredTerritoryIds: [...next.turn.conqueredTerritoryIds, c.to],
      lastConqueredTerritoryId: c.to,
      cardClaimEligible:
        next.turn.conqueredTerritoryIds.length + 1 >=
        (player(next, c.playerId)!.completedExchangeCount < 3 ? 1 : 2),
      lastCombat: {
        fromTerritoryId: c.from,
        toTerritoryId: c.to,
        ...combat.state,
        conquered: true,
      },
    },
  };
  next = cleanInternationalZones(next);
  if (defeated && ownedIds(next, defeated).length === 0)
    next = cleanInternationalZones(eliminate(next, defeated, c.playerId));
  const won = finishIfWon(next, c.playerId);
  if (won.status === 'FINISHED') return accepted(won, combat.state);
  const max = (
    partiesForZone ? 1 : Math.min(3, next.territories[c.from].armies)
  ) as 1 | 2 | 3;
  next = {
    ...next,
    territories: {
      ...next.territories,
      [c.from]: {
        ...next.territories[c.from],
        armies: next.territories[c.from].armies + 1,
      },
      [c.to]: { ...next.territories[c.to], armies: 0 },
    },
    pendingAction: {
      kind: 'conquest_transfer',
      playerId: c.playerId,
      fromTerritoryId: c.from,
      conqueredTerritoryId: c.to,
      maximumArmies: max,
    },
  };
  return accepted(next, combat.state);
}
function eliminate(
  s: ActiveGameState,
  loser: PlayerId,
  winner: PlayerId,
): ActiveGameState {
  const inherited = (player(s, loser)?.cards ?? []).map((card) => ({
    cardId: card.cardId,
    territoryBonusClaimed: false,
  }));
  const capacity = Math.max(0, 5 - player(s, winner)!.cards.length);
  const choose =
    s.mode === 'competitive' && inherited.length > capacity && capacity > 0;
  const keep =
    s.mode === 'classic'
      ? inherited
      : choose
        ? []
        : inherited.slice(0, capacity);
  const discarded =
    s.mode === 'competitive' && !choose
      ? inherited.slice(capacity).map((card) => card.cardId)
      : [];
  return {
    ...s,
    ...(s.mode === 'competitive'
      ? { competitiveHistory: recordCompetitiveElimination(s, loser, winner) }
      : {}),
    ...(choose
      ? {
          pendingInheritance: {
            playerId: winner,
            cards: inherited,
            takeCount: capacity,
          },
        }
      : {}),
    cardDeck: discarded.length
      ? {
          ...s.cardDeck,
          discardPile: [...s.cardDeck.discardPile, ...discarded],
        }
      : s.cardDeck,
    players: s.players.map((p) => {
      if (p.id === winner) return { ...p, cards: [...p.cards, ...keep] };
      if (p.id === loser) return { ...p, eliminated: true, cards: [] };
      if (p.id !== winner && p.effectiveDestructionTargetPlayerId === loser) {
        const { effectiveDestructionTargetPlayerId: _, ...rest } = p;
        void _;
        return rest;
      }
      return p;
    }),
  };
}
export function completeConquestTransfer(
  s: GameState,
  playerId: PlayerId,
  armies: 1 | 2 | 3,
): DomainResult<GameState> {
  if (s.status === 'FINISHED') return reject('GAME_FINISHED');
  if (s.status !== 'ACTIVE') return reject('GAME_NOT_ACTIVE');
  const p = s.pendingAction;
  if (!p) return reject('INVALID_TRANSFER');
  if (p.playerId !== playerId) return reject('NOT_YOUR_TURN');
  if (
    !Number.isFinite(armies) ||
    !Number.isInteger(armies) ||
    armies < 1 ||
    armies > 3 ||
    armies > p.maximumArmies
  )
    return reject('INVALID_TRANSFER');
  const from = s.territories[p.fromTerritoryId],
    to = s.territories[p.conqueredTerritoryId];
  const { pendingAction: _, ...rest } = s;
  void _;
  return accepted(
    cleanInternationalZones({
      ...rest,
      territories: {
        ...s.territories,
        [p.fromTerritoryId]: { ...from, armies: from.armies - armies },
        [p.conqueredTerritoryId]: { ...to, armies: to.armies + armies },
      },
    }),
  );
}
function regroup(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'regroup' }>,
): DomainResult<GameState> {
  if (s.turn.phase !== 'regroup') return reject('INVALID_PHASE');
  const a = s.territories[c.from],
    b = s.territories[c.to];
  if (a.ownerId !== c.playerId || b.ownerId !== c.playerId)
    return reject('NOT_OWNER');
  if (!TERRITORIES[c.from].adjacentTerritoryIds.includes(c.to))
    return reject('NOT_ADJACENT');
  if (isActiveInternationalZone(s, c.to)) return reject('INVALID_PLACEMENT');
  const movable = a.armies - 1 - a.fixedArmiesThisTurn;
  if (!isPositiveInteger(c.armies) || c.armies > movable)
    return reject('INSUFFICIENT_ARMIES');
  return accepted(
    cleanInternationalZones({
      ...s,
      territories: {
        ...s.territories,
        [c.from]: { ...a, armies: a.armies - c.armies },
        [c.to]: {
          ...b,
          armies: b.armies + c.armies,
          fixedArmiesThisTurn: b.fixedArmiesThisTurn + c.armies,
        },
      },
    }),
  );
}
function claimCard(
  s: ActiveGameState,
  id: PlayerId,
  shuffle: ShuffleSource,
): DomainResult<GameState> {
  if (s.turn.phase !== 'end_of_turn_cards' || !s.turn.cardClaimEligible)
    return reject('NOT_ELIGIBLE');
  const p = player(s, id)!;
  if (p.cards.length >= 5) return reject('CARD_LIMIT');
  let draw = [...s.cardDeck.drawPile],
    discard = [...s.cardDeck.discardPile];
  if (draw.length === 0) {
    draw = [...shuffle.shuffle(discard)];
    discard = [];
  }
  const cardId = draw.shift();
  if (!cardId) return reject('NOT_ELIGIBLE');
  return accepted(
    {
      ...s,
      cardDeck: { drawPile: draw, discardPile: discard },
      players: s.players.map((x) =>
        x.id === id
          ? {
              ...x,
              cards: [...x.cards, { cardId, territoryBonusClaimed: false }],
            }
          : x,
      ),
      turn: { ...s.turn, cardClaimEligible: false },
    },
    cardId,
  );
}
function claimBonus(
  s: ActiveGameState,
  id: PlayerId,
  cardId: TerritoryCardId,
): DomainResult<GameState> {
  if (s.turn.phase !== 'end_of_turn_cards') return reject('INVALID_PHASE');
  const p = player(s, id)!,
    card = p.cards.find((x) => x.cardId === cardId && !x.territoryBonusClaimed);
  if (
    !card ||
    card.territoryBonusClaimed ||
    s.territories[cardId].ownerId !== id
  )
    return reject('NOT_ELIGIBLE');
  if (isActiveInternationalZone(s, cardId)) return reject('INVALID_PLACEMENT');
  return accepted({
    ...s,
    territories: {
      ...s.territories,
      [cardId]: {
        ...s.territories[cardId],
        armies: s.territories[cardId].armies + 2,
      },
    },
    players: s.players.map((x) =>
      x.id === id
        ? {
            ...x,
            cards: x.cards.map((k) =>
              k.cardId === cardId ? { ...k, territoryBonusClaimed: true } : k,
            ),
          }
        : x,
    ),
  });
}
function endTurn(s: ActiveGameState): DomainResult<GameState> {
  if (s.turn.phase !== 'end_of_turn_cards') return reject('INVALID_PHASE');
  const cleanTerritories = Object.fromEntries(
    TERRITORY_IDS.map((t) => [
      t,
      { ...s.territories[t], fixedArmiesThisTurn: 0 },
    ]),
  ) as ActiveGameState['territories'];
  const interim = {
    ...s,
    territories: cleanTerritories,
  };
  return finishHostilityActivation(interim);
}

function survivingOrder(s: ActiveGameState, ids: readonly PlayerId[]) {
  return ids.filter((id) => !player(s, id)?.eliminated);
}

function reinforcementTurn(
  s: ActiveGameState,
  orderPlayerIds: readonly PlayerId[],
  actorIndex: number,
  roundNumber: number,
): ActiveGameState['turn'] {
  const playerId = orderPlayerIds[actorIndex]!;
  return {
    playerId,
    turnNumber: s.turn.turnNumber + 1,
    phase: 'ordinary_exchange',
    round: {
      kind: 'normal',
      roundNumber,
      pass: 'incorporation',
      orderPlayerIds,
      actorIndex,
    },
    isFirstHostilityTurn: false,
    ...(s.turn.firstHostilityStartingPlayerId
      ? {
          firstHostilityStartingPlayerId: s.turn.firstHostilityStartingPlayerId,
        }
      : {}),
    firstHostilityPlayerIdsRemaining: [],
    conqueredTerritoryIds: [],
    cardClaimEligible: false,
    reinforcementArmiesRemaining: baseReinforcements(
      ownedIds(s, playerId).length,
    ),
    continentReinforcementsRemaining: continentBonuses(s, playerId),
  };
}

function hostilityTurn(
  s: ActiveGameState,
  orderPlayerIds: readonly PlayerId[],
  actorIndex: number,
  roundNumber: number,
): ActiveGameState['turn'] {
  const playerId = orderPlayerIds[actorIndex]!;
  return {
    playerId,
    turnNumber: s.turn.turnNumber + 1,
    phase: 'attack',
    round: {
      kind: 'normal',
      roundNumber,
      pass: 'hostility',
      orderPlayerIds,
      actorIndex,
    },
    isFirstHostilityTurn: false,
    ...(s.turn.firstHostilityStartingPlayerId
      ? {
          firstHostilityStartingPlayerId: s.turn.firstHostilityStartingPlayerId,
        }
      : {}),
    firstHostilityPlayerIdsRemaining: [],
    conqueredTerritoryIds: [],
    cardClaimEligible: false,
  };
}

function completePactWaitingActivation(
  s: ActiveGameState,
  playerId: PlayerId,
): ActiveGameState {
  return {
    ...s,
    pacts: {
      ...s.pacts,
      active: s.pacts.active.flatMap((pact) => {
        if (pact.withdrawal.kind === 'none') return [pact];
        const waitingForPlayerIds = pact.withdrawal.waitingForPlayerIds.filter(
          (waitingId) =>
            waitingId !== playerId && !player(s, waitingId)?.eliminated,
        );
        return waitingForPlayerIds.length === 0
          ? []
          : [
              {
                ...pact,
                withdrawal: { ...pact.withdrawal, waitingForPlayerIds },
              },
            ];
      }),
    },
  };
}

function finishReinforcementActivation(
  s: ActiveGameState,
): DomainResult<GameState> {
  const round = s.turn.round;
  if (round.kind !== 'normal' || round.pass !== 'incorporation')
    return reject('INVALID_PHASE');
  if (s.mode === 'competitive' && s.pacts.competitiveWithdrawals) {
    s = {
      ...s,
      pacts: {
        ...s.pacts,
        competitiveWithdrawals: s.pacts.competitiveWithdrawals.flatMap((p) =>
          p.recipientId !== s.turn.playerId
            ? [p]
            : p.incorporationsRemaining === 1
              ? []
              : [{ ...p, incorporationsRemaining: 1 as const }],
        ),
      },
    };
  }
  const order = survivingOrder(s, round.orderPlayerIds);
  const currentIndex = order.indexOf(s.turn.playerId);
  if (currentIndex < 0 || order.length === 0) return reject('UNKNOWN_PLAYER');
  if (currentIndex + 1 < order.length)
    return accepted({
      ...s,
      turn: reinforcementTurn(s, order, currentIndex + 1, round.roundNumber),
    });
  const next = {
    ...s,
    turn: hostilityTurn(s, order, 0, round.roundNumber),
  };
  return accepted(next);
}

function finishHostilityActivation(
  s: ActiveGameState,
): DomainResult<GameState> {
  s = completePactWaitingActivation(s, s.turn.playerId);
  if (s.mode === 'competitive')
    s = {
      ...s,
      pacts: {
        ...s.pacts,
        proposals: s.pacts.proposals.filter(
          (p) => p.recipientId !== s.turn.playerId,
        ),
      },
    };
  const round = s.turn.round;
  const order = survivingOrder(s, round.orderPlayerIds);
  const currentIndex = order.indexOf(s.turn.playerId);
  if (currentIndex < 0 || order.length === 0) return reject('UNKNOWN_PLAYER');
  if (round.kind === 'initial_hostility') {
    if (currentIndex + 1 < order.length) {
      const playerId = order[currentIndex + 1]!;
      const next = {
        ...s,
        turn: {
          playerId,
          turnNumber: s.turn.turnNumber + 1,
          phase: 'attack' as const,
          round: {
            ...round,
            orderPlayerIds: order,
            actorIndex: currentIndex + 1,
          },
          isFirstHostilityTurn: true,
          firstHostilityStartingPlayerId: order[0]!,
          firstHostilityPlayerIdsRemaining: order.slice(currentIndex + 1),
          conqueredTerritoryIds: [],
          cardClaimEligible: false,
        },
      };
      return accepted(next);
    }
    const rotated = [...order.slice(1), order[0]!];
    return accepted({ ...s, turn: reinforcementTurn(s, rotated, 0, 1) });
  }
  if (round.pass !== 'hostility') return reject('INVALID_PHASE');
  if (currentIndex + 1 < order.length) {
    const next = {
      ...s,
      turn: hostilityTurn(s, order, currentIndex + 1, round.roundNumber),
    };
    return accepted(next);
  }
  const rotated = [...order.slice(1), order[0]!];
  return accepted({
    ...s,
    turn: reinforcementTurn(s, rotated, 0, round.roundNumber + 1),
  });
}

function propose(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'propose_pact' }>,
): DomainResult<GameState> {
  if (s.mode === 'competitive' && s.turn.phase !== 'attack')
    return reject('INVALID_PHASE');
  if (s.turn.round.kind === 'normal' && s.turn.round.pass !== 'hostility')
    return reject('INVALID_PHASE');
  const formationError = validatePactFormation(
    s,
    c.playerId,
    c.recipientId,
    c.terms,
  );
  if (formationError) return reject(formationError);
  const limitError = competitiveProposalError(s, c.playerId, c.recipientId);
  if (limitError) return reject(limitError);
  if (
    s.pacts.proposals.some(
      (p) =>
        p.id === c.proposalId ||
        (normalizedParties(p.proposerId, p.recipientId) ===
          normalizedParties(c.playerId, c.recipientId) &&
          normalizedTerms(p.terms) === normalizedTerms(c.terms)),
    )
  )
    return reject('DUPLICATE_PACT');
  return accepted({
    ...s,
    pacts: {
      ...s.pacts,
      proposals: [
        ...s.pacts.proposals,
        {
          id: c.proposalId,
          proposerId: c.playerId,
          recipientId: c.recipientId,
          terms: c.terms,
        },
      ],
    },
  });
}
function acceptPact(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'accept_pact' }>,
): DomainResult<GameState> {
  const proposal = s.pacts.proposals.find((p) => p.id === c.proposalId);
  if (!proposal) return reject('PACT_NOT_FOUND');
  if (proposal.recipientId !== c.playerId) return reject('INVALID_PACT');
  const formationError = validatePactFormation(
    s,
    proposal.proposerId,
    proposal.recipientId,
    proposal.terms,
  );
  if (formationError) return reject(formationError);
  if (
    [...s.pacts.active, ...(s.pacts.competitiveWithdrawals ?? [])].some(
      (p) => p.id === c.pactId,
    )
  )
    return reject('DUPLICATE_PACT');
  const common = {
    id: c.pactId,
    parties: [proposal.proposerId, proposal.recipientId] as const,
    terms: proposal.terms,
  };
  const pact =
    proposal.terms.kind === 'international_zone'
      ? {
          ...common,
          kind: 'international_zone' as const,
          terms: proposal.terms,
          expectedConquerorId: c.playerId,
          withdrawal: { kind: 'none' as const },
        }
      : {
          ...common,
          kind: proposal.terms.kind,
          terms: proposal.terms,
          withdrawal: { kind: 'none' as const },
        };
  return accepted({
    ...s,
    pacts: {
      ...s.pacts,
      proposals: s.pacts.proposals.filter((p) => p.id !== proposal.id),
      active: [...s.pacts.active, pact],
    },
  });
}
function removeProposal(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'reject_pact' | 'cancel_pact' }>,
): DomainResult<GameState> {
  const p = s.pacts.proposals.find((x) => x.id === c.proposalId);
  if (!p) return reject('PACT_NOT_FOUND');
  if (
    c.type === 'reject_pact'
      ? p.recipientId !== c.playerId
      : p.proposerId !== c.playerId
  )
    return reject('INVALID_PACT');
  const rejected = c.type === 'reject_pact' && s.mode === 'competitive';
  return accepted({
    ...s,
    pacts: {
      ...s.pacts,
      proposals: s.pacts.proposals.filter((x) => x.id !== p.id),
      ...(rejected
        ? {
            competitiveRejections: [
              ...(s.pacts.competitiveRejections ?? []).filter(
                (r) =>
                  pactRejectionWaitMs(s, r.proposerId, r.recipientId) > 0 &&
                  !(
                    r.proposerId === p.proposerId &&
                    r.recipientId === p.recipientId
                  ),
              ),
              {
                proposerId: p.proposerId,
                recipientId: p.recipientId,
                elapsedMs: s.competitiveClock?.elapsedMs ?? 0,
              },
            ],
          }
        : {}),
    },
  });
}
function withdraw(
  s: ActiveGameState,
  c: Extract<GameplayCommand, { type: 'withdraw_pact' }>,
): DomainResult<GameState> {
  const p = s.pacts.active.find((x) => x.id === c.pactId);
  if (!p) return reject('PACT_NOT_FOUND');
  if (!p.parties.includes(c.playerId)) return reject('INVALID_PACT');
  if (s.mode === 'competitive') {
    if (s.competitiveClock?.finalRoundNumber !== undefined)
      return reject('INVALID_PACT');
    if (s.turn.phase !== 'attack') return reject('INVALID_PHASE');
    if (p.withdrawal.kind === 'announced') return reject('INVALID_PACT');
    return accepted({
      ...s,
      pacts: {
        ...s.pacts,
        active: s.pacts.active.filter((pact) => pact.id !== p.id),
        competitiveWithdrawals: [
          ...(s.pacts.competitiveWithdrawals ?? []),
          {
            id: p.id,
            parties: p.parties,
            terms: p.terms,
            withdrawingPlayerId: c.playerId,
            recipientId: p.parties.find((id) => id !== c.playerId)!,
            incorporationsRemaining: 2,
          },
        ],
      },
    });
  }
  if (p.withdrawal.kind === 'announced') return reject('INVALID_PACT');
  if (s.turn.round.kind === 'normal' && s.turn.round.pass !== 'hostility')
    return reject('INVALID_PHASE');
  return accepted({
    ...s,
    pacts: {
      ...s.pacts,
      active: s.pacts.active.map((x) =>
        x.id === p.id
          ? {
              ...p,
              withdrawal: {
                kind: 'announced',
                withdrawingPlayerId: c.playerId,
                waitingForPlayerIds: s.turn.round.orderPlayerIds.filter(
                  (playerId) =>
                    playerId !== c.playerId && !player(s, playerId)?.eliminated,
                ),
              },
            }
          : x,
      ),
    },
  });
}

export function selectInheritedCards(
  s: GameState,
  playerId: PlayerId,
  cardIds: readonly TerritoryCardId[],
): DomainResult<GameState> {
  const pending = s.pendingInheritance;
  if (
    !pending ||
    pending.playerId !== playerId ||
    cardIds.length !== pending.takeCount ||
    new Set(cardIds).size !== cardIds.length ||
    cardIds.some((id) => !pending.cards.some((card) => card.cardId === id))
  )
    return reject('INVALID_INHERITANCE');
  const { pendingInheritance: _, ...rest } = s;
  void _;
  if (!('cardDeck' in rest)) return reject('INVALID_INHERITANCE');
  return accepted({
    ...rest,
    players: s.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            cards: [
              ...p.cards,
              ...pending.cards.filter((card) => cardIds.includes(card.cardId)),
            ],
          }
        : p,
    ),
    cardDeck: {
      ...rest.cardDeck,
      discardPile: [
        ...rest.cardDeck.discardPile,
        ...pending.cards
          .filter((card) => !cardIds.includes(card.cardId))
          .map((card) => card.cardId),
      ],
    },
  });
}

/** Server-authorized expiry/skip, never a client gameplay command. */
export function finishCompetitiveActivation(s: ActiveGameState): GameState {
  if (s.mode !== 'competitive') throw new Error('Competitive expiry only');
  const incorporating =
    s.turn.round.kind === 'normal' && s.turn.round.pass === 'incorporation';
  const result = incorporating
    ? finishReinforcementActivation({
        ...s,
        turn: {
          ...s.turn,
          reinforcementArmiesRemaining: 0,
          continentReinforcementsRemaining: {},
        },
      })
    : endTurn({
        ...s,
        territories: Object.fromEntries(
          Object.entries(s.territories).map(([id, t]) => [
            id,
            { ...t, fixedArmiesThisTurn: 0 },
          ]),
        ) as ActiveGameState['territories'],
        turn: {
          ...s.turn,
          phase: 'end_of_turn_cards',
          cardClaimEligible: false,
        },
      });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
