import assert from "node:assert/strict";
import test from "node:test";
import Matter from "matter-js";
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
  START_ALIGNMENT_PIN_XS,
  STRAIGHT_ZONES,
  TARGET_FIRST_FINISH_SECONDS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  courseBoundsAtY,
  rotatingBarAngle,
  rotatingBarTurnsTowardWall,
} from "../app/games/showdown/course";
import {
  advanceVerticalCamera,
  INITIAL_LEADER_FOCUS_STATE,
  INITIAL_VERTICAL_CAMERA_STATE,
  LEADER_FOCUS_DELAY_FRAMES,
  LEADER_FOCUS_DELAY_SECONDS,
  REDUCED_MOTION_CAMERA_SNAP_DISTANCE,
  resolveLeaderFocus,
} from "../app/games/showdown/camera";
import {
  inspectCourseClearance,
  FINAL_BYPASS_MIN_CLEARANCE,
  FINAL_RISK_LANE_MAX_SHARE,
  MARBLE_DIAMETER,
  MIN_COURSE_CLEARANCE,
  ROTATING_BAR_CLEARANCE_MODEL,
  ROTATING_BAR_CLEARANCE_RADIUS,
} from "../app/games/showdown/course-clearance";
import {
  assignParticipantThemes,
  buildRacePlan,
  contrastRatio,
  createRaceSlotAssignment,
  minimumGroupCount,
  parseRoster,
  PARTICIPANT_THEMES,
  resolveFixedParticipantTheme,
  shuffleSeeded,
  splitCandidatesIntoGroups,
} from "../app/games/showdown/core";
import {
  COUNTDOWN_SEQUENCE,
  countdownStepDuration,
  nextCountdownStep,
} from "../app/games/showdown/countdown";
import { createRaceDynamics } from "../app/games/showdown/dynamics";
import {
  CHASE_ASSIST_FULL_GAP,
  CHASE_ASSIST_CLOSING_SPEED_LIMIT,
  CHASE_ASSIST_LAST_PLACE_MAX_BONUS,
  CHASE_ASSIST_SECOND_PLACE_MAX_BONUS,
  CHASE_ASSIST_START_GAP,
  CHASE_ASSIST_TARGET_GAP,
  MARBLE_START_Y,
  PHYSICS_SUBSTEPS,
  START_PIN_ALIGNMENT_CLEARANCE,
  START_MIN_CENTER_GAP,
  chaseAssistGravityBonus,
  createMarbleStartLayout,
  restoreStaticCollisionMaterial,
  sharedGravityMultiplier,
  simulateRace,
  simulateRacePreview,
} from "../app/games/showdown/simulation";
import {
  OFFSCREEN_PODIUM_MAX_SCALE,
  OFFSCREEN_PODIUM_MIN_SCALE,
  resolveFinishFlagLayout,
  resolveOffscreenPodiumIndicators,
  resolveRaceFocusSlotId,
  resolveRaceFrame,
} from "../app/games/showdown/RaceCanvas";

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

test("canonical streamer marbles keep their own palette main by name", () => {
  const aliasGroups = [
    [["아모레또", "레또"], "rose"],
    [["유레카", "레카"], "mint"],
    [["세나", "세나아르벨", "세나 아르벨"], "violet"],
    [["코코", "토로리코코", "토로리 코코", "토로리"], "sky"],
    [["망징", "망징이"], "blue"],
  ] as const;

  for (const [aliases, expectedKey] of aliasGroups) {
    for (const alias of aliases) {
      assert.equal(resolveFixedParticipantTheme(alias)?.key, expectedKey);
      assert.equal(
        resolveFixedParticipantTheme(`  ${alias.normalize("NFKD")}  `)?.key,
        expectedKey,
      );
    }
  }
});

