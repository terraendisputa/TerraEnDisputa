import { tr } from './language.js';
export const RECONQUISTA_NAME = tr('Reconquista', 'Retake');

export const continentNames: Record<string, string> = {
  north_america: tr('América del Norte', 'North America'),
  central_america: tr('América Central', 'Central America'),
  south_america: tr('América del Sur', 'South America'),
  europe: tr('Europa', 'Europe'),
  asia: 'Asia',
  africa: tr('África', 'Africa'),
  oceania: tr('Oceanía', 'Oceania'),
};

export const playerColors: Record<string, string> = {
  white: '#f4eee2',
  black: '#303030',
  red: '#b33e39',
  blue: '#317da5',
  yellow: '#d9ba43',
  green: '#508463',
};

export const playerColorNames: Record<string, string> = {
  white: tr('Blanco', 'White'),
  black: tr('Negro', 'Black'),
  red: tr('Rojo', 'Red'),
  blue: tr('Azul', 'Blue'),
  yellow: tr('Amarillo', 'Yellow'),
  green: tr('Verde', 'Green'),
};

export const preparationStageNames: Record<string, string> = {
  lobby: tr('Sala de espera', 'Waiting room'),
  'initial-placement': tr('Incorporación inicial', 'Initial placement'),
  'reveal-situation': tr('Revelar situación', 'Reveal situation'),
  'extra-placement': tr('Refuerzos extra', 'Extra reinforcements'),
  'first-hostility': tr('Primera hostilidad', 'First hostility'),
  campaign: tr('Partida', 'Game'),
};

export const campaignPhaseNames: Record<string, string> = {
  incorporation: tr('Refuerzos', 'Reinforcements'),
  attack: tr('Ataque', 'Attack'),
  regroup: tr('Reagrupamiento', 'Regroup'),
  'ally-regroup': tr('Reagrupamiento del socio', "Partner's regroup"),
  'ally-closing': tr('Solicitudes del socio', "Partner's requests"),
  closing: tr('Solicitudes y cierre', 'Requests and closing'),
  'zone-decision': tr(
    'Decisión sobre zona internacional',
    'International zone decision',
  ),
  finished: tr('Partida terminada', 'Game over'),
};

interface SituationCard {
  readonly name: string;
  readonly effect: string;
}

/** Card texts (rule R05). */
export function situationCard(typeId: string): SituationCard {
  switch (typeId) {
    case 'classic_combat':
      return {
        name: tr('Combate clásico', 'Classic combat'),
        effect: tr(
          'La ronda se juega con las reglas normales.',
          'The round is played with the normal rules.',
        ),
      };
    case 'snow':
      return {
        name: tr('Nieve', 'Snow'),
        effect: tr(
          'El defensor suma un dado a su defensa. Hasta un máximo de 4 dados.',
          'The defender adds one die to their defense. Up to a maximum of 4 dice.',
        ),
      };
    case 'tailwind':
      return {
        name: tr('Viento a favor', 'Tailwind'),
        effect: tr(
          'El atacante suma un dado a su ataque. Hasta un máximo de 4 dados.',
          'The attacker adds one die to their attack. Up to a maximum of 4 dice.',
        ),
      };
    case 'crisis':
      return {
        name: tr('Crisis', 'Crisis'),
        effect: tr(
          'Cada jugador tira un dado. El jugador que saque el menor resultado no recibe una carta esta ronda.',
          'Each player rolls a die. The player with the lowest result gets no card this round.',
        ),
      };
    case 'extra_reinforcements':
      return {
        name: tr('Refuerzos extra', 'Extra reinforcements'),
        effect: tr(
          'Cada jugador debe incorporar tropas extras.',
          'Each player must place extra troops.',
        ),
      };
    case 'open_borders':
      return {
        name: tr('Fronteras abiertas', 'Open borders'),
        effect: tr(
          'Solo se puede atacar entre países de continentes distintos.',
          'Attacks are only allowed between countries on different continents.',
        ),
      };
    case 'closed_borders':
      return {
        name: tr('Fronteras cerradas', 'Closed borders'),
        effect: tr(
          'Solo se puede atacar entre países del mismo continente.',
          'Attacks are only allowed between countries on the same continent.',
        ),
      };
    default:
      return typeId.startsWith('rest_')
        ? {
            // «Descansa el Blanco»: the name says the color.
            name: tr(
              `Descansa el ${playerColorNames[typeId.slice(5)] ?? ''}`,
              `${playerColorNames[typeId.slice(5)] ?? ''} rests`,
            ).trim(),
            effect: tr(
              'El color que descansa no puede atacar ni reagrupar esta ronda.',
              'The resting color cannot attack or regroup this round.',
            ),
          }
        : { name: tr('Situación', 'Situation'), effect: '' };
  }
}

export type CardSymbol =
  | 'plane'
  | 'tank_grenade'
  | 'ship'
  | 'soldier_wildcard'
  | 'supercard'
  | 'wildcard';

export const symbolNames: Record<CardSymbol, string> = {
  plane: tr('Avión', 'Plane'),
  ship: tr('Barco', 'Ship'),
  tank_grenade: tr('Tanque / granada', 'Tank / grenade'),
  soldier_wildcard: tr('Soldado (comodín)', 'Soldier (wildcard)'),
  supercard: tr('Supertarjeta', 'Supercard'),
  wildcard: tr('Comodín', 'Wildcard'),
};

/** Special cards name their type under the drawing. */
export const specialCardNames: Partial<Record<CardSymbol, string>> = {
  soldier_wildcard: tr('Comodín', 'Wildcard'),
  wildcard: tr('Comodín', 'Wildcard'),
  supercard: tr('Supertarjeta', 'Supercard'),
};

/** How each card can be exchanged, shown on the card itself. */
export const symbolHints: Partial<Record<CardSymbol, string>> = {
  soldier_wildcard: tr('Reemplaza cualquier símbolo', 'Replaces any symbol'),
  wildcard: tr('Reemplaza cualquier símbolo', 'Replaces any symbol'),
  supercard: tr('Se canjea sola', 'Exchanged on its own'),
};

/** Symbols printed on each continent card, as in the engine's exchange rule. */
const continentCardSymbols: Record<string, CardSymbol[] | 'complete'> = {
  asia: 'complete',
  europe: 'complete',
  north_america: 'complete',
  south_america: ['plane', 'tank_grenade'],
  africa: ['plane', 'ship'],
  central_america: ['tank_grenade'],
  oceania: ['ship'],
};

export function continentCardHint(continentId: string) {
  const symbols = continentCardSymbols[continentId];
  if (!symbols) return '';
  return symbols === 'complete'
    ? tr('Se canjea sola', 'Exchanged on its own')
    : `${tr('Vale', 'Worth')} ${symbols.map((s) => symbolNames[s]).join(' + ')}`;
}

export const pactKindNames: Record<string, string> = {
  countries: tr('Entre países', 'Between countries'),
  continent: tr('Dentro de un continente', 'Within a continent'),
  intercontinental: tr('Entre fronteras', 'Between borders'),
  world: tr('Mundial', 'Worldwide'),
  zone: tr('Zona internacional', 'International zone'),
  internal: tr('No agresión interna', 'Internal non-aggression'),
  origin: tr('Protección de socios', 'Partner protection'),
  condominium: tr('Condominio', 'Condominium'),
};
