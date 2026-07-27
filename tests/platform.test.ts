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
} from "../app/_platform/contracts";
import {
  LEGACY_PLATFORM_STORAGE_KEYS,
  PLATFORM_STORAGE_KEYS,
  hasStoredStreamerThemeChoice,
  readPlatformPreferences,
  writeDuplicateNamePolicy,
  writeLastGame,
  writeSharedRoster,
  writeStreamerTheme,
  writeStreamerThemeChoice,
} from "../app/_platform/storage";
import {
  DEFAULT_STREAMER_THEME_ID,
} from "../app/_platform/theme/streamerThemes";
import {
  parseSharedRosterNames,
  validateSharedRosterDraft,
} from "../app/_platform/roster";

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
});

test("shared roster migrates once without deleting the legacy Race roster", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    PLATFORM_STORAGE_KEYS.legacyRaceRoster,
    "아모레또\n유레카",
  );

  const first = readPlatformPreferences(storage);
  assert.equal(first.rosterText, "아모레또\n유레카");
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    "아모레또\n유레카",
  );
  assert.equal(storage.getItem(PLATFORM_STORAGE_KEYS.rosterMigration), "1");

  writeSharedRoster(storage, "세나\n코코");
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.legacyRaceRoster),
    "세나\n코코",
  );
  writeLastGame(storage, "roulette");
  writeDuplicateNamePolicy(storage, true);
  assert.deepEqual(readPlatformPreferences(storage), {
    rosterText: "세나\n코코",
    gameId: "roulette",
    allowDuplicateNames: true,
    streamerThemeId: DEFAULT_STREAMER_THEME_ID,
  });
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

  assert.deepEqual(readPlatformPreferences(storage), {
    rosterText: "canonical roster",
    gameId: "roulette",
    allowDuplicateNames: false,
    streamerThemeId: "sena",
  });
});

test("previous ex-lab preferences remain readable as fallbacks", () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.roster, "legacy roster");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.lastGame, "roulette");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.allowDuplicateNames, "1");
  storage.setItem(LEGACY_PLATFORM_STORAGE_KEYS.streamerTheme, "eureka");

  assert.deepEqual(readPlatformPreferences(storage), {
    rosterText: "legacy roster",
    gameId: "roulette",
    allowDuplicateNames: true,
    streamerThemeId: "eureka",
  });
  assert.equal(
    storage.getItem(PLATFORM_STORAGE_KEYS.roster),
    "legacy roster",
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
  assert.match(source, /active=\{isActiveGame\}/);
  assert.match(source, /Record<GameId, boolean>/);
  assert.match(source, /activityByGame\[gameId\]/);
  assert.match(source, /allowDuplicateNames=\{allowDuplicateNames\}/);
  assert.match(source, /lazy\(async \(\) => \{/);
  assert.match(source, /<SharedRosterDialog/);
  assert.doesNotMatch(source, /key=\{gameId\}/);
});

test("integrated preparation source contains no large Showdown promotional copy", async () => {
  const source = await readFile(
    new URL("../app/marble/ShowdownGame.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /모든 이름이/);
  assert.doesNotMatch(source, /조별 Race로 이어집니다/);
  assert.doesNotMatch(source, /전체 명단을 편성하고 방송 화면을 여세요/);
});
