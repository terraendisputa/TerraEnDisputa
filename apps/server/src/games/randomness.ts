import { randomInt } from 'node:crypto';

export const secureGameRandomness = {
  rollDie: () => randomInt(1, 7),
  shuffle: <T>(values: readonly T[]): readonly T[] => {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const target = randomInt(index + 1);
      [result[index], result[target]] = [result[target]!, result[index]!];
    }
    return result;
  },
};
