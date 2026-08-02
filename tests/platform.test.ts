import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_GAME_ID,
  GAME_CATALOG,
  gameCatalogEntry,
  isGameId,
} from "../app/_platform/catalog";
import {
  extractNaverCafeCommentAuthors,
} from "../app/_platform/cafeCommentParser";
import {
  GAME_LIFECYCLE_STATES,
  GAME_LIFECYCLE_TRANSITIONS,
  isGameSwitchLocked,
  type EmbeddedGameProps,
} from "../app/_platform/contracts";
import {
  DEFAULT_SHARED_ROSTER,
  LEGACY_PLATFORM_STORAGE_KEYS,
  PLATFORM_STORAGE_KEYS,
  hasStoredStreamerThemeChoice,
  readPlatformPreferences,
  writeDuplicateNamePolicy,
  writeLastGame,
  writeSharedRoster,
  writeSharedRosterSnapshot,
  writeStreamerTheme,
  writeStreamerThemeChoice,
} from "../app/_platform/storage";
import {
  createSharedRosterSnapshot,
  reconcileSharedRosterSnapshot,
  sharedRosterSnapshotText,
} from "../app/_platform/sharedRosterSnapshot";
import {
  DEFAULT_STREAMER_THEME_ID,
} from "../app/_platform/theme/streamerThemes";
import {
  parseSharedRosterNames,
  sharedRosterNameKey,
  sharedRosterNameLength,
  validateSharedRosterDraft,
} from "../app/_platform/roster";

const standaloneGameProps: EmbeddedGameProps = {};
// @ts-expect-error Embedded games must receive the complete host contract.
const incompleteEmbeddedGameProps: EmbeddedGameProps = { embedded: true };
void standaloneGameProps;
void incompleteEmbeddedGameProps;

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("game catalog is serializable and future-game friendly", () => {
  assert.equal(DEFAULT_GAME_ID, "showdown");
  assert.deepEqual(
    GAME_CATALOG.map(({ id, label }) => ({ id, label })),
    [
      { id: "roulette", label: "Roulette" },
      { id: "showdown", label: "Showdown" },
    ],
  );
  assert.equal(isGameId("roulette"), true);
  assert.equal(isGameId("showdown"), true);
  assert.equal(isGameId("race"), false);
  assert.equal(isGameId("marble"), false);
  assert.equal(
    gameCatalogEntry("showdown").capabilities.maxParticipantsPerRun,
    10,
  );
  assert.doesNotThrow(() => JSON.stringify(GAME_CATALOG));
});

test("platform lifecycle locks every state that owns a run", () => {
  assert.deepEqual(GAME_LIFECYCLE_STATES, [
    "editing",
    "generating",
    "waiting",
    "active",
    "settling",
    "result",
    "failed",
  ]);
  assert.equal(isGameSwitchLocked("editing"), false);
  for (const state of GAME_LIFECYCLE_STATES.slice(1)) {
    assert.equal(isGameSwitchLocked(state), true, state);
  }
  assert.deepEqual(GAME_LIFECYCLE_TRANSITIONS.waiting, [
    "active",
    "editing",
  ]);
  assert.deepEqual(GAME_LIFECYCLE_TRANSITIONS.result, [
    "generating",
    "waiting",
    "active",
    "editing",
  ]);
});

