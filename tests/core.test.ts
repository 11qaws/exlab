import assert from "node:assert/strict";
import test from "node:test";
import {
  COURSE_BUMPERS,
  COURSE_BOUNDARY_THICKNESS,
  COURSE_LENGTH_SCALE,
  COURSE_CURVES,
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  COURSE_SECTIONS,
  FINISH_LINE_X,
  FINISH_LINE_WIDTH,
  FINISH_Y,
  MARBLE_RADIUS,
  ROTATING_BARS,
  STRAIGHT_ZONES,
  TARGET_FIRST_FINISH_SECONDS,
  WORLD_HEIGHT,
  courseBoundsAtY,
  rotatingBarAngle,
  rotatingBarTurnsTowardWall,
} from "../app/marble/course";
import {
  advanceVerticalCamera,
  INITIAL_LEADER_FOCUS_STATE,
  INITIAL_VERTICAL_CAMERA_STATE,
  LEADER_FOCUS_DELAY_FRAMES,
  LEADER_FOCUS_DELAY_SECONDS,
  resolveLeaderFocus,
} from "../app/marble/camera";
import {
  inspectCourseClearance,
  MARBLE_DIAMETER,
  MIN_COURSE_CLEARANCE,
  ROTATING_BAR_CLEARANCE_MODEL,
  ROTATING_BAR_CLEARANCE_RADIUS,
} from "../app/marble/course-clearance";
import {
  buildRacePlan,
  contrastRatio,
  minimumGroupCount,
  parseRoster,
  PARTICIPANT_THEMES,
  shuffleSeeded,
  splitCandidatesIntoGroups,
} from "../app/marble/core";
import {
  COUNTDOWN_SEQUENCE,
  countdownStepDuration,
  nextCountdownStep,
} from "../app/marble/countdown";
import { createRaceDynamics } from "../app/marble/dynamics";
import {
  catchUpIntensity,
  simulateRace,
} from "../app/marble/simulation";
import { resolveRaceFrame } from "../app/marble/RaceCanvas";

test("roster accepts two through ten participants", () => {
  assert.equal(parseRoster("가\n나").isValid, true);
  assert.equal(
    parseRoster(
      Array.from({ length: 10 }, (_, index) => `참가자${index + 1}`).join("\n"),
    ).isValid,
    true,
  );
});

test("roster preserves overflow names beyond the full-list limit", () => {
  const validation = parseRoster(
    Array.from({ length: 321 }, (_, index) => `참가자${index + 1}`).join("\n"),
  );
  assert.equal(validation.isValid, false);
  assert.equal(validation.candidates.length, 320);
  assert.deepEqual(validation.overflowNames, ["참가자321"]);
});

test("duplicate names are blocked by default and can be explicitly allowed", () => {
  const validation = parseRoster("동일\n동일");
  assert.equal(validation.isValid, false);
  assert.deepEqual(validation.duplicateNames, ["동일"]);
  const allowed = parseRoster("동일\n동일", {
    allowDuplicateNames: true,
  });
  assert.equal(allowed.isValid, true);
  assert.notEqual(allowed.candidates[0].id, allowed.candidates[1].id);
});

test("thirty-two participants default to four balanced groups", () => {
  const candidates = parseRoster(
    Array.from({ length: 32 }, (_, index) => `참가자${index + 1}`).join("\n"),
  ).candidates;
  assert.equal(minimumGroupCount(candidates.length), 4);
  assert.deepEqual(
    splitCandidatesIntoGroups(candidates, 1).map(
      (group) => group.candidates.length,
    ),
    [8, 8, 8, 8],
  );
  assert.deepEqual(
    splitCandidatesIntoGroups(candidates, 8).map(
      (group) => group.candidates.length,
    ),
    [4, 4, 4, 4, 4, 4, 4, 4],
  );
});

