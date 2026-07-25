export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 9000;
export const FINISH_Y = 8700;
export const MARBLE_RADIUS = 15;
export const VIEW_HEIGHT = 1040;
export const TARGET_FIRST_FINISH_SECONDS = 20;
export const MAX_SIMULATION_SECONDS = 68;

export type CourseRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  role?: "wall" | "rail" | "gate";
  groupId?: string;
};

export type CoursePin = {
  x: number;
  y: number;
  radius: number;
};

export type CourseCurve = {
  id: string;
  points: { x: number; y: number }[];
  thickness: number;
  role: "cycloid" | "funnel";
};

export type RotatingBar = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseAngle: number;
  angularSpeed: number;
};

function createCycloidCurve(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  thickness = 24,
  segmentCount = 14,
  role: CourseCurve["role"] = "cycloid",
): CourseCurve {
  const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const progress = index / segmentCount;
    const theta = Math.PI * progress;
    const horizontalProgress = (theta - Math.sin(theta)) / Math.PI;
    const verticalProgress = (1 - Math.cos(theta)) / 2;
    return {
      x: start.x + (end.x - start.x) * horizontalProgress,
      y: start.y + (end.y - start.y) * verticalProgress,
    };
  });
  return { id, points, thickness, role };
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
      role: "rail",
      groupId: curve.id,
    };
  });
}

export const COURSE_RECTS: CourseRect[] = [
  {
    x: 45,
    y: WORLD_HEIGHT / 2,
    width: 70,
    height: WORLD_HEIGHT,
    role: "wall",
  },
  {
    x: WORLD_WIDTH - 45,
    y: WORLD_HEIGHT / 2,
    width: 70,
    height: WORLD_HEIGHT,
    role: "wall",
  },

  // 1. Right-biased opening.
  { x: 290, y: 1180, width: 340, height: 24, angle: 0.21, role: "rail" },
  { x: 665, y: 1510, width: 220, height: 24, angle: -0.25, role: "rail" },
  { x: 390, y: 1780, width: 250, height: 22, angle: 0.14, role: "rail" },

  // 2. Left return with an open centre escape.
  { x: 590, y: 2210, width: 360, height: 24, angle: -0.19, role: "rail" },
  { x: 250, y: 2550, width: 260, height: 24, angle: 0.25, role: "rail" },
  { x: 505, y: 2770, width: 210, height: 22, angle: -0.12, role: "rail" },

  // 4. Cross-current deck.
  { x: 345, y: 4050, width: 455, height: 24, angle: 0.18, role: "rail" },
  { x: 675, y: 4390, width: 205, height: 22, angle: -0.27, role: "rail" },
  { x: 530, y: 4610, width: 230, height: 22, angle: -0.1, role: "rail" },

  // 5. Offset island passage.
  { x: 565, y: 5100, width: 430, height: 24, angle: -0.17, role: "rail" },
  { x: 240, y: 5480, width: 230, height: 22, angle: 0.26, role: "rail" },
  { x: 420, y: 5700, width: 280, height: 22, angle: 0.12, role: "rail" },

  // 8. Asymmetric final descent.
  { x: 660, y: 7630, width: 240, height: 22, angle: -0.23, role: "rail" },
  { x: 295, y: 7930, width: 350, height: 23, angle: 0.18, role: "rail" },
  { x: 610, y: 8240, width: 310, height: 23, angle: -0.16, role: "rail" },
  { x: 248, y: 8500, width: 260, height: 22, angle: 0.11, role: "rail" },

  {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT - 20,
    width: WORLD_WIDTH,
    height: 40,
    role: "wall",
  },
];

export const COURSE_CURVES: CourseCurve[] = [
  // A leftward half-cycloid and a rightward half-cycloid replace straight slaloms.
  createCycloidCurve(
    "left-cycloid",
    { x: 705, y: 3020 },
    { x: 225, y: 3400 },
  ),
  createCycloidCurve(
    "right-cycloid",
    { x: 195, y: 5820 },
    { x: 700, y: 6240 },
  ),

  // A symmetric breathing section: narrow, release, then return to full width.
  createCycloidCurve(
    "funnel-in-left",
    { x: 136, y: 6500 },
    { x: 330, y: 6810 },
    24,
    10,
    "funnel",
  ),
  createCycloidCurve(
    "funnel-in-right",
    { x: 764, y: 6500 },
    { x: 570, y: 6810 },
    24,
    10,
    "funnel",
  ),
  createCycloidCurve(
    "funnel-out-left",
    { x: 330, y: 6930 },
    { x: 136, y: 7260 },
    24,
    10,
    "funnel",
  ),
  createCycloidCurve(
    "funnel-out-right",
    { x: 570, y: 6930 },
    { x: 764, y: 7260 },
    24,
    10,
    "funnel",
  ),
];

export const COURSE_CURVE_RECTS: CourseRect[] =
  COURSE_CURVES.flatMap(curveSegments);

export const COURSE_PINS: CoursePin[] = [
  // Opening canopy.
  ...[145, 300, 475, 650, 760].map((x) => ({ x, y: 360, radius: 19 })),
  ...[220, 390, 565, 720].map((x) => ({ x, y: 535, radius: 19 })),
  ...[135, 285, 455, 620, 755].map((x) => ({ x, y: 675, radius: 19 })),

  // Large offset islands. No row is mirrored around the centre.
  { x: 190, y: 1450, radius: 39 },
  { x: 505, y: 1610, radius: 31 },
  { x: 735, y: 1920, radius: 43 },

  { x: 175, y: 2330, radius: 33 },
  { x: 470, y: 2460, radius: 44 },
  { x: 735, y: 2720, radius: 30 },

  { x: 265, y: 3560, radius: 41 },
  { x: 510, y: 3500, radius: 30 },
  { x: 740, y: 3830, radius: 38 },

  { x: 155, y: 4520, radius: 31 },
  { x: 455, y: 4850, radius: 45 },
  { x: 750, y: 4720, radius: 34 },

  { x: 235, y: 5250, radius: 38 },
  { x: 520, y: 5450, radius: 32 },
  { x: 740, y: 5680, radius: 42 },

  { x: 185, y: 7350, radius: 37 },
  { x: 310, y: 7480, radius: 43 },
  { x: 750, y: 7830, radius: 30 },

  { x: 155, y: 8130, radius: 31 },
  { x: 455, y: 8370, radius: 38 },
  { x: 745, y: 8460, radius: 34 },
];

export const ROTATING_BARS: RotatingBar[] = [
  {
    x: 480,
    y: 930,
    width: 380,
    height: 24,
    baseAngle: -0.08,
    angularSpeed: 0.014,
  },
  {
    x: 355,
    y: 3820,
    width: 340,
    height: 24,
    baseAngle: 0.1,
    angularSpeed: -0.012,
  },
  {
    x: 575,
    y: 7440,
    width: 300,
    height: 22,
    baseAngle: -0.12,
    angularSpeed: 0.016,
  },
];

export function rotatingBarAngle(bar: RotatingBar, step: number) {
  return bar.baseAngle + step * bar.angularSpeed;
}
