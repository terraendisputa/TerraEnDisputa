import {
  createCampaign,
  applyCampaign,
  finishByTime,
  assertCampaign,
  type Campaign,
  type CampaignAction,
} from './campaign.js';
import { checkedCampaignAction } from './campaign-actions.js';
import { projectCampaign } from './campaign-projection.js';
import {
  createFirstHostility,
  applyFirstHostility,
  assertFirstHostility,
  firstHostilityActions,
  type FirstHostility,
  type HostilityAction,
} from './hostilities.js';
/** Integrated development setup. Separate contract; never a Classic snapshot or public edition. */
import {
  integer,
  object,
  text,
  unique,
  type ReconquistaTerritory,
} from './contracts.js';
import {
  createPreparation,
  assertPreparation,
  initialBudgets,
  occupationSummary,
  preparationBoard,
  placeInitialArmies,
  placeReconquistaForces,
  type PreparationState,
  type PreparationBoard,
  type PreparationRandom,
} from './preparation.js';
import {
  dealInitialObjectives,
  privateInitialObjectives,
  type ObjectivePlayer,
} from './objectives.js';
import { createSituationDeck } from './situations.js';
import {
  activateSituation,
  initialSituationCycle,
  type ActivatedSituation,
  type SituationCycle,
} from './round.js';

export interface ReconquistaSession {
  readonly kind: 'reconquista-session';
  readonly version: 1;
  readonly players: readonly ObjectivePlayer[];
  readonly preparation: PreparationState;
  readonly objectives: ReturnType<typeof dealInitialObjectives>;
  readonly cycle: SituationCycle;
  readonly activation: ActivatedSituation | null;
  readonly stage:
    | 'initial-placement'
    | 'reveal-situation'
    | 'extra-placement'
    | 'first-hostility'
    | 'campaign';
  readonly extraIndex: number;
  readonly extraBudgets: readonly number[];
  readonly hostility: FirstHostility | null;
  readonly campaign: Campaign | null;
  readonly catalog: unknown;
}
export type SetupAction =
  | { readonly kind: 'start-campaign' }
  /** Express clock: the final rounds are over. Only the server sends it. */
  | { readonly kind: 'time-limit' }
  | { readonly kind: 'campaign'; readonly action: CampaignAction }
  | HostilityAction
  | {
      readonly kind: 'place';
      readonly placements: Readonly<Record<string, number>>;
      readonly conversions: Readonly<Record<string, number>>;
    }
  | { readonly kind: 'reveal' }
  | {
      readonly kind: 'extra';
      readonly placements: Readonly<Record<string, number>>;
      readonly conversions: Readonly<Record<string, number>>;
    };
