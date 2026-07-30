import {
  COURSE_BUMPERS,
  COURSE_SECTIONS,
  MARBLE_RADIUS,
  ROTATING_BARS,
  STRAIGHT_ZONES,
} from "../app/games/showdown/course";
import { LEADER_FOCUS_DELAY_FRAMES } from "../app/games/showdown/camera";
import { simulateRace } from "../app/games/showdown/simulation";
import type { RaceFrame } from "../app/games/showdown/types";

type Point = { x: number; y: number };
type MeasuredObstacle = {
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  angle?: number;
};

function pointToObstacleDistance(
  point: Point,
  obstacle: MeasuredObstacle,
  angle = obstacle.angle ?? 0,
): number {
  if (obstacle.radius !== undefined) {
    return (
      Math.hypot(point.x - obstacle.x, point.y - obstacle.y) -
      obstacle.radius
    );
  }

  const cosine = Math.cos(-angle);
  const sine = Math.sin(-angle);
  const dx = point.x - obstacle.x;
  const dy = point.y - obstacle.y;
  const localX = dx * cosine - dy * sine;
  const localY = dx * sine + dy * cosine;
  const outsideX = Math.max(
    Math.abs(localX) - (obstacle.width ?? 0) / 2,
    0,
  );
  const outsideY = Math.max(
    Math.abs(localY) - (obstacle.height ?? 0) / 2,
    0,
  );
  return Math.hypot(outsideX, outsideY);
}

function sectionIdForFrame(frame: RaceFrame, leader: string): string {
  const leaderY =
    frame.poses.find((pose) => pose.slotId === leader)?.y ?? 0;
  return (
    COURSE_SECTIONS.find(
      (section) => leaderY >= section.startY && leaderY < section.endY,
    )?.id ?? COURSE_SECTIONS.at(-1)!.id
  );
}

function emptySectionCounts(): Record<string, number> {
  return Object.fromEntries(
    COURSE_SECTIONS.map((section) => [section.id, 0]),
  );
}

function spearmanRankCorrelation(
  firstOrder: string[],
  secondOrder: string[],
): number {
  const count = Math.min(firstOrder.length, secondOrder.length);
  if (count < 2) return 1;
  const secondRanks = new Map(
    secondOrder.map((slotId, index) => [slotId, index]),
  );
  const squaredDistance = firstOrder
    .slice(0, count)
    .reduce((sum, slotId, index) => {
      const secondRank = secondRanks.get(slotId) ?? count - 1;
      return sum + (index - secondRank) ** 2;
    }, 0);
  return (
    1 -
    (6 * squaredDistance) /
      (count * (count ** 2 - 1))
  );
}

function leaderChanges(frames: RaceFrame[]): {
  raw: number;
  confirmed: number;
  rawBySection: Record<string, number>;
  confirmedBySection: Record<string, number>;
} {
  const leaders = frames.map((frame) => frame.rankedSlotIds[0]);
  let raw = 0;
  let confirmed = 0;
  const rawBySection = emptySectionCounts();
  const confirmedBySection = emptySectionCounts();
  let rawLeader = leaders[0];
  let focusedLeader = leaders[0];
  let pendingLeader: string | null = null;
  let pendingSince = 0;

  leaders.slice(1).forEach((leader, offset) => {
    const frameIndex = offset + 1;
    if (leader !== rawLeader) {
      raw += 1;
      rawBySection[sectionIdForFrame(frames[frameIndex], leader)] += 1;
      rawLeader = leader;
    }
    if (leader === focusedLeader) {
      pendingLeader = null;
      return;
    }
    if (leader !== pendingLeader) {
      pendingLeader = leader;
      pendingSince = frameIndex;
      return;
    }
    if (frameIndex - pendingSince >= LEADER_FOCUS_DELAY_FRAMES) {
      focusedLeader = leader;
      pendingLeader = null;
      confirmed += 1;
      confirmedBySection[
        sectionIdForFrame(frames[frameIndex], leader)
      ] += 1;
    }
  });
  return { raw, confirmed, rawBySection, confirmedBySection };
}

