export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 9000;
export const FINISH_Y = 8860;
export const FINISH_LINE_X = 402;
export const FINISH_LINE_WIDTH = 96;
export const MARBLE_RADIUS = 15;
export const VIEW_HEIGHT = 1040;
export const TARGET_FIRST_FINISH_SECONDS = 20;
export const MAX_SIMULATION_SECONDS = 68;

export type BoundarySide = "left" | "right";

export type StraightZone = {
  id: string;
  startY: number;
  endY: number;
  leftX: number;
  rightX: number;
};

export type CourseRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  role?: "wall" | "rail" | "gate";
  groupId?: string;
  connectedGroupIds?: string[];
  zoneId?: string;
  obstacleKind?: "wall-bumper" | "shelf";
  attachment?: BoundarySide;
};

export type CoursePin = {
  x: number;
  y: number;
  radius: number;
  zoneId: string;
};

export type CourseCurve = {
  id: string;
  points: { x: number; y: number }[];
  thickness: number;
  role: "boundary";
  boundarySide: BoundarySide;
};

export type RotatingBar = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseAngle: number;
  angularSpeed: number;
  zoneId: string;
};

const BOUNDARY_THICKNESS = 24;
const LEFT_BOUNDARY_GROUP = "left-course-boundary";
const RIGHT_BOUNDARY_GROUP = "right-course-boundary";

export const STRAIGHT_ZONES: StraightZone[] = [
  { id: "start-deck", startY: 0, endY: 1050, leftX: 80, rightX: 820 },
  {
    id: "right-chute",
    startY: 1200,
    endY: 1900,
    leftX: 300,
    rightX: 820,
  },
  {
    id: "left-chute",
    startY: 2200,
    endY: 2900,
    leftX: 80,
    rightX: 580,
  },
  {
    id: "central-release",
    startY: 3250,
    endY: 4100,
    leftX: 120,
    rightX: 800,
  },
  {
    id: "right-squeeze",
    startY: 4450,
    endY: 5150,
    leftX: 420,
    rightX: 820,
  },
  {
    id: "left-drift",
    startY: 5500,
    endY: 6300,
    leftX: 80,
    rightX: 620,
  },
  {
    id: "wide-mix",
    startY: 6650,
    endY: 7350,
    leftX: 100,
    rightX: 800,
  },
  {
    id: "left-sprint",
    startY: 7500,
    endY: 8000,
    leftX: 80,
    rightX: 520,
  },
  {
    id: "final-gate",
    startY: 8150,
    endY: 8650,
    leftX: 220,
    rightX: 680,
  },
  {
    id: "finish-corridor",
    startY: 8820,
    endY: WORLD_HEIGHT,
    leftX: 390,
    rightX: 510,
  },
];

function boundaryGroup(side: BoundarySide): string {
  return side === "left" ? LEFT_BOUNDARY_GROUP : RIGHT_BOUNDARY_GROUP;
}

function boundaryX(zone: StraightZone, side: BoundarySide): number {
  return side === "left" ? zone.leftX : zone.rightX;
}

function createBoundaryTransition(
  from: StraightZone,
  to: StraightZone,
  side: BoundarySide,
  segmentCount = 12,
): CourseCurve {
  const startX = boundaryX(from, side);
  const endX = boundaryX(to, side);
  const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const progress = index / segmentCount;
    const horizontalEase = (1 - Math.cos(Math.PI * progress)) / 2;
    return {
      x: startX + (endX - startX) * horizontalEase,
      y: from.endY + (to.startY - from.endY) * progress,
    };
  });
  return {
    id: `${side}-transition-${from.id}-to-${to.id}`,
    points,
    thickness: BOUNDARY_THICKNESS,
    role: "boundary",
    boundarySide: side,
  };
}

function curveSegments(curve: CourseCurve): CourseRect[] {
  return curve.points.slice(1).map((point, index) => {
    const previous = curve.points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return {
      x: (previous.x + point.x) / 2,
      y: (previous.y + point.y) / 2,
      width: Math.hypot(dx, dy) + 2,
      height: curve.thickness,
      angle: Math.atan2(dy, dx),
      role: "wall",
      groupId: boundaryGroup(curve.boundarySide),
    };
  });
}

function straightBoundary(
  zone: StraightZone,
  side: BoundarySide,
): CourseRect {
  return {
    x: boundaryX(zone, side),
    y: (zone.startY + zone.endY) / 2,
    width: BOUNDARY_THICKNESS,
    height: zone.endY - zone.startY + 4,
    role: "wall",
    groupId: boundaryGroup(side),
    zoneId: zone.id,
  };
}

function zoneById(zoneId: string): StraightZone {
  const zone = STRAIGHT_ZONES.find((candidate) => candidate.id === zoneId);
  if (!zone) throw new Error(`Unknown straight zone: ${zoneId}`);
  return zone;
}

function wallBumper(
  zoneId: string,
  side: BoundarySide,
  y: number,
  width: number,
  angleMagnitude: number,
): CourseRect {
  const zone = zoneById(zoneId);
  const direction = side === "left" ? 1 : -1;
  const angle = angleMagnitude * direction;
  return {
    x:
      boundaryX(zone, side) +
      direction * (width / 2) * Math.cos(angleMagnitude),
    y,
    width,
    height: 24,
    angle,
    role: "rail",
    connectedGroupIds: [boundaryGroup(side)],
    zoneId,
    obstacleKind: "wall-bumper",
    attachment: side,
  };
}

