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
  REDUCED_MOTION_CAMERA_SNAP_DISTANCE,
  resolveLeaderFocus,
} from "../app/marble/camera";
import {
  inspectCourseClearance,
  FINAL_BYPASS_MIN_CLEARANCE,
  FINAL_RISK_LANE_MAX_SHARE,
  MARBLE_DIAMETER,
  MIN_COURSE_CLEARANCE,
  ROTATING_BAR_CLEARANCE_MODEL,
  ROTATING_BAR_CLEARANCE_RADIUS,
} from "../app/marble/course-clearance";
import {
  buildRacePlan,
  contrastRatio,
  createRaceSlotAssignment,
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
  PHYSICS_SUBSTEPS,
  sharedGravityMultiplier,
  simulateRace,
} from "../app/marble/simulation";
import {
  resolveRaceFocusSlotId,
  resolveRaceFrame,
} from "../app/marble/RaceCanvas";

const simulationSlots = (participantCount: number) =>
  Object.fromEntries(
    Array.from({ length: participantCount }, (_, index) => [
      `slot-${index + 1}`,
      `simulation-candidate-${index + 1}`,
    ]),
  );

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

test("shared interface tokens meet small-text contrast targets", () => {
  assert.ok(contrastRatio("#6b5356", "#fff8f3") >= 6.5);
  assert.ok(contrastRatio("#ffffff", "#ad204f") >= 6.5);
  assert.ok(contrastRatio("#075c43", "#e4f5ee") >= 6.5);
  assert.ok(contrastRatio("#7b4300", "#fff0da") >= 6.5);
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
  const slots = simulationSlots(5);
  const first = simulateRace(slots, "race-fixed", "layout-fixed");
  const second = simulateRace(slots, "race-fixed", "layout-fixed");
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
  assert.ok(first.bumperRestitution >= 1.22);
  assert.ok(first.bumperRestitution <= 1.32);
  assert.ok(first.spinnerRestitution > first.obstacleRestitution);
  assert.equal("catchUp" in first, false);
  assert.equal("windPulses" in first, false);
  assert.equal("forceZones" in first, false);
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
        simulationSlots(participantCount),
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

  for (const bumper of COURSE_BUMPERS) {
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
    if (bar.placement === "finish-entrance") {
      assert.ok(bar.y <= zone.endY);
      assert.ok(bar.y + sweepRadius >= zone.endY);
    } else {
      assert.ok(bar.y + sweepRadius <= zone.endY);
    }
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

test("selected asymmetric wall segments use bumper-level elasticity", () => {
  const elasticWalls = COURSE_RECTS.filter(
    (rect) => rect.role === "wall" && rect.material === "elastic",
  );
  assert.ok(elasticWalls.length >= 5);
  assert.equal(
    elasticWalls.filter((wall) => wall.zoneId === "wide-mix").length,
    2,
  );
  assert.ok(
    new Set(elasticWalls.map((wall) => wall.zoneId)).size >= 3,
  );
  assert.ok(
    elasticWalls.every((wall) => wall.zoneId !== "final-gate"),
  );
  assert.ok(
    elasticWalls.every((wall) => wall.zoneId !== "finish-corridor"),
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

test("finish entrance delays one risk lane while leaving a permanent bypass", () => {
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  )!;
  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  )!;
  const spinner = ROTATING_BARS.find(
    (bar) => bar.placement === "finish-entrance",
  )!;
  const sweepRadius = Math.hypot(spinner.width / 2, spinner.height / 2);
  const innerLeft = finalGate.leftX + COURSE_BOUNDARY_THICKNESS / 2;
  const innerRight = finalGate.rightX - COURSE_BOUNDARY_THICKNESS / 2;
  const innerWidth = innerRight - innerLeft;
  const bypass =
    innerRight - (spinner.x + sweepRadius + MARBLE_RADIUS);
  const riskShare =
    (spinner.x + sweepRadius - innerLeft) / innerWidth;
  const riskBumper = COURSE_BUMPERS.find(
    (bumper) => bumper.placement === "final-risk",
  )!;
  const bumperHalfSpan =
    (Math.abs(Math.cos(riskBumper.angle)) * riskBumper.width +
      Math.abs(Math.sin(riskBumper.angle)) * riskBumper.height) /
    2;
  const bumperBypass =
    innerRight -
    (riskBumper.x + bumperHalfSpan + MARBLE_RADIUS);

  assert.equal(spinner.wallSide, "left");
  assert.ok(riskBumper);
  assert.ok(riskBumper.y < spinner.y);
  assert.ok(bumperBypass >= FINAL_BYPASS_MIN_CLEARANCE);
  assert.ok(bypass >= FINAL_BYPASS_MIN_CLEARANCE);
  assert.ok(riskShare <= FINAL_RISK_LANE_MAX_SHARE);
  assert.ok(
    spinner.x - sweepRadius <= innerLeft + MARBLE_RADIUS,
  );
  assert.ok(
    COURSE_BUMPERS.every((bumper) => bumper.y < finalGate.endY),
  );
  assert.ok(
    ROTATING_BARS.every(
      (bar) =>
        bar.placement === "finish-entrance" ||
        bar.y < finalGate.endY,
    ),
  );
  assert.ok(
    finishCorridor.startY - finalGate.endY >=
      MARBLE_DIAMETER * 8,
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
  const result = simulateRace(
    simulationSlots(5),
    "flash-test",
    "flash-layout",
  );
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

test("camera follows the next active contender until all winners arrive", () => {
  const frame = {
    poses: [],
    rankedSlotIds: ["slot-1", "slot-2", "slot-3"],
    finishedSlotIds: ["slot-1"],
    rotatingBarAngles: [],
    bumperFlashes: [],
  };
  assert.equal(resolveRaceFocusSlotId(frame, 2), "slot-2");
  assert.equal(resolveRaceFocusSlotId(frame, 1), "slot-1");
});

test("race dynamics contain only shared physical material variation", () => {
  const dynamics = createRaceDynamics("physical-only-test");
  assert.deepEqual(Object.keys(dynamics).sort(), [
    "bumperRestitution",
    "fingerprint",
    "gravityScale",
    "marbleRestitution",
    "obstacleRestitution",
    "pinRestitution",
    "rotatingBars",
    "spinnerRestitution",
  ]);
  assert.ok(dynamics.bumperRestitution > dynamics.spinnerRestitution);
  assert.ok(dynamics.spinnerRestitution > dynamics.obstacleRestitution);
});

test("physics substeps prevent tunneling without rewriting marble motion", () => {
  assert.equal(PHYSICS_SUBSTEPS, 2);
});

test("late-race gravity is shared and leaves the thirty-second race untouched", () => {
  assert.equal(sharedGravityMultiplier(0), 1);
  assert.equal(sharedGravityMultiplier(30), 1);
  assert.equal(sharedGravityMultiplier(40), 1);
  assert.ok(sharedGravityMultiplier(55) > 2);
  assert.ok(
    sharedGravityMultiplier(75) >
      sharedGravityMultiplier(55),
  );
  assert.equal(sharedGravityMultiplier(120), 6);
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
  assert.deepEqual(
    advanceVerticalCamera(
      reduced,
      500 + REDUCED_MOTION_CAMERA_SNAP_DISTANCE - 1,
      1_000,
      true,
    ),
    reduced,
  );
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
  assert.deepEqual(report.finalRunoutViolations, []);
  assert.ok(report.minimumClearance >= MIN_COURSE_CLEARANCE);
});

test("race plan maps entrants before the physical finish order is known", () => {
  const candidates = parseRoster("가\n나\n다\n라").candidates;
  const slotToCandidateId = createRaceSlotAssignment(
    candidates,
    "race-plan",
  );
  const simulation = simulateRace(
    slotToCandidateId,
    "race-plan",
    "layout-plan",
    2,
  );
  const plan = buildRacePlan(
    "테스트",
    candidates,
    simulation,
    {
      raceSeed: "race-plan",
      layoutSeed: "layout-plan",
    },
    2,
  );
  assert.equal(plan.rankedCandidateIds.length, 4);
  assert.equal(new Set(plan.rankedCandidateIds).size, 4);
  assert.deepEqual(plan.winnerIds, plan.rankedCandidateIds.slice(0, 2));
  assert.equal(plan.winnerCount, 2);
  const expectedStartOrder = shuffleSeeded(candidates, "race-plan:slots");
  expectedStartOrder.forEach((candidate, index) => {
    assert.equal(
      plan.slotToCandidateId[`slot-${index + 1}`],
      candidate.id,
    );
  });
  assert.deepEqual(
    plan.rankedCandidateIds,
    simulation.frames.at(-1)!.rankedSlotIds.map(
      (slotId) => plan.slotToCandidateId[slotId],
    ),
  );
});

test("race presentation continues until the configured winner count arrives", () => {
  const simulation = simulateRace(
    simulationSlots(8),
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

test("physical-only race can keep running until all ten entrants arrive", () => {
  const simulation = simulateRace(
    simulationSlots(10),
    "all-finish-10-0",
    "all-layout-10-0",
    10,
  );
  assert.equal(simulation.targetFinishCount, 10);
  assert.equal(simulation.timedOut, false);
  assert.equal(simulation.physicallyFinishedCount, 10);
  assert.equal(simulation.frames.at(-1)!.finishedSlotIds.length, 10);
});

test("result frames continue after the winner reveal and keep unfinished rows open", () => {
  const simulation = simulateRace(
    simulationSlots(6),
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
  let maximumBoundaryPenetration = 0;
  let worstBoundaryContact = "";

  for (const [participantCount, raceSeed, layoutSeed] of [
    [5, "duration-5-6", "layout-duration-6"],
    [2, "audit-2-9", "audit-layout-2-9"],
    [10, "audit-10-8", "audit-layout-10-8"],
  ] as const) {
    const simulation = simulateRace(
      simulationSlots(participantCount),
      raceSeed,
      layoutSeed,
    );
    for (const [frameIndex, frame] of simulation.frames.entries()) {
      const finished = new Set(frame.finishedSlotIds);
      for (const pose of frame.poses) {
        if (finished.has(pose.slotId)) continue;
        const bounds = courseBoundsAtY(pose.y);
        const innerMargin =
          COURSE_BOUNDARY_THICKNESS / 2 + MARBLE_RADIUS;
        const penetration = Math.max(
          0,
          bounds.leftX + innerMargin - pose.x,
          pose.x - (bounds.rightX - innerMargin),
        );
        if (penetration > maximumBoundaryPenetration) {
          maximumBoundaryPenetration = penetration;
          worstBoundaryContact =
            `${raceSeed}/${pose.slotId} at frame ${frameIndex} (${penetration.toFixed(2)}px)`;
        }
      }
    }
  }

  assert.ok(
    maximumBoundaryPenetration <= 6,
    `physical wall penetration exceeded 6px: ${worstBoundaryContact}`,
  );
});
