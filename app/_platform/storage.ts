import {
  DEFAULT_GAME_ID,
  isGameId,
  type GameId,
} from "./catalog";
import {
  DEFAULT_STREAMER_THEME_ID,
  STREAMER_THEMES,
  isStreamerThemeId,
  type StreamerThemeId,
} from "./theme/streamerThemes";

export const PLATFORM_STORAGE_KEYS = {
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

export const DEFAULT_SHARED_ROSTER = [
  ...STREAMER_THEMES.map(({ name }) => name),
  "로티",
  "토리",
  "마루",
].join("\n");

export type PlatformPreferences = {
  rosterText: string;
  gameId: GameId;
  allowDuplicateNames: boolean;
  streamerThemeId: StreamerThemeId;
};

/**
 * Reads the canonical shared roster first. Previous shell and standalone Race
 * keys stay mirrored during the exlab migration so rollback never loses a list.
 */
function readSharedRoster(storage: Storage): string {
  const sharedRoster = storage.getItem(PLATFORM_STORAGE_KEYS.roster);
  if (sharedRoster !== null) return sharedRoster;

  const legacyRoster =
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.roster)
    ?? storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster);
  if (legacyRoster !== null) {
    storage.setItem(PLATFORM_STORAGE_KEYS.roster, legacyRoster);
  }
  storage.setItem(PLATFORM_STORAGE_KEYS.rosterMigration, "1");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.rosterMigration, "1");
  if (legacyRoster !== null) return legacyRoster;

  return DEFAULT_SHARED_ROSTER;
}

export function readPlatformPreferences(storage: Storage): PlatformPreferences {
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
  const duplicatePolicy =
    storage.getItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames)
    ?? storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames);
  return {
    rosterText: readSharedRoster(storage),
    gameId: isGameId(legacyAwareGameId)
      ? legacyAwareGameId
      : DEFAULT_GAME_ID,
    allowDuplicateNames: duplicatePolicy === "1",
    streamerThemeId: isStreamerThemeId(storedTheme)
      ? storedTheme
      : DEFAULT_STREAMER_THEME_ID,
  };
}

export function writeSharedRoster(
  storage: Storage,
  rosterText: string,
): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, rosterText);
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.roster, rosterText);
  storage.setItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster, rosterText);
}

export function writeLastGame(storage: Storage, gameId: GameId): void {
  storage.setItem(PLATFORM_STORAGE_KEYS.lastGame, gameId);
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame, gameId);
}

export function writeDuplicateNamePolicy(
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
