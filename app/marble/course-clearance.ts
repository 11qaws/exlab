import {
  COURSE_BUMPERS,
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  MARBLE_RADIUS,
  ROTATING_BARS,
  STRAIGHT_ZONES,
  rotatingBarTurnsTowardWall,
  type BoundarySide,
  type CourseRect,
} from "./course";

export const MARBLE_DIAMETER = MARBLE_RADIUS * 2;
export const COURSE_CLEARANCE_MARGIN = 6;
export const MIN_COURSE_CLEARANCE =
  MARBLE_DIAMETER + COURSE_CLEARANCE_MARGIN;
export const ROTATING_BAR_CLEARANCE_MODEL = "pivot-marble" as const;
export const ROTATING_BAR_CLEARANCE_RADIUS = MARBLE_RADIUS;

type Point = { x: number; y: number };

type CircleShape = {
  id: string;
  kind: "circle";
  x: number;
  y: number;
  radius: number;
  isBoundary: false;
  groupId?: string;
  connectedGroupIds?: string[];
};

type RectShape = {
  id: string;
  kind: "rect";
  points: Point[];
  isBoundary: boolean;
  groupId?: string;
  connectedGroupIds?: string[];
};

type CourseShape = CircleShape | RectShape;

export type CourseClearanceViolation = {
  firstId: string;
  secondId: string;
  clearance: number;
  requiredClearance: number;
};

export type CourseWallCoverageViolation = {
  zoneId: string;
  missingSides: BoundarySide[];
};

export type CourseFinalEntranceSpinnerViolation = {
  barIndex: number | null;
  reason: string;
};

export type CourseFinalLaunchBumperViolation = {
  side: BoundarySide | null;
  reason: string;
};

export type CourseClearanceReport = {
  minimumClearance: number;
  requiredClearance: number;
  checkedPairCount: number;
  violations: CourseClearanceViolation[];
  wallCoverageViolations: CourseWallCoverageViolation[];
  finalEntranceSpinnerViolations: CourseFinalEntranceSpinnerViolation[];
  finalLaunchBumperViolations: CourseFinalLaunchBumperViolation[];
};

function rectPoints(rect: CourseRect): Point[] {
  const angle = rect.angle ?? 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;

  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map(({ x, y }) => ({
    x: rect.x + x * cosine - y * sine,
    y: rect.y + x * sine + y * cosine,
  }));
}

function pointToSegmentDistance(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function orientation(first: Point, second: Point, third: Point): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function segmentsIntersect(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean {
  const a = orientation(firstStart, firstEnd, secondStart);
  const b = orientation(firstStart, firstEnd, secondEnd);
  const c = orientation(secondStart, secondEnd, firstStart);
  const d = orientation(secondStart, secondEnd, firstEnd);
  const epsilon = 1e-8;

  return (
    ((a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon)) &&
    ((c > epsilon && d < -epsilon) || (c < -epsilon && d > epsilon))
  );
}

function pointInsidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonDistance(first: Point[], second: Point[]): number {
  if (
    pointInsidePolygon(first[0], second) ||
    pointInsidePolygon(second[0], first)
  ) {
    return 0;
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex];
    const firstEnd = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondStart = second[secondIndex];
      const secondEnd = second[(secondIndex + 1) % second.length];
      if (
        segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
      ) {
        return 0;
      }
      minimum = Math.min(
        minimum,
        pointToSegmentDistance(firstStart, secondStart, secondEnd),
        pointToSegmentDistance(firstEnd, secondStart, secondEnd),
        pointToSegmentDistance(secondStart, firstStart, firstEnd),
        pointToSegmentDistance(secondEnd, firstStart, firstEnd),
      );
    }
  }
  return minimum;
}

function circleToRectDistance(
  circle: CircleShape,
  rectangle: RectShape,
): number {
  const centre = { x: circle.x, y: circle.y };
  if (pointInsidePolygon(centre, rectangle.points)) return 0;

  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rectangle.points.length; index += 1) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistance(
        centre,
        rectangle.points[index],
        rectangle.points[(index + 1) % rectangle.points.length],
      ),
    );
  }
  return Math.max(0, minimum - circle.radius);
}

function shapeDistance(first: CourseShape, second: CourseShape): number {
  if (first.kind === "circle" && second.kind === "circle") {
    return Math.max(
      0,
      Math.hypot(first.x - second.x, first.y - second.y) -
        first.radius -
        second.radius,
    );
  }
  if (first.kind === "circle" && second.kind === "rect") {
    return circleToRectDistance(first, second);
  }
  if (first.kind === "rect" && second.kind === "circle") {
    return circleToRectDistance(second, first);
  }
  if (first.kind === "rect" && second.kind === "rect") {
    return polygonDistance(first.points, second.points);
  }
  return Number.POSITIVE_INFINITY;
}

