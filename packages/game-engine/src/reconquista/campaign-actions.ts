import { integer, object, text, unique } from './contracts.js';
import type { CampaignAction } from './campaign-types.js';
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw Error('Expected identity array');
  const result = value.map(text);
  unique(result);
  return result;
}
function amounts(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw Error('Expected amounts');
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => [text(id), integer(n, 1)]),
  );
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw Error('Expected boolean');
  return value;
}
export function checkedCampaignAction(value: unknown): CampaignAction {
  const root = object(value, [
    'kind',
    'placements',
    'conversions',
    'continentPlacements',
    'cardIds',
    'continentIds',
    'originId',
    'targetId',
    'defenderId',
    'armies',
    'missiles',
    'cardId',
    'continentId',
    'confirmForfeit',
    'partnerId',
    'pactKind',
    'countryIds',
    'pactId',
    'accept',
    'allyId',
    'allyOriginId',
    'allianceId',
    'keep',
  ]);
  switch (root.kind) {
    case 'reinforce': {
      const a = object(value, [
        'kind',
        'placements',
        'conversions',
        'continentPlacements',
      ]);
      const c = object(
        a.continentPlacements,
        Object.keys(a.continentPlacements ?? {}),
      );
      return {
        kind: 'reinforce',
        placements: amounts(a.placements),
        conversions: amounts(a.conversions),
        continentPlacements: Object.fromEntries(
          Object.entries(c)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([id, n]) => [id, amounts(n)]),
        ),
      };
    }
    case 'exchange': {
      const a = object(value, ['kind', 'cardIds', 'continentIds']);
      return {
        kind: 'exchange',
        cardIds: strings(a.cardIds).sort(),
        continentIds: strings(a.continentIds).sort(),
      };
    }
    case 'attack-country':
    case 'fire': {
      const a = object(value, ['kind', 'originId', 'targetId', 'defenderId']);
      return {
        kind: root.kind,
        originId: text(a.originId),
        targetId: text(a.targetId),
        defenderId: text(a.defenderId),
      };
    }
    case 'occupy': {
      const a = object(value, ['kind', 'armies']);
      return { kind: 'occupy', armies: integer(a.armies, 1) };
    }
    case 'regroup-forces': {
      const a = object(value, [
        'kind',
        'originId',
        'targetId',
        'armies',
        'missiles',
      ]);
      return {
        kind: 'regroup-forces',
        originId: text(a.originId),
        targetId: text(a.targetId),
        armies: integer(a.armies),
        missiles: integer(a.missiles),
      };
    }
    case 'finish-turn':
    case 'end-turn': {
      const a = object(value, ['kind', 'confirmForfeit']);
      return {
        kind: a.kind === 'end-turn' ? 'end-turn' : 'finish-turn',
        confirmForfeit: boolean(a.confirmForfeit),
      };
    }
    case 'claim-bonus': {
      const a = object(value, ['kind', 'cardId']);
      return { kind: 'claim-bonus', cardId: text(a.cardId) };
    }
    case 'claim-continent': {
      const a = object(value, ['kind', 'continentId']);
      return { kind: 'claim-continent', continentId: text(a.continentId) };
    }
    case 'propose-pact': {
      const a = object(value, [
        'kind',
        'partnerId',
        'pactKind',
        'countryIds',
        'continentIds',
      ]);
      if (
        ![
          'countries',
          'continent',
          'intercontinental',
          'world',
          'zone',
        ].includes(text(a.pactKind))
      )
        throw Error('Invalid pact kind');
      return {
        kind: 'propose-pact',
        partnerId: text(a.partnerId),
        pactKind: a.pactKind as
          'countries' | 'continent' | 'intercontinental' | 'world' | 'zone',
        countryIds: strings(a.countryIds),
        continentIds: strings(a.continentIds).sort(),
      };
    }
    case 'respond-pact': {
      const a = object(value, ['kind', 'pactId', 'accept']);
      return {
        kind: 'respond-pact',
        pactId: text(a.pactId),
        accept: boolean(a.accept),
      };
    }
    case 'withdraw-pact': {
      const a = object(value, ['kind', 'pactId']);
      return { kind: 'withdraw-pact', pactId: text(a.pactId) };
    }
    case 'propose-alliance': {
      const a = object(value, [
        'kind',
        'allyId',
        'originId',
        'allyOriginId',
        'targetId',
      ]);
      return {
        kind: 'propose-alliance',
        allyId: text(a.allyId),
        originId: text(a.originId),
        allyOriginId: text(a.allyOriginId),
        targetId: text(a.targetId),
      };
    }
    case 'respond-alliance': {
      const a = object(value, ['kind', 'allianceId', 'accept']);
      return {
        kind: 'respond-alliance',
        allianceId: text(a.allianceId),
        accept: boolean(a.accept),
      };
    }
    case 'start-alliance': {
      const a = object(value, ['kind', 'allianceId']);
      return { kind: 'start-alliance', allianceId: text(a.allianceId) };
    }
    case 'decide-zone': {
      const a = object(value, ['kind', 'pactId', 'keep']);
      return {
        kind: 'decide-zone',
        pactId: text(a.pactId),
        keep: boolean(a.keep),
      };
    }
    case 'continue-invasion':
    case 'finish-attacks':
    case 'finish-regroup':
    case 'finish-ally-regroup':
    case 'claim-country':
    case 'stop-alliance':
      object(value, ['kind']);
      return { kind: root.kind };
    default:
      throw Error('Unknown campaign action');
  }
}
