import type { CSSProperties } from "react";

/**
 * The five public product identities. Keep this list intentionally narrow:
 * product defaults and semantic game colours are not streamer themes.
 */
export const STREAMER_THEME_IDS = [
  "amoretto",
  "eureka",
  "sena",
  "torori",
  "mangjing",
] as const;

export type StreamerThemeId = (typeof STREAMER_THEME_IDS)[number];
export type StreamerThemeColorMode = "light" | "dark";
export type StreamerThemeTone = "solid" | "pale";

export interface StreamerThemeTokens {
  readonly accent: string;
  readonly accentOn: string;
  readonly accentInk: string;
  readonly accentBg: string;
  readonly accentLine: string;
  readonly background: string;
  readonly surface: string;
  readonly surfaceSubtle: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textSubtle: string;
  readonly textFaint: string;
  readonly railStart: string;
  readonly railEnd: string;
}

export interface StreamerThemePortrait {
  /** File relative to the app's public base. */
  readonly path: string;
  /** CSS object-position, validated against the 440×120 reference card. */
  readonly focus: string;
  /** Additional scale above cover, around the validated focus point. */
  readonly zoom: number;
  /** Always remains available when the image cannot be loaded. */
  readonly fallback: string;
}

export interface StreamerTheme {
  readonly id: StreamerThemeId;
  readonly name: string;
  readonly subtitle: string;
  readonly hue: number;
  readonly chroma: number;
  readonly tone: StreamerThemeTone;
  readonly portrait: StreamerThemePortrait;
  readonly light: StreamerThemeTokens;
  readonly dark: StreamerThemeTokens;
}

/**
 * Canonical values copied from the reference app's contrast-solved palette.
 * Do not align the themes by HSL lightness: their visible weight is aligned by
 * contrast, which differs substantially by hue.
 */
