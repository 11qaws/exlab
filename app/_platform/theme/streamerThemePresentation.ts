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

export function streamerThemePickerPortraitOffsetY(
  theme: StreamerTheme,
): number {
  return (
    theme.portrait.offsetY
    + (STREAMER_THEME_PICKER_PORTRAIT_OFFSET_Y[theme.id] ?? 0)
  );
}
