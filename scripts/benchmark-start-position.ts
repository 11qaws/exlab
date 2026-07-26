import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createMarbleStartLayout,
  simulateRace,
} from "../app/marble/simulation";

const PARTICIPANT_COUNTS = [5, 10] as const;
const DEFAULT_RACES_PER_COUNT = 120;
const ALPHA = 0.05;
const WILSON_Z_95 = 1.959_963_984_540_054;
const EPSILON = 1e-14;
const FLOATING_POINT_MINIMUM = 1e-300;
const MAX_ITERATIONS = 10_000;

type ParticipantCount = (typeof PARTICIPANT_COUNTS)[number];

type RaceSample = {
  seedBatch: "primary" | "legacy-exploratory";
  winnerIndex: number;
  startXs: number[];
};

type WorkerRequest = {
  participantCount: ParticipantCount;
  races: number;
  legacyRaces: number;
};

type WorkerResult = WorkerRequest & {
  samples: RaceSample[];
  elapsedMs: number;
};

type RawTest = {
  id: string;
  participantCount: ParticipantCount;
  test: "uniformity" | "linear-x" | "quadratic-edge" | "joint-x-edge";
  rawP: number;
};

function parseRacesPerCount(): number {
  const argument = process.argv.find((value) => value.startsWith("--races="));
  if (!argument) return DEFAULT_RACES_PER_COUNT;
  const parsed = Number.parseInt(argument.slice("--races=".length), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError("--races must be a positive integer.");
  }
  return parsed;
}

function parseLegacyRacesPerCount(): number {
  const argument = process.argv.find((value) =>
    value.startsWith("--legacy-races="),
  );
  if (!argument) return 0;
  const parsed = Number.parseInt(
    argument.slice("--legacy-races=".length),
    10,
  );
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError("--legacy-races must be a non-negative integer.");
  }
  return parsed;
}

function parseWorkerParticipantCount(): ParticipantCount | null {
  const argument = process.argv.find((value) => value.startsWith("--worker="));
  if (!argument) return null;
  const parsed = Number.parseInt(argument.slice("--worker=".length), 10);
  if (parsed !== 5 && parsed !== 10) {
    throw new RangeError("--worker must be 5 or 10.");
  }
  return parsed;
}

function parseParticipantCounts(): readonly ParticipantCount[] {
  const argument = process.argv.find((value) =>
    value.startsWith("--participant-count="),
  );
  if (!argument) return PARTICIPANT_COUNTS;
  const parsed = Number.parseInt(
    argument.slice("--participant-count=".length),
    10,
  );
  if (parsed !== 5 && parsed !== 10) {
    throw new RangeError("--participant-count must be 5 or 10.");
  }
  return [parsed];
}

function simulationSlots(participantCount: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: participantCount }, (_, index) => [
      `slot-${index + 1}`,
      `position-benchmark-candidate-${index + 1}`,
    ]),
  );
}

function measureParticipantCount(
  participantCount: ParticipantCount,
  races: number,
  legacyRaces: number,
): WorkerResult {
  const startedAt = performance.now();
  const slots = simulationSlots(participantCount);
  const seedDefinitions = [
    ...Array.from({ length: races }, (_, raceIndex) => ({
      seedBatch: "primary" as const,
      raceSeed:
        `position-fairness-race-v1:${participantCount}:${raceIndex}`,
      layoutSeed:
        `position-fairness-layout-v1:${participantCount}:${raceIndex}`,
    })),
    ...Array.from({ length: legacyRaces }, (_, raceIndex) => ({
      seedBatch: "legacy-exploratory" as const,
      raceSeed: `position-fairness-v1-${participantCount}-${raceIndex}`,
      layoutSeed: `position-layout-v1-${participantCount}-${raceIndex}`,
    })),
  ];
  const samples = seedDefinitions.map(({ seedBatch, raceSeed, layoutSeed }) => {
    // The race seed controls dynamics and the tiny launch force; the layout seed
    // controls start x only. Separate domains prevent accidental coupling.
    const simulation = simulateRace(slots, raceSeed, layoutSeed);
    const winnerSlotId = simulation.fullFinishOrder[0];
    const winnerIndex = Number.parseInt(
      winnerSlotId.slice("slot-".length),
      10,
    ) - 1;
    const startXs = createMarbleStartLayout(
      participantCount,
      layoutSeed,
    ).positions.map(({ x }) => x);

    if (
      !Number.isInteger(winnerIndex) ||
      winnerIndex < 0 ||
      winnerIndex >= participantCount
    ) {
      throw new Error(`Invalid winner slot: ${winnerSlotId}`);
    }
    return { seedBatch, winnerIndex, startXs };
  });

  return {
    participantCount,
    races,
    legacyRaces,
    samples,
    elapsedMs: performance.now() - startedAt,
  };
}

