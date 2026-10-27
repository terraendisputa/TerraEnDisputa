/** Full Reconquista turn lifecycle, D36–D65. Played through the Reconquista server routes. */
import { integer, unique } from './contracts.js';
import {
  occupationSummary,
  type PreparationBoard,
  type PreparationRandom,
} from './preparation.js';
import type { FirstHostility } from './hostilities.js';
import type { InitialSecret, ObjectivePlayer } from './objectives.js';
import {
  assertSituationCycle,
  activateSituation,
  permitsDiceAttack,
  resolveReconquistaCombat,
  type ActivatedSituation,
} from './round.js';
import {
  assertCards,
  createCards,
  drawCountryCard,
  exchangeCards,
  exchangeOptions,
  inheritCountryCards,
  shuffleCards,
} from './cards.js';
import { meetsVictory } from './victory.js';
import {
  adjacent,
  attackProtected,
  assertPoliticalIds,
  blockedCountry,
  borderPairs,
  continent,
  endInvalidPacts,
  force,
  permittedMissileDistance,
  territory,
  turnActor,
} from './campaign-politics.js';
import type {
  Campaign,
  CampaignAction,
  CampaignTerritory,
} from './campaign-types.js';
export type { Campaign, CampaignAction } from './campaign-types.js';
function reject(message: string): never {
  throw Error(`Reconquista: ${message}`);
}
const army = (s: Campaign, id: string, player: string) =>
  force(territory(s, id), player)?.armies ?? 0;
const own = (s: Campaign, player: string) =>
  s.territories.filter((t) => force(t, player));
const resting = (s: Campaign, player: string) =>
  s.activation.restingPlayerId === player;
const currentAlliance = (s: Campaign) =>
  s.alliances.find((a) => a.id === s.activeAllianceId);