function measureRace(participantCount: number, seedIndex: number) {
  const slotToCandidateId = Object.fromEntries(
    Array.from({ length: participantCount }, (_, index) => [
      `slot-${index + 1}`,
      `benchmark-candidate-${index + 1}`,
    ]),
  );
  const simulation = simulateRace(
    slotToCandidateId,
    `obstacle-benchmark-${participantCount}-${seedIndex}`,
    `obstacle-layout-${participantCount}-${seedIndex}`,
  );
  const lastMeasuredFrame = Math.max(0, simulation.firstFinishFrameIndex);
  const leaderGaps = simulation.frames
    .slice(0, lastMeasuredFrame + 1)
    .flatMap((frame) => {
      const leader = frame.poses.find(
        (pose) => pose.slotId === frame.rankedSlotIds[0],
      );
      const runnerUp = frame.poses.find(
        (pose) => pose.slotId === frame.rankedSlotIds[1],
      );
      return leader && runnerUp
        ? [Math.max(0, leader.y - runnerUp.y)]
        : [];
    })
    .sort((left, right) => left - right);
  const leaderGapP95 =
    leaderGaps[
      Math.min(
        leaderGaps.length - 1,
        Math.floor(leaderGaps.length * 0.95),
      )
    ] ?? 0;
  const activeContacts = new Set<string>();
  const touchedAny = new Set<string>();
  const touchedBumper = new Set<string>();
  const touchedFinalRiskBumper = new Set<string>();
  const touchedSpinner = new Set<string>();
  const touchedFinalSpinner = new Set<string>();
  let contactEpisodes = 0;
  let finalRiskBumperContactEpisodes = 0;
  let finalSpinnerContactEpisodes = 0;
  const finalSpinnerIndex = ROTATING_BARS.findIndex(
    (bar) => bar.placement === "finish-entrance",
  );
  const finalRiskBumperIndex = COURSE_BUMPERS.findIndex(
    (bumper) => bumper.placement === "final-risk",
  );

  simulation.frames
    .slice(0, lastMeasuredFrame + 1)
    .forEach((frame) => {
      const nextContacts = new Set<string>();
      frame.poses.forEach((pose) => {
        COURSE_BUMPERS.forEach((bumper, index) => {
          if (
            pointToObstacleDistance(pose, bumper) <=
            MARBLE_RADIUS + 1
          ) {
            const key = `${pose.slotId}:bumper:${index}`;
            nextContacts.add(key);
            touchedAny.add(pose.slotId);
            touchedBumper.add(pose.slotId);
            if (!activeContacts.has(key)) {
              contactEpisodes += 1;
              if (index === finalRiskBumperIndex) {
                touchedFinalRiskBumper.add(pose.slotId);
                finalRiskBumperContactEpisodes += 1;
              }
            }
          }
        });
        ROTATING_BARS.forEach((bar, index) => {
          if (
            pointToObstacleDistance(
              pose,
              bar,
              frame.rotatingBarAngles[index] ?? bar.baseAngle,
            ) <=
            MARBLE_RADIUS + 1
          ) {
            const key = `${pose.slotId}:spinner:${index}`;
            nextContacts.add(key);
            touchedAny.add(pose.slotId);
            touchedSpinner.add(pose.slotId);
            if (!activeContacts.has(key)) {
              contactEpisodes += 1;
              if (index === finalSpinnerIndex) {
                touchedFinalSpinner.add(pose.slotId);
                finalSpinnerContactEpisodes += 1;
              }
            }
          }
        });
      });
      activeContacts.clear();
      nextContacts.forEach((key) => activeContacts.add(key));
    });

  const changes = leaderChanges(
    simulation.frames.slice(0, lastMeasuredFrame + 1),
  );
  const finalGate = STRAIGHT_ZONES.find(
    (zone) => zone.id === "final-gate",
  )!;
  const finalEntryFrameIndex = simulation.frames.findIndex((frame) =>
    frame.poses.some((pose) => pose.y >= finalGate.startY),
  );
  const safeFinalEntryFrameIndex = Math.max(0, finalEntryFrameIndex);
  const finalEntryFrame =
    simulation.frames[safeFinalEntryFrameIndex];
  const entryOrder = finalEntryFrame.rankedSlotIds;
  const finishOrder = simulation.fullFinishOrder;
  const entryLeaderWon = entryOrder[0] === finishOrder[0];
  const winnerEntryRank = entryOrder.indexOf(finishOrder[0]) + 1;
  const topCount = Math.min(3, participantCount);
  const entryTop = new Set(entryOrder.slice(0, topCount));
  const topThreeRetention =
    finishOrder
      .slice(0, topCount)
      .filter((slotId) => entryTop.has(slotId)).length / topCount;
  let maximumWinnerBacktrack = 0;
  let runningMaximumY =
    finalEntryFrame.poses.find(
      (pose) => pose.slotId === finishOrder[0],
    )?.y ?? 0;
  simulation.frames
    .slice(
      safeFinalEntryFrameIndex,
      simulation.firstFinishFrameIndex + 1,
    )
    .forEach((frame) => {
      const pose = frame.poses.find(
        (candidate) => candidate.slotId === finishOrder[0],
      );
      if (!pose) return;
      runningMaximumY = Math.max(runningMaximumY, pose.y);
      maximumWinnerBacktrack = Math.max(
        maximumWinnerBacktrack,
        runningMaximumY - pose.y,
      );
    });
  return {
    participantCount,
    entrants: participantCount,
    touchedAny: touchedAny.size,
    touchedBumper: touchedBumper.size,
    touchedFinalRiskBumper: touchedFinalRiskBumper.size,
    touchedSpinner: touchedSpinner.size,
    touchedFinalSpinner: touchedFinalSpinner.size,
    contactEpisodes,
    finalRiskBumperContactEpisodes,
    finalSpinnerContactEpisodes,
    rawLeaderChanges: changes.raw,
    confirmedLeaderChanges: changes.confirmed,
    rawLeaderChangesBySection: changes.rawBySection,
    confirmedLeaderChangesBySection: changes.confirmedBySection,
    firstFinishSeconds:
      simulation.firstFinishFrameIndex / 30,
    finalEntryLeaderWon: entryLeaderWon ? 1 : 0,
    winnerEntryRank,
    topThreeRetention,
    finalEntryRankCorrelation: spearmanRankCorrelation(
      entryOrder,
      finishOrder,
    ),
    finalEntryToFinishSeconds:
      (simulation.firstFinishFrameIndex - safeFinalEntryFrameIndex) / 30,
    maximumWinnerBacktrack,
    averageLeaderGap:
      leaderGaps.reduce((sum, gap) => sum + gap, 0) /
      Math.max(1, leaderGaps.length),
    leaderGapP95,
    maximumLeaderGap: leaderGaps.at(-1) ?? 0,
    leaderGapFrames: leaderGaps.length,
    leaderGapFramesAbove1000: leaderGaps.filter((gap) => gap > 1000)
      .length,
  };
}

