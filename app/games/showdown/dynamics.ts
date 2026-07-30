import { createPrng, hashText } from "./core";
import { ROTATING_BARS } from "./course";
import type { RaceDynamics } from "./types";

const range = (random: () => number, min: number, max: number) =>
  min + random() * (max - min);

export function createRaceDynamics(raceSeed: string): RaceDynamics {
  const random = createPrng(`${raceSeed}:dynamics-v2`);
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

  const gravityScale = range(random, 0.97, 1.03);
  const marbleRestitution = range(random, 0.34, 0.43);
  const obstacleRestitution = range(random, 0.4, 0.51);
  const pinRestitution = range(random, 0.48, 0.62);
  const bumperRestitution = range(random, 1.22, 1.32);
  const spinnerRestitution = range(random, 0.68, 0.8);

  const raw = [
    ...rotatingBars.flatMap((bar) => [
      bar.baseAngle.toFixed(4),
      bar.angularSpeed.toFixed(5),
    ]),
    gravityScale.toFixed(4),
    marbleRestitution.toFixed(4),
    obstacleRestitution.toFixed(4),
    pinRestitution.toFixed(4),
    bumperRestitution.toFixed(4),
    spinnerRestitution.toFixed(4),
  ].join(":");

  return {
    fingerprint: hashText(raw).toString(36).slice(-5).toUpperCase(),
    gravityScale,
    marbleRestitution,
    obstacleRestitution,
    pinRestitution,
    bumperRestitution,
    spinnerRestitution,
    rotatingBars,
  };
}
