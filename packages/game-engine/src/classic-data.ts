export const CONTINENT_IDS = [
  'north_america',
  'south_america',
  'europe',
  'africa',
  'asia',
  'oceania',
] as const;
export type ContinentId = (typeof CONTINENT_IDS)[number];

export const TERRITORY_IDS = [
  'alaska',
  'yukon',
  'canada',
  'oregon',
  'california',
  'mexico',
  'new_york',
  'newfoundland',
  'labrador',
  'greenland',
  'colombia',
  'peru',
  'brazil',
  'chile',
  'argentina',
  'uruguay',
  'iceland',
  'great_britain',
  'spain',
  'france',
  'germany',
  'italy',
  'poland',
  'sweden',
  'russia',
  'sahara',
  'egypt',
  'ethiopia',
  'zaire',
  'madagascar',
  'south_africa',
  'turkey',
  'israel',
  'arabia',
  'iran',
  'india',
  'china',
  'gobi',
  'mongolia',
  'siberia',
  'aral',
  'tartary',
  'taymyr',
  'kamchatka',
  'japan',
  'malaysia',
  'borneo',
  'sumatra',
  'java',
  'australia',
] as const;
export type TerritoryId = (typeof TERRITORY_IDS)[number];

export interface TerritoryDefinition {
  readonly id: TerritoryId;
  readonly displayName: string;
  readonly continentId: ContinentId;
  readonly adjacentTerritoryIds: readonly TerritoryId[];
}

const territoryRows: readonly (readonly [
  TerritoryId,
  string,
  ContinentId,
  readonly TerritoryId[],
])[] = [
  ['alaska', 'Alaska', 'north_america', ['kamchatka', 'oregon', 'yukon']],
  ['yukon', 'Yukón', 'north_america', ['alaska', 'canada', 'oregon']],
  ['canada', 'Canadá', 'north_america', ['new_york', 'oregon', 'yukon']],
  [
    'oregon',
    'Oregon',
    'north_america',
    ['alaska', 'california', 'canada', 'new_york', 'yukon'],
  ],
  [
    'california',
    'California',
    'north_america',
    ['mexico', 'new_york', 'oregon'],
  ],
  ['mexico', 'México', 'north_america', ['california', 'colombia']],
  [
    'new_york',
    'Nueva York',
    'north_america',
    ['california', 'canada', 'greenland', 'newfoundland', 'oregon'],
  ],
  ['newfoundland', 'Terranova', 'north_america', ['labrador', 'new_york']],
  ['labrador', 'Labrador', 'north_america', ['greenland', 'newfoundland']],
  [
    'greenland',
    'Groenlandia',
    'north_america',
    ['iceland', 'labrador', 'new_york'],
  ],
  ['colombia', 'Colombia', 'south_america', ['brazil', 'mexico', 'peru']],
  [
    'peru',
    'Perú',
    'south_america',
    ['argentina', 'brazil', 'chile', 'colombia'],
  ],
  [
    'brazil',
    'Brasil',
    'south_america',
    ['argentina', 'colombia', 'peru', 'sahara', 'uruguay'],
  ],
  ['chile', 'Chile', 'south_america', ['argentina', 'australia', 'peru']],
  [
    'argentina',
    'Argentina',
    'south_america',
    ['brazil', 'chile', 'peru', 'uruguay'],
  ],
  ['uruguay', 'Uruguay', 'south_america', ['argentina', 'brazil']],
  ['iceland', 'Islandia', 'europe', ['great_britain', 'greenland', 'sweden']],
  ['great_britain', 'Gran Bretaña', 'europe', ['germany', 'iceland', 'spain']],
  ['spain', 'España', 'europe', ['france', 'great_britain', 'sahara']],
  ['france', 'Francia', 'europe', ['germany', 'italy', 'spain']],
  [
    'germany',
    'Alemania',
    'europe',
    ['france', 'great_britain', 'italy', 'poland'],
  ],
  ['italy', 'Italia', 'europe', ['france', 'germany']],
  ['poland', 'Polonia', 'europe', ['egypt', 'germany', 'russia', 'turkey']],
  ['sweden', 'Suecia', 'europe', ['iceland', 'russia']],
  ['russia', 'Rusia', 'europe', ['aral', 'iran', 'poland', 'sweden', 'turkey']],
  [
    'sahara',
    'Sahara',
    'africa',
    ['brazil', 'egypt', 'ethiopia', 'spain', 'zaire'],
  ],
  [
    'egypt',
    'Egipto',
    'africa',
    ['ethiopia', 'israel', 'madagascar', 'poland', 'sahara', 'turkey'],
  ],
  [
    'ethiopia',
    'Etiopía',
    'africa',
    ['egypt', 'sahara', 'south_africa', 'zaire'],
  ],
  [
    'zaire',
    'Zaire',
    'africa',
    ['ethiopia', 'madagascar', 'sahara', 'south_africa'],
  ],
  ['south_africa', 'Sudáfrica', 'africa', ['ethiopia', 'zaire']],
  ['madagascar', 'Madagascar', 'africa', ['egypt', 'zaire']],
  [
    'turkey',
    'Turquía',
    'asia',
    ['arabia', 'egypt', 'iran', 'israel', 'poland', 'russia'],
  ],
  ['israel', 'Israel', 'asia', ['arabia', 'egypt', 'turkey']],
  ['arabia', 'Arabia', 'asia', ['iran', 'israel', 'turkey']],
  [
    'iran',
    'Irán',
    'asia',
    [
      'arabia',
      'aral',
      'china',
      'gobi',
      'india',
      'mongolia',
      'russia',
      'turkey',
    ],
  ],
  [
    'aral',
    'Aral',
    'asia',
    ['iran', 'mongolia', 'russia', 'siberia', 'tartary'],
  ],
  ['tartary', 'Tartaria', 'asia', ['aral', 'siberia', 'taymyr']],
  ['taymyr', 'Taymir', 'asia', ['siberia', 'tartary']],
  ['kamchatka', 'Kamtchatka', 'asia', ['alaska', 'china', 'japan', 'siberia']],
  [
    'siberia',
    'Siberia',
    'asia',
    ['aral', 'china', 'kamchatka', 'mongolia', 'tartary', 'taymyr'],
  ],
  [
    'mongolia',
    'Mongolia',
    'asia',
    ['aral', 'china', 'gobi', 'iran', 'siberia'],
  ],
  ['gobi', 'Gobi', 'asia', ['china', 'iran', 'mongolia']],
  [
    'china',
    'China',
    'asia',
    [
      'gobi',
      'india',
      'iran',
      'japan',
      'kamchatka',
      'malaysia',
      'mongolia',
      'siberia',
    ],
  ],
  ['india', 'India', 'asia', ['china', 'iran', 'malaysia', 'sumatra']],
  ['malaysia', 'Malasia', 'asia', ['borneo', 'china', 'india']],
  ['japan', 'Japón', 'asia', ['china', 'kamchatka']],
  ['sumatra', 'Sumatra', 'oceania', ['australia', 'india']],
  ['borneo', 'Borneo', 'oceania', ['australia', 'malaysia']],
  ['java', 'Java', 'oceania', ['australia']],
  ['australia', 'Australia', 'oceania', ['borneo', 'chile', 'java', 'sumatra']],
];

