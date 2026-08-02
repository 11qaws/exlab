import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachLockedResult,
  fingerprintOptions,
  findDuplicateParticipantNames,
  participantsFromSharedRoster,
  prizeTotal,
  sharedRosterNames,
  sharedRosterTextFromParticipants,
  stableSharedParticipantId,
  totalEffectiveWeight,
  type CurrentRound,
  type DrawOption,
  type PlannedPresentation,
} from '../app/games/roulette/lib/roundContract';

/**
 * This layer moved out of RouletteGame.tsx. Its outputs are written into
 * stored history and into participant ids, so a value that drifts during a
 * refactor still passes typecheck and build and only surfaces later as broken
 * history or a roster that no longer matches the other game. The expectations
 * below are the values the pre-move implementation produced.
 */

test('participant ids stay stable across the move', () => {
  assert.equal(stableSharedParticipantId('가나다', 0), 'shared-f636bf94');
  assert.equal(stableSharedParticipantId('Amoretto', 1), 'shared-203f0702');
  assert.equal(stableSharedParticipantId('세나 아르벨', 2), 'shared-f33e2306');
});

test('the candidate fingerprint stays stable across the move', () => {
  assert.equal(fingerprintOptions([]), 'fnv1a-811c9dc5');
  assert.equal(
    fingerprintOptions([{ id: 'a', name: '가나다', weight: 1 }]),
    'fnv1a-61e14a0f',
  );
  assert.equal(
    fingerprintOptions([
      { id: 'shared-0001', name: '세나 아르벨', weight: 3 },
      { id: 'shared-0002', name: '망징이', weight: 1 },
    ]),
    'fnv1a-818810c0',
  );
});

test('roster text keeps names, order and per-name weights', () => {
  assert.deepEqual(
    sharedRosterNames(' 아모레또 ,유레카\n\n세나 아르벨\r\n'),
    ['아모레또', '유레카', '세나 아르벨'],
  );

  const first = participantsFromSharedRoster('아모레또\n유레카');
  const weighted = first.map((participant, index) => (
    index === 0 ? { ...participant, weight: 7 } : participant
  ));
  const reparsed = participantsFromSharedRoster('아모레또\n유레카', weighted);

  assert.equal(reparsed[0].weight, 7, 'editing the roster must not reset weights');
  assert.equal(reparsed[0].id, weighted[0].id, 'ids must survive a re-parse');
  assert.equal(sharedRosterTextFromParticipants(reparsed), '아모레또\n유레카');
});

test('duplicate names are reported once, case-insensitively', () => {
  assert.deepEqual(
    findDuplicateParticipantNames([
      { id: '1', name: '유레카', weight: 1 },
      { id: '2', name: '유레카', weight: 1 },
      { id: '3', name: '세나', weight: 1 },
    ]),
    ['유레카'],
  );
});

test('weights and prize totals ignore negative and blank entries', () => {
  assert.equal(
    totalEffectiveWeight([
      { id: 'a', name: 'a', weight: 2 },
      { id: 'b', name: 'b', weight: -5 },
    ]),
    2,
  );
  assert.equal(
    prizeTotal([
      { id: 'p1', name: '커피', quantity: 2, weight: 1 },
      { id: 'p2', name: '  ', quantity: 9, weight: 1 },
      { id: 'p3', name: '텀블러', quantity: -1, weight: 1 },
    ]),
    2,
  );
});

const round: CurrentRound = {
  id: 'round-1',
  sessionId: 'session-1',
  label: '오늘의 추첨',
  target: 'people',
  mode: 'wheel',
  wheelPresentation: 'spin',
  candidateCount: 2,
  poolLimit: 0,
  removeAfterDraw: true,
  useWeights: false,
  results: [],
};

test('the locked result carries the full audit record before any reveal', () => {
  const options: DrawOption[] = [
    { id: 'shared-0001', name: '아모레또', weight: 1 },
    { id: 'shared-0002', name: '유레카', weight: 1 },
  ];
  const presentation: PlannedPresentation = {
    options,
    winnerIndex: 1,
    target: 'people',
    selectedAt: '2026-07-31T01:02:03.000Z',
    candidateFingerprint: fingerprintOptions(options),
    candidateTotalWeight: totalEffectiveWeight(options),
    landing: { sliceIndex: 1, offsetRatio: 0.5 } as never,
  };

  const committed = attachLockedResult(presentation, round, 1);

  assert.ok(committed, 'a valid winner index must produce a locked result');
  assert.equal(committed.lockedResult.winner, '유레카');
  assert.equal(committed.lockedResult.sessionId, 'session-1');
  assert.equal(committed.lockedResult.roundId, 'round-1');
  assert.equal(committed.lockedResult.createdAt, presentation.selectedAt);
  assert.equal(committed.lockedResult.presentation, 'spin');
  assert.equal(
    committed.lockedResult.candidateFingerprint,
    presentation.candidateFingerprint,
  );
  assert.match(committed.lockedResult.id, /^result-/);
  // A people draw must not leak prize-only fields into the stored record.
  assert.equal(committed.lockedResult.prize, undefined);
  assert.equal(committed.lockedResult.prizeId, undefined);
  assert.equal(committed.lockedResult.recipient, undefined);
});

test('an out-of-range winner index refuses to produce a record', () => {
  const options: DrawOption[] = [{ id: 'a', name: '아모레또', weight: 1 }];

  assert.equal(
    attachLockedResult(
      {
        options,
        winnerIndex: 5,
        target: 'people',
        selectedAt: '2026-07-31T01:02:03.000Z',
        candidateFingerprint: fingerprintOptions(options),
        candidateTotalWeight: 1,
        landing: { sliceIndex: 0, offsetRatio: 0 } as never,
      },
      round,
      1,
    ),
    null,
  );
});