const seedCountArgument = process.argv.find((value) =>
  value.startsWith("--seeds="),
);
const seedCount = seedCountArgument
  ? Number.parseInt(seedCountArgument.slice("--seeds=".length), 10)
  : 12;
if (!Number.isInteger(seedCount) || seedCount < 1) {
  throw new RangeError("--seeds must be a positive integer.");
}

const samples = [5, 10].flatMap((participantCount) =>
  Array.from({ length: seedCount }, (_, seedIndex) =>
    measureRace(participantCount, seedIndex),
  ),
);

function summarize(
  selected: typeof samples,
) {
  const raceCount = selected.length;
  const entrants = selected.reduce((sum, item) => sum + item.entrants, 0);
  const average = (key: keyof (typeof selected)[number]) =>
    selected.reduce((sum, item) => sum + Number(item[key]), 0) / raceCount;
  return {
    races: raceCount,
    entrants,
    obstacleContactParticipantRate:
      selected.reduce((sum, item) => sum + item.touchedAny, 0) / entrants,
    bumperContactParticipantRate:
      selected.reduce((sum, item) => sum + item.touchedBumper, 0) / entrants,
    finalRiskBumperContactParticipantRate:
      selected.reduce(
        (sum, item) => sum + item.touchedFinalRiskBumper,
        0,
      ) / entrants,
    spinnerContactParticipantRate:
      selected.reduce((sum, item) => sum + item.touchedSpinner, 0) / entrants,
    finalSpinnerContactParticipantRate:
      selected.reduce(
        (sum, item) => sum + item.touchedFinalSpinner,
        0,
      ) / entrants,
    contactEpisodesPerRace: average("contactEpisodes"),
    finalRiskBumperContactEpisodesPerRace: average(
      "finalRiskBumperContactEpisodes",
    ),
    finalSpinnerContactEpisodesPerRace: average(
      "finalSpinnerContactEpisodes",
    ),
    rawLeaderChangesPerRace: average("rawLeaderChanges"),
    confirmedLeaderChangesPerRace: average("confirmedLeaderChanges"),
    rawLeaderChangesPerRaceBySection: Object.fromEntries(
      COURSE_SECTIONS.map((section) => [
        section.id,
        selected.reduce(
          (sum, item) =>
            sum + item.rawLeaderChangesBySection[section.id],
          0,
        ) / raceCount,
      ]),
    ),
    confirmedLeaderChangesPerRaceBySection: Object.fromEntries(
      COURSE_SECTIONS.map((section) => [
        section.id,
        selected.reduce(
          (sum, item) =>
            sum + item.confirmedLeaderChangesBySection[section.id],
          0,
        ) / raceCount,
      ]),
    ),
    firstFinishSeconds: average("firstFinishSeconds"),
    finalEntryLeaderWinRate: average("finalEntryLeaderWon"),
    winnerEntryRank: average("winnerEntryRank"),
    topThreeRetention: average("topThreeRetention"),
    finalEntryRankCorrelation: average("finalEntryRankCorrelation"),
    finalEntryToFinishSeconds: average("finalEntryToFinishSeconds"),
    maximumWinnerBacktrack: average("maximumWinnerBacktrack"),
    averageLeaderGap: average("averageLeaderGap"),
    averageRaceLeaderGapP95: average("leaderGapP95"),
    averageRaceMaximumLeaderGap: average("maximumLeaderGap"),
    maximumLeaderGap: Math.max(
      ...selected.map((sample) => sample.maximumLeaderGap),
    ),
    leaderGapFrameRateAbove1000:
      selected.reduce(
        (sum, sample) => sum + sample.leaderGapFramesAbove1000,
        0,
      ) /
      Math.max(
        1,
        selected.reduce(
          (sum, sample) => sum + sample.leaderGapFrames,
          0,
        ),
      ),
  };
}

console.log(
  JSON.stringify(
    {
      all: summarize(samples),
      byParticipantCount: Object.fromEntries(
        [5, 10].map((participantCount) => [
          participantCount,
          summarize(
            samples.filter(
              (sample) => sample.participantCount === participantCount,
            ),
          ),
        ]),
      ),
    },
    null,
    2,
  ),
);
