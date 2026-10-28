import { playerColorLabelLower } from './colors.js';
import { tr } from './language.js';

const occupation: Readonly<Record<string, string>> = {
  occupation_01: tr(
    'Controlá toda África, al menos 5 territorios de América del Norte y 4 de Europa.',
    'Control all of Africa, at least 5 territories in North America and 4 in Europe.',
  ),
  occupation_02: tr(
    'Controlá toda América del Sur, al menos 7 territorios de Europa y un grupo de 3 territorios adyacentes entre sí.',
    'Control all of South America, at least 7 territories in Europe and a group of 3 territories adjacent to each other.',
  ),
  occupation_03: tr(
    'Controlá toda Asia y al menos 2 territorios de América del Sur.',
    'Control all of Asia and at least 2 territories in South America.',
  ),
  occupation_04: tr(
    'Controlá toda Europa, al menos 4 territorios de Asia y 2 de América del Sur.',
    'Control all of Europe, at least 4 territories in Asia and 2 in South America.',
  ),
  occupation_05: tr(
    'Controlá toda América del Norte, al menos 2 territorios de Oceanía y 4 de Asia.',
    'Control all of North America, at least 2 territories in Oceania and 4 in Asia.',
  ),
  occupation_06: tr(
    'Controlá al menos 2 territorios de Oceanía, 2 de África, 2 de América del Sur, 3 de Europa, 4 de América del Norte y 3 de Asia.',
    'Control at least 2 territories in Oceania, 2 in Africa, 2 in South America, 3 in Europe, 4 in North America and 3 in Asia.',
  ),
  occupation_07: tr(
    'Controlá toda Oceanía, toda América del Norte y al menos 2 territorios de Europa.',
    'Control all of Oceania, all of North America and at least 2 territories in Europe.',
  ),
  occupation_08: tr(
    'Controlá toda América del Sur, toda África y al menos 4 territorios de Asia.',
    'Control all of South America, all of Africa and at least 4 territories in Asia.',
  ),
  occupation_09: tr(
    'Controlá toda Oceanía, toda África y al menos 5 territorios de América del Norte.',
    'Control all of Oceania, all of Africa and at least 5 territories in North America.',
  ),
};

export function objectiveText(
  objectiveId: string,
  effectiveTargetColor?: string,
): string {
  if (occupation[objectiveId]) return occupation[objectiveId];
  if (objectiveId.startsWith('destroy_'))
    return tr(
      `Eliminar al ${playerColorLabelLower(effectiveTargetColor ?? objectiveId.slice(8))}.`,
      `Eliminate the ${playerColorLabelLower(effectiveTargetColor ?? objectiveId.slice(8))} army.`,
    );
  return tr(
    'Cumplí el objetivo secreto indicado por el servidor.',
    'Complete the secret objective given by the server.',
  );
}