function shapesAreConnected(
  first: CourseShape,
  second: CourseShape,
): boolean {
  if (
    first.groupId !== undefined &&
    first.groupId === second.groupId
  ) {
    return true;
  }
  if (
    first.groupId !== undefined &&
    second.connectedGroupIds?.includes(first.groupId)
  ) {
    return true;
  }
  return (
    second.groupId !== undefined &&
    first.connectedGroupIds?.includes(second.groupId) === true
  );
}

function courseShapes(): CourseShape[] {
  const rectangles: RectShape[] = [
    ...COURSE_RECTS,
    ...COURSE_CURVE_RECTS,
  ].map((rect, index) => ({
    id: `${rect.role ?? "rect"}-${index + 1}`,
    kind: "rect",
    points: rectPoints(rect),
    isBoundary: rect.role === "wall",
    groupId:
      rect.groupId ?? (rect.role === "wall" ? "world-boundary" : undefined),
    connectedGroupIds: rect.connectedGroupIds,
  }));
  const pins: CircleShape[] = COURSE_PINS.map((pin, index) => ({
    id: `pin-${index + 1}`,
    kind: "circle",
    x: pin.x,
    y: pin.y,
    radius: pin.radius,
    isBoundary: false,
  }));
  const bumpers: CircleShape[] = COURSE_BUMPERS.map((bumper, index) => ({
    id: `active-bumper-${index + 1}`,
    kind: "circle",
    x: bumper.x,
    y: bumper.y,
    radius: bumper.radius,
    isBoundary: false,
    connectedGroupIds: bumper.connectedGroupIds,
  }));
  const rotatingPivots: CircleShape[] = ROTATING_BARS.map((bar, index) => ({
    id: `rotating-pivot-${index + 1}`,
    kind: "circle",
    x: bar.x,
    y: bar.y,
    radius: ROTATING_BAR_CLEARANCE_RADIUS,
    isBoundary: false,
  }));
  return [...rectangles, ...pins, ...bumpers, ...rotatingPivots];
}

function inspectWallCoverage(): CourseWallCoverageViolation[] {
  const wallBumpers = COURSE_RECTS.filter(
    (rect) => rect.obstacleKind === "wall-bumper",
  );
  const sides: BoundarySide[] = ["left", "right"];

  return STRAIGHT_ZONES.filter(
    (zone) => zone.requiresBilateralWallObstacles,
  ).flatMap((zone) => {
    const missingSides = sides.filter(
      (side) =>
        !wallBumpers.some(
          (rect) =>
            rect.zoneId === zone.id && rect.attachment === side,
        ),
    );
    return missingSides.length > 0
      ? [{ zoneId: zone.id, missingSides }]
      : [];
  });
}

function inspectFinalEntranceSpinner(): CourseFinalEntranceSpinnerViolation[] {
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  );
  const entranceSpinners = ROTATING_BARS.flatMap((bar, index) =>
    bar.placement === "finish-entrance" ? [{ bar, index }] : [],
  );
  if (!finalGate || entranceSpinners.length === 0) {
    return [{ barIndex: null, reason: "missing finish-entrance spinner" }];
  }

  const centreX = (finalGate.leftX + finalGate.rightX) / 2;
  return entranceSpinners.flatMap(({ bar, index }) => {
    const reasons: string[] = [];
    const sweepRadius = Math.hypot(bar.width / 2, bar.height / 2);
    if (bar.zoneId !== finalGate.id) {
      reasons.push("spinner is outside final-gate");
    }
    if (bar.y + sweepRadius < finalGate.endY - COURSE_CLEARANCE_MARGIN) {
      reasons.push("spinner does not reach the final entrance");
    }
    if (
      (bar.wallSide === "left" && bar.x >= centreX) ||
      (bar.wallSide === "right" && bar.x <= centreX) ||
      !bar.wallSide
    ) {
      reasons.push("spinner is not beside its declared wall");
    }
    if (!rotatingBarTurnsTowardWall(bar)) {
      reasons.push("spinner does not rotate toward its wall");
    }
    return reasons.map((reason) => ({ barIndex: index, reason }));
  });
}