test("host uses catalog-driven lifecycle and one shared roster snapshot", async () => {
  const appSource = await readFile(
    new URL("../app/ExlabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    appSource,
    /GAME_CATALOG\.reduce\(\(states, game\) =>/,
  );
  assert.match(
    appSource,
    /useState<GameHostStateByGame>\(createInitialGameHostStateByGame\)/,
  );
  assert.match(
    appSource,
    /isGameSwitchLocked\(selectedHostState\.lifecycle\) \|\| rosterEditorOpen/,
  );
  assert.match(
    appSource,
    /const openRosterEditor = useCallback\(\(\) => \{\s*if \(navigationLocked\) return;/,
  );
  assert.match(appSource, /roster=\{roster\}/);
  assert.match(appSource, /visible=\{isActiveGame\}/);
  assert.match(
    appSource,
    /onHostStateChange=\{hostStateHandlers\[game\.id\]\}/,
  );
  assert.match(
    appSource,
    /setRoster\(\(current\) =>\s+reconcileSharedRosterSnapshot\(/,
  );
  assert.doesNotMatch(appSource, /activityByGame/);
});

test("fresh platform storage uses the exact shared four-person default", () => {
  const storage = new MemoryStorage();

  const preferences = readPlatformPreferences(storage);

  assert.equal(DEFAULT_SHARED_ROSTER, "레또\n레카\n세나\n망징");
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    DEFAULT_SHARED_ROSTER,
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.roster),
    DEFAULT_SHARED_ROSTER,
  );
  assert.equal(
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.roster),
    DEFAULT_SHARED_ROSTER,
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    DEFAULT_SHARED_ROSTER,
  );
});

test("known legacy product defaults migrate once to the four-person roster", () => {
  const legacyDefaults = [
    "레또\n레카\n세나\n코코\n망징",
    "아모레또\n유레카\n세나\n코코\n망징이",
    "아모\n유레카\n세나\n코코\n망징이\n로티\n토리\n마루",
    "아모레또\n유레카\n세나\n코코\n망징이\n로티\n토리\n마루",
    "아모레또\n유레카\n세나 아르벨\n토로리 코코\n망징이\n로티\n토리\n마루",
    "아모레또\n유레카\n세나 아르벨\n망징이\n로티\n토리\n마루",
  ];

  legacyDefaults.forEach((legacyDefault) => {
    const storage = new MemoryStorage();
    const legacySnapshot = createSharedRosterSnapshot(legacyDefault, true);
    storage.setItem(
      PLATFORM_STORAGE_KEYS.rosterSnapshot,
      JSON.stringify(legacySnapshot),
    );
    storage.setItem(PLATFORM_STORAGE_KEYS.roster, legacyDefault);

    const preferences = readPlatformPreferences(storage);

    assert.equal(
      sharedRosterSnapshotText(preferences.roster),
      DEFAULT_SHARED_ROSTER,
      legacyDefault,
    );
    assert.equal(preferences.roster.allowDuplicateNames, true);
    assert.equal(
      storage.getItem(PLATFORM_STORAGE_KEYS.roster),
      DEFAULT_SHARED_ROSTER,
    );
    assert.equal(
      storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
      DEFAULT_SHARED_ROSTER,
    );

    const migratedSnapshot = preferences.roster;
    assert.deepEqual(
      readPlatformPreferences(storage).roster,
      migratedSnapshot,
      "the migrated revision and participant ids stay stable",
    );
  });
});

test("a raw legacy default also migrates before the v2 snapshot is created", () => {
  const legacyDefault =
    "레또\n레카\n세나\n코코\n망징";
  const rawKeys = [
    PLATFORM_STORAGE_KEYS.roster,
    LEGACY_PLATFORM_STORAGE_KEYS.roster,
    PLATFORM_STORAGE_KEYS.legacyRaceRoster,
  ];

  rawKeys.forEach((rawKey) => {
    const storage = new MemoryStorage();
    storage.setItem(rawKey, legacyDefault);

    const preferences = readPlatformPreferences(storage);

    assert.equal(
      sharedRosterSnapshotText(preferences.roster),
      DEFAULT_SHARED_ROSTER,
      rawKey,
    );
    assert.equal(
      storage.getItem(PLATFORM_STORAGE_KEYS.roster),
      DEFAULT_SHARED_ROSTER,
    );
    assert.equal(
      storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
      DEFAULT_SHARED_ROSTER,
    );
  });

  const malformedV2Storage = new MemoryStorage();
  malformedV2Storage.setItem(
    PLATFORM_STORAGE_KEYS.rosterSnapshot,
    "{broken",
  );
  malformedV2Storage.setItem(PLATFORM_STORAGE_KEYS.roster, legacyDefault);
  assert.equal(
    sharedRosterSnapshotText(
      readPlatformPreferences(malformedV2Storage).roster,
    ),
    DEFAULT_SHARED_ROSTER,
  );
});

test("the four-person migration preserves custom hidden-colour participants", () => {
  const storage = new MemoryStorage();
  const customSnapshot = createSharedRosterSnapshot(
    "코코\n사용자 A\n토로리 코코",
    true,
  );
  storage.setItem(
    PLATFORM_STORAGE_KEYS.rosterSnapshot,
    JSON.stringify(customSnapshot),
  );

  const preferences = readPlatformPreferences(storage);

  assert.deepEqual(preferences.roster, customSnapshot);
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    "코코\n사용자 A\n토로리 코코",
  );
  assert.equal(preferences.roster.allowDuplicateNames, true);
});

test("exact persisted five-person defaults migrate after a rewrite", () => {
  const persistedDefaults = [
    "레또\n레카\n세나\n코코\n망징",
    "아모레또\n유레카\n세나\n코코\n망징이",
  ];

  persistedDefaults.forEach((persistedDefault) => {
    const storage = new MemoryStorage();
    const initialRoster = createSharedRosterSnapshot(
      "사용자 A\n사용자 B",
      false,
    );
    const rewrittenDefault = reconcileSharedRosterSnapshot(
      initialRoster,
      persistedDefault,
      false,
    );
    storage.setItem(
      PLATFORM_STORAGE_KEYS.rosterSnapshot,
      JSON.stringify(rewrittenDefault),
    );

    const preferences = readPlatformPreferences(storage);

    assert.equal(
      sharedRosterSnapshotText(preferences.roster),
      DEFAULT_SHARED_ROSTER,
      persistedDefault,
    );
    if (persistedDefault.startsWith("레또")) {
      assert.deepEqual(
        preferences.roster.participants.map(({ name, id }) => ({ name, id })),
        rewrittenDefault.participants
          .filter(({ name }) => name !== "코코")
          .map(({ name, id }) => ({ name, id })),
      );
    }
  });
});

test("an edited snapshot is never mistaken for a pristine product default", () => {
  const storage = new MemoryStorage();
  const initialRoster = createSharedRosterSnapshot(
    "사용자 A\n사용자 B",
    false,
  );
  const intentionalRoster = reconcileSharedRosterSnapshot(
    initialRoster,
    "아모레또\n유레카\n세나\n코코\n망징이\n로티\n토리\n마루",
    false,
  );
  storage.setItem(
    PLATFORM_STORAGE_KEYS.rosterSnapshot,
    JSON.stringify(intentionalRoster),
  );

  const preferences = readPlatformPreferences(storage);

  assert.deepEqual(preferences.roster, intentionalRoster);
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    "아모레또\n유레카\n세나\n코코\n망징이\n로티\n토리\n마루",
  );

  const nonCanonicalStorage = new MemoryStorage();
  const pristine = createSharedRosterSnapshot(
    "아모레또\n유레카\n세나\n코코\n망징이\n로티\n토리\n마루",
    false,
  );
  const nonCanonical = {
    ...pristine,
    participants: pristine.participants.map((participant) => ({
      ...participant,
      id: `user-${participant.id}`,
    })),
  };
  nonCanonicalStorage.setItem(
    PLATFORM_STORAGE_KEYS.rosterSnapshot,
    JSON.stringify(nonCanonical),
  );
  assert.deepEqual(
    readPlatformPreferences(nonCanonicalStorage).roster,
    nonCanonical,
  );
});

test("shared roster migrates v1 text and policy without deleting legacy data", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    PLATFORM_STORAGE_KEYS.legacyRaceRoster,
    "아모레또\n유레카",
  );
  storage.setItem(
    LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames,
    "1",
  );

  const first = readPlatformPreferences(storage);
  assert.equal(
    sharedRosterSnapshotText(first.roster),
    "아모레또\n유레카",
  );
  assert.equal(first.roster.allowDuplicateNames, true);
  assert.equal(first.roster.schemaVersion, 2);
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    "아모레또\n유레카",
  );
  assert.equal(storage.getItem(PLATFORM_STORAGE_KEYS.rosterMigration), "1");
  assert.equal(
    JSON.parse(
      storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot) ?? "{}",
    ).schemaVersion,
    2,
  );

  writeSharedRoster(storage, "세나\n마루");
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    "세나\n마루",
  );
  writeLastGame(storage, "roulette");
  writeDuplicateNamePolicy(storage, true);
  const updated = readPlatformPreferences(storage);
  assert.equal(sharedRosterSnapshotText(updated.roster), "세나\n마루");
  assert.equal(updated.roster.allowDuplicateNames, true);
  assert.equal(updated.gameId, "roulette");
  assert.equal(
    updated.streamerThemeId,
    DEFAULT_STREAMER_THEME_ID,
  );
});