export const STREAMER_THEMES = [
  {
    id: "amoretto",
    name: "아모레또",
    subtitle: "교환학생 1기 ORIENT",
    hue: 344,
    chroma: 0.48,
    tone: "solid",
    portrait: {
      path: "themes/streamers/amoretto.jpg",
      focus: "53% 41%",
      zoom: 2.15,
      fallback: "아",
    },
    light: {
      accent: "hsl(344 42% 63%)",
      accentOn: "hsl(344 42% 19%)",
      accentInk: "hsl(344 42% 42%)",
      accentBg: "hsl(344 42% 94%)",
      accentLine: "hsl(344 42% 84%)",
      background: "hsl(344 22% 97%)",
      surface: "hsl(344 0% 100%)",
      surfaceSubtle: "hsl(344 20% 93%)",
      border: "hsl(344 18% 90%)",
      borderStrong: "hsl(344 20% 80%)",
      text: "hsl(344 30% 13%)",
      textMuted: "hsl(344 20% 32%)",
      textSubtle: "hsl(344 14% 48%)",
      textFaint: "hsl(344 12% 64%)",
      railStart: "hsl(344 42% 63%)",
      railEnd: "rgb(160 97 114)",
    },
    dark: {
      accent: "hsl(344 50% 74%)",
      accentOn: "hsl(344 50% 30%)",
      accentInk: "hsl(344 50% 73%)",
      accentBg: "hsl(344 42% 21%)",
      accentLine: "hsl(344 40% 35%)",
      background: "hsl(344 34% 9%)",
      surface: "hsl(344 30% 14%)",
      surfaceSubtle: "hsl(344 28% 20%)",
      border: "hsl(344 26% 24%)",
      borderStrong: "hsl(344 26% 34%)",
      text: "hsl(344 24% 93%)",
      textMuted: "hsl(344 18% 84%)",
      textSubtle: "hsl(344 14% 66%)",
      textFaint: "hsl(344 12% 46%)",
      railStart: "hsl(344 50% 74%)",
      railEnd: "rgb(177 124 139)",
    },
  },
  {
    id: "eureka",
    name: "유레카",
    subtitle: "교환학생 1기 ORIENT",
    hue: 152,
    chroma: 0.95,
    tone: "solid",
    portrait: {
      path: "themes/streamers/eureka.png",
      focus: "60% 82%",
      zoom: 1.15,
      fallback: "유",
    },
    light: {
      accent: "hsl(152 53% 56%)",
      accentOn: "hsl(152 53% 20%)",
      accentInk: "hsl(152 53% 27%)",
      accentBg: "hsl(152 53% 94%)",
      accentLine: "hsl(152 53% 84%)",
      background: "hsl(152 22% 97%)",
      surface: "hsl(152 0% 100%)",
      surfaceSubtle: "hsl(152 20% 93%)",
      border: "hsl(152 18% 90%)",
      borderStrong: "hsl(152 20% 80%)",
      text: "hsl(152 30% 13%)",
      textMuted: "hsl(152 20% 32%)",
      textSubtle: "hsl(152 14% 48%)",
      textFaint: "hsl(152 12% 64%)",
      railStart: "hsl(152 53% 56%)",
      railEnd: "rgb(67 162 117)",
    },
    dark: {
      accent: "hsl(152 61% 74%)",
      accentOn: "hsl(152 60% 25%)",
      accentInk: "hsl(152 52% 57%)",
      accentBg: "hsl(152 42% 21%)",
      accentLine: "hsl(152 40% 35%)",
      background: "hsl(152 34% 9%)",
      surface: "hsl(152 30% 14%)",
      surfaceSubtle: "hsl(152 28% 20%)",
      border: "hsl(152 26% 24%)",
      borderStrong: "hsl(152 26% 34%)",
      text: "hsl(152 24% 93%)",
      textMuted: "hsl(152 18% 84%)",
      textSubtle: "hsl(152 14% 66%)",
      textFaint: "hsl(152 12% 46%)",
      railStart: "hsl(152 61% 74%)",
      railEnd: "rgb(119 183 153)",
    },
  },
  {
    id: "sena",
    name: "세나 아르벨",
    subtitle: "교환학생 1기 ORIENT",
    hue: 277,
    chroma: 0.3,
    tone: "solid",
    portrait: {
      path: "themes/streamers/sena.jpg",
      focus: "22% 70%",
      zoom: 1.15,
      fallback: "세",
    },
    light: {
      accent: "hsl(277 38% 63%)",
      accentOn: "hsl(277 38% 19%)",
      accentInk: "hsl(277 38% 44%)",
      accentBg: "hsl(277 38% 94%)",
      accentLine: "hsl(277 38% 84%)",
      background: "hsl(277 22% 97%)",
      surface: "hsl(277 0% 100%)",
      surfaceSubtle: "hsl(277 20% 93%)",
      border: "hsl(277 18% 90%)",
      borderStrong: "hsl(277 20% 80%)",
      text: "hsl(277 30% 13%)",
      textMuted: "hsl(277 20% 32%)",
      textSubtle: "hsl(277 14% 48%)",
      textFaint: "hsl(277 12% 64%)",
      railStart: "hsl(277 38% 63%)",
      railEnd: "rgb(135 100 157)",
    },
    dark: {
      accent: "hsl(277 46% 74%)",
      accentOn: "hsl(277 46% 30%)",
      accentInk: "hsl(277 46% 73%)",
      accentBg: "hsl(277 42% 21%)",
      accentLine: "hsl(277 40% 35%)",
      background: "hsl(277 34% 9%)",
      surface: "hsl(277 30% 14%)",
      surfaceSubtle: "hsl(277 28% 20%)",
      border: "hsl(277 26% 24%)",
      borderStrong: "hsl(277 26% 34%)",
      text: "hsl(277 24% 93%)",
      textMuted: "hsl(277 18% 84%)",
      textSubtle: "hsl(277 14% 66%)",
      textFaint: "hsl(277 12% 46%)",
      railStart: "hsl(277 46% 74%)",
      railEnd: "rgb(157 127 175)",
    },
  },
  {
    id: "torori",
    name: "토로리 코코",
    subtitle: "교환학생 1기 ORIENT",
    hue: 211,
    chroma: 1.04,
    tone: "pale",
    portrait: {
      path: "themes/streamers/torori.webp",
      focus: "40% 61%",
      zoom: 1.8,
      fallback: "토",
    },
    light: {
      accent: "hsl(211 55% 84%)",
      accentOn: "hsl(211 55% 30%)",
      accentInk: "hsl(211 55% 38%)",
      accentBg: "hsl(211 55% 93%)",
      accentLine: "hsl(211 55% 84%)",
      background: "hsl(211 34% 97%)",
      surface: "hsl(211 0% 100%)",
      surfaceSubtle: "hsl(211 31% 93%)",
      border: "hsl(211 28% 90%)",
      borderStrong: "hsl(211 31% 80%)",
      text: "hsl(211 30% 13%)",
      textMuted: "hsl(211 20% 32%)",
      textSubtle: "hsl(211 14% 48%)",
      textFaint: "hsl(211 12% 64%)",
      railStart: "rgb(233 241 249)",
      railEnd: "hsl(211 55% 84%)",
    },
    dark: {
      accent: "hsl(211 63% 88%)",
      accentOn: "hsl(211 60% 30%)",
      accentInk: "hsl(211 52% 70%)",
      accentBg: "hsl(211 42% 21%)",
      accentLine: "hsl(211 40% 35%)",
      background: "hsl(211 53% 9%)",
      surface: "hsl(211 30% 14%)",
      surfaceSubtle: "hsl(211 43% 20%)",
      border: "hsl(211 40% 24%)",
      borderStrong: "hsl(211 40% 34%)",
      text: "hsl(211 24% 93%)",
      textMuted: "hsl(211 18% 84%)",
      textSubtle: "hsl(211 14% 66%)",
      textFaint: "hsl(211 12% 46%)",
      railStart: "rgb(234 242 250)",
      railEnd: "hsl(211 63% 88%)",
    },
  },
  {
    id: "mangjing",
    name: "망징이",
    subtitle: "교환학생 1기 ORIENT",
    hue: 226,
    chroma: 0.78,
    tone: "solid",
    portrait: {
      path: "themes/streamers/mangjing.jpg",
      focus: "54% 38%",
      zoom: 3.5,
      fallback: "망",
    },
    light: {
      accent: "hsl(226 49% 64%)",
      accentOn: "hsl(226 49% 19%)",
      accentInk: "hsl(226 49% 46%)",
      accentBg: "hsl(226 49% 94%)",
      accentLine: "hsl(226 49% 84%)",
      background: "hsl(226 22% 97%)",
      surface: "hsl(226 0% 100%)",
      surfaceSubtle: "hsl(226 20% 93%)",
      border: "hsl(226 18% 90%)",
      borderStrong: "hsl(226 20% 80%)",
      text: "hsl(226 30% 13%)",
      textMuted: "hsl(226 20% 32%)",
      textSubtle: "hsl(226 14% 48%)",
      textFaint: "hsl(226 12% 64%)",
      railStart: "hsl(226 49% 64%)",
      railEnd: "rgb(95 111 167)",
    },
    dark: {
      accent: "hsl(226 57% 74%)",
      accentOn: "hsl(226 57% 30%)",
      accentInk: "hsl(226 52% 73%)",
      accentBg: "hsl(226 42% 21%)",
      accentLine: "hsl(226 40% 35%)",
      background: "hsl(226 34% 9%)",
      surface: "hsl(226 30% 14%)",
      surfaceSubtle: "hsl(226 28% 20%)",
      border: "hsl(226 26% 24%)",
      borderStrong: "hsl(226 26% 34%)",
      text: "hsl(226 24% 93%)",
      textMuted: "hsl(226 18% 84%)",
      textSubtle: "hsl(226 14% 66%)",
      textFaint: "hsl(226 12% 46%)",
      railStart: "hsl(226 57% 74%)",
      railEnd: "rgb(121 135 181)",
    },
  },
] as const satisfies readonly StreamerTheme[];