function inspectFinalLaunchBumpers(): CourseFinalLaunchBumperViolation[] {
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  );
  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  );
  if (!finalGate || !finishCorridor) {
    return [{ side: null, reason: "missing final approach zones" }];
  }

  const launchBumpers = COURSE_BUMPERS.filter(
    (bumper) => bumper.kind === "finish-launch",
  );
  const violations: CourseFinalLaunchBumperViolation[] = [];
  for (const side of ["left", "right"] as const) {
    const matches = launchBumpers.filter(
      (bumper) => bumper.attachment === side,
    );
    if (matches.length !== 1) {
      violations.push({
        side,
        reason: `expected one ${side} launch bumper, found ${matches.length}`,
      });
      continue;
    }
    const bumper = matches[0];
    if (
      bumper.y <= finalGate.endY ||
      bumper.y >= finishCorridor.startY
    ) {
      violations.push({
        side,
        reason: "launch bumper is outside the narrowing entrance",
      });
    }
    if (bumper.kickSpeed < 6) {
      violations.push({
        side,
        reason: "launch bumper kick is too weak",
      });
    }
  }

  if (launchBumpers.length !== 2) {
    violations.push({
      side: null,
      reason: `expected two finish launch bumpers, found ${launchBumpers.length}`,
    });
  }
  return violations;
}

export function inspectCourseClearance(): CourseClearanceReport {
  const shapes = courseShapes();
  const violations: CourseClearanceViolation[] = [];
  let minimumClearance = Number.POSITIVE_INFINITY;
  let checkedPairCount = 0;

  for (let firstIndex = 0; firstIndex < shapes.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < shapes.length;
      secondIndex += 1
    ) {
      const first = shapes[firstIndex];
      const second = shapes[secondIndex];
      if (shapesAreConnected(first, second)) {
        continue;
      }

      const clearance = shapeDistance(first, second);
      checkedPairCount += 1;
      minimumClearance = Math.min(minimumClearance, clearance);
      if (clearance + 1e-6 < MIN_COURSE_CLEARANCE) {
        violations.push({
          firstId: first.id,
          secondId: second.id,
          clearance,
          requiredClearance: MIN_COURSE_CLEARANCE,
        });
      }
    }
  }

  return {
    minimumClearance,
    requiredClearance: MIN_COURSE_CLEARANCE,
    checkedPairCount,
    violations: violations.sort(
      (left, right) => left.clearance - right.clearance,
    ),
    wallCoverageViolations: inspectWallCoverage(),
    finalEntranceSpinnerViolations: inspectFinalEntranceSpinner(),
    finalLaunchBumperViolations: inspectFinalLaunchBumpers(),
  };
}

export function assertCourseClearance(): void {
  const report = inspectCourseClearance();
  if (
    report.violations.length === 0 &&
    report.wallCoverageViolations.length === 0 &&
    report.finalEntranceSpinnerViolations.length === 0 &&
    report.finalLaunchBumperViolations.length === 0
  ) {
    return;
  }

  const clearanceDetails = report.violations
    .slice(0, 8)
    .map(
      ({ firstId, secondId, clearance }) =>
        `${firstId} ↔ ${secondId}: ${clearance.toFixed(1)}px`,
    )
    .join(", ");
  const wallCoverageDetails = report.wallCoverageViolations
    .map(
      ({ zoneId, missingSides }) =>
        `${zoneId}: ${missingSides.join("+")}`,
    )
    .join(", ");
  const messages: string[] = [];
  if (report.violations.length > 0) {
    messages.push(
      `최소 통과 폭 ${MIN_COURSE_CLEARANCE}px 위반 ${report.violations.length}건 (${clearanceDetails})`,
    );
  }
  if (report.wallCoverageViolations.length > 0) {
    messages.push(
      `직선 구간 양측 벽 장애물 누락 ${report.wallCoverageViolations.length}건 (${wallCoverageDetails})`,
    );
  }
  if (report.finalEntranceSpinnerViolations.length > 0) {
    const details = report.finalEntranceSpinnerViolations
      .map(({ barIndex, reason }) => `${barIndex ?? "none"}: ${reason}`)
      .join(", ");
    messages.push(
      `결승 입구 회전 막대 규칙 위반 ${report.finalEntranceSpinnerViolations.length}건 (${details})`,
    );
  }
  if (report.finalLaunchBumperViolations.length > 0) {
    const details = report.finalLaunchBumperViolations
      .map(({ side, reason }) => `${side ?? "none"}: ${reason}`)
      .join(", ");
    messages.push(
      `결승 진입 범퍼 규칙 위반 ${report.finalLaunchBumperViolations.length}건 (${details})`,
    );
  }
  throw new Error(`코스 검사 실패: ${messages.join("; ")}`);
}