export const TERRITORIES = Object.fromEntries(
  territoryRows.map(([id, displayName, continentId, adjacentTerritoryIds]) => [
    id,
    { id, displayName, continentId, adjacentTerritoryIds },
  ]),
) as Readonly<Record<TerritoryId, TerritoryDefinition>>;

export interface ContinentDefinition {
  readonly id: ContinentId;
  readonly displayName: string;
  readonly territoryIds: readonly TerritoryId[];
  readonly reinforcementBonus: number;
}
const continent = (
  id: ContinentId,
  displayName: string,
  start: number,
  end: number,
  reinforcementBonus: number,
): ContinentDefinition => ({
  id,
  displayName,
  territoryIds: TERRITORY_IDS.slice(start, end),
  reinforcementBonus,
});
export const CONTINENTS = {
  north_america: continent('north_america', 'América del Norte', 0, 10, 5),
  south_america: continent('south_america', 'América del Sur', 10, 16, 3),
  europe: continent('europe', 'Europa', 16, 25, 5),
  africa: continent('africa', 'África', 25, 31, 3),
  asia: continent('asia', 'Asia', 31, 46, 7),
  oceania: continent('oceania', 'Oceanía', 46, 50, 2),
} as const satisfies Record<ContinentId, ContinentDefinition>;

export const PLAYER_COLORS = [
  'blue',
  'red',
  'black',
  'yellow',
  'green',
  'magenta',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];
export const PLAYER_COLOR_DISPLAY_NAMES = {
  blue: 'Azul',
  red: 'Rojo',
  black: 'Negro',
  yellow: 'Amarillo',
  green: 'Verde',
  magenta: 'Magenta',
} as const satisfies Record<PlayerColor, string>;