function shelf(
  zoneId: string,
  x: number,
  y: number,
  width: number,
  angle: number,
): CourseRect {
  return {
    x,
    y,
    width,
    height: 22,
    angle,
    role: "rail",
    zoneId,
    obstacleKind: "shelf",
  };
}

export const COURSE_CURVES: CourseCurve[] = STRAIGHT_ZONES.slice(1).flatMap(
  (zone, index) => {
    const previous = STRAIGHT_ZONES[index];
    return [
      createBoundaryTransition(previous, zone, "left"),
      createBoundaryTransition(previous, zone, "right"),
    ];
  },
);

const COURSE_BOUNDARY_RECTS: CourseRect[] = STRAIGHT_ZONES.flatMap((zone) => [
  straightBoundary(zone, "left"),
  straightBoundary(zone, "right"),
]);

const COURSE_OBSTACLE_RECTS: CourseRect[] = [
  // Right chute: both walls feed down and inward, then a low centre shelf splits.
  wallBumper("right-chute", "left", 1340, 180, 0.24),
  wallBumper("right-chute", "right", 1610, 190, 0.24),
  shelf("right-chute", 555, 1810, 150, 0.1),

  // Left chute: reverse the sequence so the flow does not repeat.
  wallBumper("left-chute", "right", 2340, 190, 0.24),
  wallBumper("left-chute", "left", 2630, 200, 0.22),
  shelf("left-chute", 360, 2820, 150, -0.12),

  // A narrow right-biased straight alternates the attached side.
  wallBumper("right-squeeze", "left", 4590, 150, 0.22),
  wallBumper("right-squeeze", "right", 4860, 150, 0.22),

  // Long left drift adds a final internal deflection after two wall feeds.
  wallBumper("left-drift", "left", 5680, 210, 0.24),
  wallBumper("left-drift", "right", 5990, 190, 0.24),
  shelf("left-drift", 360, 6200, 160, 0.12),

  // The left sprint uses shorter, faster alternating wall deflectors.
  wallBumper("left-sprint", "left", 7650, 170, 0.25),
  wallBumper("left-sprint", "right", 7900, 180, 0.25),
];

const BOTTOM_CAP: CourseRect = {
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT - 10,
  width: 120,
  height: 20,
  role: "wall",
  connectedGroupIds: [LEFT_BOUNDARY_GROUP, RIGHT_BOUNDARY_GROUP],
};

export const COURSE_RECTS: CourseRect[] = [
  ...COURSE_BOUNDARY_RECTS,
  ...COURSE_OBSTACLE_RECTS,
  BOTTOM_CAP,
];

export const COURSE_CURVE_RECTS: CourseRect[] =
  COURSE_CURVES.flatMap(curveSegments);

export const COURSE_PINS: CoursePin[] = [
  // Start canopy: dense but fully separated staggered rows.
  ...[155, 300, 455, 610, 753].map((x) => ({
    x,
    y: 320,
    radius: 18,
    zoneId: "start-deck",
  })),
  ...[225, 380, 535, 690].map((x) => ({
    x,
    y: 500,
    radius: 18,
    zoneId: "start-deck",
  })),
  ...[147, 285, 440, 595, 750].map((x) => ({
    x,
    y: 650,
    radius: 18,
    zoneId: "start-deck",
  })),

  // One offset island per biased chute.
  { x: 650, y: 1450, radius: 24, zoneId: "right-chute" },
  { x: 260, y: 2450, radius: 28, zoneId: "left-chute" },

  // Central release: deliberately uneven island sizes.
  { x: 225, y: 3820, radius: 35, zoneId: "central-release" },
  { x: 490, y: 3890, radius: 28, zoneId: "central-release" },
  { x: 713, y: 3780, radius: 38, zoneId: "central-release" },

  { x: 620, y: 5050, radius: 30, zoneId: "right-squeeze" },
  { x: 300, y: 5860, radius: 27, zoneId: "left-drift" },

  // Wide mix: two offset pin rows recombine marbles after the spinner.
  ...[180, 345, 520, 710].map((x, index) => ({
    x,
    y: 7040,
    radius: [19, 24, 18, 22][index],
    zoneId: "wide-mix",
  })),
  ...[265, 455, 645].map((x, index) => ({
    x,
    y: 7240,
    radius: [22, 18, 24][index],
    zoneId: "wide-mix",
  })),
];

export const ROTATING_BARS: RotatingBar[] = [
  {
    x: 450,
    y: 820,
    width: 380,
    height: 24,
    baseAngle: -0.08,
    angularSpeed: 0.014,
    zoneId: "start-deck",
  },
  {
    x: 460,
    y: 3500,
    width: 340,
    height: 24,
    baseAngle: 0.1,
    angularSpeed: -0.012,
    zoneId: "central-release",
  },
  {
    x: 450,
    y: 6850,
    width: 360,
    height: 22,
    baseAngle: -0.12,
    angularSpeed: 0.016,
    zoneId: "wide-mix",
  },
  {
    x: 450,
    y: 8400,
    width: 420,
    height: 24,
    baseAngle: 0.04,
    angularSpeed: -0.018,
    zoneId: "final-gate",
  },
];

export function rotatingBarAngle(bar: RotatingBar, step: number) {
  return bar.baseAngle + step * bar.angularSpeed;
}