test("participant themes meet the common contrast rules", () => {
  assert.equal(PARTICIPANT_THEMES.length, 10);
  for (const theme of PARTICIPANT_THEMES) {
    assert.ok(contrastRatio(theme.onPrimary, theme.primary) >= 4.5);
    assert.ok(contrastRatio(theme.onSurface, theme.surface) >= 6.5);
  }
});

test("seeded shuffle is deterministic", () => {
  const source = ["a", "b", "c", "d", "e"];
  assert.deepEqual(shuffleSeeded(source, "same"), shuffleSeeded(source, "same"));
  assert.notDeepEqual(
    shuffleSeeded(source, "same"),
    shuffleSeeded(source, "different"),
  );
});

test("physics simulation produces a stable winner for the same seeds", () => {
  const first = simulateRace(5, "race-fixed", "layout-fixed");
  const second = simulateRace(5, "race-fixed", "layout-fixed");
  assert.equal(first.fullFinishOrder.length, 5);
  assert.deepEqual(first.fullFinishOrder, second.fullFinishOrder);
  assert.deepEqual(first.dynamics, second.dynamics);
  assert.ok(first.frames.length > 30);
  assert.ok(first.firstFinishFrameIndex >= 0);
  assert.ok(first.awardFrameIndex >= first.firstFinishFrameIndex);
});

test("countdown exposes 3, 2, 1, and GO before the race starts", () => {
  assert.deepEqual(COUNTDOWN_SEQUENCE, [3, 2, 1, "GO"]);
  assert.equal(nextCountdownStep(3), 2);
  assert.equal(nextCountdownStep(2), 1);
  assert.equal(nextCountdownStep(1), "GO");
  assert.equal(nextCountdownStep("GO"), null);
  assert.ok(countdownStepDuration("GO", false) >= 350);
});

test("seeded dynamics vary races without breaking the final spinner rule", () => {
  const first = createRaceDynamics("dynamics-a");
  const replay = createRaceDynamics("dynamics-a");
  const second = createRaceDynamics("dynamics-b");
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, second);
  assert.equal(first.rotatingBars.length, ROTATING_BARS.length);
  assert.equal(
    Math.sign(first.rotatingBars.at(-1)!.angularSpeed),
    Math.sign(ROTATING_BARS.at(-1)!.angularSpeed),
  );
  assert.ok(first.windPulses.length >= 3);
  assert.ok(first.forceZones.length >= 2);
});

test("the extended asymmetric course targets a roughly thirty-second first finish", () => {
  assert.equal(TARGET_FIRST_FINISH_SECONDS, 30);
  assert.equal(COURSE_LENGTH_SCALE, 1.5);
  assert.equal(WORLD_HEIGHT, 13_500);
  assert.ok(COURSE_RECTS.length + COURSE_CURVE_RECTS.length >= 80);
  assert.ok(COURSE_PINS.length >= 25);
  assert.equal(STRAIGHT_ZONES.length, 10);
  assert.equal(COURSE_CURVES.length, (STRAIGHT_ZONES.length - 1) * 2);
  assert.ok(COURSE_CURVES.every((curve) => curve.role === "boundary"));
  assert.ok(COURSE_CURVE_RECTS.length >= 60);
  assert.equal(ROTATING_BARS.length, 4);

  const widths = STRAIGHT_ZONES.map(
    (zone) => zone.rightX - zone.leftX,
  );
  assert.ok(Math.max(...widths) - Math.min(...widths) >= 600);
  const playableWidths = STRAIGHT_ZONES.filter(
    (zone) => zone.id !== "finish-corridor",
  ).map((zone) => zone.rightX - zone.leftX);
  assert.ok(Math.max(...playableWidths) - Math.min(...playableWidths) >= 400);
  const centres = STRAIGHT_ZONES.map(
    (zone) => (zone.leftX + zone.rightX) / 2,
  );
  assert.ok(Math.max(...centres) >= 600);
  assert.ok(Math.min(...centres) <= 300);
  assert.ok(Math.max(...centres) - Math.min(...centres) >= 400);

  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  );
  assert.ok(finishCorridor);
  const finishApproachWidth =
    finishCorridor.rightX -
    finishCorridor.leftX -
    COURSE_BOUNDARY_THICKNESS;
  assert.equal(finishApproachWidth, FINISH_LINE_WIDTH);
  assert.equal(finishApproachWidth, 60);
  assert.ok(finishApproachWidth > MIN_COURSE_CLEARANCE);
  const finishEntranceSpinner = ROTATING_BARS.find(
    (bar) => bar.placement === "finish-entrance",
  );
  assert.ok(finishEntranceSpinner);
  assert.equal(finishEntranceSpinner.wallSide, "left");
  assert.ok(rotatingBarTurnsTowardWall(finishEntranceSpinner));
  assert.ok(
    finishEntranceSpinner.y > 8_000 &&
      finishEntranceSpinner.y < FINISH_Y,
  );

  for (const participantCount of [5, 10]) {
    const firstFinishSeconds = Array.from({ length: 12 }, (_, index) => {
      const simulation = simulateRace(
        participantCount,
        `duration-${participantCount}-${index}`,
        `layout-duration-${index}`,
      );
      assert.ok(simulation.physicallyFinishedCount > 0);
      return simulation.firstFinishFrameIndex / 30;
    });
    const average =
      firstFinishSeconds.reduce((sum, duration) => sum + duration, 0) /
      firstFinishSeconds.length;

    assert.ok(average >= TARGET_FIRST_FINISH_SECONDS - 5);
    assert.ok(average <= TARGET_FIRST_FINISH_SECONDS + 5);
  }
});

