import { tr } from './language.js';
export const PLAYER_COLOR_LABELS = {
  blue: tr('Azul', 'Blue'),
  red: tr('Rojo', 'Red'),
  black: tr('Negro', 'Black'),
  yellow: tr('Amarillo', 'Yellow'),
  green: tr('Verde', 'Green'),
  magenta: 'Magenta',
};

type PlayerColorId = keyof typeof PLAYER_COLOR_LABELS;

export function playerColorLabel(color: string): string {
  return PLAYER_COLOR_LABELS[color as PlayerColorId] ?? color;
}

export function playerColorLabelLower(color: string): string {
  return playerColorLabel(color).toLocaleLowerCase();
}
