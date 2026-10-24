export const RECONQUISTA_NAME = 'Reconquista';

export const continentNames: Record<string, string> = {
  north_america: 'América del Norte',
  central_america: 'América Central',
  south_america: 'América del Sur',
  europe: 'Europa',
  asia: 'Asia',
  africa: 'África',
  oceania: 'Oceanía',
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
  white: 'Blanco',
  black: 'Negro',
  red: 'Rojo',
  blue: 'Azul',
  yellow: 'Amarillo',
  green: 'Verde',
};

export const preparationStageNames: Record<string, string> = {
  lobby: 'Sala de espera',
  'initial-placement': 'Incorporación inicial',
  'reveal-situation': 'Revelar situación',
  'extra-placement': 'Refuerzos extra',
  'first-hostility': 'Primera hostilidad',
  campaign: 'Partida',
};

export const campaignPhaseNames: Record<string, string> = {
  incorporation: 'Refuerzos',
  attack: 'Ataque',
  regroup: 'Reagrupamiento',
  'ally-regroup': 'Reagrupamiento del socio',
  'ally-closing': 'Solicitudes del socio',
  closing: 'Solicitudes y cierre',
  'zone-decision': 'Decisión sobre zona internacional',
  finished: 'Partida terminada',
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
        name: 'Combate clásico',
        effect: 'La ronda se juega con las reglas normales.',
      };
    case 'snow':
      return {
        name: 'Nieve',
        effect:
          'El defensor suma un dado a su defensa. Hasta un máximo de 4 dados.',
      };
    case 'tailwind':
      return {
        name: 'Viento a favor',
        effect:
          'El atacante suma un dado a su ataque. Hasta un máximo de 4 dados.',
      };
    case 'crisis':
      return {
        name: 'Crisis',
        effect:
          'Cada jugador tira un dado. El jugador que saque el menor resultado no recibe una carta esta ronda.',
      };
    case 'extra_reinforcements':
      return {
        name: 'Refuerzos extra',
        effect: 'Cada jugador debe incorporar tropas extras.',
      };
    case 'open_borders':
      return {
        name: 'Fronteras abiertas',
        effect: 'Solo se puede atacar entre países de continentes distintos.',
      };
    case 'closed_borders':
      return {
        name: 'Fronteras cerradas',
        effect: 'Solo se puede atacar entre países del mismo continente.',
      };
    default:
      return typeId.startsWith('rest_')
        ? {
            // «Descansa el Blanco»: the name says the color.
            name: `Descansa el ${playerColorNames[typeId.slice(5)] ?? ''}`.trim(),
            effect:
              'El color que descansa no puede atacar ni reagrupar esta ronda.',
          }
        : { name: 'Situación', effect: '' };
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
  plane: 'Avión',
  ship: 'Barco',
  tank_grenade: 'Tanque / granada',
  soldier_wildcard: 'Soldado (comodín)',
  supercard: 'Supertarjeta',
  wildcard: 'Comodín',
};

/** Special cards name their type under the drawing. */
export const specialCardNames: Partial<Record<CardSymbol, string>> = {
  soldier_wildcard: 'Comodín',
  wildcard: 'Comodín',
  supercard: 'Supertarjeta',
};

/** How each card can be exchanged, shown on the card itself. */
export const symbolHints: Partial<Record<CardSymbol, string>> = {
  soldier_wildcard: 'Reemplaza cualquier símbolo',
  wildcard: 'Reemplaza cualquier símbolo',
  supercard: 'Se canjea sola',
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
    ? 'Se canjea sola'
    : `Vale ${symbols.map((s) => symbolNames[s]).join(' + ')}`;
}

export const pactKindNames: Record<string, string> = {
  countries: 'Entre países',
  continent: 'Dentro de un continente',
  intercontinental: 'Entre fronteras',
  world: 'Mundial',
  zone: 'Zona internacional',
  internal: 'No agresión interna',
  origin: 'Protección de socios',
  condominium: 'Condominio',
};
