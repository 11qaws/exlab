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
import type { RacePlan } from "./types";

type RaceCanvasProps = {
  plan: RacePlan;
  frameIndex: number;
  reducedMotion: boolean;
};

function roundedRect(
  context: CanvasRenderingContext2D,
  shape: CourseRect,
  scale: number,
  offsetX: number,
  offsetY: number,
  cameraY: number,
  radius = 8,
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
  context.restore();
}

function drawBumper(
  context: CanvasRenderingContext2D,
  bumper: CourseBumper,
  scale: number,
  offsetX: number,
  offsetY: number,
  cameraY: number,
) {
  const x = offsetX + bumper.x * scale;
  const y = offsetY + (bumper.y - cameraY) * scale;
  context.save();
  context.translate(x, y);
  context.rotate(bumper.angle);
  context.shadowColor =
    bumper.kind === "finish-launch"
      ? "rgba(255, 173, 74, 0.72)"
      : "rgba(232, 79, 131, 0.68)";
  context.shadowBlur = 14 * scale;
  context.fillStyle =
    bumper.kind === "finish-launch" ? "#ffad4a" : "#e84f83";
  context.strokeStyle = "#fff8ef";
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
  context.fillStyle =
    bumper.kind === "finish-launch" ? "#fff0c7" : "#ffd0df";
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
) {
  if (level <= 0) return;
  const progress = 1 - level;
  const radius = (18 + progress * 42) * scale;
  context.save();
  context.translate(x, y);
  context.globalAlpha = Math.min(1, level * 1.35);
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  glow.addColorStop(0.28, "rgba(255, 226, 133, 0.72)");
  glow.addColorStop(1, "rgba(255, 173, 74, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#fff8ef";
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

export function RaceCanvas({
  plan,
  frameIndex,
  reducedMotion,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leaderFocusRef = useRef<LeaderFocusState>({
    ...INITIAL_LEADER_FOCUS_STATE,
  });
  const verticalCameraRef = useRef<VerticalCameraState>({
    ...INITIAL_VERTICAL_CAMERA_STATE,
  });
  const frame =
    plan.simulation.frames[
      Math.min(frameIndex, plan.simulation.frames.length - 1)
    ];
  const candidateById = useMemo(
    () => new Map(plan.candidates.map((candidate) => [candidate.id, candidate])),
    [plan.candidates],
  );

  const leaderCandidate = candidateById.get(
    plan.slotToCandidateId[frame.rankedSlotIds[0]],
  );

  useEffect(() => {
    leaderFocusRef.current = { ...INITIAL_LEADER_FOCUS_STATE };
    verticalCameraRef.current = { ...INITIAL_VERTICAL_CAMERA_STATE };
  }, [plan.runId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
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
      frame.rankedSlotIds[0],
      frameIndex,
    );
    const focusedPose = frame.poses.find(
      (pose) =>
        pose.slotId === leaderFocusRef.current.focusedSlotId,
    );
    const currentLeaderPose = frame.poses.find(
      (pose) => pose.slotId === frame.rankedSlotIds[0],
    );
    const focusY = focusedPose?.y ?? currentLeaderPose?.y ?? 0;
    const targetCameraY = Math.max(
      0,
      Math.min(
        WORLD_HEIGHT - viewHeight,
        focusY - viewHeight * 0.42,
      ),
    );
    verticalCameraRef.current = advanceVerticalCamera(
      verticalCameraRef.current,
      targetCameraY,
      WORLD_HEIGHT - viewHeight,
      reducedMotion,
    );
    const cameraY = verticalCameraRef.current.positionY;

    const background = context.createLinearGradient(
      0,
      0,
      0,
      logicalHeight,
    );
    background.addColorStop(0, "#2a1420");
    background.addColorStop(1, "#160d14");
    context.fillStyle = background;
    context.fillRect(0, 0, logicalWidth, logicalHeight);

    const sectionTints = [
      "rgba(255, 111, 159, 0.035)",
      "rgba(255, 173, 74, 0.045)",
      "rgba(89, 201, 179, 0.04)",
      "rgba(165, 119, 255, 0.04)",
    ];
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
      context.strokeStyle = "rgba(255, 248, 239, 0.38)";
      context.setLineDash([9 * scale, 8 * scale]);
      context.beginPath();
      context.moveTo(offsetX + 86 * scale, top);
      context.lineTo(offsetX + (WORLD_WIDTH - 86) * scale, top);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "rgba(255, 248, 239, 0.8)";
      context.font = `800 ${Math.max(10, 13 * scale)}px Pretendard, system-ui`;
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
    context.strokeStyle = "#7d5361";
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

    context.fillStyle = "#5d3342";
    COURSE_RECTS.forEach((shape) => {
      roundedRect(context, shape, scale, offsetX, offsetY, cameraY);
    });

    context.save();
    context.strokeStyle = "#6f4051";
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

    context.fillStyle = "#825163";
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
    });

    COURSE_BUMPERS.forEach((bumper, index) => {
      const y = offsetY + (bumper.y - cameraY) * scale;
      const extent = Math.max(bumper.width, bumper.height) * scale;
      if (y < -extent || y > logicalHeight + extent) {
        return;
      }
      const flash = frame.bumperFlashes[index];
      if (flash?.level > 0) {
        drawBumperFlash(
          context,
          offsetX + flash.x * scale,
          offsetY + (flash.y - cameraY) * scale,
          flash.level,
          scale,
          reducedMotion,
          index * 0.37 + frameIndex * 0.08,
        );
      }
      drawBumper(context, bumper, scale, offsetX, offsetY, cameraY);
    });

    context.fillStyle = "#f1b3c6";
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
            (row + column) % 2 === 0 ? "#fff8ef" : "#ff6f9f";
          context.fillRect(
            startX + column * cell,
            finishScreenY + row * cell,
            cell,
            cell,
          );
        }
      }
      context.fillStyle = "#fff8ef";
      context.font = `800 ${Math.max(11, 17 * scale)}px system-ui`;
      context.fillText(
        "FINISH",
        startX,
        finishScreenY - Math.max(8, 12 * scale),
      );
      context.restore();
    }

    const topSlots = new Set(frame.rankedSlotIds.slice(0, 3));
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
      context.shadowColor = "rgba(0, 0, 0, 0.35)";
      context.shadowBlur = 9 * scale;
      context.fillStyle = candidate.theme.primary;
      context.beginPath();
      context.arc(0, 0, MARBLE_RADIUS * scale, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "#fff8ef";
      context.lineWidth = Math.max(1.5, 2.5 * scale);
      context.stroke();
      context.fillStyle = candidate.theme.onPrimary;
      context.font = `900 ${Math.max(9, 12 * scale)}px Pretendard, system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(candidate.number), 0, 0);
      context.restore();

      if (topSlots.has(pose.slotId) && scale > 0.55) {
        const label = shortName(candidate.name, 7);
        context.font = `700 ${Math.max(11, 13 * scale)}px Pretendard, system-ui`;
        const width = context.measureText(label).width + 16;
        context.fillStyle = "rgba(31, 17, 24, 0.88)";
        context.beginPath();
        context.roundRect(
          x - width / 2,
          y - MARBLE_RADIUS * scale - 29,
          width,
          22,
          7,
        );
        context.fill();
        context.fillStyle = "#fff8ef";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, x, y - MARBLE_RADIUS * scale - 18);
      }
    });
  }, [
    candidateById,
    frame,
    frameIndex,
    plan.slotToCandidateId,
    reducedMotion,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="race-canvas"
      role="img"
      aria-label={`Race 경기장. 현재 선두는 ${leaderCandidate?.name ?? "확인 중"}입니다.`}
    />
  );
}