test("canonical exlab preferences take priority over ex-lab values", () => {
  const storage = new MemoryStorage();
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, "canonical roster");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.roster, "legacy roster");
  storage.setItem(PLATFORM_STORAGE_KEYS.lastGame, "roulette");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame, "showdown");
  storage.setItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames, "0");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames, "1");
  storage.setItem(PLATFORM_STORAGE_KEYS.streamerTheme, "sena");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme, "eureka");

  const preferences = readPlatformPreferences(storage);
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    "canonical roster",
  );
  assert.equal(preferences.roster.allowDuplicateNames, false);
  assert.equal(preferences.gameId, "roulette");
  assert.equal(preferences.streamerThemeId, "sena");
});

test("previous ex-lab preferences remain readable as fallbacks", () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.roster, "legacy roster");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame, "roulette");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames, "1");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme, "eureka");

  const preferences = readPlatformPreferences(storage);
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    "legacy roster",
  );
  assert.equal(preferences.roster.allowDuplicateNames, true);
  assert.equal(preferences.gameId, "roulette");
  assert.equal(preferences.streamerThemeId, "eureka");
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.roster),
    "legacy roster",
  );
});

test("valid v2 roster snapshot takes priority over stale raw mirrors", () => {
  const storage = new MemoryStorage();
  const snapshot = createSharedRosterSnapshot(
    "v2 첫째\nv2 둘째",
    true,
  );
  writeSharedRosterSnapshot(storage, snapshot);
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, "stale v1 roster");
  storage.setItem(
    PLATFORM_STORAGE_KEYS.allowDuplicateNames,
    "0",
  );

  assert.deepEqual(readPlatformPreferences(storage).roster, snapshot);
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.roster),
    "v2 첫째\nv2 둘째",
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames),
    "1",
  );
});

