export type RaceMapMode = "light" | "dark";

export type RaceObstacleColorKey =
  | "hot-pink"
  | "lemon"
  | "mint"
  | "sky"
  | "lavender"
  | "periwinkle";

export type RaceObstacleColor = {
  key: RaceObstacleColorKey;
  label: string;
  value: string;
};

export type RaceObstacleRole =
  | "bumper"
  | "pin"
  | "guide"
  | "elastic-wall"
  | "spinner";

export type RaceMapTheme = {
  mode: RaceMapMode;
  background: string;
  track: string;
  trackEdge: string;
  wall: string;
  rail: string;
  text: string;
  mutedText: string;
  grid: string;
  finish: string;
  finishAlternate: string;
  outline: string;
  label: string;
  labelText: string;
  hud: string;
  hudBorder: string;
  shadow: string;
  highlight: string;
};

export const DEFAULT_RACE_MAP_MODE: RaceMapMode = "light";

/**
 * The shared five-streamer palette in the canonical profile order.
 * Map themes may change the course surfaces, but obstacles always use these
 * canonical colors so their identity remains stable between light and dark.
 */
export const RACE_OBSTACLE_PALETTE = [
  { key: "hot-pink", label: "핫핑크", value: "#ffb6c1" },
  { key: "lemon", label: "레몬", value: "#ffd166" },
  { key: "mint", label: "민트", value: "#34e0a8" },
  { key: "sky", label: "스카이", value: "#4ea9f0" },
  { key: "lavender", label: "라벤더", value: "#7e57c2" },
] as const satisfies readonly RaceObstacleColor[];

export const RACE_PIN_COLOR = {
  key: "periwinkle",
  label: "보랏빛 파랑",
  value: "#6667d9",
} as const satisfies RaceObstacleColor;

export const RACE_MAP_THEMES = {
  light: {
    mode: "light",
    background: "#fcf5f5",
    track: "#fffafc",
    trackEdge: "#ffd7de",
    wall: "#4e342e",
    rail: "#8d6e63",
    text: "#4e342e",
    mutedText: "#6d5650",
    grid: "rgba(78, 52, 46, 0.10)",
    finish: "#4e342e",
    finishAlternate: "#fffafc",
    outline: "#4e342e",
    label: "#4e342e",
    labelText: "#ffffff",
    hud: "rgba(255, 250, 252, 0.94)",
    hudBorder: "rgba(78, 52, 46, 0.24)",
    shadow: "rgba(78, 52, 46, 0.24)",
    highlight: "#fff0b8",
  },
  dark: {
    mode: "dark",
    background: "#160d14",
    track: "#25151d",
    trackEdge: "#4e2c38",
    wall: "#f8e9e3",
    rail: "#c89eaa",
    text: "#fff8ef",
    mutedText: "#d5bdc1",
    grid: "rgba(255, 248, 239, 0.10)",
    finish: "#fff8ef",
    finishAlternate: "#2d1721",
    outline: "#fff8ef",
    label: "#fff8ef",
    labelText: "#2d1721",
    hud: "rgba(31, 17, 24, 0.94)",
    hudBorder: "rgba(255, 248, 239, 0.28)",
    shadow: "rgba(0, 0, 0, 0.48)",
    highlight: "#ffd166",
  },
} as const satisfies Record<RaceMapMode, RaceMapTheme>;

export function raceMapTheme(
  mode: RaceMapMode,
  wallColor?: string,
): RaceMapTheme {
  const theme = RACE_MAP_THEMES[mode];
  if (!wallColor || wallColor === theme.wall) return theme;
  return { ...theme, wall: wallColor };
}

export function obstaclePaletteEntry(index: number): RaceObstacleColor {
  const normalizedIndex =
    ((Math.trunc(index) % RACE_OBSTACLE_PALETTE.length) +
      RACE_OBSTACLE_PALETTE.length) %
    RACE_OBSTACLE_PALETTE.length;
  return RACE_OBSTACLE_PALETTE[normalizedIndex];
}

export function obstacleColor(index: number): string {
  return obstaclePaletteEntry(index).value;
}

export const RACE_OBSTACLE_ROLE_COLORS: Record<
  RaceObstacleRole,
  RaceObstacleColor
> = {
  bumper: RACE_OBSTACLE_PALETTE[0],
  pin: RACE_PIN_COLOR,
  guide: RACE_OBSTACLE_PALETTE[2],
  "elastic-wall": RACE_OBSTACLE_PALETTE[3],
  spinner: RACE_OBSTACLE_PALETTE[4],
};

export function obstacleRoleColor(role: RaceObstacleRole): string {
  return RACE_OBSTACLE_ROLE_COLORS[role].value;
}