export function createReconquistaSession(
  catalog: unknown,
  players: readonly ObjectivePlayer[],
  random: PreparationRandom,
): ReconquistaSession {
  const board = preparationBoard(catalog);
  const preparation = createPreparation(
    board,
    players.map((p) => p.id),
    random,
  );
  const objectives = dealInitialObjectives(
    catalog,
    players,
    preparation.circle,
    random,
  );
  return {
    kind: 'reconquista-session',
    version: 1,
    players: players.map((p) => ({ ...p })),
    preparation,
    objectives,
    cycle: initialSituationCycle(createSituationDeck(catalog, random)),
    activation: null,
    stage: 'initial-placement',
    extraIndex: 0,
    extraBudgets: [],
    hostility: null,
    campaign: null,
    catalog,
  };
}
/** Blockade applicable here only to exclusive initial occupation; shared blockade remains P13/P15. */
export function blockedReconquistaCountry(
  board: PreparationBoard,
  territories: readonly ReconquistaTerritory[],
  actorId: string,
  countryId: string,
): boolean {
  const occupied = territories.filter((t) =>
    t.forces.some((f) => f.playerId === actorId),
  );
  if (occupied.length === 1) return false;
  const neighbors = board.connections
    .filter((e) => e.endpoints.includes(countryId))
    .map((e) => e.endpoints.find((id) => id !== countryId)!);
  if (neighbors.length < 3) return false;
  const around = neighbors.map((id) => territories.find((t) => t.id === id)!);
  const first = around[0]!.ownership;
  if (first.kind !== 'exclusive' || first.playerId === actorId) return false;
  return around.every(
    (t) =>
      t.ownership.kind === 'exclusive' &&
      t.ownership.playerId === first.playerId &&
      t.forces[0]!.armies >= 2,
  );
}
export function reconquistaLegalActions(
  board: PreparationBoard,
  state: ReconquistaSession,
  actorId: string,
) {
  if (!state.players.some((p) => p.id === actorId))
    throw new Error('Unknown actor');
  const prep = state.preparation;
  const current =
    state.stage === 'initial-placement'
      ? prep.circle[prep.playerIndex]!
      : state.stage === 'extra-placement'
        ? prep.circle[state.extraIndex]!
        : prep.circle[0]!;
  const own = prep.territories
    .filter((t) => t.forces.some((f) => f.playerId === actorId))
    .map((t) => t.id);
  const placementCountryIds =
    state.stage === 'initial-placement'
      ? own
      : own.filter(
          (id) =>
            !blockedReconquistaCountry(board, prep.territories, actorId, id),
        );
  return {
    actorId: current,
    canPlace:
      current === actorId &&
      (state.stage === 'initial-placement' ||
        state.stage === 'extra-placement'),
    canReveal: current === actorId && state.stage === 'reveal-situation',
    budget:
      state.stage === 'initial-placement'
        ? initialBudgets(prep.players.length)[prep.passIndex]!
        : state.stage === 'extra-placement'
          ? state.extraBudgets[state.extraIndex]!
          : 0,
    placementCountryIds,
  };
}
/** The first situation is drawn automatically once initial placement ends (no reveal step). */
function revealFirstSituation(
  board: PreparationBoard,
  state: ReconquistaSession,
  random: PreparationRandom,
): ReconquistaSession {
  const activation = activateSituation(state.cycle, state.players, random);
  const extras = activation.cycle.active!.typeId === 'extra_reinforcements';
  const extraBudgets = extras
    ? state.preparation.circle.map((id) =>
        Math.floor(
          occupationSummary(board, state.preparation.territories, id).countryIds
            .length / 2,
        ),
      )
    : [];
  return {
    ...state,
    cycle: activation.cycle,
    activation,
    extraBudgets,
    stage: extras ? 'extra-placement' : 'first-hostility',
    hostility: extras
      ? null
      : createFirstHostility(
          state.preparation.territories,
          state.preparation.circle[0]!,
        ),
  };
}
export function applyReconquistaSetup(
  board: PreparationBoard,
  state: ReconquistaSession,
  actorId: string,
  action: SetupAction,
  random: PreparationRandom,
): ReconquistaSession {
  if (action.kind === 'start-campaign') {
    if (
      state.campaign ||
      state.stage !== 'first-hostility' ||
      !state.hostility ||
      state.preparation.circle[0] !== actorId
    )
      throw Error('Campaign unavailable');
    // Initialization is an explicit journalled command: old random tapes remain byte-for-byte readable.
    const campaign = createCampaign(
      board,
      state.catalog,
      state.players,
      state.preparation.circle,
      state.objectives.secrets,
      state.hostility,
      state.activation!,
      random,
      state.preparation.territories,
    );
    return { ...state, campaign, hostility: null, stage: 'campaign' };
  }
  if (action.kind === 'time-limit') {
    if (!state.campaign) throw Error('Start full turns first');
    return { ...state, campaign: finishByTime(state.campaign) };
  }
  if (action.kind === 'campaign') {
    if (!state.campaign) throw Error('Start full turns first');
    return {
      ...state,
      campaign: applyCampaign(
        board,
        state.catalog,
        state.campaign,
        actorId,
        action.action,
        random,
      ),
    };
  }
  if (state.campaign) throw Error('Use full-turn commands');
  // User decision 2026-10-19: missiles start with full turns; none during preparation or first hostility.
  if (
    action.kind === 'fire-missile' ||
    action.kind === 'regroup-missiles' ||
    ((action.kind === 'place' || action.kind === 'extra') &&
      Object.keys(action.conversions).length > 0)
  )
    throw new Error('Missiles are unavailable before full turns');
  const legal = reconquistaLegalActions(board, state, actorId);
  if (
    action.kind === 'attack' ||
    action.kind === 'transfer' ||
    action.kind === 'finish-attacks' ||
    action.kind === 'regroup'
  ) {
    if (state.stage !== 'first-hostility' || !state.hostility)
      throw new Error('Hostility unavailable');
    return {
      ...state,
      hostility: applyFirstHostility(
        board,
        state.hostility,
        actorId,
        action,
        state.cycle.active!.typeId,
        state.activation?.restingPlayerId ?? null,
        state.players.map((p) => p.id),
        random,
      ),
    };
  }
  if (action.kind === 'place') {
    if (!legal.canPlace || state.stage !== 'initial-placement')
      throw new Error('Initial placement unavailable');
    const preparation = placeInitialArmies(
      board,
      state.preparation,
      actorId,
      action.placements,
      action.conversions,
    );
    const placed: ReconquistaSession = {
      ...state,
      preparation,
      stage:
        preparation.stage === 'awaiting-rules'
          ? 'reveal-situation'
          : 'initial-placement',
    };
    return placed.stage === 'reveal-situation'
      ? revealFirstSituation(board, placed, random)
      : placed;
  }
  if (action.kind === 'reveal') {
    // Games saved before automatic reveal can still leave this stage.
    if (!legal.canReveal) throw new Error('Situation reveal unavailable');
    return revealFirstSituation(board, state, random);
  }
  if (
    action.kind !== 'extra' ||
    !legal.canPlace ||
    state.stage !== 'extra-placement'
  )
    throw new Error('Extra placement unavailable');
  if (
    [
      ...Object.keys(action.placements),
      ...Object.keys(action.conversions),
    ].some((id) => !legal.placementCountryIds.includes(id))
  )
    throw new Error(
      'Blocked or foreign extra destination; shared missile rules remain unresolved',
    );
  const territories = placeReconquistaForces(
    board,
    state.preparation.territories,
    actorId,
    legal.budget,
    action.placements,
    action.conversions,
  );
  const extraIndex = state.extraIndex + 1;
  return {
    ...state,
    preparation: { ...state.preparation, territories },
    extraIndex,
    stage:
      extraIndex === state.players.length
        ? 'first-hostility'
        : 'extra-placement',
    hostility:
      extraIndex === state.players.length
        ? createFirstHostility(territories, state.preparation.circle[0]!)
        : null,
  };
}
/** Server chooses viewer from authenticated session; admin=null has no secrets. */
/** A player's objectives; a destroy target someone else eliminated becomes 45 countries. */
function playerObjectives(state: ReconquistaSession, playerId: string) {
  return privateInitialObjectives(state.objectives, playerId).map((o) =>
    o.targetPlayerId &&
    state.campaign?.eliminations[o.targetPlayerId] &&
    state.campaign.eliminations[o.targetPlayerId] !== playerId
      ? { objectiveId: 'common_45' }
      : o,
  );
}

