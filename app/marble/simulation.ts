import Matter from "matter-js";
import type { IChamferableBodyDefinition } from "matter-js";
import { createPrng } from "./core";
import { assertCourseClearance } from "./course-clearance";
import { createRaceDynamics } from "./dynamics";
import {
  COURSE_CURVE_RECTS,
  COURSE_BUMPERS,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_Y,
  MARBLE_RADIUS,
  MAX_SIMULATION_SECONDS,
  ROTATING_BARS,
  scaleCourseY,
  WORLD_WIDTH,
} from "./course";
import type {
  BumperFlash,
  MarblePose,
  RaceDynamics,
  RaceFrame,
  RaceSimulation,
} from "./types";

const { Bodies, Body, Composite, Engine, Events } = Matter;

export const FRAME_RATE = 30;
export const PHYSICS_SUBSTEPS = 2;
export const RESULT_REVEAL_DELAY_FRAMES = Math.round(FRAME_RATE * 1.2);
export const BUMPER_FLASH_DECAY = 0.68;
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

export function sharedGravityMultiplier(
  elapsedSeconds: number,
): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 40) {
    return 1;
  }
  if (elapsedSeconds <= 55) {
    return 1 + ((elapsedSeconds - 40) / 15) * 1.4;
  }
  if (elapsedSeconds <= 75) {
    return 2.4 + ((elapsedSeconds - 55) / 20) * 1.6;
  }
  if (elapsedSeconds <= 95) {
    return 4 + ((elapsedSeconds - 75) / 20) * 2;
  }
  return 6;
}