export const DEFAULT_STREAMER_THEME_ID: StreamerThemeId = "amoretto";

export const STREAMER_THEME_BY_ID = Object.fromEntries(
  STREAMER_THEMES.map((theme) => [theme.id, theme]),
) as Readonly<Record<StreamerThemeId, StreamerTheme>>;

export function isStreamerThemeId(
  value: string | null | undefined,
): value is StreamerThemeId {
  return (
    value !== null &&
    value !== undefined &&
    (STREAMER_THEME_IDS as readonly string[]).includes(value)
  );
}

export function getStreamerTheme(
  value: string | null | undefined,
): StreamerTheme {
  return isStreamerThemeId(value)
    ? STREAMER_THEME_BY_ID[value]
    : STREAMER_THEME_BY_ID[DEFAULT_STREAMER_THEME_ID];
}

export function getStreamerThemeTokens(
  theme: StreamerTheme | StreamerThemeId,
  mode: StreamerThemeColorMode = "light",
): StreamerThemeTokens {
  const resolved =
    typeof theme === "string" ? STREAMER_THEME_BY_ID[theme] : theme;
  return resolved[mode];
}

export type StreamerThemeCssVariableName =
  | "--exlab-background"
  | "--exlab-surface"
  | "--exlab-surface-subtle"
  | "--exlab-text"
  | "--exlab-muted"
  | "--exlab-text-subtle"
  | "--exlab-text-faint"
  | "--exlab-border"
  | "--exlab-border-strong"
  | "--exlab-accent"
  | "--exlab-on-accent"
  | "--exlab-accent-ink"
  | "--exlab-accent-bg"
  | "--exlab-accent-line"
  | "--exlab-rail-start"
  | "--exlab-rail-end"
  | "--exlab-theme-image-tint"
  | "--exlab-theme-image-tint-fade";

export type StreamerThemeCssVariables = CSSProperties &
  Record<StreamerThemeCssVariableName, string>;

/**
 * Maps a theme to the common platform token contract. Semantic status colours,
 * participant colours, and game-role colours deliberately remain outside it.
 */