export function projectReconquistaSession(
  board: PreparationBoard,
  state: ReconquistaSession,
  viewerId: string | null,
) {
  if (viewerId !== null && !state.players.some((p) => p.id === viewerId))
    throw new Error('Unknown viewer');
  const campaign = state.campaign
    ? projectCampaign(board, state.campaign, viewerId)
    : null;
  return {
    campaign: campaign?.public ?? null,
    kind: state.kind,
    version: state.version,
    stage: state.stage,
    players: structuredClone(state.players),
    territories: structuredClone(
      state.campaign?.territories ??
        state.hostility?.territories ??
        state.preparation.territories,
    ),
    hostility:
      !state.campaign && state.hostility
        ? {
            actorId: state.hostility.actorId,
            phase: state.hostility.phase,
            pendingConquest: structuredClone(state.hostility.pendingConquest),
            lastCombat: structuredClone(state.hostility.lastCombat),
            lastMissile: structuredClone(state.hostility.lastMissile),
          }
        : null,
    circle: [...state.preparation.circle],
    situation: (state.campaign?.cycle ?? state.cycle).active
      ? { ...(state.campaign?.cycle ?? state.cycle).active! }
      : null,
    crisis: (state.campaign?.activation ?? state.activation)?.crisis
      ? structuredClone(
          (state.campaign?.activation ?? state.activation)!.crisis,
        )
      : null,
    restingPlayerId:
      (state.campaign?.activation ?? state.activation)?.restingPlayerId ?? null,
    // Once the game is won, everyone sees the winners' objectives.
    winnerObjectives: (state.campaign?.winners ?? []).map((playerId) => ({
      playerId,
      objectives: playerObjectives(state, playerId),
    })),
    ...(viewerId
      ? {
          self: {
            playerId: viewerId,
            ...(campaign?.private ? { campaign: campaign.private } : {}),
            objectives: playerObjectives(state, viewerId),
            legal: {
              ...reconquistaLegalActions(board, state, viewerId),
              ...(state.hostility
                ? firstHostilityActions(
                    board,
                    state.hostility,
                    viewerId,
                    state.cycle.active!.typeId,
                    state.activation?.restingPlayerId ?? null,
                  )
                : {
                    attacks: [],
                    regroups: [],
                    missileShots: [],
                    missileRegroups: [],
                    transfer: null,
                  }),
            },
          },
        }
      : {}),
  };
}
/** Ordinary dice candidates only; missile actions are exposed separately in the session projection. */
export function firstHostilityCandidates(
  board: PreparationBoard,
  state: ReconquistaSession,
  actorId: string,
) {
  return state.hostility
    ? firstHostilityActions(
        board,
        state.hostility,
        actorId,
        state.cycle.active!.typeId,
        state.activation?.restingPlayerId ?? null,
      ).attacks
    : [];
}

