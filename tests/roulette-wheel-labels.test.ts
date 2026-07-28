import assert from "node:assert/strict";
import test from "node:test";

import {
  compactWheelName,
  resolveWheelSliceLabel,
} from "../app/games/roulette/lib/wheelLabelReadability";

const WHEEL_RADIUS = 304;

function equalSliceLabelRadius(participantCount: number) {
  const sliceAngle = 360 / participantCount;
  const baseRadius = participantCount > 28 ? 205 : participantCount > 16 ? 195 : 178;
  return sliceAngle < 16
    ? Math.min(WHEEL_RADIUS - 20, baseRadius + 35)
    : baseRadius;
}

test("221px compact Roulette keeps every common roster size identifiable", () => {
  for (const participantCount of [2, 5, 10, 32]) {
    const participantIndex = participantCount - 1;
    const decision = resolveWheelSliceLabel({
      participant: "아주 긴 참가자 이름",
      participantCount,
      participantIndex,
      sliceAngle: 360 / participantCount,
      labelRadius: equalSliceLabelRadius(participantCount),
      wheelDiameter: 221,
      wheelRadius: WHEEL_RADIUS,
      viewBoxDiameter: 600,
    });

    assert.equal(decision.kind, "number");
    assert.equal(decision.text, String(participantIndex + 1));
    assert.ok(
      decision.fontSizeInViewBox * (221 / 600) >= 9,
      `${participantCount} slices should keep a readable rendered number`,
    );
  }
});

test("large Roulette wheels keep readable participant names", () => {
  const decision = resolveWheelSliceLabel({
    participant: "레또",
    participantCount: 5,
    participantIndex: 0,
    sliceAngle: 72,
    labelRadius: 178,
    wheelDiameter: 600,
  });

  assert.deepEqual(decision, {
    kind: "name",
    text: "레또",
    fontSizeInViewBox: 20,
  });
});

test("wheel name compaction never splits emoji graphemes", () => {
  assert.equal(
    compactWheelName("👨‍👩‍👧‍👦가나다", 32),
    "👨‍👩‍👧‍👦가…",
  );
});

test("an impossibly dense compact wheel delegates identity to the numbered roster", () => {
  const decision = resolveWheelSliceLabel({
    participant: "후보",
    participantCount: 320,
    participantIndex: 319,
    sliceAngle: 360 / 320,
    labelRadius: 240,
    wheelDiameter: 221,
  });

  assert.deepEqual(decision, {
    kind: "hidden",
    text: "",
    fontSizeInViewBox: 0,
  });
});
