import assert from 'node:assert/strict';
import test from 'node:test';
import { stepChoice } from '../apps/web/src/shortcuts.ts';

void test('Arrow keys walk the menu choices in a loop from either end', () => {
  const routes = ['a→b', 'a→c', 'd→e'];
  assert.equal(stepChoice(routes, -1, 1), 'a→b');
  assert.equal(stepChoice(routes, -1, -1), 'd→e');
  assert.equal(stepChoice(routes, 0, 1), 'a→c');
  assert.equal(stepChoice(routes, 2, 1), 'a→b');
  assert.equal(stepChoice(routes, 0, -1), 'd→e');
  assert.equal(stepChoice([], -1, 1), undefined);
});