test("obstacles stay on straight zones and wall bumpers feed inward", () => {
  const zones = new Map(STRAIGHT_ZONES.map((zone) => [zone.id, zone]));
  const obstacleRects = COURSE_RECTS.filter(
    (rect) => rect.obstacleKind !== undefined,
  );

  for (const rect of obstacleRects) {
    const zone = zones.get(rect.zoneId!);
    assert.ok(zone, `missing zone for ${rect.zoneId}`);
    const angle = rect.angle ?? 0;
    const halfVerticalExtent =
      (Math.abs(Math.sin(angle)) * rect.width +
        Math.abs(Math.cos(angle)) * rect.height) /
      2;
    assert.ok(rect.y - halfVerticalExtent >= zone.startY);
    assert.ok(rect.y + halfVerticalExtent <= zone.endY);

    if (!rect.attachment) continue;
    const halfHorizontalSpan =
      (Math.abs(Math.cos(angle)) * rect.width) / 2;
    if (rect.attachment === "left") {
      assert.ok(angle > 0);
      assert.ok(Math.abs(rect.x - halfHorizontalSpan - zone.leftX) < 1e-6);
      assert.ok(rect.y + Math.sin(angle) * (rect.width / 2) > rect.y);
    } else {
      assert.ok(angle < 0);
      assert.ok(Math.abs(rect.x + halfHorizontalSpan - zone.rightX) < 1e-6);
      assert.ok(rect.y - Math.sin(angle) * (rect.width / 2) > rect.y);
    }
  }

  for (const pin of COURSE_PINS) {
    const zone = zones.get(pin.zoneId);
    assert.ok(zone);
    assert.ok(pin.y - pin.radius >= zone.startY);
    assert.ok(pin.y + pin.radius <= zone.endY);
  }

  for (const bumper of COURSE_BUMPERS.filter(
    (candidate) => candidate.kind === "field",
  )) {
    const zone = zones.get(bumper.zoneId);
    assert.ok(zone);
    const halfVerticalExtent =
      (Math.abs(Math.sin(bumper.angle)) * bumper.width +
        Math.abs(Math.cos(bumper.angle)) * bumper.height) /
      2;
    assert.ok(bumper.y - halfVerticalExtent >= zone.startY);
    assert.ok(bumper.y + halfVerticalExtent <= zone.endY);
  }

  for (const bar of ROTATING_BARS) {
    const zone = zones.get(bar.zoneId);
    assert.ok(zone);
    const sweepRadius = Math.hypot(bar.width / 2, bar.height / 2);
    assert.ok(bar.y - sweepRadius >= zone.startY);
    assert.ok(bar.y + sweepRadius <= zone.endY);
  }

  assert.ok(
    obstacleRects.filter((rect) => rect.obstacleKind === "wall-bumper")
      .length >= 18,
  );
  assert.ok(
    obstacleRects.filter((rect) => rect.obstacleKind === "shelf").length >=
      3,
  );

  for (const zone of STRAIGHT_ZONES.filter(
    (candidate) => candidate.requiresBilateralWallObstacles,
  )) {
    for (const side of ["left", "right"] as const) {
      assert.ok(
        obstacleRects.some(
          (rect) =>
            rect.obstacleKind === "wall-bumper" &&
            rect.zoneId === zone.id &&
            rect.attachment === side,
        ),
        `${zone.id} is missing its ${side} wall obstacle`,
      );
    }
  }

  assert.equal(
    STRAIGHT_ZONES.find((zone) => zone.id === "finish-corridor")
      ?.requiresBilateralWallObstacles,
    false,
  );
});

