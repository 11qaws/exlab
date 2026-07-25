import assert from "node:assert/strict";
import test from "node:test";
import {
  COURSE_CURVES,
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_LINE_WIDTH,
  FINISH_Y,
  MARBLE_RADIUS,
  ROTATING_BARS,
  STRAIGHT_ZONES,
  TARGET_FIRST_FINISH_SECONDS,
  WORLD_HEIGHT,
  rotatingBarAngle,
} from "../app/marble/course";
import {
  inspectCourseClearance,
  MARBLE_DIAMETER,
  MIN_COURSE_CLEARANCE,
  ROTATING_BAR_CLEARANCE_MODEL,
  ROTATING_BAR_CLEARANCE_RADIUS,
} from "../app/marble/course-clearance";
import {
  buildRacePlan,
  parseRoster,
  shuffleSeeded,
} from "../app/marble/core";
import { simulateRace } from "../app/marble/simulation";

test("roster accepts two through ten participants", () => {
  assert.equal(parseRoster("가\n나").isValid, true);
  assert.equal(
    parseRoster(
      Array.from({ length: 10 }, (_, index) => `참가자${index + 1}`).join("\n"),
    ).isValid,
    true,
  );
});

test("roster preserves overflow names and blocks eleven participants", () => {
  const validation = parseRoster(
    Array.from({ length: 11 }, (_, index) => `참가자${index + 1}`).join("\n"),
  );
  assert.equal(validation.isValid, false);
  assert.equal(validation.candidates.length, 10);
  assert.deepEqual(validation.overflowNames, ["참가자11"]);
});

test("duplicate names remain separate candidates", () => {
  const validation = parseRoster("레또\n레또");
  assert.equal(validation.isValid, true);
  assert.notEqual(validation.candidates[0].id, validation.candidates[1].id);
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
  assert.ok(first.frames.length > 30);
  assert.ok(first.winnerFrameIndex >= 0);
});

test("the asymmetric course targets a roughly twenty-second first finish", () => {
  assert.ok(WORLD_HEIGHT >= 8_000);
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
  const centres = STRAIGHT_ZONES.map(
    (zone) => (zone.leftX + zone.rightX) / 2,
  );
  assert.ok(Math.max(...centres) >= 600);
  assert.ok(Math.min(...centres) <= 300);

  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  );
  assert.ok(finishCorridor);
  const finishApproachWidth =
    finishCorridor.rightX - finishCorridor.leftX - 24;
  assert.equal(finishApproachWidth, FINISH_LINE_WIDTH);
  assert.ok(finishApproachWidth > MIN_COURSE_CLEARANCE);
  const finishSpinner = ROTATING_BARS.at(-1)!;
  assert.ok(finishSpinner.y > 8_000 && finishSpinner.y < FINISH_Y);
  assert.ok(finishSpinner.width >= FINISH_LINE_WIDTH * 4);

  for (const participantCount of [5, 10]) {
    const firstFinishSeconds = Array.from({ length: 12 }, (_, index) => {
      const simulation = simulateRace(
        participantCount,
        `duration-${participantCount}-${index}`,
        `layout-duration-${index}`,
      );
      assert.ok(simulation.physicallyFinishedCount > 0);
      return simulation.winnerFrameIndex / 30;
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

test("rotating bars keep turning through complete revolutions", () => {
  for (const bar of ROTATING_BARS) {
    const rotation =
      rotatingBarAngle(bar, 600) - rotatingBarAngle(bar, 0);
    assert.ok(Math.abs(rotation) > Math.PI * 2);
  }
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
  assert.ok(report.minimumClearance >= MIN_COURSE_CLEARANCE);
});

test("preselected mode maps the locked result onto physical finish slots", () => {
  const candidates = parseRoster("가\n나\n다\n라").candidates;
  const simulation = simulateRace(4, "race-plan", "layout-plan");
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
  );
  assert.equal(plan.rankedCandidateIds.length, 4);
  assert.equal(new Set(plan.rankedCandidateIds).size, 4);
  assert.equal(plan.winnerId, plan.rankedCandidateIds[0]);
});
