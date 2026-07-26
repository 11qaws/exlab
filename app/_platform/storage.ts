import {
  DEFAULT_GAME_ID,
  isGameId,
  type GameId,
} from "./catalog";

export const PLATFORM_STORAGE_KEYS = {
  roster: "ex-lab:roster:v1",
  rosterMigration: "ex-lab:roster:migration:v1",
  legacyRaceRoster: "marble-game:roster",
  lastGame: "ex-lab:last-game:v1",
  allowDuplicateNames: "ex-lab:allow-duplicate-names:v1",
} as const;

export const DEFAULT_SHARED_ROSTER = [
  "아모레또",
  "유레카",
  "세나",
  "코코",
  "망징이",
  "로티",
  "토리",
  "마루",
].join("\n");

export type PlatformPreferences = {
  rosterText: string;
  gameId: GameId;
  allowDuplicateNames: boolean;
};

/**
 * Reads the new shared roster first. If it is absent, the old standalone Race
 * roster is copied once without deleting it, so the previous site remains usable.
 */
function readSharedRoster(storage: Storage): string {
  const sharedRoster = storage.getItem(PLATFORM_STORAGE_KEYS.roster);
  if (sharedRoster !== null) return sharedRoster;

  const migrationComplete =
    storage.getItem(PLATFORM_STORAGE_KEYS.rosterMigration) === "1";
  if (!migrationComplete) {
    const legacyRoster = storage.getItem(
      PLATFORM_STORAGE_KEYS.legacyRaceRoster,
    );
    if (legacyRoster !== null) {
      storage.setItem(PLATFORM_STORAGE_KEYS.roster, legacyRoster);
    }
    storage.setItem(PLATFORM_STORAGE_KEYS.rosterMigration, "1");
    if (legacyRoster !== null) return legacyRoster;
  }

  return DEFAULT_SHARED_ROSTER;
}

export function readPlatformPreferences(storage: Storage): PlatformPreferences {
  const storedGameId = storage.getItem(PLATFORM_STORAGE_KEYS.lastGame);
  const legacyAwareGameId =
    storedGameId === "race"
      ? "showdown"
      : storedGameId;
  return {
    rosterText: readSharedRoster(storage),
    gameId: isGameId(legacyAwareGameId)
      ? legacyAwareGameId
      : DEFAULT_GAME_ID,
    allowDuplicateNames:
      storage.getItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames) === "1",
  };
}

export function writeSharedRoster(
  storage: Storage,
  rosterText: string,
): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, rosterText);
  storage.setItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster, rosterText);
}

export function writeLastGame(storage: Storage, gameId: GameId): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.lastGame, gameId);
}

export function writeDuplicateNamePolicy(
  storage: Storage,
  allowDuplicateNames: boolean,
): void {
  storage.setItem(
    PLATFORM_STORAGE_KEYS.allowDuplicateNames,
    allowDuplicateNames ? "1" : "0",
  );
}
