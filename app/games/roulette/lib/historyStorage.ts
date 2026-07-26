import {
  readMirroredStorage,
  writeMirroredStorage,
  type BrowserStorage,
} from '../../../_platform/mirroredStorage';
import type { DrawRecord } from '../types';

export const ROULETTE_HISTORY_KEY = 'exlab:roulette:history:v1';
export const LEGACY_ROULETTE_HISTORY_KEY = 'retto-roulette-history';

const ROULETTE_HISTORY_KEYS = {
  canonical: ROULETTE_HISTORY_KEY,
  legacy: [LEGACY_ROULETTE_HISTORY_KEY],
} as const;

function isStoredDrawRecord(value: unknown): value is DrawRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DrawRecord>;
  return typeof item.id === 'string'
    && typeof item.createdAt === 'string'
    && (item.mode === 'wheel' || item.mode === 'marble')
    && (item.target === 'people' || item.target === 'prizes')
    && typeof item.winner === 'string';
}

export function parseStoredRouletteHistory(
  raw: string | null,
  limit = 100,
): DrawRecord[] | null {
  if (!raw) return null;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Roulette history limit must be a positive integer.');
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isStoredDrawRecord).slice(0, limit);
  } catch {
    return null;
  }
}

export function readStoredRouletteHistory(
  storage: BrowserStorage,
  limit = 100,
): DrawRecord[] {
  return readMirroredStorage(
    storage,
    ROULETTE_HISTORY_KEYS,
    (raw) => parseStoredRouletteHistory(raw, limit),
  ) ?? [];
}

export function writeStoredRouletteHistory(
  storage: BrowserStorage,
  history: readonly DrawRecord[],
  limit = 100,
): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Roulette history limit must be a positive integer.');
  }
  writeMirroredStorage(
    storage,
    ROULETTE_HISTORY_KEYS,
    JSON.stringify(history.slice(0, limit)),
  );
}
