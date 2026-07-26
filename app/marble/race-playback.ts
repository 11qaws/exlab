export const FINAL_OVERTAKE_PRE_ROLL_MS = 300;
export const FINAL_OVERTAKE_POST_ROLL_MS = 200;
export const FINAL_OVERTAKE_DURATION_MS =
  FINAL_OVERTAKE_PRE_ROLL_MS +
  FINAL_OVERTAKE_POST_ROLL_MS;
export const FINAL_OVERTAKE_PLAYBACK_RATE = 0.5;
export const RESULT_HOLD_DURATION_MS = 3_000;

const EPSILON = 0.000_001;

export type RacePlaybackEvent = {
  triggerFrameIndex: number;
};

export type RacePlaybackClock = {
  sourceFrame: number;
  nextEventIndex: number;
  activeEventIndex: number | null;
  effectElapsedMs: number;
  effectRemainingMs: number;
  resultGateReached: boolean;
  resultHoldElapsedMs: number;
};

export type AdvanceRacePlaybackOptions = {
  frameRate?: number;
  slowMotionDurationMs?: number;
  slowMotionRate?: number;
  slowMotionEnabled?: boolean;
  resultGateFrameIndex?: number;
};

export function createRacePlaybackClock(
  sourceFrame = 0,
): RacePlaybackClock {
  if (!Number.isFinite(sourceFrame) || sourceFrame < 0) {
    throw new RangeError("sourceFrame must be a non-negative number.");
  }
  return {
    sourceFrame,
    nextEventIndex: 0,
    activeEventIndex: null,
    effectElapsedMs: 0,
    effectRemainingMs: 0,
    resultGateReached: false,
    resultHoldElapsedMs: 0,
  };
}

export function resolveFinalOvertakeTriggerFrame(
  overtakeFrameIndex: number,
  frameRate = 30,
  playbackRate = FINAL_OVERTAKE_PLAYBACK_RATE,
): number {
  if (
    !Number.isFinite(overtakeFrameIndex) ||
    overtakeFrameIndex < 0
  ) {
    throw new RangeError(
      "overtakeFrameIndex must be a non-negative number.",
    );
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError("frameRate must be a positive number.");
  }
  if (
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0 ||
    playbackRate > 1
  ) {
    throw new RangeError("playbackRate must be between 0 and 1.");
  }
  return Math.max(
    0,
    overtakeFrameIndex -
      (FINAL_OVERTAKE_PRE_ROLL_MS / 1000) *
        frameRate *
        playbackRate,
  );
}

/**
 * Advances prerecorded physical frames with a presentation-only clock.
 * Event and result-gate boundaries are consumed piecewise so a dropped
 * animation frame cannot skip a 0.5 second overtake cue or shorten the
 * post-podium hold.
 */
