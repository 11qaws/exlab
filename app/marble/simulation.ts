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
  courseBoundsAtY,
  FINISH_Y,
  MARBLE_RADIUS,
  MAX_SIMULATION_SECONDS,
  ROTATING_BARS,
  scaleCourseY,
  START_ALIGNMENT_PIN_XS,
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
export const BUMPER_FLASH_DECAY = 0.68;
export const MINIMUM_RESULT_FINISHERS = 3;
export const START_MAX_HORIZONTAL_JITTER = 12;
export const START_MIN_CENTER_GAP = MARBLE_RADIUS * 2 + 6;
export const MARBLE_START_Y = scaleCourseY(145);
export const START_PIN_ALIGNMENT_CLEARANCE = MARBLE_RADIUS * 0.5;
export const CHASE_ASSIST_TARGET_GAP = 1_000;
export const CHASE_ASSIST_START_GAP = 600;
export const CHASE_ASSIST_FULL_GAP = CHASE_ASSIST_TARGET_GAP;
export const CHASE_ASSIST_SECOND_PLACE_MAX_BONUS = 0.25;
export const CHASE_ASSIST_LAST_PLACE_MAX_BONUS = 0.32;
export const CHASE_ASSIST_CLOSING_SPEED_LIMIT = 600;
export const FIXED_GUIDE_FRICTION = 0;
const START_WALL_CLEARANCE = 6;
const START_LAYOUT_ATTEMPTS = 256;
export type StaticCollisionMaterial = {
  friction: number;
  frictionStatic: number;
  restitution: number;
};
const obstacleOptions = (
  restitution: number,
): IChamferableBodyDefinition & StaticCollisionMaterial => ({
  isStatic: true,
  friction: 0.02,
  frictionStatic: 0.5,
  restitution,
  render: { visible: false },
});
const fixedGuideOptions = (
  restitution: number,
): IChamferableBodyDefinition & StaticCollisionMaterial => ({
  ...obstacleOptions(restitution),
  friction: FIXED_GUIDE_FRICTION,
  frictionStatic: 0,
});
const activeObstacleOptions = (
  restitution: number,
): IChamferableBodyDefinition & StaticCollisionMaterial => ({
  ...obstacleOptions(restitution),
  friction: 0,
  frictionStatic: 0,
});

/**
 * Matter.js replaces a body's requested friction and restitution when
 * `isStatic` is applied. Restore the authored material on every part after
 * construction so fixed guides remain slick and bumpers retain their bounce.
 */
export function restoreStaticCollisionMaterial<T extends Matter.Body>(
  body: T,
  material: StaticCollisionMaterial,
): T {
  body.parts.forEach((part) => {
    part.friction = material.friction;
    part.frictionStatic = material.frictionStatic;
    part.restitution = material.restitution;
  });
  return body;
}

function staticRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  options: IChamferableBodyDefinition & StaticCollisionMaterial,
): Matter.Body {
  return restoreStaticCollisionMaterial(
    Bodies.rectangle(x, y, width, height, options),
    options,
  );
}

function staticCircle(
  x: number,
  y: number,
  radius: number,
  options: IChamferableBodyDefinition & StaticCollisionMaterial,
): Matter.Body {
  return restoreStaticCollisionMaterial(
    Bodies.circle(x, y, radius, options),
    options,
  );
}

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

export function chaseAssistGravityBonus(
  rank: number,
  participantCount: number,
  distanceBehindLeader: number,
  closingSpeed = 0,
): number {
  if (
    !Number.isInteger(rank) ||
    !Number.isInteger(participantCount) ||
    participantCount < 2 ||
    rank < 1 ||
    rank > participantCount ||
    !Number.isFinite(distanceBehindLeader) ||
    !Number.isFinite(closingSpeed)
  ) {
    throw new RangeError("Invalid chase-assist ranking input.");
  }
  if (rank === 1 || distanceBehindLeader <= CHASE_ASSIST_START_GAP) {
    return 0;
  }

  const distanceProgress = Math.max(
    0,
    Math.min(
      1,
      (distanceBehindLeader - CHASE_ASSIST_START_GAP) /
        (CHASE_ASSIST_FULL_GAP - CHASE_ASSIST_START_GAP),
    ),
  );
  const easedDistance =
    distanceProgress *
    distanceProgress *
    (3 - 2 * distanceProgress);
  const closingProgress = Math.max(
    0,
    Math.min(1, closingSpeed / CHASE_ASSIST_CLOSING_SPEED_LIMIT),
  );
  const closingDamping =
    1 -
    closingProgress *
      closingProgress *
      (3 - 2 * closingProgress);
  const rankDepth =
    participantCount <= 2
      ? 0
      : (rank - 2) / (participantCount - 2);
  const maximumBonus =
    CHASE_ASSIST_SECOND_PLACE_MAX_BONUS +
    (CHASE_ASSIST_LAST_PLACE_MAX_BONUS -
      CHASE_ASSIST_SECOND_PLACE_MAX_BONUS) *
      rankDepth;
  return easedDistance * maximumBonus * closingDamping;
}

