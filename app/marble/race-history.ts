import type { StoredRaceResult } from "./types";

export type RaceHistoryCheckpoint = {
  runId: string;
  arrivedCount: number;
};

export function shouldPersistRaceHistoryCheckpoint(
  checkpoint: RaceHistoryCheckpoint | null,
  runId: string,
  arrivedCount: number,
): boolean {
  return (
    checkpoint?.runId !== runId ||
    arrivedCount > checkpoint.arrivedCount
  );
}

export function upsertRaceHistory(
  history: readonly StoredRaceResult[],
  result: StoredRaceResult,
  limit = 20,
): StoredRaceResult[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Race history limit must be a positive integer.");
  }
  return [
    result,
    ...history.filter((item) => item.runId !== result.runId),
  ].slice(0, limit);
}