export function streamerThemeCssVariables(
  theme: StreamerTheme | StreamerThemeId,
  mode: StreamerThemeColorMode = "light",
): StreamerThemeCssVariables {
  const tokens = getStreamerThemeTokens(theme, mode);
  return {
    "--exlab-background": tokens.background,
    "--exlab-surface": tokens.surface,
    "--exlab-surface-subtle": tokens.surfaceSubtle,
    "--exlab-text": tokens.text,
    "--exlab-muted": tokens.textMuted,
    "--exlab-text-subtle": tokens.textSubtle,
    "--exlab-text-faint": tokens.textFaint,
    "--exlab-border": tokens.border,
    "--exlab-border-strong": tokens.borderStrong,
    "--exlab-accent": tokens.accent,
    "--exlab-on-accent": tokens.accentOn,
    "--exlab-accent-ink": tokens.accentInk,
    "--exlab-accent-bg": tokens.accentBg,
    "--exlab-accent-line": tokens.accentLine,
    "--exlab-rail-start": tokens.railStart,
    "--exlab-rail-end": tokens.railEnd,
    "--exlab-theme-image-tint": mode === "dark" ? "22%" : "14%",
    "--exlab-theme-image-tint-fade": mode === "dark" ? "15%" : "10%",
  };
}

/**
 * Resolve public assets without assuming the app is hosted at domain root.
 * Use "." for document-relative static hosting, "/" for root hosting, or pass
 * a repository base such as "/exlab/".
 */
export function resolveStreamerThemePortraitUrl(
  theme: StreamerTheme | StreamerThemeId,
  assetBasePath = ".",
): string {
  const resolved =
    typeof theme === "string" ? STREAMER_THEME_BY_ID[theme] : theme;
  const base = assetBasePath.trim() || ".";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${resolved.portrait.path.replace(/^\.?\//, "")}`;
}

type Rgb = readonly [number, number, number];

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, saturation / 100));
  const l = Math.max(0, Math.min(1, lightness / 100));
  if (s === 0) return [l, l, l];

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number): number => {
    let value = offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function parseThemeColor(value: string): Rgb | null {
  const hslMatch =
    /^hsl\(\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)$/i.exec(
      value,
    );
  if (hslMatch !== null) {
    return hslToRgb(
      Number(hslMatch[1]),
      Number(hslMatch[2]),
      Number(hslMatch[3]),
    );
  }

  const rgbMatch =
    /^rgb\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\)$/i.exec(
      value,
    );
  if (rgbMatch === null) return null;
  return [
    Math.max(0, Math.min(255, Number(rgbMatch[1]))) / 255,
    Math.max(0, Math.min(255, Number(rgbMatch[2]))) / 255,
    Math.max(0, Math.min(255, Number(rgbMatch[3]))) / 255,
  ];
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const linearize = (channel: number): number =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

/** Returns 0 for unsupported CSS colour syntax. */
export function themeColorContrastRatio(
  foreground: string,
  background: string,
): number {
  const foregroundRgb = parseThemeColor(foreground);
  const backgroundRgb = parseThemeColor(background);
  if (foregroundRgb === null || backgroundRgb === null) return 0;

  const foregroundLuminance = relativeLuminance(foregroundRgb);
  const backgroundLuminance = relativeLuminance(backgroundRgb);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface StreamerThemeContrastReport {
  readonly accentLabel: number;
  readonly accentInkOnSurface: number;
  readonly bodyTextOnSurface: number;
  readonly passes: boolean;
}

export const STREAMER_THEME_CONTRAST_TARGETS = {
  accentLabel: 4.5,
  accentInkOnSurface: 6.5,
  bodyTextOnSurface: 4.5,
} as const;

export function streamerThemeContrastReport(
  theme: StreamerTheme | StreamerThemeId,
  mode: StreamerThemeColorMode = "light",
): StreamerThemeContrastReport {
  const tokens = getStreamerThemeTokens(theme, mode);
  const accentLabel = themeColorContrastRatio(
    tokens.accentOn,
    tokens.accent,
  );
  const accentInkOnSurface = themeColorContrastRatio(
    tokens.accentInk,
    tokens.surface,
  );
  const bodyTextOnSurface = themeColorContrastRatio(
    tokens.text,
    tokens.surface,
  );
  return {
    accentLabel,
    accentInkOnSurface,
    bodyTextOnSurface,
    passes:
      accentLabel >= STREAMER_THEME_CONTRAST_TARGETS.accentLabel &&
      accentInkOnSurface >=
        STREAMER_THEME_CONTRAST_TARGETS.accentInkOnSurface &&
      bodyTextOnSurface >=
        STREAMER_THEME_CONTRAST_TARGETS.bodyTextOnSurface,
  };
}
