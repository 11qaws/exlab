import assert from "node:assert/strict";
import test from "node:test";

import {
  advancePreviewCycle,
  createPreviewCycleBuffer,
  DEFAULT_PREVIEW_ROSTER_NAMES,
  previewRosterNamesOrDefault,
  queuePreviewCycleValue,
} from "../app/_platform/previewRoster";

test("Roulette and Showdown share the exact four-person default preview roster", () => {
  assert.deepEqual(
    [...DEFAULT_PREVIEW_ROSTER_NAMES],
    ["레또", "레카", "세나", "망징"],
  );
  assert.deepEqual(
    previewRosterNamesOrDefault([" ", ""]),
    ["레또", "레카", "세나", "망징"],
  );
});

test("preview roster edits stay pending until the current cycle advances", () => {
  const initial = createPreviewCycleBuffer(
    [...DEFAULT_PREVIEW_ROSTER_NAMES],
    ["참가자 A", "참가자 B"],
  );
  const editedOnce = queuePreviewCycleValue(initial, [
    "참가자 C",
    "참가자 D",
  ]);
  const editedAgain = queuePreviewCycleValue(editedOnce, [
    "최종 A",
    "최종 B",
    "최종 C",
  ]);

  assert.deepEqual(
    editedAgain.active,
    ["레또", "레카", "세나", "망징"],
  );
  assert.deepEqual(
    editedAgain.pending,
    ["최종 A", "최종 B", "최종 C"],
  );

  const nextCycle = advancePreviewCycle(editedAgain);
  assert.deepEqual(
    nextCycle.active,
    ["최종 A", "최종 B", "최종 C"],
  );
  assert.deepEqual(nextCycle.pending, nextCycle.active);
});

test("a cycle boundary can override an older queued value with the latest snapshot", () => {
  const state = createPreviewCycleBuffer(
    ["현재 1", "현재 2"],
    ["이전 예약 1", "이전 예약 2"],
  );
  const nextCycle = advancePreviewCycle(state, [
    "최신 1",
    "최신 2",
    "최신 3",
  ]);

  assert.deepEqual(
    nextCycle.active,
    ["최신 1", "최신 2", "최신 3"],
  );
});