test("quarter markers introduce four distinct obstacle patterns", () => {
  assert.deepEqual(
    COURSE_SECTIONS.map((section) => section.startY / WORLD_HEIGHT),
    [0, 0.25, 0.5, 0.75],
  );
  assert.deepEqual(
    COURSE_SECTIONS.map((section) => section.endY / WORLD_HEIGHT),
    [0.25, 0.5, 0.75, 1],
  );
  assert.deepEqual(
    COURSE_SECTIONS.map((section) => section.pattern),
    ["pins", "bumpers", "gates", "final-mix"],
  );

  const signatures = COURSE_SECTIONS.map((section) => [
    COURSE_PINS.filter(
      (pin) => pin.y >= section.startY && pin.y < section.endY,
    ).length,
    COURSE_BUMPERS.filter(
      (bumper) =>
        bumper.y >= section.startY && bumper.y < section.endY,
    ).length,
    ROTATING_BARS.filter(
      (bar) => bar.y >= section.startY && bar.y < section.endY,
    ).length,
  ]);
  assert.equal(new Set(signatures.map((value) => value.join(":"))).size, 4);
  assert.ok(signatures[0][0] >= 12);
  assert.ok(signatures[1][1] >= 3);
  assert.equal(signatures[2][2], 0);
  assert.ok(signatures[3][0] >= 7);
  assert.ok(signatures[3][2] >= 2);
});

test("finish entrance has paired launch bumpers beside the narrow lane", () => {
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  )!;
  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  )!;
  const launchBumpers = COURSE_BUMPERS.filter(
    (bumper) => bumper.kind === "finish-launch",
  );

  assert.equal(launchBumpers.length, 2);
  assert.deepEqual(
    launchBumpers.map((bumper) => bumper.attachment).sort(),
    ["left", "right"],
  );
  for (const bumper of launchBumpers) {
    assert.ok(bumper.y > finalGate.endY);
    assert.ok(bumper.y < finishCorridor.startY);
    assert.ok(bumper.kickSpeed >= 6);
  }
  const [left, right] = launchBumpers;
  const leftInnerEdge = left.x + left.width / 2;
  const rightInnerEdge = right.x - right.width / 2;
  const clearance = rightInnerEdge - leftInnerEdge;
  assert.ok(clearance >= MIN_COURSE_CLEARANCE);
  assert.equal(leftInnerEdge, FINISH_LINE_X);
  assert.equal(rightInnerEdge, FINISH_LINE_X + FINISH_LINE_WIDTH);

  const bounds = courseBoundsAtY(left.y);
  const wallHalfWidth = COURSE_BOUNDARY_THICKNESS / 2;
  assert.ok(
    left.x - left.width / 2 <=
      bounds.leftX - wallHalfWidth - MARBLE_RADIUS,
  );
  assert.ok(
    right.x + right.width / 2 >=
      bounds.rightX + wallHalfWidth + MARBLE_RADIUS,
  );
});

