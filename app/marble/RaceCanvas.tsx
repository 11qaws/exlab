"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  advanceVerticalCamera,
  INITIAL_LEADER_FOCUS_STATE,
  INITIAL_VERTICAL_CAMERA_STATE,
  resolveLeaderFocus,
  type LeaderFocusState,
  type VerticalCameraState,
} from "./camera";
import { shortName } from "./core";
import {
  COURSE_BUMPERS,
  COURSE_CURVES,
  COURSE_PINS,
  COURSE_RECTS,
  COURSE_SECTIONS,
  FINISH_LINE_WIDTH,
  FINISH_LINE_X,
  FINISH_Y,
  MARBLE_RADIUS,
  ROTATING_BARS,
  VIEW_HEIGHT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./course";
import type { CourseBumper, CourseRect } from "./course";
import {
  findStableLeadChanges,
  isCloseRace,
  isFinalApproach,
} from "./race-presentation";
import { overtakeZoomIntensity } from "./race-playback";
import {
  obstacleColor,
  obstacleRoleColor,
  raceMapTheme,
  type RaceMapMode,
  type RaceMapTheme,
} from "./race-theme";
import type { RaceFrame, RacePlan } from "./types";

type RaceCanvasProps = {
  plan: RacePlan;
  frameIndex: number;
  reducedMotion: boolean;
  mapMode: RaceMapMode;
  wallColor?: string;
  playbackEpoch?: number;
  finalOvertake?: {
    fromSlotId: string;
    toSlotId: string;
    progress: number;
    hasOvertaken: boolean;
  } | null;
};

export function resolveRaceFrame(
  frames: RaceFrame[],
  frameIndex: number,
): RaceFrame | null {
  if (frames.length === 0) return null;
  const finiteIndex = Number.isFinite(frameIndex) ? frameIndex : 0;
  const clampedIndex = Math.max(
    0,
    Math.min(finiteIndex, frames.length - 1),
  );
  const baseIndex = Math.floor(clampedIndex);
  const nextIndex = Math.min(baseIndex + 1, frames.length - 1);
  const baseFrame = frames[baseIndex] ?? frames[0] ?? null;
  const nextFrame = frames[nextIndex] ?? baseFrame;
  const progress = clampedIndex - baseIndex;
  if (!baseFrame || !nextFrame || progress <= 0 || baseFrame === nextFrame) {
    return baseFrame;
  }

  const interpolate = (from: number, to: number) =>
    from + (to - from) * progress;
  const interpolateAngle = (from: number, to: number) => {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * progress;
  };
  const nextPoseBySlot = new Map(
    nextFrame.poses.map((pose) => [pose.slotId, pose]),
  );

  return {
    poses: baseFrame.poses.map((pose) => {
      const nextPose = nextPoseBySlot.get(pose.slotId);
      return nextPose
        ? {
            slotId: pose.slotId,
            x: interpolate(pose.x, nextPose.x),
            y: interpolate(pose.y, nextPose.y),
            angle: interpolateAngle(pose.angle, nextPose.angle),
          }
        : pose;
    }),
    // Ranking and finish state remain causal: interpolation never exposes the
    // next captured frame's result before its source-frame boundary.
    rankedSlotIds: baseFrame.rankedSlotIds,
    finishedSlotIds: baseFrame.finishedSlotIds,
    rotatingBarAngles: baseFrame.rotatingBarAngles.map((angle, index) =>
      interpolateAngle(
        angle,
        nextFrame.rotatingBarAngles[index] ?? angle,
      ),
    ),
    bumperFlashes: baseFrame.bumperFlashes.map((flash, index) => {
      const nextFlash = nextFrame.bumperFlashes[index];
      if (!nextFlash || nextFlash.level >= flash.level) return flash;
      return {
        level: interpolate(flash.level, nextFlash.level),
        x: interpolate(flash.x, nextFlash.x),
        y: interpolate(flash.y, nextFlash.y),
      };
    }),
  };
}

export function resolveRaceFocusSlotId(
  frame: RaceFrame,
  targetFinishCount: number,
): string | undefined {
  if (frame.finishedSlotIds.length < targetFinishCount) {
    const finished = new Set(frame.finishedSlotIds);
    return (
      frame.rankedSlotIds.find((slotId) => !finished.has(slotId)) ??
      frame.rankedSlotIds[0]
    );
  }
  return frame.rankedSlotIds[0];
}

export const OFFSCREEN_PODIUM_MIN_SCALE = 0.82;
export const OFFSCREEN_PODIUM_MAX_SCALE = 1.12;
export const OFFSCREEN_PODIUM_FAR_DISTANCE = VIEW_HEIGHT * 0.68;

export type OffscreenPodiumIndicator = {
  slotId: string;
  rank: 2 | 3;
  x: number;
  proximity: number;
  emphasisScale: number;
};

export function resolveOffscreenPodiumIndicators(
  frame: RaceFrame,
  viewportTopY: number,
  viewportBottomY: number,
  reducedMotion: boolean,
): OffscreenPodiumIndicator[] {
  if (frame.finishedSlotIds.length > 0) return [];
  const poseBySlot = new Map(
    frame.poses.map((pose) => [pose.slotId, pose]),
  );
  const leaderPose = poseBySlot.get(frame.rankedSlotIds[0]);
  if (
    !leaderPose ||
    leaderPose.y + MARBLE_RADIUS < viewportTopY ||
    leaderPose.y - MARBLE_RADIUS > viewportBottomY
  ) {
    return [];
  }

  return frame.rankedSlotIds.slice(1, 3).flatMap(
    (slotId, index): OffscreenPodiumIndicator[] => {
      const pose = poseBySlot.get(slotId);
      if (!pose || pose.y + MARBLE_RADIUS >= viewportTopY) {
        return [];
      }
      const distanceAboveViewport =
        viewportTopY - (pose.y + MARBLE_RADIUS);
      const linearProximity =
        1 -
        Math.min(
          1,
          distanceAboveViewport / OFFSCREEN_PODIUM_FAR_DISTANCE,
        );
      const proximity =
        linearProximity *
        linearProximity *
        (3 - 2 * linearProximity);

      return [
        {
          slotId,
          rank: (index + 2) as 2 | 3,
          x: pose.x,
          proximity,
          emphasisScale: reducedMotion
            ? 1
            : OFFSCREEN_PODIUM_MIN_SCALE +
              (OFFSCREEN_PODIUM_MAX_SCALE -
                OFFSCREEN_PODIUM_MIN_SCALE) *
                proximity,
        },
      ];
    },
  );
}

function roundedRect(
  context: CanvasRenderingContext2D,
  shape: CourseRect,
  scale: number,
  offsetX: number,
  offsetY: number,
  cameraY: number,
  radius = 8,
  stroke = false,
) {
  const x = offsetX + shape.x * scale;
  const y = offsetY + (shape.y - cameraY) * scale;
  context.save();
  context.translate(x, y);
  context.rotate(shape.angle ?? 0);
  context.beginPath();
  context.roundRect(
    (-shape.width * scale) / 2,
    (-shape.height * scale) / 2,
    shape.width * scale,
    shape.height * scale,
    radius * scale,
  );
  context.fill();
  if (stroke) context.stroke();
  context.restore();
}

function colorWithAlpha(color: string, alpha: number): string {
  const value = color.replace("#", "");
  if (value.length !== 6) return color;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clampPercent(value: number): number {
  return Math.max(8, Math.min(92, value));
}

function drawBumper(
  context: CanvasRenderingContext2D,
  bumper: CourseBumper,
  scale: number,
  offsetX: number,
  offsetY: number,
  cameraY: number,
  color: string,
  theme: RaceMapTheme,
) {
  const x = offsetX + bumper.x * scale;
  const y = offsetY + (bumper.y - cameraY) * scale;
  context.save();
  context.translate(x, y);
  context.rotate(bumper.angle);
  context.shadowColor = colorWithAlpha(color, 0.68);
  context.shadowBlur = 14 * scale;
  context.fillStyle = color;
  context.strokeStyle = theme.outline;
  context.lineWidth = Math.max(2, 3 * scale);
  context.beginPath();
  context.roundRect(
    (-bumper.width * scale) / 2,
    (-bumper.height * scale) / 2,
    bumper.width * scale,
    bumper.height * scale,
    (bumper.height * scale) / 2,
  );
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = theme.finishAlternate;
  context.beginPath();
  context.roundRect(
    (-bumper.width * scale) / 2 + 12 * scale,
    -3 * scale,
    Math.max(10, (bumper.width - 24) * scale),
    6 * scale,
    3 * scale,
  );
  context.fill();
  context.restore();
}

function drawBumperFlash(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  level: number,
  scale: number,
  reducedMotion: boolean,
  rayOffset: number,
  color: string,
  theme: RaceMapTheme,
) {
  if (level <= 0) return;
  const progress = 1 - level;
  const radius = (18 + progress * 42) * scale;
  context.save();
  context.translate(x, y);
  context.globalAlpha = Math.min(1, level * 1.35);
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, colorWithAlpha(theme.finishAlternate, 0.96));
  glow.addColorStop(0.28, colorWithAlpha(color, 0.76));
  glow.addColorStop(1, colorWithAlpha(color, 0));
  context.fillStyle = glow;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = theme.outline;
  context.lineWidth = Math.max(1.5, 2.5 * scale);
  context.beginPath();
  context.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
  context.stroke();

  if (!reducedMotion) {
    context.rotate(rayOffset);
    context.lineCap = "round";
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const start = (12 + progress * 8) * scale;
      const end = (24 + progress * 30) * scale;
      context.beginPath();
      context.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
      context.lineTo(Math.cos(angle) * end, Math.sin(angle) * end);
      context.stroke();
    }
  }
  context.restore();
}

