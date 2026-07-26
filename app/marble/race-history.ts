import type { StoredRaceResult } from "./types";

export type RaceHistoryCheckpoint = {
  runId: string;
  arrivedCount: number;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value)
    && value.every((item) => typeof item === "string")
  );
}

function parseStoredRaceResult(value: unknown): StoredRaceResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.runId !== "string"
    || typeof item.title !== "string"
    || typeof item.raceSeed !== "string"
    || typeof item.layoutSeed !== "string"
    || typeof item.createdAt !== "string"
    || !isStringArray(item.rankedNames)
  ) {
    return null;
  }

  const winnerNames = isStringArray(item.winnerNames)
    ? item.winnerNames
    : typeof item.winnerName === "string"
      ? [item.winnerName]
      : [];

  return {
    runId: item.runId,
    title: item.title,
    raceSeed: item.raceSeed,
    layoutSeed: item.layoutSeed,
    createdAt: item.createdAt,
    winnerNames,
    winnerName:
      typeof item.winnerName === "string" ? item.winnerName : undefined,
    rankedNames: item.rankedNames,
  };
}

export function parseStoredRaceHistory(
  value: string | null,
  limit = 20,
): StoredRaceResult[] {
  if (!value) return [];
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Race history limit must be a positive integer.");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredRaceResult)
      .filter((item): item is StoredRaceResult => item !== null)
      .slice(0, limit);
  } catch {
    return [];
  }
}

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
