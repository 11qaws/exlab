import {
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  MARBLE_RADIUS,
  ROTATING_BARS,
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
};

type RectShape = {
  id: string;
  kind: "rect";
  points: Point[];
  isBoundary: boolean;
  groupId?: string;
};

type CourseShape = CircleShape | RectShape;

export type CourseClearanceViolation = {
  firstId: string;
  secondId: string;
  clearance: number;
  requiredClearance: number;
};

export type CourseClearanceReport = {
  minimumClearance: number;
  requiredClearance: number;
  checkedPairCount: number;
  violations: CourseClearanceViolation[];
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
  }));
  const pins: CircleShape[] = COURSE_PINS.map((pin, index) => ({
    id: `pin-${index + 1}`,
    kind: "circle",
    x: pin.x,
    y: pin.y,
    radius: pin.radius,
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
  return [...rectangles, ...pins, ...rotatingPivots];
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
      if (
        first.groupId !== undefined &&
        first.groupId === second.groupId
      ) {
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
    violations: violations.sort((left, right) => left.clearance - right.clearance),
  };
}

export function assertCourseClearance(): void {
  const report = inspectCourseClearance();
  if (report.violations.length === 0) return;

  const details = report.violations
    .slice(0, 8)
    .map(
      ({ firstId, secondId, clearance }) =>
        `${firstId} ↔ ${secondId}: ${clearance.toFixed(1)}px`,
    )
    .join(", ");
  throw new Error(
    `코스 최소 통과 폭 ${MIN_COURSE_CLEARANCE}px 위반 ${report.violations.length}건: ${details}`,
  );
}
