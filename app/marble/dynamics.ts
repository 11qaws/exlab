import { createPrng, hashText } from "./core";
import { ROTATING_BARS, scaleCourseY } from "./course";
import type { RaceDynamics } from "./types";

const range = (random: () => number, min: number, max: number) =>
  min + random() * (max - min);

const signed = (random: () => number, magnitude: number) =>
  (random() < 0.5 ? -1 : 1) * magnitude;

export function createRaceDynamics(raceSeed: string): RaceDynamics {
  const random = createPrng(`${raceSeed}:dynamics-v1`);
  const rotatingBars = ROTATING_BARS.map((bar) => {
    const speedScale = range(random, 0.86, 1.14);
    const direction =
      bar.placement === "finish-entrance"
        ? Math.sign(bar.angularSpeed)
        : random() < 0.5
          ? -1
          : 1;
    return {
      baseAngle: bar.baseAngle + range(random, -Math.PI, Math.PI),
      angularSpeed:
        direction * Math.abs(bar.angularSpeed) * speedScale,
    };
  });

  const firstWind = signed(random, range(random, 0.07, 0.13));
  const secondWind = signed(random, range(random, 0.08, 0.15));
  const thirdWind = -Math.sign(secondWind) * range(random, 0.08, 0.14);
  const firstZoneX = signed(random, range(random, 0.000012, 0.000024));

  const raw = [
    ...rotatingBars.flatMap((bar) => [
      bar.baseAngle.toFixed(4),
      bar.angularSpeed.toFixed(5),
    ]),
    firstWind.toFixed(3),
    secondWind.toFixed(3),
    thirdWind.toFixed(3),
  ].join(":");

  return {
    fingerprint: hashText(raw).toString(36).slice(-5).toUpperCase(),
    gravityScale: range(random, 0.97, 1.03),
    marbleRestitution: range(random, 0.34, 0.43),
    obstacleRestitution: range(random, 0.4, 0.51),
    pinRestitution: range(random, 0.48, 0.62),
    rotatingBars,
    windPulses: [
      { startStep: 620, endStep: 920, gravityX: firstWind },
      { startStep: 1560, endStep: 1910, gravityX: secondWind },
      { startStep: 2830, endStep: 3190, gravityX: thirdWind },
    ],
    forceZones: [
      {
        startY: scaleCourseY(3250),
        endY: scaleCourseY(4100),
        forceX: firstZoneX,
        forceY: 0.000014,
      },
      {
        startY: scaleCourseY(6650),
        endY: scaleCourseY(7350),
        forceX: -firstZoneX * range(random, 0.82, 1.08),
        forceY: 0.00002,
      },
    ],
    catchUp: {
      startGap: 360,
      maxGap: 1_350,
      maxForceY: 0.00016,
    },
  };
}
