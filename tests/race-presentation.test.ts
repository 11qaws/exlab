import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_RACE_GAP,
  FINAL_APPROACH_PROGRESS,
  PHOTO_FINISH_FRAMES,
  findFinalSectionOvertakes,
  findStableLeadChanges,
  isCloseRace,
  isFinalApproach,
  isPhotoFinish,
  latestStableLeadChange,
  resolveArrivalDelta,
  resolveCourseProgress,
  resolveFinishFrameIndex,
} from "../app/marble/race-presentation";
import {
  COURSE_SECTIONS,
  FINISH_Y,
  MARBLE_RADIUS,
} from "../app/marble/course";
import type { RaceFrame } from "../app/marble/types";

function frame(
  order: string[],
  yBySlot: Record<string, number>,
  finishedSlotIds: string[] = [],
): RaceFrame {
  return {
    poses: Object.entries(yBySlot).map(([slotId, y], index) => ({
      slotId,
      x: 420 + index * 40,
      y,
      angle: 0,
    })),
    rankedSlotIds: order,
    finishedSlotIds,
    rotatingBarAngles: [],
    bumperFlashes: [],
  };
}

test("course progress follows the physical leader and current section", () => {
  const section = COURSE_SECTIONS[1];
  const leaderY = (section.startY + section.endY) / 2;
  const progress = resolveCourseProgress(
    frame(["leader", "second"], {
      leader: leaderY,
      second: leaderY - 100,
    }),
  );

  assert.ok(progress);
  assert.equal(progress.leaderSlotId, "leader");
  assert.equal(progress.section.id, section.id);
  assert.equal(progress.sectionIndex, 1);
  assert.equal(progress.sectionProgress, 0.5);
  assert.equal(progress.overall, leaderY / FINISH_Y);

  const finishedProgress = resolveCourseProgress(
    frame(["leader"], { leader: FINISH_Y + 500 }, ["leader"]),
  );
  assert.equal(finishedProgress?.overall, 1);
});

test("stable lead changes ignore short ranking jitter", () => {
  const frames = [
    frame(["a", "b"], { a: 100, b: 80 }),
    ...Array.from({ length: 5 }, (_, index) =>
      frame(["b", "a"], {
        a: 100 + index,
        b: 100 + index + MARBLE_RADIUS,
      }),
    ),
  ];

  assert.deepEqual(findStableLeadChanges(frames), []);
  frames.push(
    frame(["b", "a"], {
      a: 105,
      b: 105 + MARBLE_RADIUS,
    }),
  );

  const changes = findStableLeadChanges(frames);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    frameIndex: 6,
    holdStartFrameIndex: 1,
    fromSlotId: "a",
    toSlotId: "b",
    gap: MARBLE_RADIUS,
  });
  assert.deepEqual(latestStableLeadChange(frames), changes[0]);
});

test("stable lead change waits for a meaningful physical gap", () => {
  const frames = [
    frame(["a", "b"], { a: 100, b: 90 }),
    ...Array.from({ length: 7 }, (_, index) =>
      frame(["b", "a"], {
        a: 110 + index,
        b: 110 + index + MARBLE_RADIUS - 0.1,
      }),
    ),
  ];

  assert.deepEqual(findStableLeadChanges(frames), []);
  frames.push(
    frame(["b", "a"], {
      a: 120,
      b: 120 + MARBLE_RADIUS,
    }),
  );
  assert.equal(findStableLeadChanges(frames)[0].frameIndex, 8);
});

function stableOvertakeAt(y: number): RaceFrame[] {
  return [
    frame(["a", "b"], { a: y, b: y - MARBLE_RADIUS * 2 }),
    ...Array.from({ length: 6 }, (_, index) =>
      frame(["b", "a"], {
        a: y - MARBLE_RADIUS + index,
        b: y + index,
      }),
    ),
  ];
}

test("final-section overtakes cue the physical start of a confirmed change", () => {
  const finalStartY = COURSE_SECTIONS.at(-1)!.startY;
  assert.deepEqual(
    findFinalSectionOvertakes(stableOvertakeAt(finalStartY - 1)),
    [],
  );

  const [overtake] = findFinalSectionOvertakes(
    stableOvertakeAt(finalStartY),
  );
  assert.ok(overtake);
  assert.equal(overtake.overtakeFrameIndex, 1);
  assert.equal(overtake.holdStartFrameIndex, 1);
  assert.equal(overtake.frameIndex, 6);
  assert.equal(overtake.fromSlotId, "a");
  assert.equal(overtake.toSlotId, "b");
});

test("final-section cinematic ignores races for remaining places after first arrival", () => {
  const finalStartY = COURSE_SECTIONS.at(-1)!.startY;
  const postFinishFrames = stableOvertakeAt(finalStartY).map(
    (raceFrame) => ({
      ...raceFrame,
      finishedSlotIds: ["winner"],
    }),
  );

  assert.deepEqual(
    findFinalSectionOvertakes(postFinishFrames, {
      targetFinishCount: 3,
    }),
    [],
  );
});

