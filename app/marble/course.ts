export const WORLD_WIDTH = 900;
export const BASE_WORLD_HEIGHT = 9000;
export const COURSE_LENGTH_SCALE = 1.5;
export const WORLD_HEIGHT = BASE_WORLD_HEIGHT * COURSE_LENGTH_SCALE;
export const scaleCourseY = (value: number) =>
  value * COURSE_LENGTH_SCALE;
export const FINISH_Y = scaleCourseY(8860);
export const FINISH_LINE_X = 420;
export const FINISH_LINE_WIDTH = 60;
export const MARBLE_RADIUS = 15;
export const VIEW_HEIGHT = 1040;
export const TARGET_FIRST_FINISH_SECONDS = 30;
export const MAX_SIMULATION_SECONDS = 110;
export const COURSE_BOUNDARY_THICKNESS = 24;

export type BoundarySide = "left" | "right";

export type StraightZone = {
  id: string;
  startY: number;
  endY: number;
  leftX: number;
  rightX: number;
  requiresBilateralWallObstacles: boolean;
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

export type CourseBumper = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  zoneId: string;
  kind: "field" | "finish-launch";
  kickSpeed: number;
  attachment?: BoundarySide;
  connectedGroupIds?: string[];
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
  placement?: "finish-entrance";
  wallSide?: BoundarySide;
};

export type CourseSection = {
  id: string;
  label: string;
  pattern: "pins" | "bumpers" | "gates" | "final-mix";
  startY: number;
  endY: number;
};

const BOUNDARY_THICKNESS = COURSE_BOUNDARY_THICKNESS;
const LEFT_BOUNDARY_GROUP = "left-course-boundary";
const RIGHT_BOUNDARY_GROUP = "right-course-boundary";

const BASE_STRAIGHT_ZONES: StraightZone[] = [
  {
    id: "start-deck",
    startY: 0,
    endY: 1050,
    leftX: 63,
    rightX: 837,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "right-chute",
    startY: 1200,
    endY: 1900,
    leftX: 355,
    rightX: 865,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "left-chute",
    startY: 2200,
    endY: 2900,
    leftX: 27,
    rightX: 513,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "central-release",
    startY: 3250,
    endY: 4100,
    leftX: 109,
    rightX: 811,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "right-squeeze",
    startY: 4450,
    endY: 5150,
    leftX: 477,
    rightX: 843,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "left-drift",
    startY: 5500,
    endY: 6300,
    leftX: 23,
    rightX: 557,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "wide-mix",
    startY: 6650,
    endY: 7350,
    leftX: 87,
    rightX: 813,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "left-sprint",
    startY: 7500,
    endY: 8000,
    leftX: 43,
    rightX: 457,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "final-gate",
    startY: 8150,
    endY: 8650,
    leftX: 231,
    rightX: 669,
    requiresBilateralWallObstacles: true,
  },
  {
    id: "finish-corridor",
    startY: 8820,
    endY: BASE_WORLD_HEIGHT,
    leftX: 408,
    rightX: 492,
    requiresBilateralWallObstacles: false,
  },
];

export const STRAIGHT_ZONES: StraightZone[] = BASE_STRAIGHT_ZONES.map(
  (zone) => ({
    ...zone,
    startY: scaleCourseY(zone.startY),
    endY: scaleCourseY(zone.endY),
  }),
);

export const COURSE_SECTIONS: CourseSection[] = [
  {
    id: "pin-drop",
    label: "PIN DROP",
    pattern: "pins",
    startY: 0,
    endY: WORLD_HEIGHT * 0.25,
  },
  {
    id: "bumper-run",
    label: "BUMPER RUN",
    pattern: "bumpers",
    startY: WORLD_HEIGHT * 0.25,
    endY: WORLD_HEIGHT * 0.5,
  },
  {
    id: "squeeze-gates",
    label: "SQUEEZE GATES",
    pattern: "gates",
    startY: WORLD_HEIGHT * 0.5,
    endY: WORLD_HEIGHT * 0.75,
  },
  {
    id: "final-mix",
    label: "FINAL MIX",
    pattern: "final-mix",
    startY: WORLD_HEIGHT * 0.75,
    endY: WORLD_HEIGHT,
  },
];

