import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceRacePlayback,
  createRacePlaybackClock,
  FINAL_OVERTAKE_DURATION_MS,
  FINAL_OVERTAKE_POST_ROLL_MS,
  FINAL_OVERTAKE_PRE_ROLL_MS,
  overtakeZoomIntensity,
  RESULT_HOLD_DURATION_MS,
  resolveFinalOvertakeTriggerFrame,
} from "../app/marble/race-playback";

const event = (triggerFrameIndex: number) => ({ triggerFrameIndex });

test("a final overtake advances only 7.5 source frames in 0.5 seconds", () => {
  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    1_000,
    [event(30)],
  );
  assert.equal(clock.sourceFrame, 30);
  assert.equal(clock.activeEventIndex, 0);
  assert.equal(clock.effectRemainingMs, FINAL_OVERTAKE_DURATION_MS);

  clock = advanceRacePlayback(clock, 500, [event(30)]);
  assert.equal(clock.sourceFrame, 37.5);
  assert.equal(clock.activeEventIndex, null);
});

test("a 60Hz slow-motion cue exposes a distinct fractional source sample every paint", () => {
  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    1_000,
    [event(30)],
  );
  const samples: number[] = [];
  for (let paint = 0; paint < 30; paint += 1) {
    clock = advanceRacePlayback(clock, 1_000 / 60, [event(30)]);
    samples.push(clock.sourceFrame);
  }

  assert.equal(new Set(samples.map((value) => value.toFixed(6))).size, 30);
  assert.ok(
    samples.every(
      (value, index) =>
        index === 0 || value - samples[index - 1] > 0,
    ),
  );
  assert.ok(Math.abs(samples.at(-1)! - 37.5) < 1e-9);
});

test("the cinematic places 0.3 seconds before and 0.2 seconds after the overtake", () => {
  const overtakeFrameIndex = 30;
  const triggerFrameIndex =
    resolveFinalOvertakeTriggerFrame(overtakeFrameIndex);
  assert.equal(triggerFrameIndex, 25.5);

  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    850,
    [event(triggerFrameIndex)],
  );
  assert.equal(clock.sourceFrame, triggerFrameIndex);
  assert.equal(clock.effectElapsedMs, 0);

  clock = advanceRacePlayback(
    clock,
    FINAL_OVERTAKE_PRE_ROLL_MS,
    [event(triggerFrameIndex)],
  );
  assert.equal(clock.sourceFrame, overtakeFrameIndex);
  assert.equal(
    clock.effectRemainingMs,
    FINAL_OVERTAKE_POST_ROLL_MS,
  );

  clock = advanceRacePlayback(
    clock,
    FINAL_OVERTAKE_POST_ROLL_MS,
    [event(triggerFrameIndex)],
  );
  assert.equal(clock.sourceFrame, 33);
  assert.equal(clock.activeEventIndex, null);
});

test("a dropped animation frame cannot skip an overtake boundary", () => {
  const clock = advanceRacePlayback(
    createRacePlaybackClock(),
    2_000,
    [event(30)],
  );
  assert.equal(clock.sourceFrame, 52.5);
  assert.equal(clock.nextEventIndex, 1);
  assert.equal(clock.activeEventIndex, null);
});

test("a newer overtake refreshes the half-second cue", () => {
  const events = [event(30), event(33)];
  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    1_000,
    events,
  );
  clock = advanceRacePlayback(clock, 200, events);
  assert.equal(clock.sourceFrame, 33);
  assert.equal(clock.activeEventIndex, 1);
  assert.equal(clock.effectRemainingMs, FINAL_OVERTAKE_DURATION_MS);

  clock = advanceRacePlayback(clock, 500, events);
  assert.equal(clock.sourceFrame, 40.5);
  assert.equal(clock.activeEventIndex, null);
});

test("reduced motion keeps normal playback speed but preserves the cue window", () => {
  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    1_000,
    [event(30)],
    { slowMotionEnabled: false },
  );
  clock = advanceRacePlayback(clock, 500, [event(30)], {
    slowMotionEnabled: false,
  });
  assert.equal(clock.sourceFrame, 45);
  assert.equal(clock.activeEventIndex, null);
});

test("the result hold starts at the result gate and lasts three visible seconds", () => {
  let clock = advanceRacePlayback(
    createRacePlaybackClock(),
    1_500,
    [],
    { resultGateFrameIndex: 30 },
  );
  assert.equal(clock.resultGateReached, true);
  assert.equal(clock.sourceFrame, 45);
  assert.equal(clock.resultHoldElapsedMs, 500);

  clock = advanceRacePlayback(clock, RESULT_HOLD_DURATION_MS - 500, [], {
    resultGateFrameIndex: 30,
  });
  assert.equal(clock.resultHoldElapsedMs, RESULT_HOLD_DURATION_MS);
});

test("cinematic zoom eases in, holds, and returns to neutral", () => {
  assert.equal(overtakeZoomIntensity(0), 0);
  assert.equal(overtakeZoomIntensity(0.2), 1);
  assert.equal(overtakeZoomIntensity(0.5), 1);
  assert.equal(overtakeZoomIntensity(0.8), 1);
  assert.equal(overtakeZoomIntensity(1), 0);
});
