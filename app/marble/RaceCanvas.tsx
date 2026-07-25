"use client";

import { useEffect, useMemo, useRef } from "react";
import { shortName } from "./core";
import {
  COURSE_CURVES,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_LINE_WIDTH,
  FINISH_LINE_X,
  FINISH_Y,
  MARBLE_RADIUS,
  ROTATING_BARS,
  VIEW_HEIGHT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./course";
import type { CourseRect } from "./course";
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

export function RaceCanvas({
  plan,
  frameIndex,
  reducedMotion,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraYRef = useRef(0);
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
    const leadingPoses = frame.rankedSlotIds
      .slice(0, 3)
      .map((slotId) => frame.poses.find((pose) => pose.slotId === slotId))
      .filter((pose) => pose !== undefined);
    const focusY =
      leadingPoses.length > 0
        ? leadingPoses.reduce((sum, pose) => sum + pose.y, 0) /
          leadingPoses.length
        : 0;
    const targetCameraY = Math.max(
      0,
      Math.min(
        WORLD_HEIGHT - viewHeight,
        focusY - viewHeight * 0.42,
      ),
    );
    cameraYRef.current = reducedMotion
      ? targetCameraY
      : cameraYRef.current + (targetCameraY - cameraYRef.current) * 0.14;
    const cameraY = cameraYRef.current;

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
      context.fillStyle = candidate.color;
      context.beginPath();
      context.arc(0, 0, MARBLE_RADIUS * scale, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "#fff8ef";
      context.lineWidth = Math.max(1.5, 2.5 * scale);
      context.stroke();
      context.fillStyle = "#351923";
      context.font = `900 ${Math.max(9, 12 * scale)}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(candidate.number), 0, 0);
      context.restore();

      if (topSlots.has(pose.slotId) && scale > 0.55) {
        const label = shortName(candidate.name, 7);
        context.font = `700 ${Math.max(11, 13 * scale)}px system-ui`;
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
  }, [candidateById, frame, plan.slotToCandidateId, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="race-canvas"
      role="img"
      aria-label={`레또 드롭 경기장. 현재 선두는 ${leaderCandidate?.name ?? "확인 중"}입니다.`}
    />
  );
}