function syncOwnership(t: CampaignTerritory): void {
  if (t.forces.length === 1)
    t.ownership = { kind: 'exclusive', playerId: t.forces[0]!.playerId };
  else if (t.forces.length === 2)
    t.ownership = {
      kind: 'shared',
      playerIds: [t.forces[0]!.playerId, t.forces[1]!.playerId],
    };
  else if (t.forces.length !== 0) reject('More than two stable occupants');
}
function allExclusive(
  board: PreparationBoard,
  s: Campaign,
  player: string,
  cont: string,
): boolean {
  return board.countries
    .filter((c) => c.continentId === cont)
    .every((c) => {
      const t = territory(s, c.id);
      return (
        t.ownership.kind === 'exclusive' &&
        t.ownership.playerId === player &&
        !!force(t, player)
      );
    });
}
function counters(s: Campaign, player: string) {
  return s.conquests[player] ?? { individual: 0, joint: 0 };
}
function countConquest(
  s: Campaign,
  player: string,
  joint: boolean,
  countryId: string,
) {
  const category = joint ? 'joint' : 'individual';
  const countries =
    s.conquestCountries[player] ??
    (s.conquestCountries[player] = { individual: [], joint: [] });
  if (!countries[category].includes(countryId))
    countries[category].push(countryId);
  const c =
    s.conquests[player] ?? (s.conquests[player] = { individual: 0, joint: 0 });
  c[category] = countries[category].length;
}
function claimEligible(s: Campaign, player: string): boolean {
  const c = counters(s, player);
  return (
    !s.claimed[player] &&
    !s.activation.crisis?.affectedPlayerIds.includes(player) &&
    s.cards.hands[player]!.length < 5 &&
    (c.individual >= ((s.cards.exchanges[player] ?? 0) >= 3 ? 2 : 1) ||
      c.joint >= 2)
  );
}
/** Opens one player's hostility turn: attack, regroup and closing, with per-turn counters reset. */
function hostilityTurnStarted(s: Campaign): void {
  const actor = turnActor(s);
  if (own(s, actor).length === 1 && !s.lastCountryLiberated.includes(actor))
    s.lastCountryLiberated.push(actor);
  s.pacts = s.pacts.filter(
    (p) =>
      !p.untilStart ||
      p.untilStart.playerId !== actor ||
      s.round < p.untilStart.round,
  );
  s.fixedArmies = {};
  s.fixedMissiles = {};
  s.conquests = {};
  s.conquestCountries = {};
  s.claimed = {};
  s.allyWindows = [];
  s.allyDestinations = {};
  s.pending = null;
  s.activeAllianceId = null;
  for (const p of s.pacts)
    if (p.kind === 'zone') {
      p.opportunity = false;
      p.fulfilled = false;
    }
  s.freeBudget = 0;
  s.continentBudgets = {};
  s.phase = 'attack';
}
/** Ordinary incorporation is a pass of all players before the hostility pass, as in Classic (D75). */
function incorporationStarted(board: PreparationBoard, s: Campaign): void {
  const summary = occupationSummary(board, s.territories, turnActor(s));
  s.freeBudget = summary.countryReinforcements;
  s.continentBudgets = Object.fromEntries(
    summary.continentBonuses.map((c) => [c.continentId, c.armies]),
  );
  s.phase = 'incorporation';
}
function nextAlive(s: Campaign, from: number): number {
  let next = from;
  while (next < s.order.length && s.eliminations[s.order[next]!]) next++;
  return next;
}
export function createCampaign(
  board: PreparationBoard,
  catalog: unknown,
  players: readonly ObjectivePlayer[],
  circle: readonly string[],
  objectives: readonly {
    playerId: string;
    objectives: readonly InitialSecret[];
  }[],
  hostility: FirstHostility,
  activation: ActivatedSituation,
  random: PreparationRandom,
  originalTerritories?: readonly {
    id: string;
    forces: readonly { playerId: string }[];
  }[],
): Campaign {
  if (hostility.pendingConquest)
    reject('Resolve occupation before opening full turns');
  const s: Campaign = {
    round: 1,
    order: [...circle],
    turnIndex: 0,
    circle: [...circle],
    players: structuredClone([...players]),
    objectives: objectives.map((e) => ({
      playerId: e.playerId,
      objectives: e.objectives.map((o) => ({ ...o })),
    })),
    territories: hostility.territories.map((t) => ({
      ...t,
      ownership: structuredClone(t.ownership),
      forces: t.forces.map((f) => ({ ...f })),
    })),
    phase: hostility.phase,
    cycle: structuredClone(activation.cycle),
    activation: structuredClone(activation),
    cards: createCards(
      catalog,
      players.map((p) => p.id),
      random,
    ),
    extraQueue: [],
    extraPass: false,
    nextAgreement: 0,
    freeBudget: 0,
    continentBudgets: {},
    fixedArmies: Object.fromEntries(
      Object.entries(hostility.fixedArmies).map(([id, n]) => [
        `${hostility.actorId}:${id}`,
        n,
      ]),
    ),
    fixedMissiles: Object.fromEntries(
      Object.entries(hostility.fixedMissiles).map(([id, n]) => [
        `${hostility.actorId}:${id}`,
        n,
      ]),
    ),
    pending: null,
    invasionSpoils: {},
    activeAllianceId: null,
    alliances: [],
    pacts: [],
    sharedOriginal: {},
    conquests: {},
    conquestCountries: {},
    claimed: {},
    allyWindows: [],
    allyDestinations: {},
    lastCountryLiberated: [],
    completedTurns: Object.fromEntries(players.map((p) => [p.id, 0])),
    eliminations: {},
    penaltyDebts: Object.fromEntries(players.map((p) => [p.id, 0])),
    zoneDecisions: [],
    winners: [],
    lastCombat: null,
    lastMissile: null,
  };
  if (originalTerritories) {
    const gained = s.territories
      .filter(
        (t) =>
          force(t, hostility.actorId) &&
          !originalTerritories
            .find((o) => o.id === t.id)
            ?.forces.some((f) => f.playerId === hostility.actorId),
      )
      .map((t) => t.id);
    s.conquestCountries[hostility.actorId] = { individual: gained, joint: [] };
    s.conquests[hostility.actorId] = { individual: gained.length, joint: 0 };
    for (const p of players)
      if (own(s, p.id).length === 0) s.eliminations[p.id] = hostility.actorId;
  }
  finishVictory(board, catalog, s);
  assertCampaign(board, catalog, s);
  return s;
}
function canAttack(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  originId: string,
  targetId: string,
  defenderId: string,
  missile = false,
): boolean {
  if (
    s.phase !== 'attack' ||
    (s.pending &&
      (!s.pending.continuing ||
        s.pending.targetId !== targetId ||
        s.pending.arrivals[0]?.originId !== originId ||
        s.pending.arrivals[0]?.playerId !== actor)) ||
    s.winners.length ||
    resting(s, actor)
  )
    return false;
  const alliance = currentAlliance(s);
  if (alliance) {
    if (
      alliance.nextId !== actor ||
      targetId !== alliance.targetId ||
      originId !==
        (actor === alliance.proposerId
          ? alliance.originId
          : alliance.allyOriginId)
    )
      return false;
  } else if (turnActor(s) !== actor) return false;
  const from = territory(s, originId),
    to = territory(s, targetId),
    af = force(from, actor),
    df = force(to, defenderId);
  if (!af || !df || actor === defenderId) return false;
  if (s.sharedOriginal[targetId] && force(to, actor) && originId !== targetId)
    return false;
  if (
    s.sharedOriginal[originId] &&
    originId !== targetId &&
    from.forces.some((f) => f.playerId !== actor && force(to, f.playerId))
  )
    return false;
  if (
    attackProtected(board, s, actor, defenderId, originId, targetId) ||
    !permitsDiceAttack(
      s.cycle.active!.typeId,
      continent(board, originId),
      continent(board, targetId),
    )
  )
    return false;
  if (missile) {
    if (af.missiles <= df.missiles) return false;
    const distance = permittedMissileDistance(
      board,
      s,
      actor,
      originId,
      targetId,
    );
    return !!distance && af.missiles > df.missiles && df.armies > 4 - distance;
  }
  return (
    af.armies >= 2 &&
    (originId === targetId || adjacent(board, originId, targetId))
  );
}
function canRegroup(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  originId: string,
  targetId: string,
): boolean {
  if (
    s.pending ||
    s.activeAllianceId ||
    resting(s, actor) ||
    !['attack', 'regroup', 'ally-regroup'].includes(s.phase)
  )
    return false;
  if (s.phase === 'ally-regroup') {
    if (
      s.allyWindows[0] !== actor ||
      !s.allyDestinations[actor]?.includes(targetId) ||
      !force(territory(s, targetId), turnActor(s)) ||
      territory(s, targetId).ownership.kind !== 'shared'
    )
      return false;
  } else if (turnActor(s) !== actor) return false;
  return (
    adjacent(board, originId, targetId) &&
    !!force(territory(s, originId), actor) &&
    !!force(territory(s, targetId), actor) &&
    !blockedCountry(board, s, actor, targetId) &&
    !s.pacts.some(
      (p) =>
        p.status === 'active' &&
        p.kind === 'zone' &&
        p.countryIds.includes(targetId),
    )
  );
}
export function campaignLegal(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
) {
  const attackRoutes: {
    originId: string;
    targetId: string;
    defenderId: string;
  }[] = [];
  const missileShots: {
    originId: string;
    targetId: string;
    defenderId: string;
    distance: number;
    damage: number;
  }[] = [];
  const regroups: {
    originId: string;
    targetId: string;
    armies: number;
    missiles: number;
  }[] = [];
  for (const from of own(s, actor).filter(
    (t) => force(t, actor)!.armies >= 2 || force(t, actor)!.missiles > 0,
  ))
    for (const to of s.territories) {
      for (const d of to.forces) {
        if (canAttack(board, s, actor, from.id, to.id, d.playerId))
          attackRoutes.push({
            originId: from.id,
            targetId: to.id,
            defenderId: d.playerId,
          });
        if (canAttack(board, s, actor, from.id, to.id, d.playerId, true)) {
          const distance = permittedMissileDistance(
            board,
            s,
            actor,
            from.id,
            to.id,
          )!;
          missileShots.push({
            originId: from.id,
            targetId: to.id,
            defenderId: d.playerId,
            distance,
            damage: 4 - distance,
          });
        }
      }
      if (canRegroup(board, s, actor, from.id, to.id)) {
        const f = force(from, actor)!;
        const armies = Math.min(
          f.armies - 1,
          f.armies - (s.fixedArmies[`${actor}:${from.id}`] ?? 0),
        );
        const missiles =
          f.missiles - (s.fixedMissiles[`${actor}:${from.id}`] ?? 0);
        if (armies > 0 || missiles > 0)
          regroups.push({
            originId: from.id,
            targetId: to.id,
            armies,
            missiles,
          });
      }
    }
  const closing = s.phase === 'closing' && turnActor(s) === actor;
  // Armies from an exchange made while closing are placed before the turn ends.
  const exchangePlacement = closing && s.freeBudget > 0;
  const exchangeOpen =
    !s.extraPass &&
    (s.phase === 'incorporation' || (closing && s.freeBudget === 0)) &&
    turnActor(s) === actor &&
    s.cards.exchangedRound[actor] !== s.round;
  const cards =
    (closing ||
      (s.phase === 'ally-closing' && s.allyWindows[0] === actor) ||
      (s.phase === 'closing' && counters(s, actor).joint >= 2)) &&
    claimEligible(s, actor);
  const bonusPool = s.cards.hands[actor]!.filter(
    (c) =>
      c.countryId &&
      c.acquisition === 'draw' &&
      !c.bonusUsed &&
      force(territory(s, c.countryId), actor) &&
      !blockedCountry(board, s, actor, c.countryId) &&
      !s.pacts.some(
        (p) =>
          p.status === 'active' &&
          p.kind === 'zone' &&
          p.countryIds.includes(c.countryId!),
      ),
  ).map((c) => c.id);
  const continentPool = Object.entries(s.cards.continents)
    .filter(
      ([id, c]) =>
        c.holderId === null &&
        !c.usedBy.includes(actor) &&
        allExclusive(board, s, actor, id),
    )
    .map(([id]) => id);
  const bonuses = closing ? bonusPool : [];
  const continents = closing ? continentPool : [];
  const ownTurn =
    turnActor(s) === actor &&
    ['attack', 'regroup', 'closing'].includes(s.phase) &&
    !s.activeAllianceId;
  return {
    actorId:
      s.pending?.arrivals[0]?.playerId ??
      currentAlliance(s)?.nextId ??
      (['ally-regroup', 'ally-closing'].includes(s.phase)
        ? s.allyWindows[0]!
        : s.phase === 'zone-decision'
          ? s.zoneDecisions[0]!.playerId
          : turnActor(s)),
    attacks: attackRoutes,
    missileShots,
    regroups,
    canReinforce:
      (s.phase === 'incorporation' && turnActor(s) === actor) ||
      exchangePlacement,
    // Exchanges also close the turn; still one per round.
    canExchange: exchangeOpen,
    exchanges: exchangeOpen ? exchangeOptions(s.cards, actor) : [],
    canFinishAttacks:
      s.phase === 'attack' &&
      turnActor(s) === actor &&
      !s.pending &&
      !s.activeAllianceId,
    canFinishRegroup:
      ['attack', 'regroup'].includes(s.phase) &&
      turnActor(s) === actor &&
      !s.pending &&
      !s.activeAllianceId,
    canFinishAllyRegroup:
      ['ally-regroup', 'ally-closing'].includes(s.phase) &&
      s.allyWindows[0] === actor,
    canFinishTurn: closing && !exchangePlacement,
    canClaimCountry: !!cards,
    bonusCardIds: bonuses,
    continentIds: continents,
    needsForfeitConfirmation:
      !!cards || bonuses.length > 0 || continents.length > 0,
    canEndTurn:
      ownTurn &&
      !exchangePlacement &&
      (s.pending
        ? s.pending.arrivals.every((a) => a.playerId === actor)
        : Object.keys(s.invasionSpoils).length === 0),
    // Conservative: a pending conquest may still earn a card once occupied.
    endTurnMayForfeit:
      ownTurn &&
      (!!s.pending ||
        claimEligible(s, actor) ||
        bonusPool.length > 0 ||
        continentPool.length > 0),
    occupation:
      s.pending?.arrivals[0]?.playerId === actor
        ? structuredClone(s.pending)
        : null,
    freeBudget: s.freeBudget,
    continentBudgets: { ...s.continentBudgets },
    pactScopes: Object.fromEntries(
      s.players
        .filter((p) => p.id !== actor && !s.eliminations[p.id])
        .map((p) => [p.id, pactScopes(board, s, actor, p.id)]),
    ),
    placementCountryIds: own(s, actor)
      .filter(
        (t) =>
          !blockedCountry(board, s, actor, t.id) &&
          !s.pacts.some(
            (p) =>
              p.status === 'active' &&
              p.kind === 'zone' &&
              p.countryIds.includes(t.id),
          ),
      )
      .map((t) => t.id),
  };
}
function refreshContinents(board: PreparationBoard, s: Campaign) {
  for (const [id, c] of Object.entries(s.cards.continents))
    if (c.holderId && !allExclusive(board, s, c.holderId, id))
      c.holderId = null;
}
function eliminate(
  board: PreparationBoard,
  s: Campaign,
  random: PreparationRandom,
  credit: string,
) {
  for (const p of s.players)
    if (!s.eliminations[p.id] && own(s, p.id).length === 0) {
      s.eliminations[p.id] = credit;
      s.cards = inheritCountryCards(s.cards, credit, p.id, random);
      s.alliances = s.alliances.filter(
        (a) => a.proposerId !== p.id && a.allyId !== p.id,
      );
    }
  endInvalidPacts(board, s);
}
function finishVictory(board: PreparationBoard, catalog: unknown, s: Campaign) {
  if (s.pending || s.activeAllianceId) return;
  const winners = s.players
    .filter(
      (p) =>
        !s.eliminations[p.id] &&
        meetsVictory(
          board,
          catalog,
          own(s, p.id).map((t) => t.id),
          s.objectives.find((e) => e.playerId === p.id)!.objectives,
          s.players.length,
          p.id,
          s.eliminations,
        ),
    )
    .map((p) => p.id);
  if (winners.length) {
    s.winners = winners;
    s.phase = 'finished';
  }
}
function refreshZoneOpportunities(board: PreparationBoard, s: Campaign) {
  if (!['attack', 'regroup'].includes(s.phase) || s.pending) return;
  const actor = turnActor(s);
  for (const p of s.pacts.filter(
    (p) =>
      p.status === 'active' &&
      p.kind === 'zone' &&
      [p.proposerId, p.partnerId].includes(actor),
  )) {
    const target = territory(s, p.countryIds[0]!);
    if (
      target.forces.some(
        (f) =>
          f.playerId !== actor &&
          own(s, actor).some((from) =>
            canAttack(board, s, actor, from.id, target.id, f.playerId),
          ),
      )
    )
      p.opportunity = true;
    const ownForce = force(target, actor);
    if (
      ownForce &&
      (ownForce.armies !== 1 || ownForce.missiles !== 0) &&
      own(s, actor).some((to) => canRegroup(board, s, actor, target.id, to.id))
    )
      p.opportunity = true;
  }
}
function breakShared(s: Campaign, id: string, previousPlayers: string[]) {
  s.pacts = s.pacts.filter(
    (p) =>
      !(
        (p.kind === 'internal' || p.kind === 'origin') &&
        p.linkedCountryId === id &&
        previousPlayers.includes(p.proposerId) &&
        previousPlayers.includes(p.partnerId)
      ),
  );
  delete s.sharedOriginal[id];
}
function makeOccupation(
  s: Campaign,
  originId: string,
  targetId: string,
  actor: string,
  joint: boolean,
  previous: string[],
) {
  const target = territory(s, targetId),
    alliance = currentAlliance(s);
  const participants =
    joint && alliance
      ? [
          { playerId: alliance.proposerId, originId: alliance.originId },
          { playerId: alliance.allyId, originId: alliance.allyOriginId },
        ]
      : [{ playerId: actor, originId }];
  const arrivals = participants
    .map((p) => ({
      ...p,
      maximum: Math.min(joint ? 2 : 3, army(s, p.originId, p.playerId) - 1),
    }))
    .filter((p) => p.maximum >= 1);
  if (!arrivals.length) reject('No legal occupying army');
  const invasion = target.forces.length > 0;
  for (const arrival of arrivals)
    target.forces.push({ playerId: arrival.playerId, armies: 0, missiles: 0 });
  syncOwnership(target);
  s.pending = {
    targetId,
    creditId: actor,
    joint: arrivals.length === 2,
    arrivals,
    capturedMissiles: Object.entries(s.invasionSpoils)
      .filter(([key]) => key.startsWith(`${targetId}:`))
      .reduce((sum, [, n]) => sum + n, 0),
    invasion,
    continuing: false,
    originalDefenders: previous,
  };
}
function settleRepelledSpoils(s: Campaign, targetId: string) {
  const survivor = territory(s, targetId).forces.find((f) => f.armies > 0);
  if (!survivor) reject('No surviving occupant');
  for (const [key, missiles] of Object.entries(s.invasionSpoils)) {
    if (key.startsWith(`${targetId}:`)) {
      survivor.missiles += missiles;
      delete s.invasionSpoils[key];
    }
  }
}
function nextAllianceActor(s: Campaign) {
  const a = currentAlliance(s);
  if (!a) return;
  const candidates =
    a.nextId === a.proposerId
      ? [a.allyId, a.proposerId]
      : [a.proposerId, a.allyId];
  const next = candidates.find(
    (id) =>
      army(s, id === a.proposerId ? a.originId : a.allyOriginId, id) >= 2 &&
      !resting(s, id),
  );
  if (next) {
    a.nextId = next;
  } else {
    settleRepelledSpoils(s, a.targetId);
    s.activeAllianceId = null;
    s.alliances = s.alliances.filter((v) => v.id !== a.id);
  }
}
function applyBattle(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  action: Extract<CampaignAction, { kind: 'attack-country' | 'fire' }>,
  random: PreparationRandom,
) {
  const missile = action.kind === 'fire';
  if (
    !canAttack(
      board,
      s,
      actor,
      action.originId,
      action.targetId,
      action.defenderId,
      missile,
    )
  )
    reject('Illegal attack');
  const from = territory(s, action.originId),
    to = territory(s, action.targetId),
    af = force(from, actor)!,
    df = force(to, action.defenderId)!;
  if (missile) {
    const distance = permittedMissileDistance(board, s, actor, from.id, to.id)!;
    af.missiles--;
    df.armies -= 4 - distance;
    s.lastMissile = {
      originId: from.id,
      targetId: to.id,
      defenderId: df.playerId,
      distance,
      damage: 4 - distance,
    };
    s.lastCombat = null;
    nextAllianceActor(s);
    return;
  }
  const continuation = s.pending?.continuing ? s.pending : null;
  if (continuation) {
    to.forces = to.forces.filter((f) => f.armies > 0);
    syncOwnership(to);
    s.pending = null;
  }
  const result = resolveReconquistaCombat(
    af.armies,
    df.armies,
    s.cycle.active!.typeId,
    random,
  );
  af.armies -= result.attackLoss;
  df.armies -= result.defenseLoss;
  s.lastCombat = {
    originId: from.id,
    targetId: to.id,
    defenderId: df.playerId,
    ...result,
  };
  s.lastMissile = null;
  if (df.armies > 0) {
    if (continuation) {
      if (af.armies > 1)
        makeOccupation(
          s,
          from.id,
          to.id,
          actor,
          false,
          continuation.originalDefenders,
        );
      else settleRepelledSpoils(s, to.id);
    }
    nextAllianceActor(s);
    return;
  }
  const previous = to.forces.map((f) => f.playerId);
  s.invasionSpoils[`${to.id}:${actor}`] =
    (s.invasionSpoils[`${to.id}:${actor}`] ?? 0) + df.missiles;
  if (s.invasionSpoils[`${to.id}:${actor}`] === 0)
    delete s.invasionSpoils[`${to.id}:${actor}`];
  to.forces = to.forces.filter((f) => f !== df);
  if (to.ownership.kind === 'shared') breakShared(s, to.id, previous);
  syncOwnership(to);
  eliminate(board, s, random, actor);
  if (from.id === to.id) {
    af.missiles += s.invasionSpoils[`${to.id}:${actor}`] ?? 0;
    delete s.invasionSpoils[`${to.id}:${actor}`];
    countConquest(s, actor, false, to.id);
    eliminate(board, s, random, actor);
    return;
  }
  if (currentAlliance(s) && to.forces.length) {
    nextAllianceActor(s);
    return;
  }
  makeOccupation(s, from.id, to.id, actor, !!currentAlliance(s), previous);
  // Elimination credit is the final attacking player, but only after zero-army occupation resolves.
}
function occupy(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  armies: number,
  random: PreparationRandom,
) {
  const p = s.pending,
    arrival = p?.arrivals[0];
  if (
    !p ||
    !arrival ||
    arrival.playerId !== actor ||
    integer(armies, 1) > arrival.maximum
  )
    reject('Illegal occupation');
  const from = force(territory(s, arrival.originId), actor)!,
    to = territory(s, p.targetId);
  from.armies -= armies;
  let captured = s.invasionSpoils[`${to.id}:${actor}`] ?? 0;
  delete s.invasionSpoils[`${to.id}:${actor}`];
  if (!p.joint && !p.invasion) {
    for (const [key, missiles] of Object.entries(s.invasionSpoils))
      if (key.startsWith(`${to.id}:`)) {
        captured += missiles;
        delete s.invasionSpoils[key];
      }
  }
  const occupying = force(to, actor);
  if (!occupying || occupying.armies !== 0) reject('Invalid pending occupant');
  occupying.armies = armies;
  occupying.missiles = captured;
  syncOwnership(to);
  p.capturedMissiles -= captured;
  p.arrivals.shift();
  if (p.arrivals.length) return;
  const alliance = currentAlliance(s);
  if (p.joint && to.forces.length === 2) {
    s.sharedOriginal[to.id] = true;
    const [a, b] = to.forces.map((f) => f.playerId) as [string, string];
    s.pacts.push({
      id: `internal:${to.id}:${s.round}:${s.completedTurns[turnActor(s)]}:${s.pacts.length}`,
      proposerId: a,
      partnerId: b,
      kind: 'internal',
      linkedCountryId: to.id,
      countryIds: [to.id],
      continentIds: [],
      status: 'active',
      withdrawal: null,
      untilStart: null,
      opportunity: false,
      fulfilled: false,
    });
    countConquest(s, a, true, to.id);
    countConquest(s, b, true, to.id);
    if (alliance) {
      const ally = alliance.allyId;
      s.allyDestinations[ally] = [
        ...new Set([...(s.allyDestinations[ally] ?? []), to.id]),
      ];
      if (ally !== turnActor(s) && !s.allyWindows.includes(ally))
        s.allyWindows.push(ally);
    }
  } else {
    countConquest(s, actor, false, to.id);
    if (to.forces.length === 2) s.sharedOriginal[to.id] = false;
  }
  for (const zone of s.pacts.filter(
    (v) =>
      v.kind === 'zone' &&
      v.status === 'active' &&
      v.countryIds.includes(to.id),
  ))
    zone.fulfilled = true;
  s.pending = null;
  s.activeAllianceId = null;
  if (alliance) s.alliances = s.alliances.filter((a) => a.id !== alliance.id);
  eliminate(board, s, random, p.creditId);
}
function placeForces(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  placements: Record<string, number>,
  conversions: Record<string, number>,
  budget: number,
) {
  const legalIds = own(s, actor)
    .filter(
      (t) =>
        !blockedCountry(board, s, actor, t.id) &&
        !s.pacts.some(
          (p) =>
            p.status === 'active' &&
            p.kind === 'zone' &&
            p.countryIds.includes(t.id),
        ),
    )
    .map((t) => t.id);
  let sum = 0;
  for (const [id, n] of Object.entries(placements)) {
    if (!legalIds.includes(id)) reject('Blocked or foreign reinforcement');
    sum += integer(n, 1);
  }
  if (sum !== budget) reject('Incorrect reinforcement budget');
  for (const [id, n] of Object.entries(conversions)) {
    if (!legalIds.includes(id)) reject('Blocked or foreign conversion');
    integer(n, 1);
    const f = force(territory(s, id), actor)!;
    if (
      f.armies + (placements[id] ?? 0) - 6 * n < 1 ||
      !Number.isSafeInteger(n * 6)
    )
      reject('Conversion must preserve occupation');
  }
  for (const [id, n] of Object.entries(placements))
    force(territory(s, id), actor)!.armies += n;
  for (const [id, n] of Object.entries(conversions)) {
    const f = force(territory(s, id), actor)!;
    f.armies -= 6 * n;
    f.missiles += n;
  }
}
function moveForces(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  action: Extract<CampaignAction, { kind: 'regroup-forces' }>,
) {
  if (!canRegroup(board, s, actor, action.originId, action.targetId))
    reject('Illegal regroup');
  integer(action.armies);
  integer(action.missiles);
  if (action.armies + action.missiles === 0) reject('Empty regroup');
  const from = force(territory(s, action.originId), actor)!,
    to = force(territory(s, action.targetId), actor)!;
  if (
    action.armies >
      Math.min(
        from.armies - 1,
        from.armies - (s.fixedArmies[`${actor}:${action.originId}`] ?? 0),
      ) ||
    action.missiles >
      from.missiles - (s.fixedMissiles[`${actor}:${action.originId}`] ?? 0)
  )
    reject('Moved forces cannot relay');
  from.armies -= action.armies;
  to.armies += action.armies;
  from.missiles -= action.missiles;
  to.missiles += action.missiles;
  s.fixedArmies[`${actor}:${action.targetId}`] =
    (s.fixedArmies[`${actor}:${action.targetId}`] ?? 0) + action.armies;
  s.fixedMissiles[`${actor}:${action.targetId}`] =
    (s.fixedMissiles[`${actor}:${action.targetId}`] ?? 0) + action.missiles;
  if (s.phase !== 'ally-regroup') s.phase = 'regroup';
}
function advanceTurn(
  board: PreparationBoard,
  s: Campaign,
  random: PreparationRandom,
) {
  const actor = turnActor(s);
  s.completedTurns[actor] = (s.completedTurns[actor] ?? 0) + 1;
  s.pacts = s.pacts.filter(
    (p) =>
      !p.withdrawal ||
      (s.completedTurns[p.withdrawal.waitFor] ?? 0) <
        p.withdrawal.completedTurns,
  );
  s.alliances = s.alliances.filter(
    (a) => a.proposerId !== actor || a.executeTurn > s.completedTurns[actor]!,
  );
  const next = nextAlive(s, s.turnIndex + 1);
  if (next < s.order.length) {
    s.turnIndex = next;
    hostilityTurnStarted(s);
    return;
  }
  const aliveCircle = s.circle.filter((id) => !s.eliminations[id]);
  const oldStart = s.order[0]!;
  const originalIndex = s.circle.indexOf(oldStart);
  const rotated = Array.from(
    { length: s.circle.length },
    (_, i) => s.circle[(originalIndex + i + 1) % s.circle.length]!,
  ).filter((id) => aliveCircle.includes(id));
  s.round++;
  s.order = rotated;
  s.turnIndex = 0;
  const activation = activateSituation(
    s.cycle,
    s.players.filter((p) => !s.eliminations[p.id]),
    random,
  );
  s.cycle = activation.cycle;
  s.activation = activation;
  // Extras are an all-player pass before any ordinary incorporation; represented by a budget queue.
  if (s.cycle.active!.typeId === 'extra_reinforcements') {
    s.phase = 'incorporation';
    s.freeBudget = Math.floor(own(s, turnActor(s)).length / 2);
    s.continentBudgets = {};
    s.extraQueue = [...s.order];
    s.extraPass = true;
    s.fixedArmies = {};
    s.fixedMissiles = {};
    s.conquests = {};
    s.conquestCountries = {};
    s.claimed = {};
    s.allyWindows = [];
    s.allyDestinations = {};
  } else incorporationStarted(board, s);
}
function finishTurn(
  board: PreparationBoard,
  s: Campaign,
  random: PreparationRandom,
) {
  const actor = turnActor(s);
  for (const p of s.pacts.filter(
    (p) =>
      p.kind === 'zone' &&
      p.status === 'active' &&
      [p.proposerId, p.partnerId].includes(actor),
  )) {
    const t = territory(s, p.countryIds[0]!);
    const f = force(t, actor);
    const breach =
      p.opportunity &&
      ((!f && !p.fulfilled) || (!!f && (f.armies !== 1 || f.missiles !== 0)));
    if (!breach) continue;
    const hand = s.cards.hands[actor]!;
    if (hand.length) {
      const selected = shuffleCards(hand, random)[0]!;
      s.cards.hands[actor] = hand.filter((c) => c.id !== selected.id);
      s.cards.drawPile = shuffleCards(
        [
          ...s.cards.drawPile,
          {
            id: selected.id,
            countryId: selected.countryId,
            symbol: selected.symbol,
          },
        ],
        random,
      );
    } else s.penaltyDebts[actor] = (s.penaltyDebts[actor] ?? 0) + 1;
    s.zoneDecisions.push({
      pactId: p.id,
      playerId: p.proposerId === actor ? p.partnerId : p.proposerId,
    });
  }
  if (s.zoneDecisions.length) s.phase = 'zone-decision';
  else advanceTurn(board, s, random);
}
/**
 * Continents where a pact between two players means something (manual p. 28):
 * a continent pact needs both present in it; a pact between borders needs a
 * country of each bordering across two continents. Pairs are
 * [actor's continent, partner's continent].
 */