test("malformed v2 roster safely falls back to the v1 mirror", () => {
  const storage = new MemoryStorage();
  storage.setItem(PLATFORM_STORAGE_KEYS.rosterSnapshot, "{broken");
  storage.setItem(PLATFORM_STORAGE_KEYS.roster, "복구 명단");
  storage.setItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames, "1");

  const preferences = readPlatformPreferences(storage);
  assert.equal(
    sharedRosterSnapshotText(preferences.roster),
    "복구 명단",
  );
  assert.equal(preferences.roster.allowDuplicateNames, true);
  assert.equal(
    JSON.parse(
      storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot) ?? "{}",
    ).schemaVersion,
    2,
  );
});

test("invalid stored streamer themes fall back to the product default", () => {
  const storage = new MemoryStorage();
  storage.setItem(PLATFORM_STORAGE_KEYS.streamerTheme, "unknown-theme");

  assert.equal(
    readPlatformPreferences(storage).streamerThemeId,
    DEFAULT_STREAMER_THEME_ID,
  );
});

test("shared cafe comment parser keeps root commenters and excludes replies", () => {
  const candidates = extractNaverCafeCommentAuthors(JSON.stringify({
    comments: [
      {
        commentNo: 1,
        writer: { memberId: "root-1", nick: "첫 댓글" },
      },
      {
        commentNo: 2,
        parentCommentNo: 1,
        writer: { memberId: "reply-1", nick: "대댓글" },
      },
      {
        commentNo: 3,
        writer: { memberId: "root-2", nick: "두 번째 댓글" },
      },
    ],
  }));

  assert.deepEqual(
    candidates.filter((candidate) => !candidate.reply).map(
      (candidate) => candidate.nick,
    ),
    ["첫 댓글", "두 번째 댓글"],
  );
  assert.equal(
    candidates.find((candidate) => candidate.nick === "대댓글")?.reply,
    true,
  );
});

