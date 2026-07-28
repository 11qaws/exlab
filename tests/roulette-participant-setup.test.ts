import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const setupSourceUrl = new URL(
  '../app/games/roulette/components/ParticipantSetup.tsx',
  import.meta.url,
);

test('Roulette participant setup preserves invalid draft rows and blocks save with visible errors', async () => {
  const source = await readFile(setupSourceUrl, 'utf8');

  assert.match(source, /MAX_SHARED_NAME_LENGTH/);
  assert.match(source, /MAX_SHARED_ROSTER_SIZE/);
  assert.match(source, /sharedRosterNameLength/);
  assert.doesNotMatch(source, /seen\.has\(key\)\)\) return \[\]/);
  assert.doesNotMatch(source, /name\.length <= 40/);
  assert.match(source, /동일 이름을 정리하거나 허용 옵션을 켜 주세요/);
  assert.match(
    source,
    /if \(draftValidation\.error\) return;\s+onStart\(normalizedParticipants\(draft\)\)/,
  );
  assert.match(
    source,
    /disabled=\{Boolean\(draftValidation\.error\)\}/,
  );
  assert.match(source, /participant-setup-cafe-error/);
  assert.match(source, /participant-setup-manual-error/);
  assert.match(source, /role="alert"/);
});
