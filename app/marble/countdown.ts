export type CountdownStep = 3 | 2 | 1 | "GO";

export const COUNTDOWN_SEQUENCE: readonly CountdownStep[] = [
  3,
  2,
  1,
  "GO",
];

export function nextCountdownStep(
  current: CountdownStep,
): CountdownStep | null {
  const index = COUNTDOWN_SEQUENCE.indexOf(current);
  return COUNTDOWN_SEQUENCE[index + 1] ?? null;
}

export function countdownStepDuration(
  current: CountdownStep,
  reducedMotion: boolean,
): number {
  if (current === "GO") return reducedMotion ? 240 : 420;
  return reducedMotion ? 480 : 860;
}
