export const DEFAULT_PREVIEW_ROSTER_NAMES = Object.freeze([
  "레또",
  "레카",
  "세나",
  "코코",
  "망징",
] as const);

export type PreviewCycleBuffer<T> = Readonly<{
  active: T;
  pending: T;
}>;

/**
 * A preview owns the active snapshot for its complete demonstration cycle.
 * Incoming setup changes are kept separately until the next cycle begins.
 */
export function createPreviewCycleBuffer<T>(
  active: T,
  pending: T,
): PreviewCycleBuffer<T> {
  return Object.freeze({ active, pending });
}

export function queuePreviewCycleValue<T>(
  state: PreviewCycleBuffer<T>,
  pending: T,
): PreviewCycleBuffer<T> {
  return Object.freeze({
    active: state.active,
    pending,
  });
}

export function advancePreviewCycle<T>(
  state: PreviewCycleBuffer<T>,
  latestPending: T = state.pending,
): PreviewCycleBuffer<T> {
  return Object.freeze({
    active: latestPending,
    pending: latestPending,
  });
}

export function previewRosterNamesOrDefault(
  names: readonly string[],
): string[] {
  const normalized = names
    .map((name) => name.trim())
    .filter(Boolean);
  return normalized.length > 0
    ? normalized
    : [...DEFAULT_PREVIEW_ROSTER_NAMES];
}
