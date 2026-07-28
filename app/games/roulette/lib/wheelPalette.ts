export type RouletteWheelLabelTone = "accent" | "ink" | "stage";

export type RouletteWheelPaletteEntry = Readonly<{
  key:
    | "theme-main"
    | "lemon"
    | "theme-dark"
    | "mint"
    | "theme-light"
    | "sky"
    | "lavender"
    | "orange";
  color: string;
  labelTone: RouletteWheelLabelTone;
}>;

/**
 * Eight visually distinct wheel roles. The selected streamer owns three
 * identity colours; five stable game colours keep larger wheels varied.
 * Interleaving the identity roles avoids grouping one hue family together.
 */
export const ROULETTE_WHEEL_PALETTE = [
  {
    key: "theme-main",
    color: "var(--roulette-palette-main, #e84f83)",
    labelTone: "accent",
  },
  {
    key: "lemon",
    color: "var(--lemon, #ffd166)",
    labelTone: "ink",
  },
  {
    key: "theme-dark",
    color: "var(--roulette-palette-dark, #8f3655)",
    labelTone: "stage",
  },
  {
    key: "mint",
    color: "var(--mint, #34e0a8)",
    labelTone: "ink",
  },
  {
    key: "theme-light",
    color: "var(--roulette-palette-light, #f6c8d8)",
    labelTone: "ink",
  },
  {
    key: "sky",
    color: "var(--sky, #4ea9f0)",
    labelTone: "ink",
  },
  {
    key: "lavender",
    color: "var(--lavender, #7e57c2)",
    labelTone: "stage",
  },
  {
    key: "orange",
    color: "var(--orange, #ff9d54)",
    labelTone: "ink",
  },
] as const satisfies readonly RouletteWheelPaletteEntry[];