function logGamma(value: number): number {
  const coefficients = [
    676.520_368_121_885_1,
    -1_259.139_216_722_402_8,
    771.323_428_777_653_1,
    -176.615_029_162_140_6,
    12.507_343_278_686_905,
    -0.138_571_095_265_720_12,
    9.984_369_578_019_572e-6,
    1.505_632_735_149_311_6e-7,
  ];
  if (value < 0.5) {
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * value)) -
      logGamma(1 - value)
    );
  }

  const shifted = value - 1;
  let series = 0.999_999_999_999_809_9;
  coefficients.forEach((coefficient, index) => {
    series += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(series)
  );
}

function chiSquareSurvival(statistic: number, degreesOfFreedom: number): number {
  if (
    !Number.isFinite(statistic) ||
    statistic < 0 ||
    !Number.isInteger(degreesOfFreedom) ||
    degreesOfFreedom < 1
  ) {
    throw new RangeError("Invalid chi-square input.");
  }
  if (statistic === 0) return 1;

  const shape = degreesOfFreedom / 2;
  const x = statistic / 2;
  const logScale = -x + shape * Math.log(x) - logGamma(shape);

  if (x < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    let denominator = shape;
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
      denominator += 1;
      term *= x / denominator;
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * EPSILON) break;
    }
    const lowerRegularized = sum * Math.exp(logScale);
    return Math.max(0, Math.min(1, 1 - lowerRegularized));
  }

  let b = x + 1 - shape;
  let c = 1 / FLOATING_POINT_MINIMUM;
  let d = 1 / b;
  let fraction = d;
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const coefficient = -iteration * (iteration - shape);
    b += 2;
    d = coefficient * d + b;
    if (Math.abs(d) < FLOATING_POINT_MINIMUM) {
      d = FLOATING_POINT_MINIMUM;
    }
    c = b + coefficient / c;
    if (Math.abs(c) < FLOATING_POINT_MINIMUM) {
      c = FLOATING_POINT_MINIMUM;
    }
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= EPSILON) break;
  }
  return Math.max(0, Math.min(1, fraction * Math.exp(logScale)));
}

function wilson95(wins: number, total: number): {
  lower: number;
  upper: number;
} {
  const probability = wins / total;
  const zSquared = WILSON_Z_95 ** 2;
  const denominator = 1 + zSquared / total;
  const center = (probability + zSquared / (2 * total)) / denominator;
  const halfWidth =
    (WILSON_Z_95 *
      Math.sqrt(
        (probability * (1 - probability)) / total +
          zSquared / (4 * total ** 2),
      )) /
    denominator;
  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}

function uniformityTest(wins: number[]): {
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  cramersV: number;
} {
  const races = wins.reduce((sum, value) => sum + value, 0);
  const expected = races / wins.length;
  const statistic = wins.reduce(
    (sum, value) => sum + (value - expected) ** 2 / expected,
    0,
  );
  const degreesOfFreedom = wins.length - 1;
  return {
    statistic,
    degreesOfFreedom,
    pValue: chiSquareSurvival(statistic, degreesOfFreedom),
    cramersV: Math.sqrt(
      statistic / (races * Math.max(1, wins.length - 1)),
    ),
  };
}

