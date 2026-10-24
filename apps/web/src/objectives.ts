import { playerColorLabelLower } from './colors.js';

const occupation: Readonly<Record<string, string>> = {
  occupation_01:
    'Controlá toda África, al menos 5 territorios de América del Norte y 4 de Europa.',
  occupation_02:
    'Controlá toda América del Sur, al menos 7 territorios de Europa y un grupo de 3 territorios adyacentes entre sí.',
  occupation_03:
    'Controlá toda Asia y al menos 2 territorios de América del Sur.',
  occupation_04:
    'Controlá toda Europa, al menos 4 territorios de Asia y 2 de América del Sur.',
  occupation_05:
    'Controlá toda América del Norte, al menos 2 territorios de Oceanía y 4 de Asia.',
  occupation_06:
    'Controlá al menos 2 territorios de Oceanía, 2 de África, 2 de América del Sur, 3 de Europa, 4 de América del Norte y 3 de Asia.',
  occupation_07:
    'Controlá toda Oceanía, toda América del Norte y al menos 2 territorios de Europa.',
  occupation_08:
    'Controlá toda América del Sur, toda África y al menos 4 territorios de Asia.',
  occupation_09:
    'Controlá toda Oceanía, toda África y al menos 5 territorios de América del Norte.',
};

export function objectiveText(
  objectiveId: string,
  effectiveTargetColor?: string,
): string {
  if (occupation[objectiveId]) return occupation[objectiveId];
  if (objectiveId.startsWith('destroy_'))
    return `Eliminar al ${playerColorLabelLower(
      effectiveTargetColor ?? objectiveId.slice(8),
    )}.`;
  return 'Cumplí el objetivo secreto indicado por el servidor.';
}