test("active bumpers are pill-shaped bars", () => {
  for (const bumper of COURSE_BUMPERS) {
    assert.ok(bumper.width >= bumper.height * 2);
    assert.ok(bumper.height >= MARBLE_RADIUS);
    assert.ok(Number.isFinite(bumper.angle));
  }
});

test("race frames expose bounded bumper collision flashes", () => {
  const result = simulateRace(5, "flash-test", "flash-layout");
  const flashes = result.frames.flatMap((frame) => frame.bumperFlashes);

  assert.ok(
    result.frames.every(
      (frame) => frame.bumperFlashes.length === COURSE_BUMPERS.length,
    ),
  );
  assert.ok(flashes.some((flash) => flash.level > 0));
  for (const flash of flashes) {
    assert.ok(flash.level >= 0 && flash.level <= 1);
    assert.ok(Number.isFinite(flash.x));
    assert.ok(Number.isFinite(flash.y));
  }
});

test("race frame selection survives preview plan transitions", () => {
  const frame = {
    poses: [],
    rankedSlotIds: ["slot-1"],
    finishedSlotIds: [],
    rotatingBarAngles: [],
    bumperFlashes: [],
  };

  assert.equal(resolveRaceFrame([frame], -1), frame);
  assert.equal(resolveRaceFrame([frame], Number.NaN), frame);
  assert.equal(resolveRaceFrame([frame], 999), frame);
  assert.equal(resolveRaceFrame([], 0), null);
});

test("catch-up force starts only after a meaningful leader gap", () => {
  const dynamics = createRaceDynamics("catch-up-test").catchUp;
  assert.equal(catchUpIntensity(dynamics.startGap, dynamics), 0);
  assert.equal(
    catchUpIntensity(
      (dynamics.startGap + dynamics.maxGap) / 2,
      dynamics,
    ),
    0.5,
  );
  assert.equal(catchUpIntensity(dynamics.maxGap, dynamics), 1);
  assert.equal(catchUpIntensity(dynamics.maxGap * 2, dynamics), 1);
});

test("rotating bars keep turning through complete revolutions", () => {
  for (const bar of ROTATING_BARS) {
    const rotation =
      rotatingBarAngle(bar, 600) - rotatingBarAngle(bar, 0);
    assert.ok(Math.abs(rotation) > Math.PI * 2);
  }
});

test("camera waits half a second before following a new leader", () => {
  assert.equal(LEADER_FOCUS_DELAY_SECONDS, 0.5);
  assert.equal(LEADER_FOCUS_DELAY_FRAMES, 15);

  let focus = resolveLeaderFocus(
    INITIAL_LEADER_FOCUS_STATE,
    "slot-a",
    0,
  );
  assert.equal(focus.focusedSlotId, "slot-a");

  focus = resolveLeaderFocus(focus, "slot-b", 20);
  assert.equal(focus.focusedSlotId, "slot-a");
  assert.equal(focus.pendingSlotId, "slot-b");
  focus = resolveLeaderFocus(focus, "slot-b", 34);
  assert.equal(focus.focusedSlotId, "slot-a");
  focus = resolveLeaderFocus(focus, "slot-b", 35);
  assert.equal(focus.focusedSlotId, "slot-b");
});

test("camera follows vertically with damped acceleration", () => {
  const first = advanceVerticalCamera(
    INITIAL_VERTICAL_CAMERA_STATE,
    500,
    1_000,
    false,
  );
  const second = advanceVerticalCamera(first, 500, 1_000, false);
  assert.ok(first.positionY > 0 && first.positionY < 500);
  assert.ok(second.positionY > first.positionY);
  assert.ok(second.velocityY > first.velocityY);

  const reduced = advanceVerticalCamera(
    INITIAL_VERTICAL_CAMERA_STATE,
    500,
    1_000,
    true,
  );
  assert.deepEqual(reduced, { positionY: 500, velocityY: 0 });
});