function conditionalPositionScore(samples: RaceSample[]): {
  linear: { score: number; statistic: number; pValue: number };
  quadraticEdge: { score: number; statistic: number; pValue: number };
  joint: {
    score: [number, number];
    information: [[number, number], [number, number]];
    statistic: number;
    degreesOfFreedom: 2;
    pValue: number;
  };
} {
  let linearScore = 0;
  let edgeScore = 0;
  let informationLinear = 0;
  let informationCross = 0;
  let informationEdge = 0;

  samples.forEach(({ winnerIndex, startXs }) => {
    const meanX =
      startXs.reduce((sum, value) => sum + value, 0) / startXs.length;
    const varianceX =
      startXs.reduce((sum, value) => sum + (value - meanX) ** 2, 0) /
      startXs.length;
    const scaleX = Math.sqrt(varianceX);
    const linearTerms = startXs.map((x) => (x - meanX) / scaleX);
    const meanSquare =
      linearTerms.reduce((sum, value) => sum + value ** 2, 0) /
      linearTerms.length;
    const edgeTerms = linearTerms.map((value) => value ** 2 - meanSquare);

    linearScore += linearTerms[winnerIndex];
    edgeScore += edgeTerms[winnerIndex];
    informationLinear +=
      linearTerms.reduce((sum, value) => sum + value ** 2, 0) /
      linearTerms.length;
    informationCross +=
      linearTerms.reduce(
        (sum, value, index) => sum + value * edgeTerms[index],
        0,
      ) / linearTerms.length;
    informationEdge +=
      edgeTerms.reduce((sum, value) => sum + value ** 2, 0) /
      edgeTerms.length;
  });

  const linearStatistic = linearScore ** 2 / informationLinear;
  const edgeStatistic = edgeScore ** 2 / informationEdge;
  const determinant =
    informationLinear * informationEdge - informationCross ** 2;
  if (determinant <= 0) {
    throw new Error("Conditional score information matrix is singular.");
  }
  const jointStatistic =
    (informationEdge * linearScore ** 2 -
      2 * informationCross * linearScore * edgeScore +
      informationLinear * edgeScore ** 2) /
    determinant;

  return {
    linear: {
      score: linearScore,
      statistic: linearStatistic,
      pValue: chiSquareSurvival(linearStatistic, 1),
    },
    quadraticEdge: {
      score: edgeScore,
      statistic: edgeStatistic,
      pValue: chiSquareSurvival(edgeStatistic, 1),
    },
    joint: {
      score: [linearScore, edgeScore],
      information: [
        [informationLinear, informationCross],
        [informationCross, informationEdge],
      ],
      statistic: jointStatistic,
      degreesOfFreedom: 2,
      pValue: chiSquareSurvival(jointStatistic, 2),
    },
  };
}

function holmAdjust(tests: RawTest[]): Array<
  RawTest & { adjustedP: number; significant: boolean }
> {
  const sorted = [...tests].sort((left, right) => left.rawP - right.rawP);
  let runningMaximum = 0;
  const adjustedById = new Map<string, number>();
  sorted.forEach((test, index) => {
    const adjusted = Math.min(
      1,
      Math.max(runningMaximum, test.rawP * (sorted.length - index)),
    );
    runningMaximum = adjusted;
    adjustedById.set(test.id, adjusted);
  });
  return tests.map((test) => {
    const adjustedP = adjustedById.get(test.id)!;
    return {
      ...test,
      adjustedP,
      significant: adjustedP < ALPHA,
    };
  });
}