export const CARD_SYMBOLS = [
  'balloon',
  'galleon',
  'cannon',
  'wildcard',
] as const;
export type CardSymbol = (typeof CARD_SYMBOLS)[number];
export type TerritoryCardId = TerritoryId;
const cardGroups = {
  balloon: [
    'spain',
    'greenland',
    'india',
    'russia',
    'yukon',
    'egypt',
    'kamchatka',
    'ethiopia',
    'iran',
    'uruguay',
    'italy',
    'chile',
    'gobi',
    'france',
    'sumatra',
    'colombia',
  ],
  galleon: [
    'madagascar',
    'borneo',
    'israel',
    'peru',
    'zaire',
    'iceland',
    'alaska',
    'brazil',
    'siberia',
    'germany',
    'turkey',
    'great_britain',
    'mongolia',
    'china',
    'sweden',
    'new_york',
  ],
  cannon: [
    'arabia',
    'mexico',
    'california',
    'canada',
    'aral',
    'japan',
    'newfoundland',
    'south_africa',
    'sahara',
    'oregon',
    'australia',
    'labrador',
    'malaysia',
    'poland',
    'tartary',
    'java',
  ],
  wildcard: ['taymyr', 'argentina'],
} as const satisfies Record<CardSymbol, readonly TerritoryId[]>;
export interface TerritoryCardDefinition {
  readonly id: TerritoryCardId;
  readonly territoryId: TerritoryId;
  readonly symbol: CardSymbol;
}
export const TERRITORY_CARDS = Object.fromEntries(
  Object.entries(cardGroups).flatMap(([symbol, ids]) =>
    ids.map((id) => [id, { id, territoryId: id, symbol }]),
  ),
) as Readonly<Record<TerritoryCardId, TerritoryCardDefinition>>;

export type OccupationObjectiveId =
  `occupation_0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
export type DestructionObjectiveId = `destroy_${PlayerColor}`;
export type SecretObjectiveId = OccupationObjectiveId | DestructionObjectiveId;
export interface OccupationObjectiveDefinition {
  readonly kind: 'occupation';
  readonly id: OccupationObjectiveId;
  readonly continentMinimums: Readonly<Partial<Record<ContinentId, number>>>;
  readonly requiresPairwiseAdjacentTerritoryTrio?: true;
}
export interface DestructionObjectiveDefinition {
  readonly kind: 'destruction';
  readonly id: DestructionObjectiveId;
  readonly targetColor: PlayerColor;
}
export type SecretObjectiveDefinition =
  OccupationObjectiveDefinition | DestructionObjectiveDefinition;
export const SECRET_OBJECTIVES = {
  occupation_01: {
    kind: 'occupation',
    id: 'occupation_01',
    continentMinimums: { africa: 6, north_america: 5, europe: 4 },
  },
  occupation_02: {
    kind: 'occupation',
    id: 'occupation_02',
    continentMinimums: { south_america: 6, europe: 7 },
    requiresPairwiseAdjacentTerritoryTrio: true,
  },
  occupation_03: {
    kind: 'occupation',
    id: 'occupation_03',
    continentMinimums: { asia: 15, south_america: 2 },
  },
  occupation_04: {
    kind: 'occupation',
    id: 'occupation_04',
    continentMinimums: { europe: 9, asia: 4, south_america: 2 },
  },
  occupation_05: {
    kind: 'occupation',
    id: 'occupation_05',
    continentMinimums: { north_america: 10, oceania: 2, asia: 4 },
  },
  occupation_06: {
    kind: 'occupation',
    id: 'occupation_06',
    continentMinimums: {
      oceania: 2,
      africa: 2,
      south_america: 2,
      europe: 3,
      north_america: 4,
      asia: 3,
    },
  },
  occupation_07: {
    kind: 'occupation',
    id: 'occupation_07',
    continentMinimums: { oceania: 4, north_america: 10, europe: 2 },
  },
  occupation_08: {
    kind: 'occupation',
    id: 'occupation_08',
    continentMinimums: { south_america: 6, africa: 6, asia: 4 },
  },
  occupation_09: {
    kind: 'occupation',
    id: 'occupation_09',
    continentMinimums: { oceania: 4, africa: 6, north_america: 5 },
  },
  destroy_blue: {
    kind: 'destruction',
    id: 'destroy_blue',
    targetColor: 'blue',
  },
  destroy_red: { kind: 'destruction', id: 'destroy_red', targetColor: 'red' },
  destroy_black: {
    kind: 'destruction',
    id: 'destroy_black',
    targetColor: 'black',
  },
  destroy_yellow: {
    kind: 'destruction',
    id: 'destroy_yellow',
    targetColor: 'yellow',
  },
  destroy_green: {
    kind: 'destruction',
    id: 'destroy_green',
    targetColor: 'green',
  },
  destroy_magenta: {
    kind: 'destruction',
    id: 'destroy_magenta',
    targetColor: 'magenta',
  },
} as const satisfies Record<SecretObjectiveId, SecretObjectiveDefinition>;

function freezeClassicData(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return;
  for (const child of Object.values(value)) freezeClassicData(child);
  Object.freeze(value);
}

for (const canonicalCollection of [
  CONTINENT_IDS,
  TERRITORY_IDS,
  TERRITORIES,
  CONTINENTS,
  PLAYER_COLORS,
  PLAYER_COLOR_DISPLAY_NAMES,
  CARD_SYMBOLS,
  TERRITORY_CARDS,
  SECRET_OBJECTIVES,
])
  freezeClassicData(canonicalCollection);