test("shared roster keeps cafe import as an optional disclosure", async () => {
  const [appSource, cssSource, rouletteSetupSource] = await Promise.all([
    readFile(new URL("../app/ExlabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/games/roulette/components/ParticipantSetup.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(appSource, /<details[\s\S]*?exlab-roster-import/);
  assert.match(appSource, /카페 댓글에서 가져오기/);
  assert.match(appSource, /댓글 작성자 가져오기/);
  assert.match(appSource, /extractNaverCafeCommentAuthors/);
  assert.match(cssSource, /\.exlab-roster-import/);
  assert.match(rouletteSetupSource, /initialStep = 'edit'/);
  assert.match(rouletteSetupSource, /<details[\s\S]*?setup-import-option/);
  assert.doesNotMatch(rouletteSetupSource, /setup-source-tabs/);
});

test("first-visit theme choice distinguishes new and returning users", () => {
  const storage = new MemoryStorage();

  assert.equal(hasStoredStreamerThemeChoice(storage), false);

  writeStreamerTheme(storage, "sena");
  assert.equal(
    hasStoredStreamerThemeChoice(storage),
    false,
    "an older persisted theme is not proof that onboarding was shown",
  );

  writeStreamerThemeChoice(storage);
  assert.equal(hasStoredStreamerThemeChoice(storage), true);
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.streamerThemeChoice),
    "1",
  );
});

test("platform writes mirror canonical, previous, and standalone keys", () => {
  const storage = new MemoryStorage();

  writeSharedRoster(storage, "아모레또\n유레카");
  writeLastGame(storage, "showdown");
  writeDuplicateNamePolicy(storage, true);
  writeStreamerTheme(storage, "mangjing");

  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.roster),
    "아모레또\n유레카",
  );
  assert.equal(
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.roster),
    "아모레또\n유레카",
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    "아모레또\n유레카",
  );
  const storedSnapshot = JSON.parse(
    storage.getItem(PLATFORM_STORAGE_KEYS.rosterSnapshot) ?? "{}",
  );
  assert.equal(storedSnapshot.schemaVersion, 2);
  assert.equal(storedSnapshot.allowDuplicateNames, true);
  assert.deepEqual(
    storedSnapshot.participants.map(
      (participant: { name: string }) => participant.name,
    ),
    ["아모레또", "유레카"],
  );
  assert.equal(storage.getItem(PLATFORM_STORAGE_KEYS.lastGame), "showdown");
  assert.equal(
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame),
    "showdown",
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.allowDuplicateNames),
    "1",
  );
  assert.equal(
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames),
    "1",
  );
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.streamerTheme),
    "mangjing",
  );
  assert.equal(
    storage.getItem(LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme),
    "mangjing",
  );
});

test("legacy Race selection resumes as Showdown", () => {
  const storage = new MemoryStorage();
  storage.setItem(PLATFORM_STORAGE_KEYS.lastGame, "race");

  assert.equal(readPlatformPreferences(storage).gameId, "showdown");
});

test("shared roster preserves occurrences and applies one duplicate policy", () => {
  assert.deepEqual(
    parseSharedRosterNames("아모레또\n유레카\n아모레또"),
    ["아모레또", "유레카", "아모레또"],
  );
  assert.match(
    validateSharedRosterDraft(
      "아모레또\n유레카\n아모레또",
      false,
    ).error ?? "",
    /동일 이름/,
  );
  assert.equal(
    validateSharedRosterDraft(
      "아모레또\n유레카\n아모레또",
      true,
    ).error,
    null,
  );
  assert.equal(sharedRosterNameKey("  홍  길동  "), sharedRosterNameKey("홍 길동"));
  assert.equal(sharedRosterNameKey("ＡＭＯＲＥＴＴＯ"), "amoretto");
  assert.match(
    validateSharedRosterDraft("홍 길동\n홍  길동", false).error ?? "",
    /동일 이름/,
  );

  const fortyEmoji = "😀".repeat(40);
  assert.equal(sharedRosterNameLength(fortyEmoji), 40);
  assert.equal(validateSharedRosterDraft(fortyEmoji, false).error, null);
  assert.match(
    validateSharedRosterDraft(`${fortyEmoji}😀`, false).error ?? "",
    /40자 이내/,
  );
});

test("game surfaces keep setup drafts mounted and isolate activity locks", async () => {
  const source = await readFile(
    new URL("../app/ExlabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /GAME_CATALOG\s*\.filter\(\(game\)\s*=>\s*visitedGameIds\.has\(game\.id\)\s*\)\s*\.map\(\(game\)\s*=>\s*\{/,
  );
  assert.match(source, /hidden=\{!isActiveGame\}/);
  assert.match(source, /visible=\{isActiveGame\}/);
  assert.match(source, /active=\{isActiveGame\}/);
  assert.match(source, /Record<GameId, GameHostState>/);
  assert.match(source, /hostStateByGame\[gameId\]/);
  assert.match(
    source,
    /isGameSwitchLocked\(selectedHostState\.lifecycle\)/,
  );
  assert.match(source, /roster=\{roster\}/);
  assert.match(source, /allowDuplicateNames=\{allowDuplicateNames\}/);
  assert.match(source, /lazy\(async \(\) => \{/);
  assert.match(source, /<SharedRosterDialog/);
  assert.doesNotMatch(source, /key=\{gameId\}/);
});

test("integrated preparation source contains no large Showdown promotional copy", async () => {
  const source = await readFile(
    new URL("../app/games/showdown/ShowdownGame.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /모든 이름이/);
  assert.doesNotMatch(source, /조별 Race로 이어집니다/);
  assert.doesNotMatch(source, /전체 명단을 편성하고 방송 화면을 여세요/);
});