// Persist commands and consumed random draws, then replay semantic validation on load.
// Classic's snapshot reader rejects this format; Reconquista games live in their own store.
export interface SetupRecord {
  readonly actorId: string;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly action: SetupAction;
  readonly draws: readonly number[];
}
export interface SetupJournal {
  readonly kind: 'reconquista-journal';
  readonly version: 1;
  readonly catalogContract: string;
  readonly players: readonly ObjectivePlayer[];
  readonly initialDraws: readonly number[];
  readonly commands: readonly SetupRecord[];
}
function recordedRandom(random: PreparationRandom) {
  const draws: number[] = [];
  return {
    draws,
    random: () => {
      const n = random();
      if (!Number.isFinite(n) || n < 0 || n >= 1)
        throw new Error('Invalid journal RNG');
      draws.push(n);
      return n;
    },
  };
}
function replayRandom(draws: readonly number[]) {
  if (
    !Array.isArray(draws) ||
    draws.length > 200000 ||
    draws.some((n) => !Number.isFinite(n) || n < 0 || n >= 1)
  )
    throw new Error('Invalid random tape');
  let cursor = 0;
  return {
    random: () => {
      if (cursor >= draws.length) throw new Error('Incomplete random tape');
      const value: unknown = draws[cursor++];
      if (typeof value !== 'number')
        throw new Error('Invalid random tape value');
      return value;
    },
    finish: () => {
      if (cursor !== draws.length) throw new Error('Excess random tape');
    },
  };
}
export function newSetupJournal(
  catalog: unknown,
  players: readonly ObjectivePlayer[],
  random: PreparationRandom,
) {
  const tape = recordedRandom(random);
  const state = createReconquistaSession(catalog, players, tape.random);
  const journal: SetupJournal = {
    kind: 'reconquista-journal',
    version: 1,
    catalogContract: JSON.stringify(catalog),
    players: players.map((p) => ({ ...p })),
    initialDraws: tape.draws,
    commands: [],
  };
  return { state, journal, revision: 0 };
}
function checkedAction(value: unknown): SetupAction {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    if (value.kind === 'start-campaign') {
      object(value, ['kind']);
      return { kind: 'start-campaign' };
    }
    if (value.kind === 'finish-attacks') {
      object(value, ['kind']);
      return { kind: 'finish-attacks' };
    }
    if (value.kind === 'time-limit') {
      object(value, ['kind']);
      return { kind: 'time-limit' };
    }
    if (value.kind === 'campaign') {
      const a = object(value, ['kind', 'action']);
      return { kind: 'campaign', action: checkedCampaignAction(a.action) };
    }
    if (value.kind === 'fire-missile') {
      const a = object(value, ['kind', 'originId', 'targetId']);
      return {
        kind: 'fire-missile',
        originId: text(a.originId),
        targetId: text(a.targetId),
      };
    }
    if (value.kind === 'regroup-missiles') {
      const a = object(value, ['kind', 'originId', 'targetId', 'missiles']);
      return {
        kind: 'regroup-missiles',
        originId: text(a.originId),
        targetId: text(a.targetId),
        missiles: integer(a.missiles, 1),
      };
    }
    if (value.kind === 'attack' || value.kind === 'regroup') {
      const a = object(
        value,
        value.kind === 'attack'
          ? ['kind', 'originId', 'targetId']
          : ['kind', 'originId', 'targetId', 'armies'],
      );
      return value.kind === 'attack'
        ? {
            kind: 'attack',
            originId: text(a.originId),
            targetId: text(a.targetId),
          }
        : {
            kind: 'regroup',
            originId: text(a.originId),
            targetId: text(a.targetId),
            armies: integer(a.armies, 1),
          };
    }
    if (value.kind === 'transfer') {
      const a = object(value, ['kind', 'armies']);
      return { kind: 'transfer', armies: integer(a.armies, 1) };
    }
  }
  const a = object(value, ['kind', 'placements', 'conversions']);
  if (a.kind === 'reveal') {
    object(value, ['kind']);
    return { kind: 'reveal' };
  }
  if (a.kind !== 'place' && a.kind !== 'extra')
    throw new Error('Unknown setup command');
  const normalized: Record<string, Readonly<Record<string, number>>> = {};
  for (const field of ['placements', 'conversions']) {
    const amounts = a[field];
    if (!amounts || typeof amounts !== 'object' || Array.isArray(amounts))
      throw new Error('Invalid amounts');
    const record = amounts as Record<string, unknown>;
    normalized[field] = Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((id) => [id, integer(record[id], 1)]),
    );
  }
  return {
    kind: a.kind,
    placements: normalized.placements!,
    conversions: normalized.conversions!,
  };
}
export function loadSetupJournal(catalog: unknown, value: unknown) {
  const raw = object(value, [
    'kind',
    'version',
    'players',
    'initialDraws',
    'commands',
    'catalogContract',
  ]);
  if (
    raw.kind !== 'reconquista-journal' ||
    raw.version !== 1 ||
    raw.catalogContract !== JSON.stringify(catalog) ||
    !Array.isArray(raw.players) ||
    !Array.isArray(raw.commands) ||
    raw.commands.length > 50000
  )
    throw new Error('Incompatible setup journal');
  const players = raw.players.map((p) => {
    const entry = object(p, ['id', 'color']);
    return { id: text(entry.id), color: text(entry.color) };
  });
  const initialDraws = raw.initialDraws as readonly number[];
  const tape = replayRandom(initialDraws);
  let state = createReconquistaSession(catalog, players, tape.random);
  tape.finish();
  const board = preparationBoard(catalog);
  const ids: string[] = [];
  const commands = raw.commands.map((v, revision): SetupRecord => {
    const c = object(v, [
      'actorId',
      'commandId',
      'expectedRevision',
      'action',
      'draws',
    ]);
    const commandId = text(c.commandId);
    ids.push(commandId);
    unique(ids);
    if (integer(c.expectedRevision) !== revision)
      throw new Error('Invalid journal revision');
    const action = checkedAction(c.action);
    const draws = c.draws as readonly number[];
    const rng = replayRandom(draws);
    const actorId = text(c.actorId);
    state = applyReconquistaSetup(board, state, actorId, action, rng.random);
    rng.finish();
    assertPreparation(board, state.preparation);
    if (state.campaign) assertCampaign(board, catalog, state.campaign);
    if (state.hostility)
      assertFirstHostility(
        board,
        state.hostility,
        players.map((p) => p.id),
      );
    return {
      actorId,
      commandId,
      expectedRevision: revision,
      action,
      draws: [...draws],
    };
  });
  return {
    state,
    revision: commands.length,
    journal: {
      kind: 'reconquista-journal' as const,
      version: 1 as const,
      catalogContract: JSON.stringify(catalog),
      players,
      initialDraws: [...initialDraws],
      commands,
    },
  };
}
export function commitSetupCommand(
  catalog: unknown,
  journal: SetupJournal,
  actorId: string,
  commandId: string,
  expectedRevision: number,
  value: unknown,
  random: PreparationRandom,
) {
  return commitLoadedSetupCommand(
    catalog,
    loadSetupJournal(catalog, journal),
    actorId,
    commandId,
    expectedRevision,
    value,
    random,
  );
}
/**
 * Same as commitSetupCommand, on a journal already replayed by
 * loadSetupJournal: only the new command runs, so a long game stays fast.
 */
