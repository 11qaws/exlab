import type {
  StreamerTheme,
  StreamerThemeId,
} from "./streamerThemes";

/**
 * Card crops are presentation-specific. Keep them separate from the canonical
 * portrait so compact avatars and future portrait surfaces do not inherit the
 * wide-card adjustment.
 */
export const STREAMER_THEME_PICKER_PORTRAIT_OFFSET_Y:
  Readonly<Partial<Record<StreamerThemeId, number>>> = Object.freeze({
    eureka: 10,
    sena: 10,
  });

/**
 * Compact current-theme avatars have their own crop scale. This must not alter
 * the canonical portrait zoom used by the theme picker or other surfaces.
 */
export const STREAMER_THEME_CURRENT_PORTRAIT_SCALE:
  Readonly<Partial<Record<StreamerThemeId, number>>> = Object.freeze({
    amoretto: 0.9,
    mangjing: 0.9,
  });

export function streamerThemePickerPortraitOffsetY(
  theme: StreamerTheme,
): number {
  return (
    theme.portrait.offsetY
    + (STREAMER_THEME_PICKER_PORTRAIT_OFFSET_Y[theme.id] ?? 0)
  );
}

export function streamerThemeCurrentPortraitZoom(
  theme: StreamerTheme,
): number {
  return (
    theme.portrait.zoom
    * (STREAMER_THEME_CURRENT_PORTRAIT_SCALE[theme.id] ?? 1)
  );
}