export function pactScopes(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  partner: string,
) {
  const present = (playerId: string) =>
    new Set(
      s.territories
        .filter((t) => force(t, playerId))
        .map((t) => continent(board, t.id)),
    );
  const mine = present(actor);
  const theirs = present(partner);
  const continents = [...mine].filter((id) => theirs.has(id)).sort();
  return {
    continents,
    continentPairs: borderPairs(board, s, actor, partner),
  };
}
function proposePact(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  a: Extract<CampaignAction, { kind: 'propose-pact' }>,
) {
  if (
    actor === a.partnerId ||
    s.eliminations[a.partnerId] ||
    !s.players.some((p) => p.id === a.partnerId)
  )
    reject('Invalid partner');
  unique(a.countryIds);
  unique(a.continentIds);
  a.countryIds.forEach((id) => territory(s, id));
  a.continentIds.forEach((id) => {
    if (!board.countries.some((c) => c.continentId === id))
      reject('Unknown continent');
  });
  if (a.pactKind === 'countries') {
    if (
      a.countryIds.length !== 2 ||
      a.continentIds.length ||
      !force(territory(s, a.countryIds[0]!), actor) ||
      !force(territory(s, a.countryIds[1]!), a.partnerId)
    )
      reject('Invalid country pact');
    if (
      permittedMissileDistance(
        board,
        { ...s, pacts: [] },
        actor,
        a.countryIds[0]!,
        a.countryIds[1]!,
      ) === null
    )
      reject('Pact beyond missile range');
  } else if (a.pactKind === 'zone') {
    if (
      a.countryIds.length !== 1 ||
      a.continentIds.length ||
      (s.cards.exchanges[actor] ?? 0) < 3 ||
      (s.cards.exchanges[a.partnerId] ?? 0) < 3
    )
      reject('Zone requires third exchange for both');
    const t = territory(s, a.countryIds[0]!);
    if (
      t.ownership.kind !== 'exclusive' ||
      t.ownership.playerId !== actor ||
      t.forces[0]!.armies !== 1 ||
      t.forces[0]!.missiles !== 0
    )
      reject('Zone must be weak and owned');
    if (
      ![actor, a.partnerId].every((id) =>
        own(s, id).some((o) => adjacent(board, o.id, t.id)),
      )
    )
      reject('Zone must border both signers');
    if (
      s.pacts.some(
        (p) =>
          p.kind === 'zone' &&
          [p.proposerId, p.partnerId].some((id) =>
            [actor, a.partnerId].includes(id),
          ),
      )
    )
      reject('One zone per player');
  } else if (a.pactKind === 'world') {
    if (a.countryIds.length || a.continentIds.length)
      reject('Invalid world scope');
  } else {
    if (
      a.countryIds.length ||
      a.continentIds.length !== (a.pactKind === 'continent' ? 1 : 2)
    )
      reject('Invalid continent scope');
    const scopes = pactScopes(board, s, actor, a.partnerId);
    const valid =
      a.pactKind === 'continent'
        ? scopes.continents.includes(a.continentIds[0]!)
        : // Either order: the action keeps its continents sorted.
          scopes.continentPairs.some(
            (pair) =>
              [...pair].sort().join('|') ===
              [...a.continentIds].sort().join('|'),
          );
    if (!valid) reject('Pact scope without presence or border');
  }
  s.pacts.push({
    id: `pact:${s.round}:${s.completedTurns[turnActor(s)]}:${s.nextAgreement++}`,
    proposerId: actor,
    partnerId: a.partnerId,
    kind: a.pactKind,
    linkedCountryId: null,
    countryIds: [...a.countryIds],
    continentIds: [...a.continentIds],
    status: 'proposed',
    withdrawal: null,
    untilStart: null,
    opportunity: false,
    fulfilled: false,
  });
}
function proposeAlliance(
  board: PreparationBoard,
  s: Campaign,
  actor: string,
  a: Extract<CampaignAction, { kind: 'propose-alliance' }>,
) {
  if (
    actor === a.allyId ||
    s.eliminations[a.allyId] ||
    resting(s, actor) ||
    resting(s, a.allyId)
  )
    reject('Invalid ally');
  if (
    !adjacent(board, a.originId, a.targetId) ||
    !adjacent(board, a.allyOriginId, a.targetId) ||
    army(s, a.originId, actor) < 2 ||
    army(s, a.allyOriginId, a.allyId) < 2
  )
    reject('Allies must border with attacking armies');
  const target = territory(s, a.targetId);
  if (target.forces.some((f) => [actor, a.allyId].includes(f.playerId)))
    reject('Alliance target must be a third party');
  s.alliances.push({
    id: `alliance:${s.round}:${s.completedTurns[turnActor(s)]}:${s.nextAgreement++}`,
    proposerId: actor,
    allyId: a.allyId,
    originId: a.originId,
    allyOriginId: a.allyOriginId,
    targetId: a.targetId,
    status: 'proposed',
    executeTurn:
      (s.completedTurns[actor] ?? 0) +
      (turnActor(s) === actor && !['incorporation', 'attack'].includes(s.phase)
        ? 2
        : 1),
    nextId: actor,
    exhaustive: territory(s, a.originId).ownership.kind !== 'shared',
  });
}
export function applyCampaign(
  board: PreparationBoard,
  catalog: unknown,
  before: Campaign,
  actor: string,
  action: CampaignAction,
  random: PreparationRandom,
): Campaign {
  assertCampaign(board, catalog, before);
  if (before.phase === 'finished' || before.eliminations[actor])
    reject('Game finished or player eliminated');
  const s = structuredClone(before);
  refreshZoneOpportunities(board, s);
  const legal = () => campaignLegal(board, s, actor);
  if (
    s.pending &&
    !['occupy', 'continue-invasion', 'end-turn'].includes(action.kind) &&
    !(s.pending.continuing && ['attack-country', 'fire'].includes(action.kind))
  )
    reject('Resolve occupation first');
  if (s.phase === 'zone-decision' && action.kind !== 'decide-zone')
    reject('Resolve zone decision first');
  if (action.kind === 'reinforce' && s.phase === 'closing') {
    if (!legal().canReinforce) reject('Not incorporation turn');
    if (Object.keys(action.continentPlacements).length)
      reject('Unknown continent budget');
    placeForces(
      board,
      s,
      actor,
      action.placements,
      action.conversions,
      s.freeBudget,
    );
    s.freeBudget = 0;
  } else if (action.kind === 'reinforce') {
    if (!legal().canReinforce) reject('Not incorporation turn');
    const combined = { ...action.placements };
    unique(Object.keys(action.continentPlacements));
    for (const [cont, budget] of Object.entries(s.continentBudgets)) {
      const placements = action.continentPlacements[cont] ?? {};
      if (
        Object.entries(placements).reduce((sum, [id, n]) => {
          if (continent(board, id) !== cont)
            reject('Continent bonus left its continent');
          return sum + integer(n, 1);
        }, 0) !== budget
      )
        reject('Continent budget mismatch');
      for (const [id, n] of Object.entries(placements))
        combined[id] = (combined[id] ?? 0) + n;
    }
    if (
      Object.keys(action.continentPlacements).some(
        (id) => s.continentBudgets[id] === undefined,
      )
    )
      reject('Unknown continent budget');
    const total =
      s.freeBudget +
      Object.values(s.continentBudgets).reduce((a, b) => a + b, 0);
    placeForces(board, s, actor, combined, action.conversions, total);
    s.freeBudget = 0;
    s.continentBudgets = {};
    if (s.extraPass) {
      s.extraQueue.shift();
      if (s.extraQueue.length) {
        const next = s.extraQueue[0]!;
        s.turnIndex = s.order.indexOf(next);
        s.freeBudget = Math.floor(own(s, next).length / 2);
      } else {
        s.extraPass = false;
        s.turnIndex = 0;
        incorporationStarted(board, s);
      }
    } else {
      const next = nextAlive(s, s.turnIndex + 1);
      if (next < s.order.length) {
        s.turnIndex = next;
        incorporationStarted(board, s);
      } else {
        s.turnIndex = nextAlive(s, 0);
        hostilityTurnStarted(s);
      }
    }
  } else if (action.kind === 'exchange') {
    if (!legal().canExchange || s.extraPass)
      reject('Exchange only in ordinary incorporation or closing');
    const exchanged = exchangeCards(
      s.cards,
      actor,
      s.round,
      action.cardIds,
      action.continentIds,
    );
    s.cards = exchanged.cards;
    s.freeBudget += exchanged.armies;
  } else if (action.kind === 'attack-country' || action.kind === 'fire')
    applyBattle(board, s, actor, action, random);
  else if (action.kind === 'occupy')
    occupy(board, s, actor, action.armies, random);
  else if (action.kind === 'continue-invasion') {
    const p = s.pending;
    if (!p?.invasion || p.arrivals[0]?.playerId !== actor || p.joint)
      reject('No invasion choice');
    if (p.continuing) reject('Invasion already continuing');
    p.continuing = true;
  } else if (action.kind === 'regroup-forces')
    moveForces(board, s, actor, action);
  else if (action.kind === 'finish-attacks') {
    if (!legal().canFinishAttacks) reject('Cannot finish attacks');
    s.phase = 'regroup';
  } else if (action.kind === 'finish-regroup') {
    if (!legal().canFinishRegroup) reject('Cannot finish regroup');
    s.allyWindows = s.allyWindows.filter(
      (id) => !s.eliminations[id] && !resting(s, id),
    );
    s.phase = s.allyWindows.length ? 'ally-regroup' : 'closing';
  } else if (action.kind === 'finish-ally-regroup') {
    if (!legal().canFinishAllyRegroup) reject('Not ally regroup window');
    if (s.phase === 'ally-regroup') s.phase = 'ally-closing';
    else {
      s.allyWindows.shift();
      s.phase = s.allyWindows.length ? 'ally-regroup' : 'closing';
    }
  } else if (action.kind === 'claim-country') {
    if (!legal().canClaimCountry) reject('No country card entitlement');
    s.claimed[actor] = true;
    if ((s.penaltyDebts[actor] ?? 0) > 0) s.penaltyDebts[actor]!--;
    // The +3 of the drawn card is claimed explicitly afterwards, as in Classic.
    else s.cards = drawCountryCard(s.cards, actor, random);
  } else if (action.kind === 'claim-bonus') {
    if (!legal().bonusCardIds.includes(action.cardId))
      reject('No card bonus entitlement');
    const card = s.cards.hands[actor]!.find((c) => c.id === action.cardId)!;
    force(territory(s, card.countryId!), actor)!.armies += 3;
    card.bonusUsed = true;
  } else if (action.kind === 'claim-continent') {
    if (!legal().continentIds.includes(action.continentId))
      reject('No continent entitlement');
    s.cards.continents[action.continentId]!.holderId = actor;
  } else if (action.kind === 'finish-turn') {
    if (
      !legal().canFinishTurn ||
      (legal().needsForfeitConfirmation && !action.confirmForfeit)
    )
      reject('Confirm unclaimed entitlements');
    if (Object.keys(s.invasionSpoils).length)
      reject('Resolve invasion spoils before closing');
    finishTurn(board, s, random);
  } else if (action.kind === 'end-turn') {
    // Shortcut from any moment of the hostility turn: a pending occupation moves one army.
    if (!legal().canEndTurn) reject('Cannot end turn now');
    while (s.pending && s.phase !== 'finished')
      occupy(board, s, actor, 1, random);
    if (['attack', 'regroup'].includes(s.phase)) {
      s.allyWindows = s.allyWindows.filter(
        (id) => !s.eliminations[id] && !resting(s, id),
      );
      s.phase = s.allyWindows.length ? 'ally-regroup' : 'closing';
    }
    if (s.phase === 'closing') {
      if (legal().needsForfeitConfirmation && !action.confirmForfeit)
        reject('Confirm unclaimed entitlements');
      if (Object.keys(s.invasionSpoils).length)
        reject('Resolve invasion spoils before closing');
      finishTurn(board, s, random);
    }
  } else if (action.kind === 'propose-pact')
    proposePact(board, s, actor, action);
  else if (action.kind === 'respond-pact') {
    const p = s.pacts.find((p) => p.id === action.pactId);
    if (!p || p.partnerId !== actor || p.status !== 'proposed')
      reject('No pact response');
    if (action.accept) {
      p.status = 'active';
      endInvalidPacts(board, s);
      if (!s.pacts.includes(p)) reject('Pact changed before acceptance');
    } else s.pacts = s.pacts.filter((v) => v !== p);
  } else if (action.kind === 'withdraw-pact') {
    const p = s.pacts.find((p) => p.id === action.pactId);
    if (
      !p ||
      ![p.proposerId, p.partnerId].includes(actor) ||
      p.status !== 'active' ||
      p.withdrawal ||
      p.kind === 'origin'
    )
      reject('No pact withdrawal');
    const other = p.proposerId === actor ? p.partnerId : p.proposerId;
    p.withdrawal = {
      by: actor,
      waitFor: other,
      completedTurns: (s.completedTurns[other] ?? 0) + 1,
    };
  } else if (action.kind === 'propose-alliance')
    proposeAlliance(board, s, actor, action);
  else if (action.kind === 'respond-alliance') {
    const a = s.alliances.find((a) => a.id === action.allianceId);
    if (!a || a.allyId !== actor || a.status !== 'proposed')
      reject('No alliance response');
    if (action.accept) a.status = 'accepted';
    else s.alliances = s.alliances.filter((v) => v !== a);
  } else if (action.kind === 'start-alliance') {
    const a = s.alliances.find((a) => a.id === action.allianceId);
    if (
      !a ||
      a.proposerId !== actor ||
      turnActor(s) !== actor ||
      s.phase !== 'attack' ||
      a.status !== 'accepted' ||
      a.executeTurn !== (s.completedTurns[actor] ?? 0) + 1 ||
      resting(s, actor) ||
      s.activeAllianceId ||
      resting(s, a.allyId)
    )
      reject('No alliance start');
    if (
      !permitsDiceAttack(
        s.cycle.active!.typeId,
        continent(board, a.originId),
        continent(board, a.targetId),
      ) ||
      !permitsDiceAttack(
        s.cycle.active!.typeId,
        continent(board, a.allyOriginId),
        continent(board, a.targetId),
      ) ||
      army(s, a.originId, actor) < 2 ||
      army(s, a.allyOriginId, a.allyId) < 2 ||
      territory(s, a.targetId).forces.some((f) =>
        [actor, a.allyId].includes(f.playerId),
      )
    )
      reject('Alliance became illegal');
    if (
      territory(s, a.targetId).forces.some(
        (f) =>
          attackProtected(
            board,
            s,
            actor,
            f.playerId,
            a.originId,
            a.targetId,
          ) ||
          attackProtected(
            board,
            s,
            a.allyId,
            f.playerId,
            a.allyOriginId,
            a.targetId,
          ),
      )
    )
      reject('Alliance violates pact');
    a.status = 'active';
    a.nextId = actor;
    s.activeAllianceId = a.id;
    s.pacts.push({
      id: `origin:${a.id}`,
      proposerId: actor,
      partnerId: a.allyId,
      kind: 'origin',
      linkedCountryId: a.targetId,
      countryIds: [a.originId, a.allyOriginId],
      continentIds: [],
      status: 'active',
      withdrawal: null,
      untilStart: { playerId: a.allyId, round: s.round + 1 },
      opportunity: false,
      fulfilled: false,
    });
  } else if (action.kind === 'stop-alliance') {
    const a = currentAlliance(s);
    if (!a || ![a.proposerId, a.allyId].includes(actor) || a.exhaustive)
      reject('Must complete initial allied attack');
    const capturer = [a.proposerId, a.allyId].find(
      (id) =>
        (s.invasionSpoils[`${a.targetId}:${id}`] ?? 0) > 0 &&
        army(s, id === a.proposerId ? a.originId : a.allyOriginId, id) > 1,
    );
    s.activeAllianceId = null;
    s.alliances = s.alliances.filter((v) => v !== a);
    if (capturer)
      makeOccupation(
        s,
        capturer === a.proposerId ? a.originId : a.allyOriginId,
        a.targetId,
        capturer,
        false,
        territory(s, a.targetId).forces.map((f) => f.playerId),
      );
    else settleRepelledSpoils(s, a.targetId);
  } else if (action.kind === 'decide-zone') {
    const decision = s.zoneDecisions[0];
    if (
      !decision ||
      decision.playerId !== actor ||
      decision.pactId !== action.pactId
    )
      reject('No zone decision');
    if (!action.keep) s.pacts = s.pacts.filter((p) => p.id !== action.pactId);
    s.zoneDecisions.shift();
    if (!s.zoneDecisions.length) advanceTurn(board, s, random);
  } else reject('Unknown campaign action');
  s.lastCountryLiberated = s.lastCountryLiberated.filter(
    (id) => own(s, id).length === 1,
  );
  refreshContinents(board, s);
  endInvalidPacts(board, s);
  refreshZoneOpportunities(board, s);
  finishVictory(board, catalog, s);
  assertCampaign(board, catalog, s);
  return s;
}
/**
 * Express time limit, as in Classic Express: most countries wins, then
 * armies, exchanges and cards. A full tie finishes without winners.
 */
