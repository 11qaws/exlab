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
  GAME_LIFECYCLE_STATES,
  GAME_LIFECYCLE_TRANSITIONS,
  isGameSwitchLocked,
} from "../app/_platform/contracts";
import {
  PLATFORM_STORAGE_KEYS,
  readPlatformPreferences,
  writeDuplicateNamePolicy,
  writeLastGame,
  writeSharedRoster,
} from "../app/_platform/storage";
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
  });
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
    new URL("../app/ExLabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /GAME_CATALOG\.filter\(\(game\) => visitedGameIds\.has\(game\.id\)\)\.map\(\(game\) => \{/,
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
    new URL("../app/marble/MarbleGame.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /모든 이름이/);
  assert.doesNotMatch(source, /조별 Race로 이어집니다/);
  assert.doesNotMatch(source, /전체 명단을 편성하고 방송 화면을 여세요/);
});