function summarizeWorkerResult(
  result: WorkerResult,
  samples: RaceSample[],
) {
  const races = samples.length;
  if (races < 1) {
    throw new RangeError("At least one race sample is required.");
  }
  const wins = Array(result.participantCount).fill(0) as number[];
  samples.forEach(({ winnerIndex }) => {
    wins[winnerIndex] += 1;
  });
  const rates = wins.map((value) => value / races);
  const uniformity = uniformityTest(wins);
  const positionScore = conditionalPositionScore(samples);
  const slotRows = wins.map((value, index) => {
    const xValues = samples.map(({ startXs }) => startXs[index]);
    return {
      slotId: `slot-${index + 1}`,
      leftToRightIndex: index + 1,
      meanStartX:
        xValues.reduce((sum, x) => sum + x, 0) / xValues.length,
      wins: value,
      rate: value / races,
      wilson95: wilson95(value, races),
    };
  });

  return {
    participantCount: result.participantCount,
    races,
    expectedWinsPerSlot: races / result.participantCount,
    elapsedSeconds: result.elapsedMs / 1000,
    slots: slotRows,
    uniformity,
    conditionalPositionScore: positionScore,
    maxMinusMin: {
      wins: Math.max(...wins) - Math.min(...wins),
      rate: Math.max(...rates) - Math.min(...rates),
      percentagePoints: (Math.max(...rates) - Math.min(...rates)) * 100,
      maxSlotId: `slot-${rates.indexOf(Math.max(...rates)) + 1}`,
      minSlotId: `slot-${rates.indexOf(Math.min(...rates)) + 1}`,
    },
  };
}

async function runWorker(request: WorkerRequest): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url);
    const tsxCliPath = require.resolve("tsx/cli");
    const scriptPath = fileURLToPath(import.meta.url);
    const child = spawn(
      process.execPath,
      [
        tsxCliPath,
        scriptPath,
        `--worker=${request.participantCount}`,
        `--races=${request.races}`,
        `--legacy-races=${request.legacyRaces}`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark worker exited with ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(output) as WorkerResult);
      } catch (error) {
        reject(
          new Error(
            `Benchmark worker returned invalid JSON: ${String(error)}`,
          ),
        );
      }
    });
  });
}

function inferenceForSummaries(
  summaries: ReturnType<typeof summarizeWorkerResult>[],
) {
  const rawTests: RawTest[] = summaries.flatMap((summary) => [
    {
      id: `${summary.participantCount}-uniformity`,
      participantCount: summary.participantCount,
      test: "uniformity",
      rawP: summary.uniformity.pValue,
    },
    {
      id: `${summary.participantCount}-linear-x`,
      participantCount: summary.participantCount,
      test: "linear-x",
      rawP: summary.conditionalPositionScore.linear.pValue,
    },
    {
      id: `${summary.participantCount}-quadratic-edge`,
      participantCount: summary.participantCount,
      test: "quadratic-edge",
      rawP: summary.conditionalPositionScore.quadraticEdge.pValue,
    },
    {
      id: `${summary.participantCount}-joint-x-edge`,
      participantCount: summary.participantCount,
      test: "joint-x-edge",
      rawP: summary.conditionalPositionScore.joint.pValue,
    },
  ]);
  const holm = holmAdjust(rawTests);
  const significant = holm.filter(({ significant: rejected }) => rejected);
  return {
    byParticipantCount: Object.fromEntries(
      summaries.map((summary) => [
        summary.participantCount,
        summary,
      ]),
    ),
    holm,
    decision: {
      significantPositionDifference: significant.length > 0,
      significantTestIds: significant.map(({ id }) => id),
      statement:
        significant.length > 0
          ? "At least one position test remains significant after Holm correction."
          : "No reported position test is significant after Holm correction; this is not proof that all smaller effects are absent.",
    },
  };
}

