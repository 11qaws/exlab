import {
  COURSE_RECTS,
  MARBLE_RADIUS,
  type CourseRect,
} from "../app/games/showdown/course";
import { FRAME_RATE, simulateRace } from "../app/games/showdown/simulation";

const PARTICIPANT_COUNT = 8;
const DEFAULT_RACE_COUNT = 48;
const SLOW_DISPLACEMENT_PER_FRAME = 0.5;
const REPORT_THRESHOLD_FRAMES = FRAME_RATE;

type FixedBar = CourseRect & {
  obstacleKind: NonNullable<CourseRect["obstacleKind"]>;
};

type StallSample = {
  seed: string;
  slotId: string;
  barIndex: number;
  kind: FixedBar["obstacleKind"];
  angle: number;
  slowFrames: number;
  startFrame: number;
  endFrame: number;
  startPosition: { x: number; y: number };
  endPosition: { x: number; y: number };
};

function parseRaceCount(): number {
  const argument = process.argv.find((value) => value.startsWith("--races="));
  if (!argument) return DEFAULT_RACE_COUNT;
  const parsed = Number.parseInt(argument.slice("--races=".length), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError("--races must be a positive integer.");
  }
  return parsed;
}

function pointToRectangleDistance(
  point: { x: number; y: number },
  rectangle: CourseRect,
): number {
  const angle = rectangle.angle ?? 0;
  const cosine = Math.cos(-angle);
  const sine = Math.sin(-angle);
  const dx = point.x - rectangle.x;
  const dy = point.y - rectangle.y;
  const localX = dx * cosine - dy * sine;
  const localY = dx * sine + dy * cosine;
  const outsideX = Math.max(Math.abs(localX) - rectangle.width / 2, 0);
  const outsideY = Math.max(Math.abs(localY) - rectangle.height / 2, 0);
  return Math.hypot(outsideX, outsideY);
}

function createSlots(): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: PARTICIPANT_COUNT }, (_, index) => [
      `slot-${index + 1}`,
      `candidate-${index + 1}`,
    ]),
  );
}

function measureRace(
  raceIndex: number,
  bars: FixedBar[],
): StallSample[] {
  const seed = `fixed-bar-stall-${raceIndex}`;
  const simulation = simulateRace(
    createSlots(),
    seed,
    `${seed}-layout`,
    1,
  );
  const samples: StallSample[] = [];

  bars.forEach((bar, barIndex) => {
    for (const slotId of Object.keys(createSlots())) {
      let previousPose: { x: number; y: number } | null = null;
      let consecutiveSlowFrames = 0;
      let longestSlowFrames = 0;
      let currentStartFrame = 0;
      let longestStartFrame = 0;
      let longestEndFrame = 0;
      let longestStartPosition = { x: 0, y: 0 };
      let longestEndPosition = { x: 0, y: 0 };

      simulation.frames.forEach((frame, frameIndex) => {
        const pose = frame.poses.find((candidate) => candidate.slotId === slotId);
        if (!pose) return;
        const displacement = previousPose
          ? Math.hypot(
              pose.x - previousPose.x,
              pose.y - previousPose.y,
            )
          : Number.POSITIVE_INFINITY;
        const touching =
          pointToRectangleDistance(pose, bar) <= MARBLE_RADIUS + 2;

        if (
          touching &&
          displacement < SLOW_DISPLACEMENT_PER_FRAME
        ) {
          if (consecutiveSlowFrames === 0) {
            currentStartFrame = frameIndex;
          }
          consecutiveSlowFrames += 1;
          if (consecutiveSlowFrames > longestSlowFrames) {
            longestSlowFrames = consecutiveSlowFrames;
            longestStartFrame = currentStartFrame;
            longestEndFrame = frameIndex;
            const startPose =
              simulation.frames[currentStartFrame]?.poses.find(
                (candidate) => candidate.slotId === slotId,
              ) ?? pose;
            longestStartPosition = { x: startPose.x, y: startPose.y };
            longestEndPosition = { x: pose.x, y: pose.y };
          }
        } else {
          consecutiveSlowFrames = 0;
        }
        previousPose = pose;
      });

      if (longestSlowFrames >= REPORT_THRESHOLD_FRAMES) {
        samples.push({
          seed,
          slotId,
          barIndex,
          kind: bar.obstacleKind,
          angle: bar.angle ?? 0,
          slowFrames: longestSlowFrames,
          startFrame: longestStartFrame,
          endFrame: longestEndFrame,
          startPosition: longestStartPosition,
          endPosition: longestEndPosition,
        });
      }
    }
  });

  return samples;
}

const raceCount = parseRaceCount();
const bars = COURSE_RECTS.filter(
  (rectangle): rectangle is FixedBar =>
    rectangle.obstacleKind !== undefined,
);
const samples = Array.from({ length: raceCount }, (_, raceIndex) =>
  measureRace(raceIndex, bars),
)
  .flat()
  .sort((left, right) => right.slowFrames - left.slowFrames);

const byBar = bars.map((bar, barIndex) => {
  const matching = samples.filter((sample) => sample.barIndex === barIndex);
  return {
    barIndex,
    kind: bar.obstacleKind,
    angle: bar.angle ?? 0,
    reports: matching.length,
    worstSeconds:
      (matching[0]?.slowFrames ?? 0) / FRAME_RATE,
  };
});

console.log(
  JSON.stringify(
    {
      raceCount,
      participantCount: PARTICIPANT_COUNT,
      measuredMarbles: raceCount * PARTICIPANT_COUNT,
      slowDisplacementPerFrame: SLOW_DISPLACEMENT_PER_FRAME,
      reportThresholdSeconds: REPORT_THRESHOLD_FRAMES / FRAME_RATE,
      passed: samples.length === 0,
      reports: samples.length,
      worst: samples.slice(0, 12).map((sample) => ({
        ...sample,
        seconds: sample.slowFrames / FRAME_RATE,
      })),
      byBar,
    },
    null,
    2,
  ),
);

if (samples.length > 0) {
  process.exitCode = 1;
}
