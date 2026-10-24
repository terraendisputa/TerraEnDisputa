export const PLAYER_COLOR_LABELS = {
  blue: 'Azul',
  red: 'Rojo',
  black: 'Negro',
  yellow: 'Amarillo',
  green: 'Verde',
  magenta: 'Magenta',
} as const;

type PlayerColorId = keyof typeof PLAYER_COLOR_LABELS;

export function playerColorLabel(color: string): string {
  return PLAYER_COLOR_LABELS[color as PlayerColorId] ?? color;
}

export function playerColorLabelLower(color: string): string {
  return playerColorLabel(color).toLocaleLowerCase('es');
}