export function commitLoadedSetupCommand(
  catalog: unknown,
  loaded: ReturnType<typeof loadSetupJournal>,
  actorId: string,
  commandId: string,
  expectedRevision: number,
  value: unknown,
  random: PreparationRandom,
) {
  text(commandId);
  const action = checkedAction(value);
  const duplicate = loaded.journal.commands.find(
    (c) => c.commandId === commandId,
  );
  if (duplicate) {
    if (
      duplicate.actorId !== actorId ||
      duplicate.expectedRevision !== expectedRevision ||
      JSON.stringify(duplicate.action) !== JSON.stringify(action)
    )
      throw new Error('Conflicting command identifier');
    return { ...loaded, duplicate: true };
  }
  if (expectedRevision !== loaded.revision)
    throw new Error('Stale setup revision');
  if (loaded.journal.commands.length >= 50000)
    throw new Error('Internal journal safety limit reached');
  const tape = recordedRandom(random);
  const state = applyReconquistaSetup(
    preparationBoard(catalog),
    loaded.state,
    actorId,
    action,
    tape.random,
  );
  const record: SetupRecord = {
    actorId,
    commandId,
    expectedRevision,
    action,
    draws: tape.draws,
  };
  return {
    state,
    revision: loaded.revision + 1,
    journal: {
      ...loaded.journal,
      commands: [...loaded.journal.commands, record],
    },
    duplicate: false,
  };
}