function compactInference(
  inference: ReturnType<typeof inferenceForSummaries>,
) {
  return {
    byParticipantCount: Object.fromEntries(
      Object.entries(inference.byParticipantCount).map(([key, summary]) => [
        key,
        {
          races: summary.races,
          wins: summary.slots.map(({ wins }) => wins),
          rates: summary.slots.map(({ rate }) => rate),
          wilson95: summary.slots.map(({ slotId, wilson95 }) => ({
            slotId,
            ...wilson95,
          })),
          uniformityP: summary.uniformity.pValue,
          cramersV: summary.uniformity.cramersV,
          linearXP: summary.conditionalPositionScore.linear.pValue,
          quadraticEdgeP:
            summary.conditionalPositionScore.quadraticEdge.pValue,
          jointXEdgeP: summary.conditionalPositionScore.joint.pValue,
          maxMinusMin: summary.maxMinusMin,
        },
      ]),
    ),
    holm: inference.holm.map(({ id, rawP, adjustedP, significant }) => ({
      id,
      rawP,
      adjustedP,
      significant,
    })),
    decision: inference.decision,
  };
}

async function main() {
  const races = parseRacesPerCount();
  const legacyRaces = parseLegacyRacesPerCount();
  const participantCounts = parseParticipantCounts();
  const startedAt = performance.now();
  const workerResults = await Promise.all(
    participantCounts.map((participantCount) =>
      runWorker({ participantCount, races, legacyRaces }),
    ),
  );
  const primarySummaries = workerResults.map((result) =>
    summarizeWorkerResult(
      result,
      result.samples.filter(({ seedBatch }) => seedBatch === "primary"),
    ),
  );
  const primaryInference = inferenceForSummaries(primarySummaries);
  const legacyInference =
    legacyRaces > 0
      ? inferenceForSummaries(
          workerResults.map((result) =>
            summarizeWorkerResult(
              result,
              result.samples.filter(
                ({ seedBatch }) => seedBatch === "legacy-exploratory",
              ),
            ),
          ),
        )
      : null;
  const combinedInference =
    legacyRaces > 0
      ? inferenceForSummaries(
          workerResults.map((result) =>
            summarizeWorkerResult(result, result.samples),
          ),
        )
      : null;

  console.log(
    JSON.stringify(
      {
        design: {
          participantCounts,
          racesPerCount: races,
          legacyExploratoryRacesPerCount: legacyRaces,
          primaryTotalRaces: races * participantCounts.length,
          executedTotalRaces:
            (races + legacyRaces) * participantCounts.length,
          alpha: ALPHA,
          slotDefinition:
            "slot-1..slot-N are the realized left-to-right start positions.",
          seedDomains: {
            race: "position-fairness-race-v1",
            layout: "position-fairness-layout-v1",
            optionalLegacyRace: "position-fairness-v1",
            optionalLegacyLayout: "position-layout-v1",
          },
          candidateIdentity:
            "Fixed opaque candidate IDs are used because physics reads slot labels; production candidate-to-slot assignment is a separate seeded shuffle.",
          tests:
            `Pearson uniformity plus conditional score tests using each race's realized start x; Holm adjusts all ${participantCounts.length * 4} reported hypotheses.`,
        },
        compactSummary: compactInference(primaryInference),
        ...primaryInference,
        legacyExploratory:
          legacyInference === null
            ? null
            : {
                compactSummary: compactInference(legacyInference),
                ...legacyInference,
              },
        combinedWithLegacyExploratory:
          combinedInference === null
            ? null
            : {
                compactSummary: compactInference(combinedInference),
                ...combinedInference,
              },
        elapsedSeconds: (performance.now() - startedAt) / 1000,
      },
      null,
      2,
    ),
  );
}

const workerParticipantCount = parseWorkerParticipantCount();
if (workerParticipantCount === null) {
  await main();
} else {
  console.log(
    JSON.stringify(
      measureParticipantCount(
        workerParticipantCount,
        parseRacesPerCount(),
        parseLegacyRacesPerCount(),
      ),
    ),
  );
}
