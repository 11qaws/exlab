import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_ROULETTE_HISTORY_KEY,
  readStoredRouletteHistory,
  ROULETTE_HISTORY_KEY,
  writeStoredRouletteHistory,
} from "../app/games/roulette/lib/historyStorage";
import {
  LEGACY_PENDING_RAFFLE_KEY,
  PENDING_RAFFLE_KEY,
  readPendingRaffleLock,
  removePendingRaffleLock,
  writePendingRaffleLock,
  type PendingRaffleLock,
} from "../app/games/roulette/lib/pendingRaffle";
import {
  LEGACY_PRIZE_ASSIGNMENT_KEY,
  PRIZE_ASSIGNMENT_KEY,
  readStoredPrizeAssignment,
  removeStoredPrizeAssignment,
  writeStoredPrizeAssignment,
  type StoredPrizeAssignment,
} from "../app/games/roulette/lib/prizeAssignmentStorage";
import type { DrawRecord } from "../app/games/roulette/types";
import {
  LEGACY_SHOWDOWN_HISTORY_KEY,
  readStoredRaceHistory,
  removeStoredRaceHistory,
  SHOWDOWN_HISTORY_KEY,
  writeStoredRaceHistory,
} from "../app/games/showdown/race-history";
import type { StoredRaceResult } from "../app/games/showdown/types";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const LEGACY_MARBLE_RESULT: DrawRecord = {
  id: "legacy-marble",
  createdAt: "2026-07-20T00:00:00.000Z",
  mode: "marble",
  target: "people",
  winner: "이전 당첨자",
};

const CURRENT_ROULETTE_RESULT: DrawRecord = {
  id: "current-wheel",
  createdAt: "2026-07-27T00:00:00.000Z",
  mode: "wheel",
  presentation: "spin",
  target: "people",
  winner: "현재 당첨자",
};

test("Roulette history validates and copies a legacy marble record", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_ROULETTE_HISTORY_KEY,
    JSON.stringify([LEGACY_MARBLE_RESULT, { broken: true }]),
  );

  assert.deepEqual(readStoredRouletteHistory(storage), [
    LEGACY_MARBLE_RESULT,
  ]);
  assert.deepEqual(
    JSON.parse(storage.getItem(ROULETTE_HISTORY_KEY) ?? "null"),
    [LEGACY_MARBLE_RESULT],
  );
  assert.notEqual(storage.getItem(LEGACY_ROULETTE_HISTORY_KEY), null);

  storage.setItem(
    ROULETTE_HISTORY_KEY,
    JSON.stringify([CURRENT_ROULETTE_RESULT]),
  );
  assert.deepEqual(readStoredRouletteHistory(storage), [
    CURRENT_ROULETTE_RESULT,
  ]);
});

test("Roulette history writes canonical and rollback copies", () => {
  const storage = new MemoryStorage();
  writeStoredRouletteHistory(storage, [CURRENT_ROULETTE_RESULT]);

  assert.equal(
    storage.getItem(ROULETTE_HISTORY_KEY),
    storage.getItem(LEGACY_ROULETTE_HISTORY_KEY),
  );
});

test("pending Roulette results migrate, mirror, and clear together", () => {
  const storage = new MemoryStorage();
  const pending: PendingRaffleLock = {
    version: 1,
    roundId: "round-1",
    savedAt: "2026-07-27T00:00:00.000Z",
    records: [LEGACY_MARBLE_RESULT],
  };
  storage.setItem(LEGACY_PENDING_RAFFLE_KEY, JSON.stringify(pending));

  assert.deepEqual(readPendingRaffleLock(storage), pending);
  assert.deepEqual(
    JSON.parse(storage.getItem(PENDING_RAFFLE_KEY) ?? "null"),
    pending,
  );

  writePendingRaffleLock(storage, pending);
  assert.equal(
    storage.getItem(PENDING_RAFFLE_KEY),
    storage.getItem(LEGACY_PENDING_RAFFLE_KEY),
  );

  removePendingRaffleLock(storage);
  assert.equal(storage.getItem(PENDING_RAFFLE_KEY), null);
  assert.equal(storage.getItem(LEGACY_PENDING_RAFFLE_KEY), null);
});

test("invalid pending fallback is never copied into canonical storage", () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_PENDING_RAFFLE_KEY, "{broken");

  assert.equal(readPendingRaffleLock(storage), null);
  assert.equal(storage.getItem(PENDING_RAFFLE_KEY), null);
});

test("prize assignment migration preserves validated recipient progress", () => {
  const storage = new MemoryStorage();
  const assignment: StoredPrizeAssignment = {
    version: 1,
    batchId: "batch-1",
    savedAt: "2026-07-27T00:00:00.000Z",
    source: "manual",
    recipients: [
      { id: "recipient-1", name: "수령자", source: "manual" },
    ],
    assignedRecipientIds: ["recipient-1"],
    results: [
      {
        id: "prize-result",
        createdAt: "2026-07-27T00:00:01.000Z",
        mode: "wheel",
        target: "prizes",
        winner: "상품",
        recipientId: "recipient-1",
        prizeAssignmentBatchId: "batch-1",
      },
    ],
  };
  storage.setItem(
    LEGACY_PRIZE_ASSIGNMENT_KEY,
    JSON.stringify(assignment),
  );

  const migrated = readStoredPrizeAssignment(storage);
  assert.deepEqual(migrated, assignment);
  assert.deepEqual(
    JSON.parse(storage.getItem(PRIZE_ASSIGNMENT_KEY) ?? "null"),
    assignment,
  );

  writeStoredPrizeAssignment(storage, assignment);
  assert.equal(
    storage.getItem(PRIZE_ASSIGNMENT_KEY),
    storage.getItem(LEGACY_PRIZE_ASSIGNMENT_KEY),
  );
  removeStoredPrizeAssignment(storage);
  assert.equal(storage.getItem(PRIZE_ASSIGNMENT_KEY), null);
  assert.equal(storage.getItem(LEGACY_PRIZE_ASSIGNMENT_KEY), null);
});

test("Showdown history migrates winnerName and mirrors subsequent writes", () => {
  const storage = new MemoryStorage();
  const legacy = {
    runId: "run-1",
    title: "Race",
    raceSeed: "race-seed",
    layoutSeed: "layout-seed",
    createdAt: "2026-07-26T00:00:00.000Z",
    winnerName: "이전 우승자",
    rankedNames: ["이전 우승자", "다음 참가자"],
  };
  storage.setItem(LEGACY_SHOWDOWN_HISTORY_KEY, JSON.stringify([legacy]));

  const migrated = readStoredRaceHistory(storage);
  assert.deepEqual(migrated[0].winnerNames, ["이전 우승자"]);
  assert.deepEqual(
    JSON.parse(storage.getItem(SHOWDOWN_HISTORY_KEY) ?? "null"),
    migrated,
  );

  const current: StoredRaceResult = {
    runId: "run-2",
    title: "Showdown",
    raceSeed: "new-race-seed",
    layoutSeed: "new-layout-seed",
    createdAt: "2026-07-27T00:00:00.000Z",
    winnerNames: ["새 우승자"],
    rankedNames: ["새 우승자"],
  };
  writeStoredRaceHistory(storage, [current]);
  assert.equal(
    storage.getItem(SHOWDOWN_HISTORY_KEY),
    storage.getItem(LEGACY_SHOWDOWN_HISTORY_KEY),
  );

  removeStoredRaceHistory(storage);
  assert.equal(storage.getItem(SHOWDOWN_HISTORY_KEY), null);
  assert.equal(storage.getItem(LEGACY_SHOWDOWN_HISTORY_KEY), null);
});