function addCourse(
  engine: Matter.Engine,
  dynamics: RaceDynamics,
): {
  rotatingBodies: Matter.Body[];
  bumperBodies: Matter.Body[];
} {
  assertCourseClearance();
  const staticBodies = [
    ...[...COURSE_RECTS, ...COURSE_CURVE_RECTS].map((shape) =>
      Bodies.rectangle(shape.x, shape.y, shape.width, shape.height, {
        ...obstacleOptions(
          shape.material === "elastic"
            ? dynamics.bumperRestitution
            : dynamics.obstacleRestitution,
        ),
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
      ...obstacleOptions(dynamics.spinnerRestitution),
      chamfer: { radius: 12 },
      label: `rotating-bar-${index + 1}`,
    }),
  );
  const bumperBodies = COURSE_BUMPERS.map((bumper, index) =>
    Bodies.rectangle(bumper.x, bumper.y, bumper.width, bumper.height, {
      ...obstacleOptions(dynamics.bumperRestitution),
      angle: bumper.angle,
      chamfer: { radius: bumper.height / 2 },
      label: `active-bumper-${index}`,
    }),
  );
  Composite.add(engine.world, [
    ...staticBodies,
    ...bumperBodies,
    ...rotatingBodies,
  ]);
  return { rotatingBodies, bumperBodies };
}

function registerBumperContacts(
  engine: Matter.Engine,
  bumperBodies: Matter.Body[],
  onBumperHit: (bumperIndex: number, x: number, y: number) => void,
) {
  const bumperIndexById = new Map(
    bumperBodies.map((body, index) => [body.id, index]),
  );
  Events.on(engine, "collisionStart", (event) => {
    event.pairs.forEach((pair) => {
      const bumperBody = bumperIndexById.has(pair.bodyA.id)
        ? pair.bodyA
        : bumperIndexById.has(pair.bodyB.id)
          ? pair.bodyB
          : null;
      const marble =
        bumperBody === pair.bodyA
          ? pair.bodyB
          : bumperBody === pair.bodyB
            ? pair.bodyA
            : null;
      if (!bumperBody || !marble?.label.startsWith("slot-")) return;

      const bumperIndex = bumperIndexById.get(bumperBody.id)!;
      const contact = pair.collision.supports[0] ?? marble.position;
      onBumperHit(bumperIndex, contact.x, contact.y);
      // Matter's collision normal and the seeded restitution are the complete
      // response. We record the contact for presentation, but never rewrite a
      // marble's velocity or inject a rank-dependent impulse.
    });
  });
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
    const marble = Bodies.circle(x, scaleCourseY(145), MARBLE_RADIUS, {
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
  bumperFlashes: BumperFlash[],
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
    bumperFlashes: bumperFlashes.map((flash) => ({ ...flash })),
  };
}

export function simulateRace(
  slotToCandidateId: Readonly<Record<string, string>>,
  raceSeed: string,
  layoutSeed: string,
  targetFinishCount = 1,
): RaceSimulation {
  const participantCount = Object.keys(slotToCandidateId).length;
  if (participantCount < 2 || participantCount > 10) {
    throw new Error("물리 경기는 2명 이상 10명 이하만 실행할 수 있습니다.");
  }
  const assignedCandidateIds = Object.values(slotToCandidateId);
  const hasExactSlots = Array.from(
    { length: participantCount },
    (_, index) => `slot-${index + 1}`,
  ).every((slotId) => Boolean(slotToCandidateId[slotId]));
  if (
    !hasExactSlots ||
    assignedCandidateIds.some((candidateId) => !candidateId) ||
    new Set(assignedCandidateIds).size !== participantCount
  ) {
    throw new Error("물리 경기 시작 슬롯이 유효하지 않습니다.");
  }
  if (
    !Number.isInteger(targetFinishCount) ||
    targetFinishCount < 1 ||
    targetFinishCount > participantCount
  ) {
    throw new Error("당첨 인원은 1명 이상 참가자 수 이하여야 합니다.");
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

  const { rotatingBodies: rotatingBars, bumperBodies } = addCourse(
    engine,
    dynamics,
  );
  const bumperFlashes = COURSE_BUMPERS.map((bumper) => ({
    level: 0,
    x: bumper.x,
    y: bumper.y,
  }));
  registerBumperContacts(engine, bumperBodies, (bumperIndex, x, y) => {
    bumperFlashes[bumperIndex] = { level: 1, x, y };
  });
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
  const substepMs = 1000 / 60 / PHYSICS_SUBSTEPS;
  const maxSteps = 60 * MAX_SIMULATION_SECONDS;
  let firstFinishFrameIndex = -1;
  let awardFrameIndex = -1;
  let step = 0;

  for (; step < maxSteps; step += 1) {
    let rotatingBarAngles: number[] = [];
    for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
      const physicsStep = step + substep / PHYSICS_SUBSTEPS;
      engine.gravity.y =
        baseGravityY *
        dynamics.gravityScale *
        sharedGravityMultiplier(physicsStep / 60);
      rotatingBarAngles = rotatingBars.map((body, index) => {
        const definition = dynamics.rotatingBars[index];
        const angle =
          definition.baseAngle +
          physicsStep * definition.angularSpeed;
        Body.setAngle(body, angle);
        Body.setAngularVelocity(body, definition.angularSpeed);
        return angle;
      });

      Engine.update(engine, substepMs);

      marbles.forEach((marble) => {
        if (
          !finished.has(marble.label) &&
          marble.position.y >= FINISH_Y
        ) {
          finished.add(marble.label);
          finishedSlotIds.push(marble.label);
        }
      });
    }

    if (step % 2 === 0) {
      frames.push(
        captureFrame(
          marbles,
          finishedSlotIds,
          rotatingBarAngles,
          bumperFlashes,
        ),
      );
      bumperFlashes.forEach((flash) => {
        flash.level =
          flash.level < 0.04
            ? 0
            : flash.level * BUMPER_FLASH_DECAY;
      });
      if (firstFinishFrameIndex < 0 && finishedSlotIds.length > 0) {
        firstFinishFrameIndex = frames.length - 1;
      }
      if (
        awardFrameIndex < 0 &&
        finishedSlotIds.length >= targetFinishCount
      ) {
        awardFrameIndex = frames.length - 1;
      }
    }

    if (
      finishedSlotIds.length === participantCount &&
      step % 2 === 0
    ) {
      break;
    }
  }

  const fullFinishOrder = rankMarbles(marbles, finishedSlotIds);
  if (awardFrameIndex < 0) {
    throw new Error(
      `${targetFinishCount}명의 결승 통과를 확인하지 못했습니다. 새 코스로 다시 시도해 주세요.`,
    );
  }
  const safeFirstFinishFrame =
    firstFinishFrameIndex >= 0 ? firstFinishFrameIndex : awardFrameIndex;
  const visibleFinishedCount =
    frames.at(-1)?.finishedSlotIds.length ?? 0;

  return {
    slotToCandidateId: { ...slotToCandidateId },
    frames,
    fullFinishOrder,
    firstFinishFrameIndex: safeFirstFinishFrame,
    awardFrameIndex,
    targetFinishCount,
    visibleFinishedCount,
    durationMs: Math.round((frames.length / FRAME_RATE) * 1000),
    layoutShift,
    simulationSteps: step + 1,
    physicallyFinishedCount: finishedSlotIds.length,
    timedOut: finishedSlotIds.length !== participantCount,
    dynamics,
  };
}
