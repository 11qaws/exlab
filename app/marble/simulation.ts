import Matter from "matter-js";
import type { IChamferableBodyDefinition } from "matter-js";
import { createPrng } from "./core";
import type { MarblePose, RaceFrame, RaceSimulation } from "./types";

const { Bodies, Body, Composite, Engine } = Matter;

export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 2500;
export const FINISH_Y = 2260;
export const MARBLE_RADIUS = 15;
export const FRAME_RATE = 30;
export const VIEW_HEIGHT = 980;

type RaceBodies = {
  marbles: Matter.Body[];
  rotatingBar: Matter.Body;
};

const obstacleOptions: IChamferableBodyDefinition = {
  isStatic: true,
  friction: 0.02,
  restitution: 0.45,
  render: { visible: false },
};

function addCourse(engine: Matter.Engine): RaceBodies["rotatingBar"] {
  const bodies: Matter.Body[] = [];

  bodies.push(
    Bodies.rectangle(45, WORLD_HEIGHT / 2, 70, WORLD_HEIGHT, obstacleOptions),
    Bodies.rectangle(
      WORLD_WIDTH - 45,
      WORLD_HEIGHT / 2,
      70,
      WORLD_HEIGHT,
      obstacleOptions,
    ),
  );

  const pinRows = [
    { y: 340, xs: [150, 270, 390, 510, 630, 750] },
    { y: 485, xs: [210, 330, 450, 570, 690] },
    { y: 630, xs: [150, 270, 390, 510, 630, 750] },
    { y: 775, xs: [210, 330, 450, 570, 690] },
  ];

  pinRows.forEach(({ y, xs }) => {
    xs.forEach((x) => {
      bodies.push(Bodies.circle(x, y, 19, obstacleOptions));
    });
  });

  const rotatingBar = Bodies.rectangle(450, 970, 330, 24, {
    ...obstacleOptions,
    chamfer: { radius: 12 },
    label: "rotating-bar",
  });
  bodies.push(rotatingBar);

  bodies.push(
    Bodies.rectangle(245, 1210, 300, 24, {
      ...obstacleOptions,
      angle: 0.24,
      chamfer: { radius: 10 },
    }),
    Bodies.rectangle(655, 1210, 300, 24, {
      ...obstacleOptions,
      angle: -0.24,
      chamfer: { radius: 10 },
    }),
    Bodies.circle(450, 1335, 34, obstacleOptions),
  );

  const gateXs = [145, 265, 385, 515, 635, 755];
  gateXs.forEach((x, index) => {
    bodies.push(
      Bodies.rectangle(x, 1530 + (index % 2) * 105, 24, 165, {
        ...obstacleOptions,
        angle: index % 2 === 0 ? -0.18 : 0.18,
        chamfer: { radius: 9 },
      }),
    );
  });

  bodies.push(
    Bodies.circle(300, 1810, 36, obstacleOptions),
    Bodies.circle(450, 1740, 36, obstacleOptions),
    Bodies.circle(600, 1810, 36, obstacleOptions),
    Bodies.rectangle(235, 2050, 310, 28, {
      ...obstacleOptions,
      angle: 0.42,
      chamfer: { radius: 12 },
    }),
    Bodies.rectangle(665, 2050, 310, 28, {
      ...obstacleOptions,
      angle: -0.42,
      chamfer: { radius: 12 },
    }),
    Bodies.rectangle(320, 2200, 210, 24, {
      ...obstacleOptions,
      angle: 0.1,
      chamfer: { radius: 10 },
    }),
    Bodies.rectangle(580, 2200, 210, 24, {
      ...obstacleOptions,
      angle: -0.1,
      chamfer: { radius: 10 },
    }),
    Bodies.rectangle(450, WORLD_HEIGHT - 20, WORLD_WIDTH, 40, obstacleOptions),
  );

  Composite.add(engine.world, bodies);
  return rotatingBar;
}

function addMarbles(
  engine: Matter.Engine,
  count: number,
  layoutSeed: string,
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
      restitution: 0.38,
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
  barAngle: number,
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
    barAngle,
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
  const engine = Engine.create({
    gravity: { x: 0, y: 1.12, scale: 0.001 },
    enableSleeping: false,
  });
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 2;

  const rotatingBar = addCourse(engine);
  const { marbles, layoutShift } = addMarbles(
    engine,
    participantCount,
    layoutSeed,
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
  const maxSteps = 60 * 52;
  let winnerFrameIndex = -1;
  let step = 0;

  for (; step < maxSteps; step += 1) {
    const barAngle = Math.sin(step / 48) * 0.72;
    Body.setAngle(rotatingBar, barAngle);
    Body.setAngularVelocity(rotatingBar, Math.cos(step / 48) * 0.015);

    if (step === 1100) {
      engine.gravity.y = 1.65;
      engine.gravity.x = 0.28;
    }
    if (step === 1450) {
      engine.gravity.x = -0.28;
    }
    if (step === 1800) {
      engine.gravity.x = 0;
    }
    if (step === 2100) {
      engine.gravity.y = 2.3;
    }

    Engine.update(engine, stepMs);

    marbles.forEach((marble) => {
      if (!finished.has(marble.label) && marble.position.y >= FINISH_Y) {
        finished.add(marble.label);
        finishedSlotIds.push(marble.label);
      }
    });

    if (step % 2 === 0) {
      frames.push(captureFrame(marbles, finishedSlotIds, barAngle));
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
  };
}
