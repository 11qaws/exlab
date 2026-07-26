export const CAMERA_FRAME_RATE = 30;
export const LEADER_FOCUS_DELAY_SECONDS = 0.5;
export const LEADER_FOCUS_DELAY_FRAMES =
  CAMERA_FRAME_RATE * LEADER_FOCUS_DELAY_SECONDS;

const CAMERA_SPRING_ACCELERATION = 0.035;
const CAMERA_VELOCITY_DAMPING = 0.78;
const CAMERA_MAX_VERTICAL_SPEED = 64;
export const REDUCED_MOTION_CAMERA_SNAP_DISTANCE = 450;

export type LeaderFocusState = {
  focusedSlotId: string | null;
  pendingSlotId: string | null;
  pendingSinceFrame: number | null;
};

export type VerticalCameraState = {
  positionY: number;
  velocityY: number;
};

export const INITIAL_LEADER_FOCUS_STATE: LeaderFocusState = {
  focusedSlotId: null,
  pendingSlotId: null,
  pendingSinceFrame: null,
};

export const INITIAL_VERTICAL_CAMERA_STATE: VerticalCameraState = {
  positionY: 0,
  velocityY: 0,
};

export function resolveLeaderFocus(
  state: LeaderFocusState,
  currentLeaderSlotId: string | undefined,
  frameIndex: number,
): LeaderFocusState {
  if (!currentLeaderSlotId) return state;
  if (!state.focusedSlotId) {
    return {
      focusedSlotId: currentLeaderSlotId,
      pendingSlotId: null,
      pendingSinceFrame: null,
    };
  }
  if (currentLeaderSlotId === state.focusedSlotId) {
    return {
      focusedSlotId: state.focusedSlotId,
      pendingSlotId: null,
      pendingSinceFrame: null,
    };
  }
  if (
    state.pendingSlotId !== currentLeaderSlotId ||
    state.pendingSinceFrame === null
  ) {
    return {
      focusedSlotId: state.focusedSlotId,
      pendingSlotId: currentLeaderSlotId,
      pendingSinceFrame: frameIndex,
    };
  }
  if (
    frameIndex - state.pendingSinceFrame <
    LEADER_FOCUS_DELAY_FRAMES
  ) {
    return state;
  }
  return {
    focusedSlotId: currentLeaderSlotId,
    pendingSlotId: null,
    pendingSinceFrame: null,
  };
}

export function advanceVerticalCamera(
  state: VerticalCameraState,
  targetY: number,
  maximumY: number,
  reducedMotion: boolean,
  frameDelta = 1,
): VerticalCameraState {
  const clampedTarget = Math.max(0, Math.min(maximumY, targetY));
  if (reducedMotion) {
    if (
      Math.abs(clampedTarget - state.positionY) <
      REDUCED_MOTION_CAMERA_SNAP_DISTANCE
    ) {
      return { positionY: state.positionY, velocityY: 0 };
    }
    return { positionY: clampedTarget, velocityY: 0 };
  }
  if (!Number.isFinite(frameDelta) || frameDelta <= 0) {
    return state;
  }

  const acceleration =
    (clampedTarget - state.positionY) *
    CAMERA_SPRING_ACCELERATION *
    frameDelta;
  const velocityY = Math.max(
    -CAMERA_MAX_VERTICAL_SPEED,
    Math.min(
      CAMERA_MAX_VERTICAL_SPEED,
      (state.velocityY + acceleration) *
        CAMERA_VELOCITY_DAMPING ** frameDelta,
    ),
  );
  const positionY = Math.max(
    0,
    Math.min(maximumY, state.positionY + velocityY * frameDelta),
  );
  const hitBoundary =
    (positionY === 0 && velocityY < 0) ||
    (positionY === maximumY && velocityY > 0);

  return {
    positionY,
    velocityY: hitBoundary ? 0 : velocityY,
  };
}
