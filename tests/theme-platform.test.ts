import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  STREAMER_THEMES,
  STREAMER_THEME_CONTRAST_TARGETS,
  streamerThemeContrastReport,
  streamerThemeCssVariables,
} from "../app/_platform/theme/streamerThemes";

test("streamer theme registry exposes the five canonical profile assets", async () => {
  assert.deepEqual(
    STREAMER_THEMES.map(({ id, portrait }) => ({
      id,
      path: portrait.path,
    })),
    [
      {
        id: "amoretto",
        path: "themes/streamers/amoretto.jpg",
      },
      {
        id: "eureka",
        path: "themes/streamers/eureka.png",
      },
      {
        id: "sena",
        path: "themes/streamers/sena.jpg",
      },
      {
        id: "torori",
        path: "themes/streamers/torori.webp",
      },
      {
        id: "mangjing",
        path: "themes/streamers/mangjing.jpg",
      },
    ],
  );

  for (const theme of STREAMER_THEMES) {
    await assert.doesNotReject(
      access(new URL(`../public/${theme.portrait.path}`, import.meta.url)),
      `${theme.id} profile asset should exist`,
    );
  }
});

test("every light streamer theme keeps labels and text contrast-safe", () => {
  for (const theme of STREAMER_THEMES) {
    const report = streamerThemeContrastReport(theme, "light");
    assert.equal(report.passes, true, theme.id);
    assert.ok(
      report.accentLabel >=
        STREAMER_THEME_CONTRAST_TARGETS.accentLabel,
      `${theme.id} accent label`,
    );
    assert.ok(
      report.accentInkOnSurface >=
        STREAMER_THEME_CONTRAST_TARGETS.accentInkOnSurface,
      `${theme.id} accent ink`,
    );
    assert.ok(
      report.bodyTextOnSurface >=
        STREAMER_THEME_CONTRAST_TARGETS.bodyTextOnSurface,
      `${theme.id} body text`,
    );
  }
});

test("every Showdown stage palette keeps dark-surface text contrast-safe", () => {
  for (const theme of STREAMER_THEMES) {
    const report = streamerThemeContrastReport(theme, "dark");
    assert.equal(report.passes, true, theme.id);
    assert.ok(
      report.bodyTextOnSurface >=
        STREAMER_THEME_CONTRAST_TARGETS.bodyTextOnSurface,
      `${theme.id} Showdown stage text`,
    );
  }
});

test("every streamer owns a unique dark-stage palette for Showdown", () => {
  const stagePalettes = STREAMER_THEMES.map((theme) => {
    const variables = streamerThemeCssVariables(theme, "light");
    return [
      variables["--exlab-stage-background"],
      variables["--exlab-stage-surface"],
      variables["--exlab-stage-accent"],
      variables["--exlab-stage-border"],
    ].join("|");
  });

  assert.equal(new Set(stagePalettes).size, STREAMER_THEMES.length);
});

test("the shell owns one compact theme picker beside the game selector", async () => {
  const [appSource, sharedSetupSource, pickerSource, globalsSource] =
    await Promise.all([
      readFile(
        new URL("../app/ExlabApp.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/_platform/components/SharedSetupSummary.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/_platform/theme/StreamerThemePicker.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/globals.css", import.meta.url),
        "utf8",
      ),
    ]);

  const pickerIndex = appSource.indexOf(
    'className="exlab-toolbar-theme-picker"',
  );
  const gameSelectorIndex = appSource.indexOf(
    'className="exlab-select-field"',
  );

  assert.ok(pickerIndex >= 0);
  assert.ok(gameSelectorIndex > pickerIndex);
  assert.doesNotMatch(sharedSetupSource, /StreamerThemePicker/);
  assert.match(pickerSource, /aria-label=\{theme\.name\}/);
  assert.match(
    globalsSource,
    /\.exlab-toolbar-theme-picker \.exlab-theme-card\s*\{[\s\S]*?block-size: 32px;/,
  );
  assert.match(
    globalsSource,
    /@media \(max-width: 640px\)[\s\S]*?\.exlab-toolbar-theme-picker \.exlab-theme-card\s*\{[\s\S]*?block-size: 24px;/,
  );
});

test("the first visit reuses profile cards and Showdown consumes stage tokens", async () => {
  const [appSource, showdownCss] = await Promise.all([
    readFile(new URL("../app/ExlabApp.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/marble/showdown-game.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(appSource, /<StreamerThemeWelcome/);
  assert.match(
    appSource,
    /hasStoredStreamerThemeChoice\(\s*window\.localStorage/,
  );
  assert.match(appSource, /streamerThemeId=\{streamerThemeId\}/);
  assert.match(
    appSource,
    /className="exlab-onboarding-theme-picker"/,
  );
  assert.match(showdownCss, /--stage:\s*var\(--exlab-stage-background/);
  assert.match(showdownCss, /--stage-accent:\s*var\(--exlab-stage-accent/);
  assert.doesNotMatch(
    showdownCss.slice(showdownCss.indexOf(":scope.race-screen")),
    /background:\s*#1f1118/,
  );
});