test("group palette deals are deterministic and reserve five streamer colours", () => {
  const validation = parseRoster(
    [
      "아모레또",
      "유레카",
      "세나 아르벨",
      "토로리 코코",
      "망징이",
      "참가자 1",
      "참가자 2",
      "참가자 3",
      "참가자 4",
      "참가자 5",
    ].join("\n"),
  );
  const first = assignParticipantThemes(validation.candidates, "palette-a");
  const replay = assignParticipantThemes(validation.candidates, "palette-a");
  const alternate = assignParticipantThemes(
    validation.candidates,
    "palette-b",
  );

  assert.deepEqual(first, replay);
  assert.deepEqual(
    first.slice(0, 5).map(({ theme }) => theme.key),
    ["rose", "mint", "violet", "sky", "blue"],
  );
  assert.equal(
    new Set(first.map(({ theme }) => theme.key)).size,
    10,
    "a full group should not reuse a participant colour",
  );
  assert.notDeepEqual(
    first.slice(5).map(({ theme }) => theme.key),
    alternate.slice(5).map(({ theme }) => theme.key),
  );
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

test("layout seed creates a centered, irregular, non-overlapping start row", () => {
  const first = createMarbleStartLayout(10, "start-layout-a");
  const replay = createMarbleStartLayout(10, "start-layout-a");
  const different = createMarbleStartLayout(10, "start-layout-b");
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.positions, different.positions);
  assert.ok(
    first.positions.every((position) => position.y === MARBLE_START_Y),
  );
  const averageX =
    first.positions.reduce((sum, position) => sum + position.x, 0) /
    first.positions.length;
  assert.ok(
    Math.abs(
      averageX - (WORLD_WIDTH / 2 + first.layoutShift),
    ) <
      0.000_001,
  );
  const startBounds = courseBoundsAtY(MARBLE_START_Y);
  first.positions.forEach((position, index) => {
    assert.ok(position.x - MARBLE_RADIUS >= startBounds.leftX);
    assert.ok(position.x + MARBLE_RADIUS <= startBounds.rightX);
    if (index === 0) return;
    assert.ok(
      position.x - first.positions[index - 1].x >=
        START_MIN_CENTER_GAP,
    );
  });
});

test("seeded start layouts avoid every opening alignment hazard", () => {
  assert.ok(
    START_ALIGNMENT_PIN_XS.includes(650),
    "the lone pin between the opening guide rails must be covered",
  );

  for (let count = 2; count <= 10; count += 1) {
    for (let seedIndex = 0; seedIndex < 300; seedIndex += 1) {
      const layout = createMarbleStartLayout(
        count,
        `pin-alignment-${count}-${seedIndex}`,
      );
      for (const position of layout.positions) {
        const closestPinDistance = Math.min(
          ...START_ALIGNMENT_PIN_XS.map((pinX) =>
            Math.abs(position.x - pinX),
          ),
        );
        assert.ok(
          closestPinDistance >= START_PIN_ALIGNMENT_CLEARANCE,
          `${count}명 시드 ${seedIndex}의 x=${position.x}가 첫 핀 열과 ${closestPinDistance}px만 떨어졌습니다.`,
        );
      }
    }
  }
});

test("distance and live rank bound the transparent chase acceleration", () => {
  assert.equal(
    chaseAssistGravityBonus(1, 10, CHASE_ASSIST_FULL_GAP * 2),
    0,
  );
  assert.equal(
    chaseAssistGravityBonus(2, 10, CHASE_ASSIST_START_GAP),
    0,
  );
  const secondAtTarget = chaseAssistGravityBonus(
    2,
    10,
    CHASE_ASSIST_TARGET_GAP,
  );
  const lastAtTarget = chaseAssistGravityBonus(
    10,
    10,
    CHASE_ASSIST_TARGET_GAP,
  );
  assert.ok(secondAtTarget > 0);
  assert.ok(lastAtTarget > secondAtTarget);
  assert.equal(
    chaseAssistGravityBonus(2, 10, CHASE_ASSIST_FULL_GAP),
    CHASE_ASSIST_SECOND_PLACE_MAX_BONUS,
  );
  assert.equal(
    chaseAssistGravityBonus(10, 10, CHASE_ASSIST_FULL_GAP),
    CHASE_ASSIST_LAST_PLACE_MAX_BONUS,
  );
  assert.equal(
    chaseAssistGravityBonus(
      10,
      10,
      CHASE_ASSIST_FULL_GAP,
      CHASE_ASSIST_CLOSING_SPEED_LIMIT,
    ),
    0,
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
  assert.equal(first.resultGateCount, 3);
  assert.ok(first.podiumFrameIndex >= first.awardFrameIndex);
  assert.ok(first.resultGateFrameIndex >= first.podiumFrameIndex);
});

test("ten-second race previews are deterministic partial simulations", () => {
  const slots = simulationSlots(5);
  const first = simulateRacePreview(
    slots,
    "preview-race-fixed",
    "preview-layout-fixed",
    10_000,
  );
  const replay = simulateRacePreview(
    slots,
    "preview-race-fixed",
    "preview-layout-fixed",
    10_000,
  );

  assert.equal(first.frames.length, 300);
  assert.equal(first.durationMs, 10_000);
  assert.deepEqual(first, replay);
  assert.equal(first.physicallyFinishedCount, 0);
  assert.equal(first.visibleFinishedCount, 0);
  assert.equal(first.awardFrameIndex, -1);
  assert.equal(first.podiumFrameIndex, -1);
  assert.equal(first.resultGateFrameIndex, -1);
  assert.equal(first.timedOut, true);

  const expectedSlotIds = Object.keys(slots).sort();
  for (const frame of first.frames) {
    assert.deepEqual(
      frame.poses.map(({ slotId }) => slotId).sort(),
      expectedSlotIds,
    );
  }
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

test("finish flag sits beside the exact checker line and stays on canvas", () => {
  const layout = resolveFinishFlagLayout(420, 60, 300, 1, 900);

  assert.equal(layout.connectorStartX, 480);
  assert.ok(layout.connectorEndX > layout.connectorStartX);
  assert.ok(layout.x >= layout.connectorEndX);
  assert.ok(layout.x + layout.width <= 892);
  assert.equal(layout.centerY, 307.5);
});

test("fractional race frames interpolate motion without revealing future results", () => {
  const frames = [
    {
      poses: [
        {
          slotId: "slot-1",
          x: 10,
          y: 20,
          angle: Math.PI - 0.1,
        },
      ],
      rankedSlotIds: ["slot-1", "slot-2"],
      finishedSlotIds: [],
      rotatingBarAngles: [Math.PI - 0.2],
      bumperFlashes: [{ level: 1, x: 10, y: 20 }],
    },
    {
      poses: [
        {
          slotId: "slot-1",
          x: 30,
          y: 60,
          angle: -Math.PI + 0.1,
        },
      ],
      rankedSlotIds: ["slot-2", "slot-1"],
      finishedSlotIds: ["slot-2"],
      rotatingBarAngles: [-Math.PI + 0.2],
      bumperFlashes: [{ level: 0.5, x: 14, y: 28 }],
    },
  ];

  const interpolated = resolveRaceFrame(frames, 0.5)!;
  assert.equal(interpolated.poses[0].x, 20);
  assert.equal(interpolated.poses[0].y, 40);
  assert.ok(Math.abs(Math.abs(interpolated.poses[0].angle) - Math.PI) < 1e-9);
  assert.ok(
    Math.abs(
      Math.abs(interpolated.rotatingBarAngles[0]) - Math.PI,
    ) < 1e-9,
  );
  assert.equal(interpolated.bumperFlashes[0].level, 0.75);
  assert.deepEqual(interpolated.rankedSlotIds, ["slot-1", "slot-2"]);
  assert.deepEqual(interpolated.finishedSlotIds, []);
});

test("fractional interpolation does not preflash a future bumper collision", () => {
  const frame = {
    poses: [],
    rankedSlotIds: ["slot-1"],
    finishedSlotIds: [],
    rotatingBarAngles: [],
    bumperFlashes: [{ level: 0, x: 0, y: 0 }],
  };
  const nextFrame = {
    ...frame,
    bumperFlashes: [{ level: 1, x: 20, y: 30 }],
  };

  assert.deepEqual(
    resolveRaceFrame([frame, nextFrame], 0.75)!.bumperFlashes[0],
    frame.bumperFlashes[0],
  );
});

test("fractional interpolation does not preflash a same-level bumper rehit", () => {
  const frame = {
    poses: [],
    rankedSlotIds: ["slot-1"],
    finishedSlotIds: [],
    rotatingBarAngles: [],
    bumperFlashes: [{ level: 1, x: 10, y: 20 }],
  };
  const nextFrame = {
    ...frame,
    bumperFlashes: [{ level: 1, x: 80, y: 90 }],
  };

  assert.deepEqual(
    resolveRaceFrame([frame, nextFrame], 0.75)!.bumperFlashes[0],
    frame.bumperFlashes[0],
  );
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

test("top-edge podium markers grow as offscreen challengers approach the leader view", () => {
  const frame = {
    poses: [
      { slotId: "slot-1", x: 480, y: 500, angle: 0 },
      { slotId: "slot-2", x: 320, y: -1000, angle: 0 },
      { slotId: "slot-3", x: 680, y: -30, angle: 0 },
    ],
    rankedSlotIds: ["slot-1", "slot-2", "slot-3"],
    finishedSlotIds: [],
    rotatingBarAngles: [],
    bumperFlashes: [],
  };

  const indicators = resolveOffscreenPodiumIndicators(
    frame,
    0,
    1000,
    false,
  );
  assert.deepEqual(
    indicators.map(({ slotId, rank }) => ({ slotId, rank })),
    [
      { slotId: "slot-2", rank: 2 },
      { slotId: "slot-3", rank: 3 },
    ],
  );
  assert.equal(indicators[0].emphasisScale, OFFSCREEN_PODIUM_MIN_SCALE);
  assert.ok(indicators[1].emphasisScale > indicators[0].emphasisScale);
  assert.ok(indicators[1].emphasisScale <= OFFSCREEN_PODIUM_MAX_SCALE);

  assert.deepEqual(
    resolveOffscreenPodiumIndicators(
      {
        ...frame,
        poses: frame.poses.map((pose) =>
          pose.slotId === "slot-3" ? { ...pose, y: 0 } : pose,
        ),
      },
      0,
      1000,
      false,
    ).map(({ slotId }) => slotId),
    ["slot-2"],
  );
  assert.ok(
    resolveOffscreenPodiumIndicators(frame, 0, 1000, true).every(
      ({ emphasisScale }) => emphasisScale === 1,
    ),
  );
  assert.deepEqual(
    resolveOffscreenPodiumIndicators(
      { ...frame, finishedSlotIds: ["slot-1"] },
      0,
      1000,
      false,
    ),
    [],
  );
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

test("static collision bodies retain authored friction and restitution", () => {
  const body = Matter.Bodies.rectangle(0, 0, 100, 20, {
    isStatic: true,
    friction: 0,
    frictionStatic: 0,
    restitution: 1.25,
  });
  assert.notEqual(body.friction, 0);
  assert.notEqual(body.restitution, 1.25);

  restoreStaticCollisionMaterial(body, {
    friction: 0,
    frictionStatic: 0,
    restitution: 1.25,
  });
  body.parts.forEach((part) => {
    assert.equal(part.friction, 0);
    assert.equal(part.frictionStatic, 0);
    assert.equal(part.restitution, 1.25);
  });
});

test("known preview seeds do not rest on fixed guide bars", () => {
  const simulation = simulateRace(
    simulationSlots(8),
    "fixed-bar-stall-7",
    "fixed-bar-stall-7-layout",
  );
  const fixedBars = COURSE_RECTS.filter((shape) => shape.obstacleKind);
  let longestSlowContact = 0;

  for (const bar of fixedBars) {
    const angle = bar.angle ?? 0;
    const cosine = Math.cos(-angle);
    const sine = Math.sin(-angle);
    for (const slotId of Object.keys(simulationSlots(8))) {
      let previous: { x: number; y: number } | null = null;
      let consecutiveSlowFrames = 0;
      for (const frame of simulation.frames) {
        const pose = frame.poses.find(
          (candidate) => candidate.slotId === slotId,
        )!;
        const dx = pose.x - bar.x;
        const dy = pose.y - bar.y;
        const localX = dx * cosine - dy * sine;
        const localY = dx * sine + dy * cosine;
        const outsideX = Math.max(
          Math.abs(localX) - bar.width / 2,
          0,
        );
        const outsideY = Math.max(
          Math.abs(localY) - bar.height / 2,
          0,
        );
        const touching =
          Math.hypot(outsideX, outsideY) <= MARBLE_RADIUS + 2;
        const displacement = previous
          ? Math.hypot(pose.x - previous.x, pose.y - previous.y)
          : Number.POSITIVE_INFINITY;
        consecutiveSlowFrames =
          touching && displacement < 0.5
            ? consecutiveSlowFrames + 1
            : 0;
        longestSlowContact = Math.max(
          longestSlowContact,
          consecutiveSlowFrames,
        );
        previous = pose;
      }
    }
  }

  assert.ok(
    longestSlowContact < 30,
    `a marble rested on a fixed guide for ${longestSlowContact / 30}s`,
  );
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
  const halfStep = advanceVerticalCamera(
    INITIAL_VERTICAL_CAMERA_STATE,
    500,
    1_000,
    false,
    0.5,
  );
  const secondHalfStep = advanceVerticalCamera(
    halfStep,
    500,
    1_000,
    false,
    0.5,
  );
  assert.ok(halfStep.positionY > 0 && halfStep.positionY < first.positionY);
  assert.ok(secondHalfStep.positionY > halfStep.positionY);
  assert.ok(Math.abs(secondHalfStep.positionY - first.positionY) < 3);

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

test("race presentation gate waits for at least third place and every winner", () => {
  const simulation = simulateRace(
    simulationSlots(8),
    "multi-winner-race",
    "multi-winner-layout",
    4,
  );
  assert.equal(simulation.targetFinishCount, 4);
  assert.equal(simulation.resultGateCount, 4);
  assert.ok(simulation.visibleFinishedCount >= 4);
  assert.ok(simulation.awardFrameIndex > simulation.firstFinishFrameIndex);
  assert.equal(
    simulation.resultGateFrameIndex,
    simulation.awardFrameIndex,
  );
  assert.ok(
    simulation.frames.at(-1)!.finishedSlotIds.length >=
      simulation.targetFinishCount,
  );
});

test("two-person races use the full field instead of waiting for third place", () => {
  const simulation = simulateRace(
    simulationSlots(2),
    "two-person-gate",
    "two-person-layout",
    1,
  );
  assert.equal(simulation.targetFinishCount, 1);
  assert.equal(simulation.resultGateCount, 2);
  assert.ok(simulation.podiumFrameIndex > simulation.awardFrameIndex);
  assert.equal(
    simulation.resultGateFrameIndex,
    simulation.podiumFrameIndex,
  );
});

test("race can keep running until all ten entrants arrive", () => {
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