export type FinishFlagLayout = {
  connectorStartX: number;
  connectorEndX: number;
  centerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveFinishFlagLayout(
  startX: number,
  finishWidth: number,
  finishScreenY: number,
  scale: number,
  logicalWidth: number,
): FinishFlagLayout {
  const checkerCell = (FINISH_LINE_WIDTH / 8) * scale;
  const centerY = finishScreenY + checkerCell;
  const width = Math.max(72, 92 * scale);
  const height = Math.max(24, 30 * scale);
  const gap = Math.max(9, 14 * scale);
  const x = Math.min(
    logicalWidth - width - 8,
    Math.max(8, startX + finishWidth + gap),
  );

  return {
    connectorStartX: startX + finishWidth,
    connectorEndX: x,
    centerY,
    x,
    y: centerY - height / 2,
    width,
    height,
  };
}

function drawFinishFlag(
  context: CanvasRenderingContext2D,
  startX: number,
  finishWidth: number,
  finishScreenY: number,
  scale: number,
  logicalWidth: number,
  theme: RaceMapTheme,
) {
  const layout = resolveFinishFlagLayout(
    startX,
    finishWidth,
    finishScreenY,
    scale,
    logicalWidth,
  );

  context.save();
  context.strokeStyle = theme.wall;
  context.lineWidth = Math.max(2, 3 * scale);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(layout.connectorStartX, layout.centerY);
  context.lineTo(layout.connectorEndX, layout.centerY);
  context.stroke();

  context.shadowColor = theme.shadow;
  context.shadowBlur = Math.max(4, 9 * scale);
  context.fillStyle = theme.wall;
  context.strokeStyle = theme.outline;
  context.lineWidth = Math.max(1.5, 2 * scale);
  context.beginPath();
  context.roundRect(
    layout.x,
    layout.y,
    layout.width,
    layout.height,
    Math.min(layout.height / 2, 9 * scale),
  );
  context.fill();
  context.shadowBlur = 0;
  context.stroke();

  context.fillStyle = theme.finishAlternate;
  context.font = `900 ${Math.max(11, 14 * scale)}px Inter, Pretendard, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    "FINISH",
    layout.x + layout.width / 2,
    layout.centerY + 0.5,
  );
  context.restore();
}

export function RaceCanvas({
  plan,
  frameIndex,
  reducedMotion,
  mapMode,
  wallColor,
  playbackEpoch = 0,
  finalOvertake = null,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leaderFocusRef = useRef<LeaderFocusState>({
    ...INITIAL_LEADER_FOCUS_STATE,
  });
  const verticalCameraRef = useRef<VerticalCameraState>({
    ...INITIAL_VERTICAL_CAMERA_STATE,
  });
  const verticalCameraFrameRef = useRef<number | null>(null);
  const frame = resolveRaceFrame(plan.simulation.frames, frameIndex);
  const previousFrame = resolveRaceFrame(
    plan.simulation.frames,
    frameIndex - 1,
  );
  const activeRankedSlotIds = useMemo(() => {
    const finishedSlots = new Set(frame?.finishedSlotIds ?? []);

    return (
      frame?.rankedSlotIds.filter(
        (slotId) => !finishedSlots.has(slotId),
      ) ?? []
    );
  }, [frame]);
  const focusLeaderSlotId = frame
    ? resolveRaceFocusSlotId(
        frame,
        plan.simulation.resultGateCount,
      )
    : undefined;
  const focusLeaderPose = frame?.poses.find(
    (pose) => pose.slotId === focusLeaderSlotId,
  );
  const activeRunnerUpPose = frame?.poses.find(
    (pose) => pose.slotId === activeRankedSlotIds[1],
  );
  const theme = useMemo(
    () => raceMapTheme(mapMode, wallColor),
    [mapMode, wallColor],
  );
  const stableLeadChanges = useMemo(
    () =>
      findStableLeadChanges(plan.simulation.frames, {
        targetFinishCount: plan.simulation.resultGateCount,
      }),
    [
      plan.simulation.frames,
      plan.simulation.resultGateCount,
    ],
  );
  const activeLeadChange = [...stableLeadChanges]
    .reverse()
    .find(
      (change) =>
        frameIndex >= change.frameIndex &&
        frameIndex <= change.frameIndex + 30,
    );
  const highlightedOvertakeSlotId =
    finalOvertake?.toSlotId ?? activeLeadChange?.toSlotId;
  const closeRace =
    frame && frame.finishedSlotIds.length === 0
      ? isCloseRace(frame)
      : Boolean(
          focusLeaderPose &&
            activeRunnerUpPose &&
            focusLeaderPose.y - activeRunnerUpPose.y <=
              MARBLE_RADIUS * 2,
        );
  const finalApproach =
    frame && frame.finishedSlotIds.length === 0
      ? isFinalApproach(frame)
      : Boolean(
          focusLeaderPose &&
            frame &&
            frame.finishedSlotIds.length <
              plan.simulation.resultGateCount &&
            focusLeaderPose.y / FINISH_Y >= 0.88,
        );
  const candidateById = useMemo(
    () => new Map(plan.candidates.map((candidate) => [candidate.id, candidate])),
    [plan.candidates],
  );

  const leaderSlotId = focusLeaderSlotId;
  const leaderCandidate = leaderSlotId
    ? candidateById.get(plan.slotToCandidateId[leaderSlotId])
    : undefined;
  const finalOvertakeCandidate = finalOvertake
    ? candidateById.get(
        plan.slotToCandidateId[finalOvertake.toSlotId],
      )
    : undefined;
  const cinematicSlotId = finalOvertake?.toSlotId;
  const cinematicIntensity =
    !reducedMotion && finalOvertake
      ? overtakeZoomIntensity(finalOvertake.progress)
      : 0;
  const cinematicScale = 1 + cinematicIntensity;
  const cinematicPose = frame?.poses.find(
    (pose) => pose.slotId === cinematicSlotId,
  );
  const cinematicOrigin = cinematicPose
    ? `${clampPercent(
        (cinematicPose.x / WORLD_WIDTH) * 100,
      ).toFixed(2)}% 42%`
    : "50% 42%";

  useEffect(() => {
    leaderFocusRef.current = { ...INITIAL_LEADER_FOCUS_STATE };
    verticalCameraRef.current = { ...INITIAL_VERTICAL_CAMERA_STATE };
    verticalCameraFrameRef.current = null;
  }, [plan.runId, playbackEpoch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.floor(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.floor(rect.height * dpr));
    const cssWidth = `${rect.width}px`;
    const cssHeight = `${rect.height}px`;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const logicalWidth = rect.width;
    const logicalHeight = rect.height;
    const viewHeight = VIEW_HEIGHT;
    const scale = Math.min(
      logicalWidth / WORLD_WIDTH,
      logicalHeight / viewHeight,
    );
    const offsetX = (logicalWidth - WORLD_WIDTH * scale) / 2;
    const offsetY = (logicalHeight - viewHeight * scale) / 2;
    leaderFocusRef.current = resolveLeaderFocus(
      leaderFocusRef.current,
      focusLeaderSlotId,
      frameIndex,
    );
    const focusedPose = frame.poses.find(
      (pose) =>
        pose.slotId === leaderFocusRef.current.focusedSlotId,
    );
    const currentLeaderPose = frame.poses.find(
      (pose) => pose.slotId === focusLeaderSlotId,
    );
    const focusY = focusedPose?.y ?? currentLeaderPose?.y ?? 0;
    const targetCameraY = Math.max(
      0,
      Math.min(
        WORLD_HEIGHT - viewHeight,
        focusY - viewHeight * 0.42,
      ),
    );
    const previousCameraFrame = verticalCameraFrameRef.current;
    const cameraFrameDelta =
      previousCameraFrame === null
        ? 1
        : Math.max(0, frameIndex - previousCameraFrame);
    verticalCameraFrameRef.current = frameIndex;
    verticalCameraRef.current = advanceVerticalCamera(
      verticalCameraRef.current,
      targetCameraY,
      WORLD_HEIGHT - viewHeight,
      reducedMotion,
      cameraFrameDelta,
    );
    const cameraY = verticalCameraRef.current.positionY;

    const background = context.createLinearGradient(
      0,
      0,
      0,
      logicalHeight,
    );
    background.addColorStop(0, theme.track);
    background.addColorStop(1, theme.background);
    context.fillStyle = background;
    context.fillRect(0, 0, logicalWidth, logicalHeight);

    const sectionTints = COURSE_SECTIONS.map((_, index) =>
      colorWithAlpha(
        obstacleColor(index),
        mapMode === "light" ? 0.09 : 0.055,
      ),
    );
    COURSE_SECTIONS.forEach((section, index) => {
      const top = offsetY + (section.startY - cameraY) * scale;
      const bottom = offsetY + (section.endY - cameraY) * scale;
      const visibleTop = Math.max(0, top);
      const visibleBottom = Math.min(logicalHeight, bottom);
      if (visibleBottom > visibleTop) {
        context.fillStyle = sectionTints[index];
        context.fillRect(
          offsetX,
          visibleTop,
          WORLD_WIDTH * scale,
          visibleBottom - visibleTop,
        );
      }
      if (index === 0 || top < -18 || top > logicalHeight + 18) return;
      context.save();
      context.strokeStyle = colorWithAlpha(theme.text, 0.38);
      context.setLineDash([9 * scale, 8 * scale]);
      context.beginPath();
      context.moveTo(offsetX + 86 * scale, top);
      context.lineTo(offsetX + (WORLD_WIDTH - 86) * scale, top);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = colorWithAlpha(theme.text, 0.82);
      context.font = `800 ${Math.max(10, 13 * scale)}px Inter, Pretendard, system-ui, sans-serif`;
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillText(
        `${index * 25}% · ${section.label}`,
        offsetX + 92 * scale,
        top - 7,
      );
      context.restore();
    });

    context.save();
    context.globalAlpha = 0.22;
    context.strokeStyle = theme.grid;
    context.lineWidth = 1;
    for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
      const screenY = offsetY + (y - cameraY) * scale;
      if (screenY < 0 || screenY > logicalHeight) continue;
      context.beginPath();
      context.moveTo(offsetX + 82 * scale, screenY);
      context.lineTo(offsetX + (WORLD_WIDTH - 82) * scale, screenY);
      context.stroke();
    }
    context.restore();

    COURSE_RECTS.forEach((shape) => {
      const isSemanticObstacle =
        shape.material === "elastic" || Boolean(shape.obstacleKind);
      context.fillStyle =
        shape.material === "elastic"
          ? obstacleRoleColor("elastic-wall")
          : shape.obstacleKind
            ? obstacleRoleColor("guide")
            : theme.wall;
      if (isSemanticObstacle) {
        context.strokeStyle = theme.outline;
        context.lineWidth = Math.max(1.5, 2.5 * scale);
      }
      roundedRect(
        context,
        shape,
        scale,
        offsetX,
        offsetY,
        cameraY,
        8,
        isSemanticObstacle,
      );
    });

    context.save();
    context.strokeStyle = theme.wall;
    context.lineCap = "round";
    context.lineJoin = "round";
    COURSE_CURVES.forEach((curve) => {
      context.beginPath();
      curve.points.forEach((point, index) => {
        const x = offsetX + point.x * scale;
        const y = offsetY + (point.y - cameraY) * scale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = curve.thickness * scale;
      context.stroke();
    });
    context.restore();

    context.fillStyle = obstacleRoleColor("pin");
    context.strokeStyle = theme.outline;
    context.lineWidth = Math.max(1.5, 2.5 * scale);
    COURSE_PINS.forEach(({ x, y, radius }) => {
      context.beginPath();
      context.arc(
        offsetX + x * scale,
        offsetY + (y - cameraY) * scale,
        radius * scale,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.stroke();
    });

    COURSE_BUMPERS.forEach((bumper, index) => {
      const y = offsetY + (bumper.y - cameraY) * scale;
      const extent = Math.max(bumper.width, bumper.height) * scale;
      if (y < -extent || y > logicalHeight + extent) {
        return;
      }
      const flash = frame.bumperFlashes?.[index];
      if (flash?.level > 0) {
        drawBumperFlash(
          context,
          offsetX + flash.x * scale,
          offsetY + (flash.y - cameraY) * scale,
          flash.level,
          scale,
          reducedMotion,
          index * 0.37 + frameIndex * 0.08,
          obstacleRoleColor("bumper"),
          theme,
        );
      }
      drawBumper(
        context,
        bumper,
        scale,
        offsetX,
        offsetY,
        cameraY,
        obstacleRoleColor("bumper"),
        theme,
      );
    });

    context.fillStyle = obstacleRoleColor("spinner");
    context.strokeStyle = theme.outline;
    context.lineWidth = Math.max(1.5, 2.5 * scale);
    ROTATING_BARS.forEach((bar, index) => {
      roundedRect(
        context,
        {
          x: bar.x,
          y: bar.y,
          width: bar.width,
          height: bar.height,
          angle: frame.rotatingBarAngles[index] ?? bar.baseAngle,
        },
        scale,
        offsetX,
        offsetY,
        cameraY,
        12,
        true,
      );
    });

    const finishScreenY = offsetY + (FINISH_Y - cameraY) * scale;
    if (finishScreenY > -20 && finishScreenY < logicalHeight + 20) {
      const startX = offsetX + FINISH_LINE_X * scale;
      const columnCount = 8;
      const cell = (FINISH_LINE_WIDTH / columnCount) * scale;
      context.save();
      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < columnCount; column += 1) {
          context.fillStyle =
            (row + column) % 2 === 0
              ? theme.finishAlternate
              : theme.finish;
          context.fillRect(
            startX + column * cell,
            finishScreenY + row * cell,
            cell,
            cell,
          );
        }
      }
      context.restore();
    }

    const previousPoseBySlot = new Map(
      previousFrame?.poses.map((pose) => [pose.slotId, pose]) ?? [],
    );
    if (!reducedMotion) {
      frame.poses.forEach((pose) => {
        const previousPose = previousPoseBySlot.get(pose.slotId);
        const candidate = candidateById.get(
          plan.slotToCandidateId[pose.slotId],
        );
        if (!previousPose || !candidate) return;
        const deltaX = pose.x - previousPose.x;
        const deltaY = pose.y - previousPose.y;
        const speed = Math.hypot(deltaX, deltaY);
        if (speed < 5) return;
        const lengthScale = Math.min(2.8, 34 / Math.max(1, speed * scale));
        const x = offsetX + pose.x * scale;
        const y = offsetY + (pose.y - cameraY) * scale;
        context.save();
        context.strokeStyle = colorWithAlpha(candidate.theme.primary, 0.34);
        context.lineCap = "round";
        context.lineWidth = Math.max(2, MARBLE_RADIUS * scale * 0.48);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(
          x - deltaX * scale * lengthScale,
          y - deltaY * scale * lengthScale,
        );
        context.stroke();
        context.restore();
      });
    }

    const topSlots = new Set(
      (activeRankedSlotIds.length > 0
        ? activeRankedSlotIds
        : frame.rankedSlotIds
      ).slice(0, 3),
    );
    const closeRaceSlots = new Set(
      closeRace
        ? (activeRankedSlotIds.length > 0
            ? activeRankedSlotIds
            : frame.rankedSlotIds
          ).slice(0, 2)
        : [],
    );
    frame.poses.forEach((pose) => {
      const candidateId = plan.slotToCandidateId[pose.slotId];
      const candidate = candidateById.get(candidateId);
      if (!candidate) return;
      const x = offsetX + pose.x * scale;
      const y = offsetY + (pose.y - cameraY) * scale;
      if (y < -60 || y > logicalHeight + 60) return;

      context.save();
      context.translate(x, y);
      context.rotate(pose.angle);
      context.shadowColor = theme.shadow;
      context.shadowBlur = 9 * scale;
      context.fillStyle = candidate.theme.primary;
      context.beginPath();
      context.arc(0, 0, MARBLE_RADIUS * scale, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = closeRaceSlots.has(pose.slotId)
        ? theme.highlight
        : theme.outline;
      context.lineWidth = Math.max(
        1.5,
        (closeRaceSlots.has(pose.slotId) ? 4 : 2.5) * scale,
      );
      context.stroke();
      context.fillStyle = candidate.theme.onPrimary;
      context.font = `900 ${Math.max(9, 12 * scale)}px Inter, Pretendard, system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(candidate.number), 0, 0);
      context.restore();

      if (topSlots.has(pose.slotId) && scale > 0.55) {
        const label = shortName(candidate.name, 7);
        context.font = `700 ${Math.max(11, 13 * scale)}px Inter, Pretendard, system-ui, sans-serif`;
        const width = context.measureText(label).width + 16;
        context.fillStyle = theme.label;
        context.beginPath();
        context.roundRect(
          x - width / 2,
          y - MARBLE_RADIUS * scale - 29,
          width,
          22,
          7,
        );
        context.fill();
        context.fillStyle = theme.labelText;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, x, y - MARBLE_RADIUS * scale - 18);
      }

      if (
        highlightedOvertakeSlotId === pose.slotId &&
        !reducedMotion &&
        scale > 0.5
      ) {
        context.save();
        context.fillStyle = theme.highlight;
        context.font = `900 ${Math.max(12, 15 * scale)}px Inter, Pretendard, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("↑", x, y + MARBLE_RADIUS * scale + 18);
        context.restore();
      }
    });

    const viewportTopY = cameraY - offsetY / scale;
    const viewportBottomY =
      cameraY + (logicalHeight - offsetY) / scale;
    const offscreenPodiumIndicators =
      resolveOffscreenPodiumIndicators(
        frame,
        viewportTopY,
        viewportBottomY,
        reducedMotion,
      );
    const indicatorLayouts = offscreenPodiumIndicators
      .map((indicator) => {
        const candidate = candidateById.get(
          plan.slotToCandidateId[indicator.slotId],
        );
        if (!candidate) return null;
        const label = `${indicator.rank}위 ${shortName(candidate.name, 7)} ↑`;
        const fontSize = 12 * indicator.emphasisScale;
        context.font = `850 ${fontSize}px Inter, Pretendard, system-ui, sans-serif`;
        const width = context.measureText(label).width + 22;
        return {
          ...indicator,
          candidate,
          label,
          fontSize,
          width,
          centerX: Math.max(
            offsetX + width / 2 + 8,
            Math.min(
              offsetX + WORLD_WIDTH * scale - width / 2 - 8,
              offsetX + indicator.x * scale,
            ),
          ),
        };
      })
      .filter((layout) => layout !== null)
      .sort((left, right) => left.centerX - right.centerX);

    if (indicatorLayouts.length === 2) {
      const [left, right] = indicatorLayouts;
      const minimumCenterGap =
        left.width / 2 + right.width / 2 + 8;
      if (right.centerX - left.centerX < minimumCenterGap) {
        const midpoint = (left.centerX + right.centerX) / 2;
        left.centerX = midpoint - minimumCenterGap / 2;
        right.centerX = midpoint + minimumCenterGap / 2;
      }
      const leftEdge = offsetX + 8;
      const rightEdge = offsetX + WORLD_WIDTH * scale - 8;
      if (left.centerX - left.width / 2 < leftEdge) {
        const shift =
          leftEdge - (left.centerX - left.width / 2);
        left.centerX += shift;
        right.centerX += shift;
      }
      if (right.centerX + right.width / 2 > rightEdge) {
        const shift =
          right.centerX + right.width / 2 - rightEdge;
        left.centerX -= shift;
        right.centerX -= shift;
      }
    }

    indicatorLayouts.forEach((indicator) => {
      const height = 25 * indicator.emphasisScale;
      const centerY = 10 + height / 2;
      context.save();
      context.globalAlpha = 0.76 + indicator.proximity * 0.24;
      context.shadowColor = colorWithAlpha(
        indicator.candidate.theme.primary,
        0.3 + indicator.proximity * 0.42,
      );
      context.shadowBlur = reducedMotion
        ? 0
        : 4 + indicator.proximity * 10;
      context.fillStyle = theme.label;
      context.strokeStyle = indicator.candidate.theme.primary;
      context.lineWidth = Math.max(
        2,
        2.5 * indicator.emphasisScale,
      );
      context.beginPath();
      context.roundRect(
        indicator.centerX - indicator.width / 2,
        centerY - height / 2,
        indicator.width,
        height,
        height / 2,
      );
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = theme.labelText;
      context.font = `850 ${indicator.fontSize}px Inter, Pretendard, system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        indicator.label,
        indicator.centerX,
        centerY + 0.5,
      );
      context.restore();
    });

    if (finalApproach) {
      context.save();
      context.strokeStyle = colorWithAlpha(theme.highlight, 0.72);
      context.lineWidth = Math.max(2, 4 * scale);
      context.strokeRect(
        offsetX + 2 * scale,
        2 * scale,
        WORLD_WIDTH * scale - 4 * scale,
        logicalHeight - 4 * scale,
      );
      context.restore();
    }

    if (finishScreenY > -20 && finishScreenY < logicalHeight + 20) {
      drawFinishFlag(
        context,
        offsetX + FINISH_LINE_X * scale,
        FINISH_LINE_WIDTH * scale,
        finishScreenY,
        scale,
        logicalWidth,
        theme,
      );
    }
  }, [
    activeLeadChange,
    activeRankedSlotIds,
    candidateById,
    closeRace,
    finalApproach,
    frame,
    frameIndex,
    focusLeaderSlotId,
    highlightedOvertakeSlotId,
    mapMode,
    plan.slotToCandidateId,
    previousFrame,
    reducedMotion,
    theme,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-render-frame={frameIndex.toFixed(3)}
      className={[
        "race-canvas",
        finalApproach ? "is-final-approach" : "",
        finalOvertake ? "is-final-overtake" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        cinematicIntensity > 0
          ? {
              transform: `scale(${cinematicScale.toFixed(4)})`,
              transformOrigin: cinematicOrigin,
            }
          : undefined
      }
      role="img"
      aria-label={
        finalOvertakeCandidate
          ? finalOvertake?.hasOvertaken
            ? `Showdown 경기장. 마지막 구간에서 ${finalOvertakeCandidate.name} 참가자가 선두를 추월했습니다.`
            : `Showdown 경기장. 마지막 구간에서 ${finalOvertakeCandidate.name} 참가자가 선두 추월을 시도하고 있습니다.`
          : `Showdown 경기장. 현재 선두는 ${leaderCandidate?.name ?? "확인 중"}입니다.`
      }
    />
  );
}
