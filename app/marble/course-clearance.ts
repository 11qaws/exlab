import {
  COURSE_BUMPERS,
  COURSE_BOUNDARY_THICKNESS,
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_LINE_WIDTH,
  MARBLE_RADIUS,
  ROTATING_BARS,
  STRAIGHT_ZONES,
  courseBoundsAtY,
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
export const FINAL_RISK_LANE_MAX_SHARE = 0.6;
export const FINAL_BYPASS_MIN_CLEARANCE = MARBLE_DIAMETER * 3;

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

export type CourseFinalRunoutViolation = {
  reason: string;
};

export type CourseClearanceReport = {
  minimumClearance: number;
  requiredClearance: number;
  checkedPairCount: number;
  violations: CourseClearanceViolation[];
  wallCoverageViolations: CourseWallCoverageViolation[];
  finalEntranceSpinnerViolations: CourseFinalEntranceSpinnerViolation[];
  finalRunoutViolations: CourseFinalRunoutViolation[];
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
  const bumpers: RectShape[] = COURSE_BUMPERS.map((bumper, index) => ({
    id: `active-bumper-${index + 1}`,
    kind: "rect",
    points: rectPoints({
      x: bumper.x,
      y: bumper.y,
      width: bumper.width,
      height: bumper.height,
      angle: bumper.angle,
    }),
    isBoundary: false,
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
  const innerLeft =
    finalGate.leftX + COURSE_BOUNDARY_THICKNESS / 2;
  const innerRight =
    finalGate.rightX - COURSE_BOUNDARY_THICKNESS / 2;
  const innerWidth = innerRight - innerLeft;
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
    const bypassClearance =
      bar.wallSide === "left"
        ? innerRight - (bar.x + sweepRadius + MARBLE_RADIUS)
        : bar.x - sweepRadius - MARBLE_RADIUS - innerLeft;
    if (bypassClearance < FINAL_BYPASS_MIN_CLEARANCE) {
      reasons.push(
        `spinner bypass is ${bypassClearance.toFixed(1)}px, below ${FINAL_BYPASS_MIN_CLEARANCE}px`,
      );
    }
    const riskLaneWidth =
      bar.wallSide === "left"
        ? bar.x + sweepRadius - innerLeft
        : innerRight - (bar.x - sweepRadius);
    if (riskLaneWidth / innerWidth > FINAL_RISK_LANE_MAX_SHARE) {
      reasons.push("spinner sweeps too much of the final gate");
    }
    const reachesWallLane =
      bar.wallSide === "left"
        ? bar.x - sweepRadius <= innerLeft + MARBLE_RADIUS
        : bar.x + sweepRadius >= innerRight - MARBLE_RADIUS;
    if (!reachesWallLane) {
      reasons.push("spinner does not intercept its wall-side risk lane");
    }
    return reasons.map((reason) => ({ barIndex: index, reason }));
  });
}

function inspectFinalRunout(): CourseFinalRunoutViolation[] {
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  );
  const finishCorridor = STRAIGHT_ZONES.find(
    (zone) => zone.id === "finish-corridor",
  );
  if (!finalGate || !finishCorridor) {
    return [{ reason: "missing final approach zones" }];
  }

  const violations: CourseFinalRunoutViolation[] = [];
  const riskBumpers = COURSE_BUMPERS.filter(
    (bumper) => bumper.placement === "final-risk",
  );
  if (riskBumpers.length !== 1) {
    violations.push({
      reason: `expected one final risk bumper, found ${riskBumpers.length}`,
    });
  } else {
    const bumper = riskBumpers[0];
    const innerRight =
      finalGate.rightX - COURSE_BOUNDARY_THICKNESS / 2;
    const halfHorizontalSpan =
      (Math.abs(Math.cos(bumper.angle)) * bumper.width +
        Math.abs(Math.sin(bumper.angle)) * bumper.height) /
      2;
    const rightEdge = bumper.x + halfHorizontalSpan;
    const bypass =
      innerRight - (rightEdge + MARBLE_RADIUS);
    if (
      bumper.zoneId !== finalGate.id ||
      bumper.y >= finalGate.endY
    ) {
      violations.push({
        reason: "final risk bumper is outside final-gate",
      });
    }
    if (bypass < FINAL_BYPASS_MIN_CLEARANCE) {
      violations.push({
        reason: `final risk bumper bypass is ${bypass.toFixed(1)}px`,
      });
    }
    const spinner = ROTATING_BARS.find(
      (bar) => bar.placement === "finish-entrance",
    );
    if (spinner && bumper.y >= spinner.y) {
      violations.push({
        reason: "final risk bumper must precede the rotating risk lane",
      });
    }
  }
  const lateBumpers = COURSE_BUMPERS.filter(
    (bumper) => bumper.y > finalGate.endY,
  );
  const lateSpinners = ROTATING_BARS.filter(
    (bar) => bar.y > finalGate.endY,
  );
  const lateObstacles = COURSE_RECTS.filter(
    (rect) =>
      rect.obstacleKind !== undefined && rect.y > finalGate.endY,
  );
  if (lateBumpers.length > 0 || lateSpinners.length > 0) {
    violations.push({
      reason: "active obstacles must not enter the final runout",
    });
  }
  if (lateObstacles.length > 0) {
    violations.push({
      reason: "fixed obstacles must not enter the final runout",
    });
  }

  const funnelLength = finishCorridor.startY - finalGate.endY;
  if (funnelLength < MARBLE_DIAMETER * 8) {
    violations.push({
      reason: `final funnel is only ${funnelLength.toFixed(1)}px long`,
    });
  }

  let previousWidth =
    courseBoundsAtY(finalGate.endY).rightX -
    courseBoundsAtY(finalGate.endY).leftX;
  for (let index = 1; index <= 24; index += 1) {
    const y =
      finalGate.endY +
      (funnelLength * index) / 24;
    const bounds = courseBoundsAtY(y);
    const width = bounds.rightX - bounds.leftX;
    if (width > previousWidth + 0.01) {
      violations.push({
        reason: "final funnel widens after it begins narrowing",
      });
      break;
    }
    previousWidth = width;
  }

  const finishWidth =
    finishCorridor.rightX -
    finishCorridor.leftX -
    COURSE_BOUNDARY_THICKNESS;
  if (finishWidth !== FINISH_LINE_WIDTH) {
    violations.push({
      reason: "finish corridor and line widths do not match",
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
    finalRunoutViolations: inspectFinalRunout(),
  };
}

export function assertCourseClearance(): void {
  const report = inspectCourseClearance();
  if (
    report.violations.length === 0 &&
    report.wallCoverageViolations.length === 0 &&
    report.finalEntranceSpinnerViolations.length === 0 &&
    report.finalRunoutViolations.length === 0
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
  if (report.finalRunoutViolations.length > 0) {
    const details = report.finalRunoutViolations
      .map(({ reason }) => reason)
      .join(", ");
    messages.push(
      `결승 자유 주행 구간 규칙 위반 ${report.finalRunoutViolations.length}건 (${details})`,
    );
  }
  throw new Error(`코스 검사 실패: ${messages.join("; ")}`);
}
