import { language } from './language.js';

/** English names of the Reconquista countries; their ids are Spanish. */
const RECONQUISTA_COUNTRIES_EN: Readonly<Record<string, string>> = {
  sudafrica: 'South Africa',
  turquia: 'Turkey',
  nueva_zelanda: 'New Zealand',
  terranova: 'Newfoundland',
  noruega: 'Norway',
  nueva_york: 'New York',
  rusia: 'Russia',
  polonia: 'Poland',
  oregon: 'Oregon',
  iran: 'Iran',
  irak: 'Iraq',
  isla_victoria: 'Victoria Island',
  finlandia: 'Finland',
  japon: 'Japan',
  malasia: 'Malaysia',
  francia: 'France',
  mexico: 'Mexico',
  gran_bretana: 'Great Britain',
  islandia: 'Iceland',
  italia: 'Italy',
  groenlandia: 'Greenland',
  egipto: 'Egypt',
  canada: 'Canada',
  bielorrusia: 'Belarus',
  espana: 'Spain',
  corea: 'Korea',
  brasil: 'Brazil',
  etiopia: 'Ethiopia',
  filipinas: 'Philippines',
  croacia: 'Croatia',
  irlanda: 'Ireland',
  alemania: 'Germany',
  ucrania: 'Ukraine',
  chechenia: 'Chechnya',
};

const CONTINENTS_EN: Readonly<Record<string, string>> = {
  north_america: 'North America',
  central_america: 'Central America',
  south_america: 'South America',
  europe: 'Europe',
  asia: 'Asia',
  africa: 'Africa',
  oceania: 'Oceania',
};

/** Classic ids are English: great_britain reads Great Britain. */
const titled = (id: string) =>
  id
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** A Classic country's name in the current language. */
export function classicCountryName(id: string, spanish: string): string {
  return language === 'en' ? titled(id) : spanish;
}

/** A Reconquista country's name in the current language. */
export function reconquistaCountryName(id: string, spanish: string): string {
  return language === 'en'
    ? (RECONQUISTA_COUNTRIES_EN[id] ?? spanish)
    : spanish;
}

/** A continent's name in the current language. */
export function continentName(id: string, spanish: string): string {
  return language === 'en' ? (CONTINENTS_EN[id] ?? spanish) : spanish;
}

const MAP_LABELS_EN: Readonly<Record<string, string>> = {
  // Compass west.
  O: 'W',
  ALEMANIA: 'GERMANY',
  'AMÉRICA CENTRAL': 'CENTRAL AMERICA',
  'AMÉRICA DEL NORTE': 'NORTH AMERICA',
  'AMÉRICA DEL SUR': 'SOUTH AMERICA',
  BIELORRUSIA: 'BELARUS',
  BRASIL: 'BRAZIL',
  CANADÁ: 'CANADA',
  CHECHENIA: 'CHECHNYA',
  COREA: 'KOREA',
  CROACIA: 'CROATIA',
  EGIPTO: 'EGYPT',
  ESPAÑA: 'SPAIN',
  ETIOPÍA: 'ETHIOPIA',
  EUROPA: 'EUROPE',
  FILIPINAS: 'PHILIPPINES',
  FINLANDIA: 'FINLAND',
  FRANCIA: 'FRANCE',
  GROENLANDIA: 'GREENLAND',
  IRAK: 'IRAQ',
  IRLANDA: 'IRELAND',
  IRÁN: 'IRAN',
  ISLANDIA: 'ICELAND',
  ITALIA: 'ITALY',
  JAPÓN: 'JAPAN',
  MALASIA: 'MALAYSIA',
  MÉXICO: 'MEXICO',
  NORUEGA: 'NORWAY',
  'NUEVA YORK': 'NEW YORK',
  'NUEVA ZELANDA': 'NEW ZEALAND',
  OCEANÍA: 'OCEANIA',
  OREGÓN: 'OREGON',
  POLONIA: 'POLAND',
  RUSIA: 'RUSSIA',
  SUDÁFRICA: 'SOUTH AFRICA',
  TERRANOVA: 'NEWFOUNDLAND',
  TURQUÍA: 'TURKEY',
  UCRANIA: 'UKRAINE',
  ÁFRICA: 'AFRICA',
};

/** Two-line labels whose words swap places in English. */
const MAP_PAIRS_EN: readonly [string, string, string, string][] = [
  ['GRAN', 'BRETAÑA', 'GREAT', 'BRITAIN'],
  ['ISLA', 'VICTORIA', 'VICTORIA', 'ISLAND'],
  ['OCÉANO', 'PACÍFICO NORTE', 'NORTH PACIFIC', 'OCEAN'],
  ['OCÉANO', 'PACÍFICO SUR', 'SOUTH PACIFIC', 'OCEAN'],
  ['OCÉANO', 'ATLÁNTICO NORTE', 'NORTH ATLANTIC', 'OCEAN'],
  ['OCÉANO', 'ATLÁNTICO SUR', 'SOUTH ATLANTIC', 'OCEAN'],
  ['OCÉANO', 'ÍNDICO', 'INDIAN', 'OCEAN'],
  ['OCÉANO GLACIAR', 'ÁRTICO', 'ARCTIC', 'OCEAN'],
];

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrites the names drawn in the Reconquista artwork; positions stay. */
export function translateMapArt(svg: string): string {
  if (language !== 'en') return svg;
  let out = svg;
  for (const [first, second, firstEn, secondEn] of MAP_PAIRS_EN)
    out = out.replace(
      new RegExp(
        `>${escaped(first)}</tspan>(<tspan[^>]*>)${escaped(second)}<`,
        'g',
      ),
      `>${firstEn}</tspan>$1${secondEn}<`,
    );
  return out.replace(/>([^<>]+)</g, (whole, text: string) =>
    MAP_LABELS_EN[text] ? `>${MAP_LABELS_EN[text]}<` : whole,
  );
}