export function courseBoundsAtY(y: number): {
  leftX: number;
  rightX: number;
} {
  const first = STRAIGHT_ZONES[0];
  if (y <= first.endY) {
    return { leftX: first.leftX, rightX: first.rightX };
  }

  for (let index = 1; index < STRAIGHT_ZONES.length; index += 1) {
    const previous = STRAIGHT_ZONES[index - 1];
    const current = STRAIGHT_ZONES[index];
    if (y < current.startY) {
      const progress = Math.max(
        0,
        Math.min(
          1,
          (y - previous.endY) / (current.startY - previous.endY),
        ),
      );
      const horizontalEase = (1 - Math.cos(Math.PI * progress)) / 2;
      return {
        leftX:
          previous.leftX +
          (current.leftX - previous.leftX) * horizontalEase,
        rightX:
          previous.rightX +
          (current.rightX - previous.rightX) * horizontalEase,
      };
    }
    if (y <= current.endY) {
      return { leftX: current.leftX, rightX: current.rightX };
    }
  }

  const last = STRAIGHT_ZONES.at(-1)!;
  return { leftX: last.leftX, rightX: last.rightX };
}

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
    y: scaleCourseY(y),
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
    y: scaleCourseY(y),
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
  // Start deck: block both wall-hugging launch lines before the first spinner.
  wallBumper("start-deck", "left", 760, 160, 0.22),
  wallBumper("start-deck", "right", 980, 160, 0.22),

  // Right chute: both walls feed down and inward, then a low centre shelf splits.
  wallBumper("right-chute", "left", 1340, 180, 0.24),
  wallBumper("right-chute", "right", 1610, 190, 0.24),
  shelf("right-chute", 555, 1810, 150, 0.1),

  // Left chute: reverse the sequence so the flow does not repeat.
  wallBumper("left-chute", "right", 2340, 190, 0.24),
  wallBumper("left-chute", "left", 2630, 200, 0.22),
  shelf("left-chute", 360, 2820, 150, -0.12),

  // Central release: the spinner cannot leave either boundary as a clean lane.
  wallBumper("central-release", "left", 3340, 160, 0.22),
  wallBumper("central-release", "right", 4030, 160, 0.22),

  // A narrow right-biased straight alternates the attached side.
  wallBumper("right-squeeze", "left", 4590, 150, 0.22),
  wallBumper("right-squeeze", "right", 4860, 150, 0.22),

  // Long left drift adds a final internal deflection after two wall feeds.
  wallBumper("left-drift", "left", 5680, 210, 0.24),
  wallBumper("left-drift", "right", 5990, 190, 0.24),
  shelf("left-drift", 360, 6200, 160, 0.12),

  // Wide mix: close both side lanes before the offset pin rows.
  wallBumper("wide-mix", "left", 6700, 160, 0.22),
  wallBumper("wide-mix", "right", 6820, 160, 0.22),

  // The left sprint uses shorter, faster alternating wall deflectors.
  wallBumper("left-sprint", "left", 7650, 170, 0.25),
  wallBumper("left-sprint", "right", 7900, 180, 0.25),

  // Final gate: force both wall lines into the rotating entrance obstacle.
  wallBumper("final-gate", "left", 8200, 120, 0.2),
  wallBumper("final-gate", "right", 8600, 120, 0.2),
];

const BOTTOM_CAP: CourseRect = {
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT - 10,
  width: 84,
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

const BASE_COURSE_PINS: CoursePin[] = [
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

export const COURSE_PINS: CoursePin[] = BASE_COURSE_PINS.map((pin) => ({
  ...pin,
  y: scaleCourseY(pin.y),
}));

const BASE_COURSE_BUMPERS: CourseBumper[] = [
  // 25% Bumper Run: replace the opening pin language with active rebounds.
  {
    x: 270,
    y: 2450,
    width: 105,
    height: 30,
    angle: 0.2,
    zoneId: "left-chute",
    kind: "field",
    kickSpeed: 4.2,
  },
  {
    x: 380,
    y: 3650,
    width: 105,
    height: 30,
    angle: -0.2,
    zoneId: "central-release",
    kind: "field",
    kickSpeed: 4,
  },
  {
    x: 540,
    y: 3705,
    width: 105,
    height: 30,
    angle: 0.2,
    zoneId: "central-release",
    kind: "field",
    kickSpeed: 4,
  },

  // 50% Squeeze Gates: fewer, larger bumpers sit between attached rails.
  {
    x: 650,
    y: 4740,
    width: 105,
    height: 30,
    angle: -0.18,
    zoneId: "right-squeeze",
    kind: "field",
    kickSpeed: 4.2,
  },
  {
    x: 300,
    y: 5750,
    width: 110,
    height: 30,
    angle: 0.2,
    zoneId: "left-drift",
    kind: "field",
    kickSpeed: 4,
  },

  // 75% Final Mix: one last active rebound follows the dense pin field.
  {
    x: 250,
    y: 7750,
    width: 105,
    height: 30,
    angle: -0.2,
    zoneId: "left-sprint",
    kind: "field",
    kickSpeed: 4.2,
  },

  // The final pair is embedded in both narrowing walls. Any contact kicks
  // the marble back upward before it can enter the 60px finish corridor.
  {
    x: 375,
    y: 8760,
    width: 90,
    height: 30,
    angle: 0,
    zoneId: "finish-corridor",
    kind: "finish-launch",
    kickSpeed: 7.2,
    attachment: "left",
    connectedGroupIds: [LEFT_BOUNDARY_GROUP],
  },
  {
    x: 525,
    y: 8760,
    width: 90,
    height: 30,
    angle: 0,
    zoneId: "finish-corridor",
    kind: "finish-launch",
    kickSpeed: 7.2,
    attachment: "right",
    connectedGroupIds: [RIGHT_BOUNDARY_GROUP],
  },
];

export const COURSE_BUMPERS: CourseBumper[] = BASE_COURSE_BUMPERS.map(
  (bumper) => ({
    ...bumper,
    y: scaleCourseY(bumper.y),
  }),
);

const BASE_ROTATING_BARS: RotatingBar[] = [
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
    x: 350,
    y: 8609,
    width: 120,
    height: 22,
    baseAngle: 0.12,
    angularSpeed: -0.02,
    zoneId: "final-gate",
    placement: "finish-entrance",
    wallSide: "left",
  },
];

export const ROTATING_BARS: RotatingBar[] = BASE_ROTATING_BARS.map(
  (bar) => ({
    ...bar,
    y: scaleCourseY(bar.y),
  }),
);

export function rotatingBarAngle(bar: RotatingBar, step: number) {
  return bar.baseAngle + step * bar.angularSpeed;
}

export function rotatingBarTurnsTowardWall(bar: RotatingBar): boolean {
  if (!bar.wallSide) return false;
  // At the upstream contact point, clockwise motion feeds left and
  // counter-clockwise motion feeds right.
  return bar.wallSide === "left"
    ? bar.angularSpeed < 0
    : bar.angularSpeed > 0;
}
