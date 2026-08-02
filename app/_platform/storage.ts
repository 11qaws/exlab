import {
  DEFAULT_GAME_ID,
  isGameId,
  type GameId,
} from "./catalog";
import { DEFAULT_ROSTER_TEXT } from "./defaultRoster";
import {
  DEFAULT_STREAMER_THEME_ID,
  isStreamerThemeId,
  type StreamerThemeId,
} from "./theme/streamerThemes";
import {
  createSharedRosterSnapshot,
  reconcileSharedRosterSnapshot,
  sharedRosterSnapshotText,
  type SharedParticipant,
  type SharedRosterSnapshot,
} from "./sharedRosterSnapshot";

export const PLATFORM_STORAGE_KEYS = {
  rosterSnapshot: "exlab:roster:v2",
  roster: "exlab:roster:v1",
  rosterMigration: "exlab:roster:migration:v1",
  legacyRaceRoster: "marble-game:roster",
  lastGame: "exlab:last-game:v1",
  allowDuplicateNames: "exlab:allow-duplicate-names:v1",
  streamerTheme: "exlab:theme:v1",
  streamerThemeChoice: "exlab:theme-choice:v2",
} as const;

export const LEGACY_PLATFORM_STORAGE_KEYS = {
  roster: "ex-lab:roster:v1",
  rosterMigration: "ex-lab:roster:migration:v1",
  lastGame: "ex-lab:last-game:v1",
  allowDuplicateNames: "ex-lab:allow-duplicate-names:v1",
  streamerTheme: "ex-lab:theme:v1",
} as const;

export const DEFAULT_SHARED_ROSTER = DEFAULT_ROSTER_TEXT;

const LEGACY_DEFAULT_SHARED_ROSTERS = new Set([
  [
    "레또",
    "레카",
    "세나",
    "코코",
    "망징",
  ].join("\n"),
  [
    "아모",
    "유레카",
    "세나",
    "코코",
    "망징이",
    "로티",
    "토리",
    "마루",
  ].join("\n"),
  [
    "아모레또",
    "유레카",
    "세나",
    "코코",
    "망징이",
    "로티",
    "토리",
    "마루",
  ].join("\n"),
  [
    "아모레또",
    "유레카",
    "세나 아르벨",
    "토로리 코코",
    "망징이",
    "로티",
    "토리",
    "마루",
  ].join("\n"),
  [
    "아모레또",
    "유레카",
    "세나 아르벨",
    "망징이",
    "로티",
    "토리",
    "마루",
  ].join("\n"),
]);

export type PlatformPreferences = {
  roster: SharedRosterSnapshot;
  gameId: GameId;
  streamerThemeId: StreamerThemeId;
};

/**
 * Only complete schema-v2 snapshots are accepted. A malformed value falls back
 * to the mirrored v1 text instead of partially restoring participant identity.
 */
function parseStoredSharedRosterSnapshot(
  value: string | null,
): SharedRosterSnapshot | null {
  if (value === null) return null;

  try {
    const candidate: unknown = JSON.parse(value);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("schemaVersion" in candidate) ||
      candidate.schemaVersion !== 2 ||
      !("revision" in candidate) ||
      typeof candidate.revision !== "number" ||
      !Number.isInteger(candidate.revision) ||
      candidate.revision < 1 ||
      !("allowDuplicateNames" in candidate) ||
      typeof candidate.allowDuplicateNames !== "boolean" ||
      !("participants" in candidate) ||
      !Array.isArray(candidate.participants)
    ) {
      return null;
    }

    const ids = new Set<string>();
    const participants: SharedParticipant[] = [];
    for (let index = 0; index < candidate.participants.length; index += 1) {
      const participant: unknown = candidate.participants[index];
      if (
        typeof participant !== "object" ||
        participant === null ||
        !("id" in participant) ||
        typeof participant.id !== "string" ||
        participant.id.length === 0 ||
        ids.has(participant.id) ||
        !("name" in participant) ||
        typeof participant.name !== "string" ||
        participant.name.length === 0 ||
        !("ordinal" in participant) ||
        participant.ordinal !== index + 1
      ) {
        return null;
      }
      ids.add(participant.id);
      participants.push({
        id: participant.id,
        name: participant.name,
        ordinal: participant.ordinal,
      });
    }

    return {
      schemaVersion: 2,
      revision: candidate.revision,
      participants,
      allowDuplicateNames: candidate.allowDuplicateNames,
    };
  } catch {
    return null;
  }
}

function readSharedRosterText(storage: Storage): string {
  const sharedRoster = storage.getItem(PLATFORM_STORAGE_KEYS.roster);
  if (sharedRoster !== null) return sharedRoster;

  const legacyRoster =
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.roster)
    ?? storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster);
  if (legacyRoster !== null) return legacyRoster;

  return DEFAULT_SHARED_ROSTER;
}

function readDuplicateNamePolicy(storage: Storage): boolean {
  const duplicatePolicy =
    storage.getItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames)
    ?? storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames);
  return duplicatePolicy === "1";
}

function mirrorRosterText(storage: Storage, rosterText: string): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, rosterText);
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.roster, rosterText);
  storage.setItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster, rosterText);
}

