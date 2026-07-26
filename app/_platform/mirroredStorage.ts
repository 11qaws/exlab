export type BrowserStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type MirroredStorageKeys = {
  canonical: string;
  legacy: readonly string[];
};

/**
 * Reads a validated canonical value first, then tries legacy keys in order.
 * A valid legacy value is normalized into the canonical key without deleting
 * the rollback copy. Migration write failures never hide otherwise usable data.
 */
export function readMirroredStorage<T>(
  storage: BrowserStorage,
  keys: MirroredStorageKeys,
  parse: (raw: string | null) => T | null,
): T | null {
  const canonical = parse(storage.getItem(keys.canonical));
  if (canonical !== null) return canonical;

  for (const legacyKey of keys.legacy) {
    const legacy = parse(storage.getItem(legacyKey));
    if (legacy === null) continue;
    try {
      storage.setItem(keys.canonical, JSON.stringify(legacy));
    } catch {
      // The validated legacy value remains usable for this session.
    }
    return legacy;
  }

  return null;
}

/** Writes every compatibility key even if one individual storage call fails. */
export function writeMirroredStorage(
  storage: BrowserStorage,
  keys: MirroredStorageKeys,
  value: string,
): void {
  let firstFailure: unknown;
  for (const key of [keys.canonical, ...keys.legacy]) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure) throw firstFailure;
}

/** Clears canonical and rollback keys together. */
export function removeMirroredStorage(
  storage: BrowserStorage,
  keys: MirroredStorageKeys,
): void {
  let firstFailure: unknown;
  for (const key of [keys.canonical, ...keys.legacy]) {
    try {
      storage.removeItem(key);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure) throw firstFailure;
}
