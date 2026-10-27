import { pactsAllowed } from './mode-policy.js';
import {
  TERRITORIES,
  TERRITORY_IDS,
  type TerritoryId,
} from './classic-data.js';
import type { GameState, PactTerms, PlayerId } from './domain.js';
import {
  blockedByZone,
  exchangeValue,
  isLegalExchange,
  isPactProposalLegal,
  isActiveInternationalZone,
  competitiveProposalError,
  pactBlocks,
  suicideBlocks,
} from './rules.js';

export type LegalActionType =
  | 'select_inherited_cards'
  | 'set_ready'
  | 'place_setup_armies'
  | 'place_reinforcements'
  | 'advance_phase'
  | 'exchange_cards'
  | 'attack'
  | 'complete_conquest_transfer'
  | 'regroup'
  | 'claim_card'
  | 'claim_territory_bonus'
  | 'end_turn'
  | 'propose_pact'
  | 'accept_pact'
  | 'reject_pact'
  | 'cancel_pact'
  | 'withdraw_pact';

export interface LegalActionGuidance {
  readonly readOnly: boolean;
  readonly actions: readonly LegalActionType[];
  readonly territoryChoices: readonly TerritoryId[];
  readonly reinforcementChoices: readonly {
    readonly territoryId: TerritoryId;
    readonly maximumArmies: number;
  }[];
  readonly attackChoices: readonly {
    readonly from: TerritoryId;
    readonly targets: readonly TerritoryId[];
  }[];
  readonly regroupChoices: readonly {
    readonly from: TerritoryId;
    readonly to: TerritoryId;
    readonly maximumArmies: number;
  }[];
  readonly exchangeAvailable: boolean;
  readonly exchangeChoices: readonly {
    readonly cardIds: readonly [TerritoryId, TerritoryId, TerritoryId];
    readonly rewardArmies: number;
  }[];
  readonly territoryBonusCardIds: readonly TerritoryId[];
  readonly conquestTransferMaximum?: 1 | 2 | 3;
  readonly pactProposalIdsToAnswer: readonly string[];
  readonly pactProposalIdsToCancel: readonly string[];
  readonly pactIdsToWithdraw: readonly string[];
  readonly pactRecipientIds: readonly string[];
  readonly pactProposalChoices: readonly {
    readonly recipientId: string;
    readonly terms:
      | { readonly kind: 'general_non_aggression' }
      | {
          readonly kind: 'border_non_aggression';
          readonly territoryIds: readonly [TerritoryId, TerritoryId];
        }
      | {
          readonly kind: 'international_zone';
          readonly territoryId: TerritoryId;
          readonly firstExpectedConquerorId: string;
        };
  }[];
}

const actionList = (
  ...values: readonly (LegalActionType | false)[]
): readonly LegalActionType[] =>
  values.filter((value): value is LegalActionType => value !== false);

const empty = (readOnly: boolean): LegalActionGuidance => ({
  readOnly,
  actions: [],
  territoryChoices: [],
  reinforcementChoices: [],
  attackChoices: [],
  regroupChoices: [],
  exchangeAvailable: false,
  exchangeChoices: [],
  territoryBonusCardIds: [],
  pactProposalIdsToAnswer: [],
  pactProposalIdsToCancel: [],
  pactIdsToWithdraw: [],
  pactRecipientIds: [],
  pactProposalChoices: [],
});

const exchangeSets = (
  state: Extract<GameState, { status: 'ACTIVE' }>,
  playerId: PlayerId,
) => {
  const actor = state.players.find(({ id }) => id === playerId)!;
  const choices: LegalActionGuidance['exchangeChoices'][number][] = [];
  for (let a = 0; a < actor.cards.length - 2; a++)
    for (let b = a + 1; b < actor.cards.length - 1; b++)
      for (let c = b + 1; c < actor.cards.length; c++) {
        const ids = [
          actor.cards[a]!.cardId,
          actor.cards[b]!.cardId,
          actor.cards[c]!.cardId,
        ] as const;
        if (isLegalExchange(ids))
          choices.push({
            cardIds: ids,
            rewardArmies: exchangeValue(actor.completedExchangeCount),
          });
      }
  return choices;
};

