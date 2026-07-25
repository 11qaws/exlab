import Matter from "matter-js";
import type { IChamferableBodyDefinition } from "matter-js";
import { createPrng } from "./core";
import { assertCourseClearance } from "./course-clearance";
import { createRaceDynamics } from "./dynamics";
import {
  COURSE_CURVE_RECTS,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_Y,
  MARBLE_RADIUS,
  MAX_SIMULATION_SECONDS,
  ROTATING_BARS,
  WORLD_WIDTH,
} from "./course";
import type {
  MarblePose,
  RaceDynamics,
  RaceFrame,
  RaceSimulation,
} from "./types";

const { Bodies, Body, Composite, Engine } = Matter;

export const FRAME_RATE = 30;

const obstacleOptions = (
  restitution: number,
): IChamferableBodyDefinition => ({
  isStatic: true,
  friction: 0.02,
  restitution,
  render: { visible: false },
});

const INITIAL_GRAVITY_BY_PARTICIPANT_COUNT: Record<number, number> = {
  2: 1.08,
  3: 1.02,
  4: 0.96,
  5: 0.9,
  6: 0.86,
  7: 0.83,
  8: 0.79,
  9: 0.76,
  10: 0.72,
};

function addCourse(
  engine: Matter.Engine,
  dynamics: RaceDynamics,
): Matter.Body[] {
  assertCourseClearance();
  const staticBodies = [
    ...[...COURSE_RECTS, ...COURSE_CURVE_RECTS].map((shape) =>
      Bodies.rectangle(shape.x, shape.y, shape.width, shape.height, {
        ...obstacleOptions(dynamics.obstacleRestitution),
        angle: shape.angle ?? 0,
        chamfer: {
          radius: Math.min(
            shape.role === "gate" ? 9 : 12,
            shape.width / 2,
            shape.height / 2,
          ),
        },
      }),
    ),
    ...COURSE_PINS.map((pin) =>
      Bodies.circle(
        pin.x,
        pin.y,
        pin.radius,
        obstacleOptions(dynamics.pinRestitution),
      ),
    ),
  ];
  const rotatingBodies = ROTATING_BARS.map((bar, index) =>
    Bodies.rectangle(bar.x, bar.y, bar.width, bar.height, {
      ...obstacleOptions(dynamics.obstacleRestitution),
      chamfer: { radius: 12 },
      label: `rotating-bar-${index + 1}`,
    }),
  );
  Composite.add(engine.world, [...staticBodies, ...rotatingBodies]);
  return rotatingBodies;
}

function addMarbles(
  engine: Matter.Engine,
  count: number,
  layoutSeed: string,
  restitution: number,
): { marbles: Matter.Body[]; layoutShift: number } {
  const random = createPrng(layoutSeed);
  const maxShift = count >= 9 ? 18 : 52;
  const layoutShift = Math.round((random() * 2 - 1) * maxShift);
  const usableWidth = Math.min(650, Math.max(220, (count - 1) * 72));
  const startX = WORLD_WIDTH / 2 - usableWidth / 2 + layoutShift;
  const spacing = count === 1 ? 0 : usableWidth / (count - 1);

  const marbles = Array.from({ length: count }, (_, index) => {
    const x = startX + index * spacing;
    const marble = Bodies.circle(x, 145, MARBLE_RADIUS, {
      friction: 0.012,
      frictionAir: 0.0015,
      frictionStatic: 0,
      restitution,
      density: 0.001,
      label: `slot-${index + 1}`,
      slop: 0.02,
      render: { visible: false },
    });
    Body.setVelocity(marble, { x: 0, y: 0 });
    return marble;
  });

  Composite.add(engine.world, marbles);
  return { marbles, layoutShift };
}

function rankMarbles(
  marbles: Matter.Body[],
  finishedSlotIds: string[],
): string[] {
  const finishIndex = new Map(
    finishedSlotIds.map((slotId, index) => [slotId, index]),
  );
  return [...marbles]
    .sort((left, right) => {
      const leftFinish = finishIndex.get(left.label);
      const rightFinish = finishIndex.get(right.label);
      if (leftFinish !== undefined || rightFinish !== undefined) {
        if (leftFinish === undefined) return 1;
        if (rightFinish === undefined) return -1;
        return leftFinish - rightFinish;
      }
      if (Math.abs(right.position.y - left.position.y) > 0.1) {
        return right.position.y - left.position.y;
      }
      return Math.abs(left.position.x - WORLD_WIDTH / 2) -
        Math.abs(right.position.x - WORLD_WIDTH / 2);
    })
    .map((marble) => marble.label);
}