test("stable lead changes continue through later winner competitions", () => {
  const frames = [
    frame(["a", "b", "c", "d"], {
      a: 140,
      b: 120,
      c: 100,
      d: 80,
    }),
    frame(
      ["a", "b", "c", "d"],
      { a: FINISH_Y + 1, b: 150, c: 130, d: 110 },
      ["a"],
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      frame(
        ["a", "c", "b", "d"],
        {
          a: FINISH_Y + 2 + index,
          b: 160 + index,
          c: 160 + index + MARBLE_RADIUS,
          d: 120 + index,
        },
        ["a"],
      ),
    ),
    frame(
      ["a", "c", "b", "d"],
      {
        a: FINISH_Y + 10,
        b: 190,
        c: FINISH_Y + 1,
        d: 170,
      },
      ["a", "c"],
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      frame(
        ["a", "c", "d", "b"],
        {
          a: FINISH_Y + 11 + index,
          b: 200 + index,
          c: FINISH_Y + 2 + index,
          d: 200 + index + MARBLE_RADIUS,
        },
        ["a", "c"],
      ),
    ),
    frame(
      ["a", "c", "d", "b"],
      {
        a: FINISH_Y + 20,
        b: 220,
        c: FINISH_Y + 10,
        d: FINISH_Y + 1,
      },
      ["a", "c", "d"],
    ),
  ];

  assert.deepEqual(findStableLeadChanges(frames), []);

  const changes = findStableLeadChanges(frames, {
    targetFinishCount: 3,
  });
  assert.deepEqual(
    changes.map(({ frameIndex, fromSlotId, toSlotId }) => ({
      frameIndex,
      fromSlotId,
      toSlotId,
    })),
    [
      { frameIndex: 7, fromSlotId: "b", toSlotId: "c" },
      { frameIndex: 14, fromSlotId: "b", toSlotId: "d" },
    ],
  );
  assert.deepEqual(
    latestStableLeadChange(frames, { targetFinishCount: 3 }),
    changes[1],
  );
});

test("close race and final approach use live positions only", () => {
  assert.equal(
    isCloseRace(
      frame(["a", "b"], {
        a: 500,
        b: 500 - CLOSE_RACE_GAP,
      }),
    ),
    true,
  );
  assert.equal(
    isCloseRace(
      frame(["a", "b"], {
        a: 500,
        b: 499 - CLOSE_RACE_GAP,
      }),
    ),
    false,
  );
  assert.equal(
    isCloseRace(
      frame(
        ["a", "b"],
        { a: FINISH_Y + 10, b: FINISH_Y - 5 },
        ["a"],
      ),
    ),
    false,
  );

  assert.equal(
    isFinalApproach(
      frame(["a", "b"], {
        a: FINISH_Y * FINAL_APPROACH_PROGRESS,
        b: 100,
      }),
    ),
    true,
  );
  assert.equal(
    isFinalApproach(
      frame(["a", "b"], {
        a: FINISH_Y * FINAL_APPROACH_PROGRESS - 1,
        b: 100,
      }),
    ),
    false,
  );
});

function finishFrames(
  firstFrameIndex: number,
  secondFrameIndex: number,
): RaceFrame[] {
  return Array.from({ length: secondFrameIndex + 1 }, (_, frameIndex) => {
    const finished =
      frameIndex >= secondFrameIndex
        ? ["a", "b"]
        : frameIndex >= firstFrameIndex
          ? ["a"]
          : [];
    return frame(
      ["a", "b"],
      { a: FINISH_Y + frameIndex, b: FINISH_Y - 10 + frameIndex },
      finished,
    );
  });
}

test("arrival delta is derived from cumulative physical finish frames", () => {
  const frames = finishFrames(2, 5);
  assert.equal(resolveFinishFrameIndex(frames, 1), 2);
  assert.equal(resolveFinishFrameIndex(frames, 2), 5);
  assert.equal(resolveFinishFrameIndex(frames.slice(0, 4), 2), null);
  assert.deepEqual(resolveArrivalDelta(frames), {
    firstPlace: 1,
    secondPlace: 2,
    firstSlotId: "a",
    secondSlotId: "b",
    firstFrameIndex: 2,
    secondFrameIndex: 5,
    deltaFrames: 3,
    deltaMs: 100,
    deltaSeconds: 0.1,
  });
  assert.equal(resolveArrivalDelta(frames.slice(0, 4)), null);
});

test("photo finish uses the exported physical arrival-time window", () => {
  assert.equal(isPhotoFinish(finishFrames(1, 1 + PHOTO_FINISH_FRAMES)), true);
  assert.equal(
    isPhotoFinish(finishFrames(1, 2 + PHOTO_FINISH_FRAMES)),
    false,
  );
});

test("invalid thresholds fail explicitly", () => {
  const sample = frame(["a", "b"], { a: 100, b: 90 });
  assert.throws(
    () => findStableLeadChanges([sample], { holdFrames: 0 }),
    RangeError,
  );
  assert.throws(
    () =>
      findStableLeadChanges([sample], {
        targetFinishCount: 0,
      }),
    RangeError,
  );
  assert.throws(() => isCloseRace(sample, -1), RangeError);
  assert.throws(() => isFinalApproach(sample, 2), RangeError);
  assert.throws(
    () => resolveArrivalDelta([sample], 2, 1),
    RangeError,
  );
  assert.throws(() => isPhotoFinish([sample], -1), RangeError);
});
