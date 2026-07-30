import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createResultPresentationProjection,
  createResultPresentationState,
  createStagePresentationAnchor,
  isCurrentResultPresentation,
  reduceResultPresentation,
  RESULT_PRESENTATION_PHASES,
  RESULT_PRESENTATION_TRANSITIONS,
  resultPresentationToken,
} from "../app/_platform/presentation";
import type {
  ResultPresentationState,
} from "../app/_platform/presentation";

const projection = (
  runId = "run-1",
  presentationId = "reveal-1",
) => createResultPresentationProjection({
  gameId: "showdown",
  runId,
  presentationId,
  committedAt: "2026-07-27T00:00:00.000Z",
  anchor: createStagePresentationAnchor({
    xRatio: 0.5,
    yRatio: 0.9,
    sourceId: "finish-line",
  }),
  primaryWinners: [{ participantId: "p1", name: "아모레또" }],
  rankingRows: [
    { participantId: "p1", rank: 1 },
    { participantId: "p2", rank: null },
  ],
  summary: { elapsedMs: 30_000 },
});

/**
 * Each game is read together with the module that owns its presentation
 * layer. The reducer call moved out of the component, but the contract being
 * checked is unchanged: a game must drive the common reducer, not roll its own.
 */
const showdownSource = [
  "../app/games/showdown/ShowdownGame.tsx",
  "../app/games/showdown/resultPresentation.ts",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const rouletteSource = [
  "../app/games/roulette/RouletteGame.tsx",
  "../app/games/roulette/lib/roundContract.ts",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

test("presentation phases and transitions preserve the approved sequence", () => {
  assert.deepEqual(RESULT_PRESENTATION_PHASES, [
    "live",
    "evidence",
    "hero",
    "docking",
    "settled",
  ]);
  assert.deepEqual(RESULT_PRESENTATION_TRANSITIONS, {
    live: ["evidence"],
    evidence: ["hero"],
    hero: ["docking"],
    docking: ["settled"],
    settled: ["evidence"],
  });
});

test("stage anchors use validated normalized coordinates", () => {
  const anchor = createStagePresentationAnchor({
    xRatio: 0.25,
    yRatio: 0.75,
  });
  assert.deepEqual(anchor, {
    coordinateSpace: "stage-normalized",
    xRatio: 0.25,
    yRatio: 0.75,
  });
  assert.equal(Object.isFrozen(anchor), true);
  assert.throws(
    () => createStagePresentationAnchor({ xRatio: -0.01, yRatio: 0.5 }),
    RangeError,
  );
  assert.throws(
    () => createStagePresentationAnchor({
      xRatio: 0.5,
      yRatio: Number.NaN,
    }),
    RangeError,
  );
});

test("a committed result advances without changing its immutable projection", () => {
  let state: ResultPresentationState =
    createResultPresentationState("run-1");
  const committed = projection();
  state = reduceResultPresentation(state, {
    type: "result-committed",
    projection: committed,
  });

  const token = resultPresentationToken(state);
  assert.ok(token);
  assert.equal(state.phase, "evidence");
  assert.equal(state.projection, committed);
  assert.equal(Object.isFrozen(committed), true);
  assert.equal(Object.isFrozen(committed.primaryWinners), true);
  assert.equal(Object.isFrozen(committed.rankingRows), true);

  state = reduceResultPresentation(state, {
    type: "evidence-complete",
    token,
  });
  assert.equal(state.phase, "hero");
  state = reduceResultPresentation(state, {
    type: "hero-complete",
    token,
  });
  assert.equal(state.phase, "docking");
  state = reduceResultPresentation(state, {
    type: "docking-complete",
    token,
  });
  assert.equal(state.phase, "settled");
  assert.equal(state.projection, committed);
});

test("projection data is deeply copied and frozen from mutable game state", () => {
  const winner = {
    participantId: "p1",
    profile: { name: "아모레또" },
  };
  const row = {
    participantId: "p1",
    finish: { rank: 1 },
  };
  const summary = {
    elapsed: { milliseconds: 30_000 },
  };
  const committed = createResultPresentationProjection({
    gameId: "showdown",
    runId: "run-1",
    presentationId: "reveal-1",
    committedAt: "2026-07-27T00:00:00.000Z",
    anchor: createStagePresentationAnchor({
      xRatio: 0.5,
      yRatio: 0.9,
    }),
    primaryWinners: [winner],
    rankingRows: [row],
    summary,
  });

  winner.profile.name = "변경";
  row.finish.rank = 2;
  summary.elapsed.milliseconds = 99_000;

  assert.equal(committed.primaryWinners[0].profile.name, "아모레또");
  assert.equal(committed.rankingRows[0].finish.rank, 1);
  assert.equal(committed.summary.elapsed.milliseconds, 30_000);
  assert.equal(Object.isFrozen(committed.primaryWinners[0]), true);
  assert.equal(Object.isFrozen(committed.primaryWinners[0].profile), true);
  assert.equal(Object.isFrozen(committed.rankingRows[0].finish), true);
  assert.equal(Object.isFrozen(committed.summary.elapsed), true);
});

test("late callbacks from another run or presentation are ignored", () => {
  let state = reduceResultPresentation(
    createResultPresentationState("run-1"),
    { type: "result-committed", projection: projection() },
  );
  const before = state;

  state = reduceResultPresentation(state, {
    type: "evidence-complete",
    token: { runId: "old-run", presentationId: "reveal-1" },
  });
  assert.equal(state, before);
  state = reduceResultPresentation(state, {
    type: "evidence-complete",
    token: { runId: "run-1", presentationId: "old-reveal" },
  });
  assert.equal(state, before);
  assert.equal(
    isCurrentResultPresentation(state, {
      runId: "run-1",
      presentationId: "reveal-1",
    }),
    true,
  );
});

test("run changes use compare-and-swap guards against stale start events", () => {
  let state: ResultPresentationState = createResultPresentationState();
  state = reduceResultPresentation(state, {
    type: "run-started",
    previousRunId: null,
    runId: "run-1",
  });
  assert.equal(state.runId, "run-1");

  const current = state;
  state = reduceResultPresentation(state, {
    type: "run-started",
    previousRunId: null,
    runId: "stale-run",
  });
  assert.equal(state, current);

  state = reduceResultPresentation(state, {
    type: "run-started",
    previousRunId: "run-1",
    runId: "run-2",
  });
  assert.deepEqual(state, createResultPresentationState("run-2"));

  const beforeStaleCommit = state;
  state = reduceResultPresentation(state, {
    type: "result-committed",
    projection: projection("run-1", "late-reveal"),
  });
  assert.equal(state, beforeStaleCommit);
});

test("replay needs the settled current token and a fresh presentation id", () => {
  let state = reduceResultPresentation(
    createResultPresentationState("run-1"),
    { type: "result-committed", projection: projection() },
  );
  const token = resultPresentationToken(state);
  assert.ok(token);
  state = reduceResultPresentation(state, {
    type: "evidence-complete",
    token,
  });
  state = reduceResultPresentation(state, {
    type: "hero-complete",
    token,
  });
  state = reduceResultPresentation(state, {
    type: "docking-complete",
    token,
  });

  const settled = state;
  state = reduceResultPresentation(state, {
    type: "presentation-restarted",
    token: { runId: "run-1", presentationId: "stale-reveal" },
    projection: projection("run-1", "reveal-2"),
  });
  assert.equal(state, settled);

  state = reduceResultPresentation(state, {
    type: "presentation-restarted",
    token,
    projection: projection("run-1", "reveal-2"),
  });
  assert.equal(state.phase, "evidence");
  assert.equal(state.presentationId, "reveal-2");
});

test("Showdown keeps the race surface mounted and gates actions on settled presentation", () => {
  assert.match(showdownSource, /createShowdownResultProjection/);
  assert.match(showdownSource, /reduceResultPresentation/);
  assert.match(showdownSource, /<RaceCanvas/);
  assert.doesNotMatch(showdownSource, /showdown-game result-screen/);
  assert.match(
    showdownSource,
    /const resultPresentationSettled =[\s\S]*?resultPresentation\.phase === "settled"/,
  );
  assert.match(showdownSource, /\{resultPresentationSettled && \(/);
});

test("Roulette keeps its hero mounted through docking and uses the common reducer", () => {
  assert.match(rouletteSource, /rouletteResultPresentationReducer/);
  assert.match(rouletteSource, /createResultPresentationProjection/);
  assert.match(
    rouletteSource,
    /presentationBeat === 'hero' \|\| presentationBeat === 'dock'/,
  );
  assert.match(rouletteSource, /className="broadcast-focus__winner-hero"/);
});
