export type StreamerPaletteRole = "dark" | "main" | "light";

export type StreamerColorPalette = Readonly<
  Record<StreamerPaletteRole, string>
>;

/**
 * Image-derived identity colours shared by every Ex Lab game.
 *
 * Use these names consistently:
 * - dark: dense structural colour for walls, outlines, and deep accents
 * - main: the streamer's primary identity colour
 * - light: pale supporting colour for secondary objects and soft surfaces
 *
 * Component-specific contrast adjustments may mix these colours with the
 * active surface, but should not introduce a fourth identity colour.
 */
export const STREAMER_COLOR_PALETTES = {
  amoretto: {
    dark: "#8f3655",
    main: "#e84f83",
    light: "#f6c8d8",
  },
  eureka: {
    dark: "#16664f",
    main: "#2fbfa7",
    light: "#f2d76b",
  },
  sena: {
    dark: "#572b43",
    main: "#443e4b",
    light: "#bdacbb",
  },
  torori: {
    dark: "#355d8a",
    main: "#4baedc",
    light: "#d6f1fb",
  },
  mangjing: {
    dark: "#2f478f",
    main: "#7d90ca",
    light: "#cedafa",
  },
} as const satisfies Record<string, StreamerColorPalette>;
