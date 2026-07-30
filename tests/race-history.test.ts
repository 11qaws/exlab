import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStoredRaceHistory,
  shouldPersistRaceHistoryCheckpoint,
  upsertRaceHistory,
} from "../app/games/showdown/race-history";
import type { StoredRaceResult } from "../app/games/showdown/types";

function stored(
  runId: string,
  rankedNames: string[],
): StoredRaceResult {
  return {
    runId,
    title: "Race",
    raceSeed: `${runId}-race`,
    layoutSeed: `${runId}-layout`,
    createdAt: "2026-07-26T00:00:00.000Z",
    winnerNames: [rankedNames[0] ?? "winner"],
    rankedNames,
  };
}

test("result history persists on result entry and only when arrivals grow", () => {
  assert.equal(
    shouldPersistRaceHistoryCheckpoint(null, "run-1", 1),
    true,
  );
  assert.equal(
    shouldPersistRaceHistoryCheckpoint(
      { runId: "run-1", arrivedCount: 1 },
      "run-1",
      1,
    ),
    false,
  );
  assert.equal(
    shouldPersistRaceHistoryCheckpoint(
      { runId: "run-1", arrivedCount: 1 },
      "run-1",
      2,
    ),
    true,
  );
  assert.equal(
    shouldPersistRaceHistoryCheckpoint(
      { runId: "run-1", arrivedCount: 5 },
      "run-2",
      1,
    ),
    true,
  );
});

test("arrival updates replace one run without duplicating its history row", () => {
  const initial = [stored("run-1", ["가"]), stored("run-0", ["이전"])];
  const updated = upsertRaceHistory(
    initial,
    stored("run-1", ["가", "나"]),
  );

  assert.deepEqual(
    updated.map((item) => item.runId),
    ["run-1", "run-0"],
  );
  assert.deepEqual(updated[0].rankedNames, ["가", "나"]);
});

test("history upsert keeps the newest run first and enforces its limit", () => {
  const history = Array.from({ length: 20 }, (_, index) =>
    stored(`run-${index}`, [`참가자 ${index}`]),
  );
  const next = upsertRaceHistory(history, stored("new-run", ["새 참가자"]));

  assert.equal(next.length, 20);
  assert.equal(next[0].runId, "new-run");
  assert.equal(next.some((item) => item.runId === "run-19"), false);
  assert.throws(
    () => upsertRaceHistory(history, stored("bad", []), 0),
    RangeError,
  );
});

test("stored history drops malformed rows and migrates a legacy winner", () => {
  const valid = stored("valid", ["당첨자"]);
  const parsed = parseStoredRaceHistory(JSON.stringify([
    valid,
    {
      ...valid,
      runId: "legacy",
      winnerNames: undefined,
      winnerName: "이전 당첨자",
    },
    { runId: "broken" },
  ]));

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[1].winnerNames, ["이전 당첨자"]);
  assert.deepEqual(parseStoredRaceHistory("{broken"), []);
});