function mirrorDuplicateNamePolicy(
  storage: Storage,
  allowDuplicateNames: boolean,
): void {
  storage.setItem(
    PLATFORM_STORAGE_KEYS.allowDuplicateNames,
    allowDuplicateNames ? "1" : "0",
  );
  storage.setItem(
    LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames,
    allowDuplicateNames ? "1" : "0",
  );
}

export function writeSharedRosterSnapshot(
  storage: Storage,
  snapshot: SharedRosterSnapshot,
): void {
  storage.setItem(
    PLATFORM_STORAGE_KEYS.rosterSnapshot,
    JSON.stringify(snapshot),
  );
  mirrorRosterText(storage, sharedRosterSnapshotText(snapshot));
  mirrorDuplicateNamePolicy(storage, snapshot.allowDuplicateNames);
  storage.setItem(PLATFORM_STORAGE_KEYS.rosterMigration, "1");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.rosterMigration, "1");
}

function isPristineInitialRosterSnapshot(
  roster: SharedRosterSnapshot,
): boolean {
  if (roster.revision !== 1) return false;

  const initial = createSharedRosterSnapshot(
    sharedRosterSnapshotText(roster),
    roster.allowDuplicateNames,
  );
  return initial.participants.every((participant, index) => {
    const current = roster.participants[index];
    return (
      current?.id === participant.id &&
      current.name === participant.name &&
      current.ordinal === participant.ordinal
    );
  });
}

function migrateLegacyDefaultRoster(
  roster: SharedRosterSnapshot,
  requirePristineSnapshot: boolean,
): SharedRosterSnapshot {
  if (!LEGACY_DEFAULT_SHARED_ROSTERS.has(sharedRosterSnapshotText(roster))) {
    return roster;
  }
  if (requirePristineSnapshot && !isPristineInitialRosterSnapshot(roster)) {
    return roster;
  }

  return reconcileSharedRosterSnapshot(
    roster,
    DEFAULT_SHARED_ROSTER,
    roster.allowDuplicateNames,
  );
}

export function readPlatformPreferences(storage: Storage): PlatformPreferences {
  const storedRoster = parseStoredSharedRosterSnapshot(
    storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot),
  );
  const restoredRoster =
    storedRoster ??
    createSharedRosterSnapshot(
      readSharedRosterText(storage),
      readDuplicateNamePolicy(storage),
    );
  const roster = migrateLegacyDefaultRoster(
    restoredRoster,
    storedRoster !== null,
  );
  try {
    writeSharedRosterSnapshot(storage, roster);
  } catch {
    // A readable canonical snapshot remains usable when storage is read-only.
  }

  const storedGameId =
    storage.getItem(PLATFORM_STORAGE_KEYS.lastGame)
    ?? storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame);
  const legacyAwareGameId =
    storedGameId === "race"
      ? "showdown"
      : storedGameId;
  const storedTheme =
    storage.getItem(PLATFORM_STORAGE_KEYS.streamerTheme)
    ?? storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme);
  return {
    roster,
    gameId: isGameId(legacyAwareGameId)
      ? legacyAwareGameId
      : DEFAULT_GAME_ID,
    streamerThemeId: isStreamerThemeId(storedTheme)
      ? storedTheme
      : DEFAULT_STREAMER_THEME_ID,
  };
}

export function writeSharedRoster(
  storage: Storage,
  rosterText: string,
): void {
  const storedRoster = parseStoredSharedRosterSnapshot(
    storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot),
  );
  const snapshot = storedRoster
    ? reconcileSharedRosterSnapshot(
        storedRoster,
        rosterText,
        storedRoster.allowDuplicateNames,
      )
    : createSharedRosterSnapshot(
        rosterText,
        readDuplicateNamePolicy(storage),
      );
  writeSharedRosterSnapshot(storage, snapshot);
}

export function writeLastGame(storage: Storage, gameId: GameId): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.lastGame, gameId);
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame, gameId);
}

export function writeDuplicateNamePolicy(
  storage: Storage,
  allowDuplicateNames: boolean,
): void {
  const storedRoster = parseStoredSharedRosterSnapshot(
    storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot),
  );
  if (storedRoster) {
    writeSharedRosterSnapshot(
      storage,
      reconcileSharedRosterSnapshot(
        storedRoster,
        sharedRosterSnapshotText(storedRoster),
        allowDuplicateNames,
      ),
    );
    return;
  }

  mirrorDuplicateNamePolicy(storage, allowDuplicateNames);
}

export function writeStreamerTheme(
  storage: Storage,
  streamerThemeId: StreamerThemeId,
): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.streamerTheme, streamerThemeId);
  storage.setItem(
    LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme,
    streamerThemeId,
  );
}

/**
 * Theme persistence and onboarding completion are deliberately separate.
 * A stored theme may have been written by an older shell before the profile
 * chooser existed, so only this versioned acknowledgement closes the gate.
 */
export function hasStoredStreamerThemeChoice(storage: Storage): boolean {
  return (
    storage.getItem(PLATFORM_STORAGE_KEYS.streamerThemeChoice) === "1"
  );
}

export function writeStreamerThemeChoice(storage: Storage): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.streamerThemeChoice, "1");
}