test("rotating bar clearance reserves one marble at each pivot", () => {
  assert.equal(ROTATING_BAR_CLEARANCE_MODEL, "pivot-marble");
  assert.equal(ROTATING_BAR_CLEARANCE_RADIUS, MARBLE_RADIUS);
  for (const bar of ROTATING_BARS) {
    assert.ok(
      ROTATING_BAR_CLEARANCE_RADIUS <
        Math.hypot(bar.width / 2, bar.height / 2),
    );
  }
});

test("every independent course object leaves more than one marble diameter", () => {
  const report = inspectCourseClearance();
  assert.ok(MIN_COURSE_CLEARANCE > MARBLE_DIAMETER);
  assert.equal(
    report.violations.length,
    0,
    report.violations
      .slice(0, 12)
      .map(
        ({ firstId, secondId, clearance }) =>
          `${firstId} ↔ ${secondId}: ${clearance.toFixed(1)}px`,
      )
      .join(", "),
  );
  assert.deepEqual(report.wallCoverageViolations, []);
  assert.deepEqual(report.finalEntranceSpinnerViolations, []);
  assert.deepEqual(report.finalLaunchBumperViolations, []);
  assert.ok(report.minimumClearance >= MIN_COURSE_CLEARANCE);
});

test("preselected mode maps the locked result onto physical finish slots", () => {
  const candidates = parseRoster("가\n나\n다\n라").candidates;
  const simulation = simulateRace(4, "race-plan", "layout-plan", 2);
  const plan = buildRacePlan(
    "테스트",
    candidates,
    "preselected",
    simulation,
    {
      raceSeed: "race-plan",
      resultSeed: "result-plan",
      layoutSeed: "layout-plan",
    },
    2,
  );
  assert.equal(plan.rankedCandidateIds.length, 4);
  assert.equal(new Set(plan.rankedCandidateIds).size, 4);
  assert.deepEqual(plan.winnerIds, plan.rankedCandidateIds.slice(0, 2));
  assert.equal(plan.winnerCount, 2);
});

test("race presentation continues until the configured winner count arrives", () => {
  const simulation = simulateRace(
    8,
    "multi-winner-race",
    "multi-winner-layout",
    4,
  );
  assert.equal(simulation.targetFinishCount, 4);
  assert.ok(simulation.visibleFinishedCount >= 4);
  assert.ok(simulation.awardFrameIndex > simulation.firstFinishFrameIndex);
  assert.ok(
    simulation.frames.at(-1)!.finishedSlotIds.length >=
      simulation.targetFinishCount,
  );
});

test("result frames continue after the winner reveal and keep unfinished rows open", () => {
  const simulation = simulateRace(
    6,
    "live-arrival-race",
    "live-arrival-layout",
    1,
  );
  const revealFrame =
    simulation.frames[simulation.awardFrameIndex];
  const finalFrame = simulation.frames.at(-1)!;

  assert.equal(revealFrame.finishedSlotIds.length, 1);
  assert.ok(simulation.frames.length - 1 > simulation.awardFrameIndex);
  assert.ok(
    finalFrame.finishedSlotIds.length >= revealFrame.finishedSlotIds.length,
  );
  assert.equal(
    new Set(finalFrame.finishedSlotIds).size,
    finalFrame.finishedSlotIds.length,
  );
});

test("marbles remain inside the moving course after high-energy collisions", () => {
  const simulation = simulateRace(
    5,
    "duration-5-6",
    "layout-duration-6",
  );
  for (const frame of simulation.frames) {
    for (const pose of frame.poses) {
      const bounds = courseBoundsAtY(pose.y);
      const innerMargin =
        COURSE_BOUNDARY_THICKNESS / 2 + MARBLE_RADIUS;
      assert.ok(pose.x >= bounds.leftX + innerMargin - 0.01);
      assert.ok(pose.x <= bounds.rightX - innerMargin + 0.01);
    }
  }
});