export function finishByTime(before: Campaign): Campaign {
  if (before.phase === 'finished') reject('Game finished');
  const s = structuredClone(before);
  const metrics = (id: string) => {
    const countries = own(s, id);
    return [
      countries.length,
      countries.reduce((n, t) => n + force(t, id)!.armies, 0),
      s.cards.exchanges[id] ?? 0,
      s.cards.hands[id]!.length,
    ];
  };
  const ranked = s.players
    .filter((p) => !s.eliminations[p.id])
    .map((p) => ({ id: p.id, m: metrics(p.id) }))
    .sort((a, b) => {
      for (let i = 0; i < a.m.length; i++)
        if (a.m[i] !== b.m[i]) return b.m[i]! - a.m[i]!;
      return 0;
    });
  const [first, second] = ranked;
  s.winners =
    first && !(second && second.m.every((v, i) => v === first.m[i]))
      ? [first.id]
      : [];
  s.timeLimit = true;
  s.phase = 'finished';
  return s;
}
export function assertCampaign(
  board: PreparationBoard,
  catalog: unknown,
  s: Campaign,
): void {
  integer(s.round, 1);
  integer(s.turnIndex);
  if (s.turnIndex >= s.order.length) reject('Invalid turn index');
  unique(s.order);
  unique(s.circle);
  const playerIds = s.players.map((p) => p.id);
  unique(playerIds);
  if (
    s.circle.length !== playerIds.length ||
    s.circle.some((id) => !playerIds.includes(id)) ||
    s.order.some((id) => !playerIds.includes(id))
  )
    reject('Unknown seat in order');
  if (s.eliminations[turnActor(s)] && s.phase !== 'finished')
    reject('Eliminated turn holder');
  assertSituationCycle(s.cycle);
  if (s.activation.cycle.active?.id !== s.cycle.active?.id)
    reject('Activation/cycle mismatch');
  const known = new Set(board.countries.map((c) => c.id));
  if (s.territories.length !== 72) reject('Incomplete campaign board');
  unique(s.territories.map((t) => t.id));
  for (const t of s.territories) {
    if (!known.has(t.id)) reject('Unknown campaign country');
    if (t.forces.length === 0) {
      if (s.pending?.targetId !== t.id) reject('Unoccupied stable country');
      continue;
    }
    unique(t.forces.map((f) => f.playerId));
    for (const f of t.forces) {
      if (!s.players.some((p) => p.id === f.playerId))
        reject('Unknown force player');
      integer(
        f.armies,
        s.pending?.targetId === t.id &&
          s.pending.arrivals.some((a) => a.playerId === f.playerId)
          ? 0
          : 1,
      );
      integer(f.missiles);
    }
    if (
      t.ownership.kind === 'exclusive'
        ? t.forces.length !== 1 ||
          t.forces[0]!.playerId !== t.ownership.playerId
        : t.forces.length !== 2 ||
          t.ownership.playerIds.some((id) => !force(t, id))
    )
      reject('Ownership/forces mismatch');
  }
  for (const n of [
    s.freeBudget,
    ...Object.values(s.continentBudgets),
    ...Object.values(s.fixedArmies),
    ...Object.values(s.fixedMissiles),
    ...Object.values(s.completedTurns),
    ...Object.values(s.penaltyDebts),
  ])
    integer(n);
  for (const [keys, resource] of [
    [s.fixedArmies, 'armies'],
    [s.fixedMissiles, 'missiles'],
  ] as const) {
    for (const [key, count] of Object.entries(keys)) {
      const colon = key.indexOf(':');
      const player = key.slice(0, colon),
        id = key.slice(colon + 1);
      const current = known.has(id) ? force(territory(s, id), player) : null;
      if (colon < 0 || !current || count > current[resource])
        reject('Invalid fixed force');
    }
  }
  if (s.pending) {
    unique(s.pending.arrivals.map((a) => a.playerId));
    if (s.pending.arrivals.length === 0 || !known.has(s.pending.targetId))
      reject('Invalid occupation checkpoint');
    const dest = territory(s, s.pending.targetId);
    for (const a of s.pending.arrivals) {
      const origin = force(territory(s, a.originId), a.playerId),
        pending = force(dest, a.playerId);
      if (
        !origin ||
        !pending ||
        pending.armies !== 0 ||
        a.maximum < 1 ||
        a.maximum > Math.min(s.pending.joint ? 2 : 3, origin.armies - 1) ||
        !adjacent(board, a.originId, s.pending.targetId)
      )
        reject('Invalid pending arrival');
    }
  }
  unique(s.winners);
  if (
    s.winners.some((id) => !playerIds.includes(id) || s.eliminations[id]) ||
    (s.winners.length > 0 || !!s.timeLimit) !== (s.phase === 'finished')
  )
    reject('Invalid winner state');
  for (const [id, credit] of Object.entries(s.eliminations))
    if (
      !playerIds.includes(id) ||
      !playerIds.includes(credit) ||
      own(s, id).length
    )
      reject('Invalid elimination');
  assertCards(
    s.cards,
    board.countries.map((c) => c.id),
    s.players.map((p) => p.id),
  );
  assertPoliticalIds(s);
  if (s.phase === 'finished' && s.winners.length === 0 && !s.timeLimit)
    reject('Finished without winner');
  void catalog;
}