function captureFrame(
  marbles: Matter.Body[],
  finishedSlotIds: string[],
  rotatingBarAngles: number[],
): RaceFrame {
  const poses: MarblePose[] = marbles.map((marble) => ({
    slotId: marble.label,
    x: marble.position.x,
    y: marble.position.y,
    angle: marble.angle,
  }));
  return {
    poses,
    rankedSlotIds: rankMarbles(marbles, finishedSlotIds),
    finishedSlotIds: [...finishedSlotIds],
    rotatingBarAngles,
  };
}

export function simulateRace(
  participantCount: number,
  raceSeed: string,
  layoutSeed: string,
): RaceSimulation {
  if (participantCount < 2 || participantCount > 10) {
    throw new Error("물리 경기는 2명 이상 10명 이하만 실행할 수 있습니다.");
  }

  const random = createPrng(raceSeed);
  const dynamics = createRaceDynamics(raceSeed);
  const baseGravityY = INITIAL_GRAVITY_BY_PARTICIPANT_COUNT[participantCount];
  const engine = Engine.create({
    gravity: {
      x: 0,
      y: baseGravityY * dynamics.gravityScale,
      scale: 0.001,
    },
    enableSleeping: false,
  });
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 2;

  const rotatingBars = addCourse(engine, dynamics);
  const { marbles, layoutShift } = addMarbles(
    engine,
    participantCount,
    layoutSeed,
    dynamics.marbleRestitution,
  );

  marbles.forEach((marble) => {
    Body.applyForce(marble, marble.position, {
      x: (random() - 0.5) * 0.000001,
      y: 0,
    });
  });

  const frames: RaceFrame[] = [];
  const finishedSlotIds: string[] = [];
  const finished = new Set<string>();
  const stepMs = 1000 / 60;
  const maxSteps = 60 * MAX_SIMULATION_SECONDS;
  let winnerFrameIndex = -1;
  let step = 0;

  for (; step < maxSteps; step += 1) {
    const rotatingBarAngles = rotatingBars.map((body, index) => {
      const definition = dynamics.rotatingBars[index];
      const angle =
        definition.baseAngle + step * definition.angularSpeed;
      Body.setAngle(body, angle);
      Body.setAngularVelocity(
        body,
        definition.angularSpeed,
      );
      return angle;
    });

    engine.gravity.x =
      dynamics.windPulses.find(
        (pulse) => step >= pulse.startStep && step < pulse.endStep,
      )?.gravityX ?? 0;
    if (step === 1500) {
      engine.gravity.y = 1.85;
    }
    if (step === 2700) {
      engine.gravity.y = 2.2;
    }
    if (step === 3900) {
      engine.gravity.y = 2.8;
    }

    for (const marble of marbles) {
      const forceZone = dynamics.forceZones.find(
        (zone) =>
          marble.position.y >= zone.startY &&
          marble.position.y < zone.endY,
      );
      if (forceZone) {
        Body.applyForce(marble, marble.position, {
          x: forceZone.forceX,
          y: forceZone.forceY,
        });
      }
    }

    Engine.update(engine, stepMs);

    marbles.forEach((marble) => {
      if (!finished.has(marble.label) && marble.position.y >= FINISH_Y) {
        finished.add(marble.label);
        finishedSlotIds.push(marble.label);
      }
    });

    if (step % 2 === 0) {
      frames.push(
        captureFrame(marbles, finishedSlotIds, rotatingBarAngles),
      );
      if (winnerFrameIndex < 0 && finishedSlotIds.length > 0) {
        winnerFrameIndex = frames.length - 1;
      }
    }

    if (finishedSlotIds.length === participantCount) {
      break;
    }
  }

  const fullFinishOrder = rankMarbles(marbles, finishedSlotIds);
  const visibleTailFrames = Math.round(FRAME_RATE * 1.2);
  const safeWinnerFrame =
    winnerFrameIndex >= 0
      ? winnerFrameIndex
      : Math.max(0, frames.length - visibleTailFrames - 1);
  const visibleFrames = frames.slice(
    0,
    Math.min(frames.length, safeWinnerFrame + visibleTailFrames),
  );

  return {
    frames: visibleFrames,
    fullFinishOrder,
    winnerFrameIndex: safeWinnerFrame,
    durationMs: Math.round((visibleFrames.length / FRAME_RATE) * 1000),
    layoutShift,
    simulationSteps: step + 1,
    physicallyFinishedCount: finishedSlotIds.length,
    timedOut: finishedSlotIds.length !== participantCount,
    dynamics,
  };
}
