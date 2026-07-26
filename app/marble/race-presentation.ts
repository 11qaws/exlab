import {
  COURSE_SECTIONS,
  FINISH_Y,
  MARBLE_RADIUS,
  type CourseSection,
} from "./course";
import type { MarblePose, RaceFrame } from "./types";

export const RACE_FRAME_RATE = 30;
export const STABLE_LEAD_HOLD_FRAMES = 6;
export const MEANINGFUL_LEAD_GAP = MARBLE_RADIUS;
export const CLOSE_RACE_GAP = MARBLE_RADIUS * 2;
export const FINAL_APPROACH_PROGRESS = 0.88;
export const PHOTO_FINISH_SECONDS = 0.35;
export const PHOTO_FINISH_FRAMES = Math.round(
  RACE_FRAME_RATE * PHOTO_FINISH_SECONDS,
);

export type CourseProgress = {
  leaderSlotId: string;
  leaderY: number;
  overall: number;
  section: CourseSection;
  sectionIndex: number;
  sectionProgress: number;
};

export type LeadChange = {
  frameIndex: number;
  holdStartFrameIndex: number;
  fromSlotId: string;
  toSlotId: string;
  gap: number;
};

export type StableLeadChangeOptions = {
  holdFrames?: number;
  meaningfulGap?: number;
  targetFinishCount?: number;
};

export type ArrivalDelta = {
  firstPlace: number;
  secondPlace: number;
  firstSlotId: string;
  secondSlotId: string;
  firstFrameIndex: number;
  secondFrameIndex: number;
  deltaFrames: number;
  deltaMs: number;
  deltaSeconds: number;
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function poseBySlotId(
  frame: RaceFrame,
  slotId: string | undefined,
): MarblePose | undefined {
  if (!slotId) return undefined;
  return frame.poses.find((pose) => pose.slotId === slotId);
}

function leadingPose(frame: RaceFrame): MarblePose | undefined {
  const rankedLeader = poseBySlotId(frame, frame.rankedSlotIds[0]);
  if (rankedLeader) return rankedLeader;
  return frame.poses.reduce<MarblePose | undefined>(
    (leader, pose) => (!leader || pose.y > leader.y ? pose : leader),
    undefined,
  );
}

function sectionAtY(y: number): {
  section: CourseSection;
  sectionIndex: number;
} {
  const sectionIndex = COURSE_SECTIONS.findIndex(
    (section, index) =>
      y >= section.startY &&
      (y < section.endY || index === COURSE_SECTIONS.length - 1),
  );
  const safeIndex =
    sectionIndex >= 0
      ? sectionIndex
      : y < COURSE_SECTIONS[0].startY
        ? 0
        : COURSE_SECTIONS.length - 1;
  return {
    section: COURSE_SECTIONS[safeIndex],
    sectionIndex: safeIndex,
  };
}

function activeRankedSlotIds(frame: RaceFrame): string[] {
  const finished = new Set(frame.finishedSlotIds);
  return frame.rankedSlotIds.filter((slotId) => !finished.has(slotId));
}

function liveLeaderGap(
  frame: RaceFrame,
  rankedSlotIds = frame.rankedSlotIds,
): number | null {
  const leader = poseBySlotId(frame, rankedSlotIds[0]);
  const runnerUp = poseBySlotId(frame, rankedSlotIds[1]);
  if (!leader || !runnerUp) return null;
  return leader.y - runnerUp.y;
}

/**
 * Returns the physical leader's position in the course and in its current
 * quarter. Progress is clamped at the finish line so post-finish movement
 * cannot push presentation values past 100%.
 */
export function resolveCourseProgress(
  frame: RaceFrame,
): CourseProgress | null {
  const leader = leadingPose(frame);
  if (!leader) return null;

  const { section, sectionIndex } = sectionAtY(leader.y);
  const sectionLength = Math.max(1, section.endY - section.startY);
  return {
    leaderSlotId: leader.slotId,
    leaderY: leader.y,
    overall: clamp(leader.y / FINISH_Y),
    section,
    sectionIndex,
    sectionProgress: clamp(
      (leader.y - section.startY) / sectionLength,
    ),
  };
}

/**
 * Filters ranking jitter into confirmed lead-change events. A challenger must
 * remain the raw leader for six consecutive captured frames and finish that
 * hold at least one marble radius ahead of the runner-up.
 */
export function findStableLeadChanges(
  frames: readonly RaceFrame[],
  options: StableLeadChangeOptions = {},
): LeadChange[] {
  const {
    holdFrames = STABLE_LEAD_HOLD_FRAMES,
    meaningfulGap = MEANINGFUL_LEAD_GAP,
    targetFinishCount = 1,
  } = options;
  if (!Number.isInteger(holdFrames) || holdFrames < 1) {
    throw new RangeError("holdFrames must be a positive integer.");
  }
  if (!Number.isFinite(meaningfulGap) || meaningfulGap < 0) {
    throw new RangeError("meaningfulGap must be a non-negative number.");
  }
  if (!Number.isInteger(targetFinishCount) || targetFinishCount < 1) {
    throw new RangeError(
      "targetFinishCount must be a positive integer.",
    );
  }

  const firstRankedFrameIndex = frames.findIndex(
    (frame) =>
      frame.finishedSlotIds.length < targetFinishCount &&
      activeRankedSlotIds(frame).length > 0,
  );
  if (firstRankedFrameIndex < 0) return [];

  let confirmedLeader =
    activeRankedSlotIds(frames[firstRankedFrameIndex])[0];
  let pendingLeader: string | null = null;
  let pendingStartFrameIndex = -1;
  let pendingFrames = 0;
  const changes: LeadChange[] = [];

  for (
    let frameIndex = firstRankedFrameIndex + 1;
    frameIndex < frames.length;
    frameIndex += 1
  ) {
    const frame = frames[frameIndex];
    if (frame.finishedSlotIds.length >= targetFinishCount) break;

    const activeOrder = activeRankedSlotIds(frame);
    const rawLeader = activeOrder[0];
    if (!rawLeader) continue;

    if (!activeOrder.includes(confirmedLeader)) {
      confirmedLeader = rawLeader;
      pendingLeader = null;
      pendingStartFrameIndex = -1;
      pendingFrames = 0;
      continue;
    }

    if (!rawLeader || rawLeader === confirmedLeader) {
      pendingLeader = null;
      pendingStartFrameIndex = -1;
      pendingFrames = 0;
      continue;
    }

    if (rawLeader !== pendingLeader) {
      pendingLeader = rawLeader;
      pendingStartFrameIndex = frameIndex;
      pendingFrames = 1;
    } else {
      pendingFrames += 1;
    }

    const gap = liveLeaderGap(frame, activeOrder);
    if (
      pendingFrames < holdFrames ||
      gap === null ||
      gap < meaningfulGap
    ) {
      continue;
    }

    changes.push({
      frameIndex,
      holdStartFrameIndex: pendingStartFrameIndex,
      fromSlotId: confirmedLeader,
      toSlotId: rawLeader,
      gap,
    });
    confirmedLeader = rawLeader;
    pendingLeader = null;
    pendingStartFrameIndex = -1;
    pendingFrames = 0;
  }

  return changes;
}

export function latestStableLeadChange(
  frames: readonly RaceFrame[],
  options: StableLeadChangeOptions = {},
): LeadChange | null {
  return (
    findStableLeadChanges(frames, options).at(-1) ??
    null
  );
}

/**
 * A live close-race state is only reported before the first arrival. Arrival
 * timing has its own photo-finish signal and should not be inferred from
 * bodies continuing below the finish line.
 */
export function isCloseRace(
  frame: RaceFrame,
  threshold = CLOSE_RACE_GAP,
): boolean {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError("threshold must be a non-negative number.");
  }
  if (frame.finishedSlotIds.length > 0) return false;
  const gap = liveLeaderGap(frame);
  return gap !== null && gap >= 0 && gap <= threshold;
}