export function advanceRacePlayback(
  state: RacePlaybackClock,
  deltaMs: number,
  events: readonly RacePlaybackEvent[],
  options: AdvanceRacePlaybackOptions = {},
): RacePlaybackClock {
  const {
    frameRate = 30,
    slowMotionDurationMs = FINAL_OVERTAKE_DURATION_MS,
    slowMotionRate = FINAL_OVERTAKE_PLAYBACK_RATE,
    slowMotionEnabled = true,
    resultGateFrameIndex,
  } = options;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new RangeError("deltaMs must be a non-negative number.");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError("frameRate must be a positive number.");
  }
  if (
    !Number.isFinite(slowMotionDurationMs) ||
    slowMotionDurationMs <= 0
  ) {
    throw new RangeError(
      "slowMotionDurationMs must be a positive number.",
    );
  }
  if (
    !Number.isFinite(slowMotionRate) ||
    slowMotionRate <= 0 ||
    slowMotionRate > 1
  ) {
    throw new RangeError("slowMotionRate must be between 0 and 1.");
  }
  if (
    resultGateFrameIndex !== undefined &&
    (!Number.isFinite(resultGateFrameIndex) ||
      resultGateFrameIndex < 0)
  ) {
    throw new RangeError(
      "resultGateFrameIndex must be a non-negative number.",
    );
  }

  const next: RacePlaybackClock = { ...state };
  let remainingWallMs = deltaMs;

  const triggerDueEvents = () => {
    while (
      next.nextEventIndex < events.length &&
      events[next.nextEventIndex].triggerFrameIndex <=
        next.sourceFrame + EPSILON
    ) {
      next.activeEventIndex = next.nextEventIndex;
      next.nextEventIndex += 1;
      next.effectElapsedMs = 0;
      next.effectRemainingMs = slowMotionDurationMs;
    }
  };

  const markResultGateIfDue = () => {
    if (
      !next.resultGateReached &&
      resultGateFrameIndex !== undefined &&
      next.sourceFrame + EPSILON >= resultGateFrameIndex
    ) {
      next.resultGateReached = true;
    }
  };

  triggerDueEvents();
  markResultGateIfDue();

  while (remainingWallMs > EPSILON) {
    const effectActive =
      next.activeEventIndex !== null &&
      next.effectRemainingMs > EPSILON;
    const playbackRate =
      effectActive && slowMotionEnabled ? slowMotionRate : 1;
    const upcomingEvent = events[next.nextEventIndex];
    const wallMsToEvent = upcomingEvent
      ? Math.max(
          0,
          ((upcomingEvent.triggerFrameIndex - next.sourceFrame) /
            (frameRate * playbackRate)) *
            1000,
        )
      : Number.POSITIVE_INFINITY;
    const wallMsToResultGate =
      !next.resultGateReached &&
      resultGateFrameIndex !== undefined
        ? Math.max(
            0,
            ((resultGateFrameIndex - next.sourceFrame) /
              (frameRate * playbackRate)) *
              1000,
          )
        : Number.POSITIVE_INFINITY;
    const wallMsToEffectEnd = effectActive
      ? next.effectRemainingMs
      : Number.POSITIVE_INFINITY;
    const stepMs = Math.min(
      remainingWallMs,
      wallMsToEvent,
      wallMsToResultGate,
      wallMsToEffectEnd,
    );

    if (stepMs <= EPSILON) {
      const previousEventIndex = next.nextEventIndex;
      const resultGateWasReached = next.resultGateReached;
      triggerDueEvents();
      markResultGateIfDue();
      if (
        next.activeEventIndex !== null &&
        next.effectRemainingMs <= EPSILON
      ) {
        next.activeEventIndex = null;
        next.effectElapsedMs = 0;
        next.effectRemainingMs = 0;
      }
      if (
        previousEventIndex === next.nextEventIndex &&
        resultGateWasReached === next.resultGateReached
      ) {
        break;
      }
      continue;
    }

    const resultGateWasReached = next.resultGateReached;
    next.sourceFrame +=
      (stepMs / 1000) * frameRate * playbackRate;
    remainingWallMs -= stepMs;
    if (effectActive) {
      next.effectElapsedMs += stepMs;
      next.effectRemainingMs = Math.max(
        0,
        next.effectRemainingMs - stepMs,
      );
    }
    if (resultGateWasReached) {
      next.resultHoldElapsedMs += stepMs;
    }

    triggerDueEvents();
    markResultGateIfDue();
    if (
      next.activeEventIndex !== null &&
      next.effectRemainingMs <= EPSILON
    ) {
      next.activeEventIndex = null;
      next.effectElapsedMs = 0;
      next.effectRemainingMs = 0;
    }
  }

  return next;
}

export function overtakeZoomIntensity(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  const edgeProgress =
    clamped < 0.2
      ? clamped / 0.2
      : clamped > 0.8
        ? (1 - clamped) / 0.2
        : 1;
  const eased = Math.max(0, Math.min(1, edgeProgress));
  return eased * eased * (3 - 2 * eased);
}
