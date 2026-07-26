import {
  COURSE_BUMPERS,
  COURSE_SECTIONS,
  MARBLE_RADIUS,
  ROTATING_BARS,
} from "../app/marble/course";
import { LEADER_FOCUS_DELAY_FRAMES } from "../app/marble/camera";
import { simulateRace } from "../app/marble/simulation";
import type { RaceFrame } from "../app/marble/types";

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
  const simulation = simulateRace(
    participantCount,
    `obstacle-benchmark-${participantCount}-${seedIndex}`,
    `obstacle-layout-${participantCount}-${seedIndex}`,
  );
  const lastMeasuredFrame = Math.max(0, simulation.firstFinishFrameIndex);
  const activeContacts = new Set<string>();
  const touchedAny = new Set<string>();
  const touchedBumper = new Set<string>();
  const touchedSpinner = new Set<string>();
  let contactEpisodes = 0;

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
            if (!activeContacts.has(key)) contactEpisodes += 1;
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
            if (!activeContacts.has(key)) contactEpisodes += 1;
          }
        });
      });
      activeContacts.clear();
      nextContacts.forEach((key) => activeContacts.add(key));
    });

  const changes = leaderChanges(
    simulation.frames.slice(0, lastMeasuredFrame + 1),
  );
  return {
    participantCount,
    entrants: participantCount,
    touchedAny: touchedAny.size,
    touchedBumper: touchedBumper.size,
    touchedSpinner: touchedSpinner.size,
    contactEpisodes,
    rawLeaderChanges: changes.raw,
    confirmedLeaderChanges: changes.confirmed,
    rawLeaderChangesBySection: changes.rawBySection,
    confirmedLeaderChangesBySection: changes.confirmedBySection,
    firstFinishSeconds:
      simulation.firstFinishFrameIndex / 30,
  };
}

const samples = [5, 10].flatMap((participantCount) =>
  Array.from({ length: 12 }, (_, seedIndex) =>
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
    spinnerContactParticipantRate:
      selected.reduce((sum, item) => sum + item.touchedSpinner, 0) / entrants,
    contactEpisodesPerRace: average("contactEpisodes"),
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