export function deriveLegalActions(
  state: GameState,
  playerId: PlayerId,
): LegalActionGuidance {
  const actor = state.players.find(({ id }) => id === playerId);
  if (
    !actor ||
    actor.eliminated ||
    actor.disqualified ||
    state.competitiveClock?.pauseReason ||
    actor.controller !== 'controlled'
  )
    return empty(true);
  if (state.pendingInheritance?.playerId === playerId)
    return {
      ...empty(false),
      actions: [
        'select_inherited_cards',
        ...(state.status === 'ACTIVE' && state.pendingAction
          ? ['complete_conquest_transfer' as const]
          : []),
      ],
      ...(state.status === 'ACTIVE' && state.pendingAction
        ? { conquestTransferMaximum: state.pendingAction.maximumArmies }
        : {}),
    };
  if (state.status === 'FINISHED') return empty(true);
  if (state.status === 'LOBBY')
    return { ...empty(false), actions: ['set_ready'] };
  if (state.status === 'SETUP') {
    if (state.setup.currentPlayerId !== playerId) return empty(false);
    return {
      ...empty(false),
      actions: ['place_setup_armies'],
      territoryChoices: TERRITORY_IDS.filter(
        (id) => state.territories[id].ownerId === playerId,
      ),
    };
  }

  const pactProposalIdsToAnswer = state.pacts.proposals
    .filter(({ recipientId }) => recipientId === playerId)
    .map(({ id }) => id);
  if (state.pendingAction) {
    const canTransfer = state.pendingAction.playerId === playerId;
    return {
      ...empty(false),
      actions: actionList(
        canTransfer && 'complete_conquest_transfer',
        pactProposalIdsToAnswer.length > 0 && 'accept_pact',
        pactProposalIdsToAnswer.length > 0 && 'reject_pact',
        state.mode === 'competitive' &&
          state.pacts.proposals.some((p) => p.proposerId === playerId) &&
          'cancel_pact',
      ),
      pactProposalIdsToCancel:
        state.mode === 'competitive'
          ? state.pacts.proposals
              .filter((p) => p.proposerId === playerId)
              .map((p) => p.id)
          : [],
      pactProposalIdsToAnswer,
      ...(canTransfer
        ? { conquestTransferMaximum: state.pendingAction.maximumArmies }
        : {}),
    };
  }
  const pactProposalIdsToCancel = state.pacts.proposals
    .filter(({ proposerId }) => proposerId === playerId)
    .map(({ id }) => id);
  const ownsTurn = state.turn.playerId === playerId;
  const pactIdsToWithdraw = state.pacts.active
    .filter(
      (pact) =>
        state.competitiveClock?.finalRoundNumber === undefined &&
        pact.parties.includes(playerId) &&
        pact.withdrawal.kind === 'none',
    )
    .map(({ id }) => id);
  const ownsHostilityActivation =
    ownsTurn &&
    (state.mode !== 'competitive' || state.turn.phase === 'attack') &&
    (state.turn.round.kind === 'initial_hostility' ||
      state.turn.round.pass === 'hostility');
  const pactRecipientIds =
    ownsHostilityActivation &&
    pactsAllowed(
      state.mode,
      state.configuredPlayerCount,
      state.competitiveBotSeats,
    )
      ? state.players
          .filter(
            (player) =>
              !player.eliminated &&
              !player.disqualified &&
              !player.absent &&
              !player.bot &&
              player.id !== playerId,
          )
          .map(({ id }) => id)
      : [];
  const pactProposalChoices = pactRecipientIds.flatMap((recipientId) => {
    const candidates: LegalActionGuidance['pactProposalChoices'][number][] = [
      { recipientId, terms: { kind: 'general_non_aggression' } },
    ];
    for (const territoryId of TERRITORY_IDS) {
      candidates.push({
        recipientId,
        terms: {
          kind: 'international_zone',
          territoryId,
          firstExpectedConquerorId: recipientId,
        },
      });
      for (const adjacent of TERRITORIES[territoryId].adjacentTerritoryIds)
        if (territoryId < adjacent)
          candidates.push({
            recipientId,
            terms: {
              kind: 'border_non_aggression',
              territoryIds: [territoryId, adjacent],
            },
          });
    }
    if (competitiveProposalError(state, playerId, recipientId)) return [];
    return candidates.filter(({ terms }) =>
      isPactProposalLegal(state, playerId, recipientId, terms as PactTerms),
    );
  });
  const pactActions = actionList(
    ownsHostilityActivation &&
      pactsAllowed(
        state.mode,
        state.configuredPlayerCount,
        state.competitiveBotSeats,
      ) &&
      'propose_pact',
    pactProposalIdsToAnswer.length > 0 && 'accept_pact',
    pactProposalIdsToAnswer.length > 0 && 'reject_pact',
    pactProposalIdsToCancel.length > 0 && 'cancel_pact',
    ownsHostilityActivation && pactIdsToWithdraw.length > 0 && 'withdraw_pact',
  );
  const common = {
    ...empty(false),
    actions: pactActions,
    pactProposalIdsToAnswer,
    pactProposalIdsToCancel,
    pactIdsToWithdraw: ownsHostilityActivation ? pactIdsToWithdraw : [],
    pactRecipientIds,
    pactProposalChoices,
  };
  if (state.turn.playerId !== playerId) return common;
  const owned = TERRITORY_IDS.filter(
    (id) => state.territories[id].ownerId === playerId,
  );
  const phase = state.turn.phase;
  if (phase === 'territory_reinforcement') {
    const territoryChoices = owned.filter(
      (id) => !isActiveInternationalZone(state, id),
    );
    const placementAvailable =
      (state.turn.reinforcementArmiesRemaining ?? 0) > 0 &&
      territoryChoices.length > 0;
    return {
      ...common,
      actions: actionList(
        ...pactActions,
        placementAvailable && 'place_reinforcements',
        !placementAvailable && 'advance_phase',
      ),
      territoryChoices: placementAvailable ? territoryChoices : [],
      reinforcementChoices: placementAvailable
        ? territoryChoices.map((territoryId) => ({
            territoryId,
            maximumArmies: state.turn.reinforcementArmiesRemaining ?? 0,
          }))
        : [],
    };
  }
  if (phase === 'continent_reinforcement') {
    const remaining = state.turn.continentReinforcementsRemaining ?? {};
    const territoryChoices = owned.filter(
      (id) =>
        (remaining[TERRITORIES[id].continentId] ?? 0) > 0 &&
        !isActiveInternationalZone(state, id),
    );
    return {
      ...common,
      actions: actionList(
        ...pactActions,
        territoryChoices.length > 0 && 'place_reinforcements',
        territoryChoices.length === 0 && 'advance_phase',
      ),
      territoryChoices,
      reinforcementChoices: territoryChoices.map((territoryId) => ({
        territoryId,
        maximumArmies: remaining[TERRITORIES[territoryId].continentId] ?? 0,
      })),
    };
  }
  if (phase === 'ordinary_exchange') {
    const exchangeChoices = exchangeSets(state, playerId);
    const exchangeAvailable = exchangeChoices.length > 0;
    const territoryChoices = owned.filter(
      (id) => !isActiveInternationalZone(state, id),
    );
    const placementAvailable =
      (state.mode === 'competitive' || actor.cards.length <= 5) &&
      (state.turn.reinforcementArmiesRemaining ?? 0) > 0 &&
      territoryChoices.length > 0;
    return {
      ...common,
      actions: actionList(
        ...pactActions,
        exchangeAvailable && 'exchange_cards',
        placementAvailable && 'place_reinforcements',
      ),
      exchangeAvailable,
      exchangeChoices,
      territoryChoices: placementAvailable ? territoryChoices : [],
      reinforcementChoices: placementAvailable
        ? territoryChoices.map((territoryId) => ({
            territoryId,
            maximumArmies: state.turn.reinforcementArmiesRemaining ?? 0,
          }))
        : [],
    };
  }
  if (phase === 'attack') {
    const attackChoices = owned.flatMap((from) => {
      if (
        state.territories[from].armies < 2 ||
        suicideBlocks(state, playerId, from)
      )
        return [];
      const targets = TERRITORIES[from].adjacentTerritoryIds.filter((to) => {
        const defender = state.territories[to].ownerId;
        return (
          defender !== playerId &&
          (defender === undefined ||
            !pactBlocks(state, playerId, defender, from, to))
        );
      });
      return targets.length ? [{ from, targets }] : [];
    });
    return {
      ...common,
      actions: actionList(
        ...pactActions,
        attackChoices.length > 0 && 'attack',
        !blockedByZone(state, playerId) && 'advance_phase',
      ),
      attackChoices,
    };
  }
  if (phase === 'regroup') {
    const regroupChoices = owned.flatMap((from) => {
      const maximumArmies =
        state.territories[from].armies -
        1 -
        state.territories[from].fixedArmiesThisTurn;
      if (maximumArmies < 1) return [];
      return TERRITORIES[from].adjacentTerritoryIds
        .filter(
          (to) =>
            state.territories[to].ownerId === playerId &&
            !isActiveInternationalZone(state, to),
        )
        .map((to) => ({ from, to, maximumArmies }));
    });
    return {
      ...common,
      actions: actionList(
        ...pactActions,
        regroupChoices.length > 0 && 'regroup',
        'advance_phase',
      ),
      regroupChoices,
    };
  }
  const territoryBonusCardIds = actor.cards
    .filter(
      ({ cardId, territoryBonusClaimed }) =>
        !territoryBonusClaimed &&
        state.territories[cardId].ownerId === playerId &&
        !isActiveInternationalZone(state, cardId),
    )
    .map(({ cardId }) => cardId);
  return {
    ...common,
    actions: actionList(
      ...pactActions,
      state.turn.cardClaimEligible && actor.cards.length < 5 && 'claim_card',
      territoryBonusCardIds.length > 0 && 'claim_territory_bonus',
      'end_turn',
    ),
    territoryBonusCardIds,
  };
}