export function isFinalApproach(
  frame: RaceFrame,
  startProgress = FINAL_APPROACH_PROGRESS,
): boolean {
  if (
    !Number.isFinite(startProgress) ||
    startProgress < 0 ||
    startProgress > 1
  ) {
    throw new RangeError("startProgress must be between 0 and 1.");
  }
  if (frame.finishedSlotIds.length > 0) return false;
  const progress = resolveCourseProgress(frame);
  return progress !== null && progress.overall >= startProgress;
}

function arrivalAtPlace(
  frames: readonly RaceFrame[],
  place: number,
): { slotId: string; frameIndex: number } | null {
  if (!Number.isInteger(place) || place < 1) {
    throw new RangeError("place must be a positive integer.");
  }
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const slotId = frames[frameIndex].finishedSlotIds[place - 1];
    if (slotId) return { slotId, frameIndex };
  }
  return null;
}

/**
 * Measures sampled-frame arrival time between any two finish places.
 * Places are one-based and must be supplied in finish order.
 */
export function resolveArrivalDelta(
  frames: readonly RaceFrame[],
  firstPlace = 1,
  secondPlace = 2,
  frameRate = RACE_FRAME_RATE,
): ArrivalDelta | null {
  if (
    !Number.isInteger(firstPlace) ||
    !Number.isInteger(secondPlace) ||
    firstPlace < 1 ||
    secondPlace <= firstPlace
  ) {
    throw new RangeError(
      "Finish places must be positive integers in ascending order.",
    );
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError("frameRate must be a positive number.");
  }

  const first = arrivalAtPlace(frames, firstPlace);
  const second = arrivalAtPlace(frames, secondPlace);
  if (!first || !second) return null;

  const deltaFrames = second.frameIndex - first.frameIndex;
  const deltaSeconds = deltaFrames / frameRate;
  return {
    firstPlace,
    secondPlace,
    firstSlotId: first.slotId,
    secondSlotId: second.slotId,
    firstFrameIndex: first.frameIndex,
    secondFrameIndex: second.frameIndex,
    deltaFrames,
    deltaMs: Math.round(deltaSeconds * 1000),
    deltaSeconds,
  };
}

export function isPhotoFinish(
  frames: readonly RaceFrame[],
  thresholdFrames = PHOTO_FINISH_FRAMES,
): boolean {
  if (!Number.isInteger(thresholdFrames) || thresholdFrames < 0) {
    throw new RangeError(
      "thresholdFrames must be a non-negative integer.",
    );
  }
  const delta = resolveArrivalDelta(frames);
  return delta !== null && delta.deltaFrames <= thresholdFrames;
}
