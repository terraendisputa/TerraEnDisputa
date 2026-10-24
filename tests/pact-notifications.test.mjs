import assert from 'node:assert/strict';
import test from 'node:test';
import { panelChanges } from '../apps/web/src/use-panel-notifications.ts';

const proposal = {
  id: 'proposal-1',
  proposerId: 'black',
  recipientId: 'yellow',
  terms: { kind: 'general_non_aggression' },
};
const accepted = {
  id: 'pact-1',
  kind: 'general_non_aggression',
  parties: ['black', 'yellow'],
  terms: proposal.terms,
  withdrawal: { kind: 'none' },
};
function snapshot(selfPlayerId, revision, proposals = [], active = []) {
  return {
    gameId: 'game-1',
    revision,
    status: 'ACTIVE',
    selfPlayerId,
    players: ['black', 'yellow', 'red'].map((id) => ({
      id,
      nickname: id,
      color: id,
      eliminated: false,
    })),
    private: { cards: [] },
    pacts: { proposals, active },
  };
}

void test('Incoming proposals notify the recipient and other observers, but not their author', () => {
  for (const player of ['yellow', 'red']) {
    const changes = panelChanges(
      snapshot(player, 1),
      snapshot(player, 2, [proposal]),
    );
    assert.equal(changes.pacts.count, 1);
    assert.equal(changes.pacts.message, 'Nueva propuesta de pacto');
  }
  assert.equal(
    panelChanges(snapshot('black', 1), snapshot('black', 2, [proposal])).pacts,
    undefined,
  );
});

void test('Accepted pacts notify their proposer and observers, but not the accepting player', () => {
  for (const player of ['black', 'red']) {
    const changes = panelChanges(
      snapshot(player, 2, [proposal]),
      snapshot(player, 3, [], [accepted]),
    );
    assert.equal(changes.pacts.count, 1);
    assert.equal(changes.pacts.message, 'Un jugador aceptó un pacto');
  }
  assert.equal(
    panelChanges(
      snapshot('yellow', 2, [proposal]),
      snapshot('yellow', 3, [], [accepted]),
    ).pacts,
    undefined,
  );
});

void test('Unchanged snapshots, later unrelated revisions and empty initial pacts do not notify', () => {
  const before = snapshot('red', 3, [], [accepted]);
  assert.equal(panelChanges(before, before).pacts, undefined);
  assert.equal(
    panelChanges(before, snapshot('red', 4, [], [accepted])).pacts,
    undefined,
  );
  assert.equal(
    panelChanges(snapshot('red', 1), snapshot('red', 2)).pacts,
    undefined,
  );
  assert.equal(
    panelChanges(snapshot('red', 3), snapshot('red', 2, [proposal], [accepted]))
      .pacts,
    undefined,
  );
});

void test('Cancellation, rejection, expiry and withdrawal updates are not proposal/acceptance events', () => {
  assert.equal(
    panelChanges(snapshot('red', 2, [proposal]), snapshot('red', 3)).pacts,
    undefined,
  );
  assert.equal(
    panelChanges(snapshot('red', 3, [], [accepted]), snapshot('red', 4)).pacts,
    undefined,
  );
  const withdrawing = {
    ...accepted,
    withdrawal: {
      kind: 'announced',
      withdrawingPlayerId: 'black',
      waitingForPlayerIds: ['yellow', 'red'],
    },
  };
  assert.equal(
    panelChanges(
      snapshot('red', 3, [], [accepted]),
      snapshot('red', 4, [], [withdrawing]),
    ).pacts,
    undefined,
  );
});

void test('Multiple changes in a snapshot are counted once without dropping pending proposals', () => {
  const second = {
    ...proposal,
    id: 'proposal-2',
    proposerId: 'yellow',
    recipientId: 'black',
  };
  const changes = panelChanges(
    snapshot('red', 3),
    snapshot('red', 6, [proposal, second], [accepted]),
  );
  assert.equal(changes.pacts.count, 3);
  assert.match(changes.pacts.message, /2 propuestas nuevas/);
  assert.match(changes.pacts.message, /Un jugador aceptó un pacto/);
});

void test('International zones and border pacts use the same acceptance notifications', () => {
  for (const kind of ['international_zone', 'border_non_aggression']) {
    const pact = {
      ...accepted,
      kind,
      terms:
        kind === 'international_zone'
          ? {
              kind,
              territoryId: 'mongolia',
              firstExpectedConquerorId: 'yellow',
            }
          : { kind, territoryIds: ['mongolia', 'siberia'] },
    };
    assert.equal(
      panelChanges(snapshot('black', 2), snapshot('black', 3, [], [pact])).pacts
        .count,
      1,
    );
  }
});
