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

test("221px compact Roulette keeps short names readable without number placeholders", () => {
  for (const participantCount of [2, 5, 10, 32]) {
    const decision = resolveWheelSliceLabel({
      participant: "레또",
      participantCount,
      sliceAngle: 360 / participantCount,
      labelRadius: equalSliceLabelRadius(participantCount),
      wheelDiameter: 221,
      wheelRadius: WHEEL_RADIUS,
      viewBoxDiameter: 600,
    });

    assert.equal(decision.kind, "name");
    assert.equal(decision.text, "레또");
    assert.ok(
      decision.fontSizeInViewBox * (221 / 600) >= 10,
      `${participantCount} slices should keep a readable rendered name`,
    );
  }
});

test("compact Roulette hides or truncates long names instead of inventing ordinals", () => {
  for (const participantCount of [2, 5, 10, 32]) {
    const decision = resolveWheelSliceLabel({
      participant: "아주 긴 참가자 이름",
      participantCount,
      sliceAngle: 360 / participantCount,
      labelRadius: equalSliceLabelRadius(participantCount),
      wheelDiameter: 221,
      wheelRadius: WHEEL_RADIUS,
      viewBoxDiameter: 600,
    });

    assert.notEqual(
      (decision as { kind: string }).kind,
      "number",
      `${participantCount} slices must never fall back to a numeric label`,
    );
    assert.notEqual(decision.text, String(participantCount));
    assert.ok(
      decision.kind === "hidden" || decision.text.includes("아"),
      `${participantCount} slices should preserve the supplied name when visible`,
    );
  }
});

test("large Roulette wheels keep readable participant names", () => {
  const decision = resolveWheelSliceLabel({
    participant: "레또",
    participantCount: 5,
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

test("an impossibly dense compact wheel hides its label cleanly", () => {
  const decision = resolveWheelSliceLabel({
    participant: "후보",
    participantCount: 320,
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
