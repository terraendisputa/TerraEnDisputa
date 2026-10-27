import type { ReconquistaOwnership } from './contracts.js';
import type { InitialSecret, ObjectivePlayer } from './objectives.js';
import type { CardsState } from './cards.js';
import type {
  ActivatedSituation,
  SituationCycle,
  resolveReconquistaCombat,
} from './round.js';
export interface CampaignTerritory {
  id: string;
  ownership: ReconquistaOwnership;
  forces: { playerId: string; armies: number; missiles: number }[];
}
export interface Pact {
  id: string;
  proposerId: string;
  partnerId: string;
  kind:
    | 'countries'
    | 'continent'
    | 'intercontinental'
    | 'world'
    | 'internal'
    | 'origin'
    | 'zone';
  linkedCountryId: string | null;
  countryIds: string[];
  continentIds: string[];
  status: 'proposed' | 'active';
  withdrawal: { by: string; waitFor: string; completedTurns: number } | null;
  untilStart: { playerId: string; round: number } | null;
  opportunity: boolean;
  fulfilled: boolean;
}
export interface Alliance {
  id: string;
  proposerId: string;
  allyId: string;
  originId: string;
  allyOriginId: string;
  targetId: string;
  status: 'proposed' | 'accepted' | 'active';
  nextId: string;
  exhaustive: boolean;
  executeTurn: number;
}
export interface PendingOccupation {
  targetId: string;
  creditId: string;
  joint: boolean;
  arrivals: { playerId: string; originId: string; maximum: number }[];
  capturedMissiles: number;
  invasion: boolean;
  continuing: boolean;
  originalDefenders: string[];
}
export interface Campaign {
  round: number;
  order: string[];
  turnIndex: number;
  circle: string[];
  players: ObjectivePlayer[];
  objectives: { playerId: string; objectives: InitialSecret[] }[];
  territories: CampaignTerritory[];
  phase:
    | 'incorporation'
    | 'attack'
    | 'regroup'
    | 'ally-regroup'
    | 'ally-closing'
    | 'closing'
    | 'zone-decision'
    | 'finished';
  cycle: SituationCycle;
  activation: ActivatedSituation;
  cards: CardsState;
  extraQueue: string[];
  extraPass: boolean;
  nextAgreement: number;
  freeBudget: number;
  continentBudgets: Record<string, number>;
  fixedArmies: Record<string, number>;
  fixedMissiles: Record<string, number>;
  pending: PendingOccupation | null;
  invasionSpoils: Record<string, number>;
  activeAllianceId: string | null;
  alliances: Alliance[];
  pacts: Pact[];
  sharedOriginal: Record<string, boolean>;
  conquestCountries: Record<string, { individual: string[]; joint: string[] }>;
  conquests: Record<string, { individual: number; joint: number }>;
  claimed: Record<string, boolean>;
  allyWindows: string[];
  allyDestinations: Record<string, string[]>;
  lastCountryLiberated: string[];
  completedTurns: Record<string, number>;
  eliminations: Record<string, string>;
  penaltyDebts: Record<string, number>;
  zoneDecisions: { pactId: string; playerId: string }[];
  winners: string[];
  /** Express ended by the clock; a full tie finishes without winners. */
  timeLimit?: boolean;
  lastCombat:
    | ({ originId: string; targetId: string; defenderId: string } & ReturnType<
        typeof resolveReconquistaCombat
      >)
    | null;
  lastMissile: {
    originId: string;
    targetId: string;
    defenderId: string;
    distance: number;
    damage: number;
  } | null;
}
export type CampaignAction =
  | {
      kind: 'reinforce';
      placements: Record<string, number>;
      conversions: Record<string, number>;
      continentPlacements: Record<string, Record<string, number>>;
    }
  | { kind: 'exchange'; cardIds: string[]; continentIds: string[] }
  | {
      kind: 'attack-country';
      originId: string;
      targetId: string;
      defenderId: string;
    }
  | { kind: 'fire'; originId: string; targetId: string; defenderId: string }
  | { kind: 'occupy'; armies: number }
  | { kind: 'continue-invasion' }
  | {
      kind: 'regroup-forces';
      originId: string;
      targetId: string;
      armies: number;
      missiles: number;
    }
  | { kind: 'finish-attacks' }
  | { kind: 'finish-regroup' }
  | { kind: 'finish-ally-regroup' }
  | { kind: 'claim-country' }
  | { kind: 'claim-bonus'; cardId: string }
  | { kind: 'claim-continent'; continentId: string }
  | { kind: 'finish-turn'; confirmForfeit: boolean }
  | { kind: 'end-turn'; confirmForfeit: boolean }
  | {
      kind: 'propose-pact';
      partnerId: string;
      pactKind:
        'countries' | 'continent' | 'intercontinental' | 'world' | 'zone';
      countryIds: string[];
      continentIds: string[];
    }
  | { kind: 'respond-pact'; pactId: string; accept: boolean }
  | { kind: 'withdraw-pact'; pactId: string }
  | {
      kind: 'propose-alliance';
      allyId: string;
      originId: string;
      allyOriginId: string;
      targetId: string;
    }
  | { kind: 'respond-alliance'; allianceId: string; accept: boolean }
  | { kind: 'start-alliance'; allianceId: string }
  | { kind: 'stop-alliance' }
  | { kind: 'decide-zone'; pactId: string; keep: boolean };