function applyChaseAssist(
  marbles: Matter.Body[],
  finished: ReadonlySet<string>,
  gravityY: number,
) {
  const activeMarbles = marbles
    .filter((marble) => !finished.has(marble.label))
    .sort(
      (left, right) => right.position.y - left.position.y,
    );
  const leader = activeMarbles[0];
  if (!leader) return;

  activeMarbles.slice(1).forEach((marble, index) => {
    const distanceBehindLeader = Math.max(
      0,
      leader.position.y - marble.position.y,
    );
    const gravityBonus = chaseAssistGravityBonus(
      index + 2,
      activeMarbles.length,
      distanceBehindLeader,
      Math.max(
        0,
        (marble.velocity.y - leader.velocity.y) * 60,
      ),
    );
    if (gravityBonus <= 0) return;
    Body.applyForce(marble, marble.position, {
      x: 0,
      y: marble.mass * gravityY * 0.001 * gravityBonus,
    });
  });
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
      staticRectangle(
        shape.x,
        shape.y,
        shape.width,
        shape.height,
        {
          ...(shape.obstacleKind
            ? fixedGuideOptions(dynamics.obstacleRestitution)
            : obstacleOptions(
                shape.material === "elastic"
                  ? dynamics.bumperRestitution
                  : dynamics.obstacleRestitution,
              )),
          angle: shape.angle ?? 0,
          chamfer: {
            radius: Math.min(
              shape.role === "gate" ? 9 : 12,
              shape.width / 2,
              shape.height / 2,
            ),
          },
        },
      ),
    ),
    ...COURSE_PINS.map((pin) =>
      staticCircle(
        pin.x,
        pin.y,
        pin.radius,
        obstacleOptions(dynamics.pinRestitution),
      ),
    ),
  ];
  const rotatingBodies = ROTATING_BARS.map((bar, index) =>
    staticRectangle(bar.x, bar.y, bar.width, bar.height, {
      ...activeObstacleOptions(dynamics.spinnerRestitution),
      chamfer: { radius: 12 },
      label: `rotating-bar-${index + 1}`,
    }),
  );
  const bumperBodies = COURSE_BUMPERS.map((bumper, index) =>
    staticRectangle(bumper.x, bumper.y, bumper.width, bumper.height, {
      ...activeObstacleOptions(dynamics.bumperRestitution),
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

export type MarbleStartLayout = {
  layoutShift: number;
  positions: { x: number; y: number }[];
};

function createMarbleStartLayoutCandidate(
  count: number,
  layoutSeed: string,
  attempt: number,
): MarbleStartLayout {
  const attemptSuffix = attempt === 0 ? "" : `:pin-safe-${attempt}`;
  const shiftRandom = createPrng(`${layoutSeed}${attemptSuffix}`);
  const jitterRandom = createPrng(
    `${layoutSeed}:start-jitter-v1${attemptSuffix}`,
  );
  const maxShift = count >= 9 ? 18 : 52;
  const layoutShift = Math.round(
    (shiftRandom() * 2 - 1) * maxShift,
  );
  const usableWidth = Math.min(650, Math.max(220, (count - 1) * 72));
  const startX = WORLD_WIDTH / 2 - usableWidth / 2 + layoutShift;
  const spacing = count === 1 ? 0 : usableWidth / (count - 1);
  const bounds = courseBoundsAtY(MARBLE_START_Y);
  const leftLimit =
    bounds.leftX + MARBLE_RADIUS + START_WALL_CLEARANCE;
  const rightLimit =
    bounds.rightX - MARBLE_RADIUS - START_WALL_CLEARANCE;
  const wallAllowance = Math.max(
    0,
    Math.min(
      startX - leftLimit,
      rightLimit - (startX + usableWidth),
    ),
  );
  const maximumJitter = Math.max(
    0,
    Math.min(
      START_MAX_HORIZONTAL_JITTER,
      (spacing - START_MIN_CENTER_GAP) / 2,
      wallAllowance,
    ),
  );
  const rawJitters = Array.from(
    { length: count },
    () => jitterRandom() * 2 - 1,
  );
  const meanJitter =
    rawJitters.reduce((sum, value) => sum + value, 0) / count;
  const centeredJitters = rawJitters.map(
    (value) => value - meanJitter,
  );
  const largestMagnitude = Math.max(
    ...centeredJitters.map((value) => Math.abs(value)),
    1,
  );
  const jitterScale = maximumJitter / largestMagnitude;

  return {
    layoutShift,
    positions: centeredJitters.map((jitter, index) => ({
      x: startX + index * spacing + jitter * jitterScale,
      y: MARBLE_START_Y,
    })),
  };
}

function minimumStartPinAlignmentDistance(
  positions: MarbleStartLayout["positions"],
): number {
  return Math.min(
    ...positions.flatMap((position) =>
      START_ALIGNMENT_PIN_XS.map((pinX) =>
        Math.abs(position.x - pinX),
      ),
    ),
  );
}

export function createMarbleStartLayout(
  count: number,
  layoutSeed: string,
): MarbleStartLayout {
  if (!Number.isInteger(count) || count < 2 || count > 10) {
    throw new RangeError("count must be an integer between 2 and 10.");
  }

  for (let attempt = 0; attempt < START_LAYOUT_ATTEMPTS; attempt += 1) {
    const layout = createMarbleStartLayoutCandidate(
      count,
      layoutSeed,
      attempt,
    );
    const alignmentDistance = minimumStartPinAlignmentDistance(
      layout.positions,
    );
    if (alignmentDistance >= START_PIN_ALIGNMENT_CLEARANCE) {
      return layout;
    }
  }

  throw new Error(
    "Unable to create a start layout with opening-pin alignment clearance.",
  );
}

function addMarbles(
  engine: Matter.Engine,
  count: number,
  layoutSeed: string,
  restitution: number,
): { marbles: Matter.Body[]; layoutShift: number } {
  const startLayout = createMarbleStartLayout(count, layoutSeed);

  const marbles = Array.from({ length: count }, (_, index) => {
    const position = startLayout.positions[index];
    const marble = Bodies.circle(position.x, position.y, MARBLE_RADIUS, {
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
  return { marbles, layoutShift: startLayout.layoutShift };
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
  const podiumFinishCount = Math.min(
    MINIMUM_RESULT_FINISHERS,
    participantCount,
  );
  const resultGateCount = Math.max(
    targetFinishCount,
    podiumFinishCount,
  );
  const substepMs = 1000 / 60 / PHYSICS_SUBSTEPS;
  const maxSteps = 60 * MAX_SIMULATION_SECONDS;
  let firstFinishFrameIndex = -1;
  let awardFrameIndex = -1;
  let podiumFrameIndex = -1;
  let resultGateFrameIndex = -1;
  let step = 0;

  for (; step < maxSteps; step += 1) {
    let rotatingBarAngles: number[] = [];
    for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
      const physicsStep = step + substep / PHYSICS_SUBSTEPS;
      engine.gravity.y =
        baseGravityY *
        dynamics.gravityScale *
        sharedGravityMultiplier(physicsStep / 60);
      applyChaseAssist(
        marbles,
        finished,
        baseGravityY * dynamics.gravityScale,
      );
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
      if (
        podiumFrameIndex < 0 &&
        finishedSlotIds.length >= podiumFinishCount
      ) {
        podiumFrameIndex = frames.length - 1;
      }
      if (
        resultGateFrameIndex < 0 &&
        finishedSlotIds.length >= resultGateCount
      ) {
        resultGateFrameIndex = frames.length - 1;
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
  if (podiumFrameIndex < 0 || resultGateFrameIndex < 0) {
    throw new Error(
      `${resultGateCount}위까지 결승 통과를 확인하지 못했습니다. 새 코스로 다시 시도해 주세요.`,
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
    podiumFrameIndex,
    resultGateCount,
    resultGateFrameIndex,
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
