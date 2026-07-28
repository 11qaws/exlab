import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  getStreamerThemeTokens,
  STREAMER_THEMES,
  STREAMER_THEME_CONTRAST_TARGETS,
  streamerThemeContrastReport,
  streamerThemeCssVariables,
} from "../app/_platform/theme/streamerThemes";
import {
  streamerThemePickerPortraitOffsetY,
} from "../app/_platform/theme/streamerThemePresentation";

test("streamer theme registry exposes the five canonical profile assets", async () => {
  assert.deepEqual(
    STREAMER_THEMES.map(({ name }) => name),
    ["아모레또", "유레카", "세나 아르벨", "토로리 코코", "망징이"],
  );
  assert.deepEqual(
    STREAMER_THEMES.map(({ id, portrait }) => [id, portrait.offsetY]),
    [
      ["amoretto", 0],
      ["eureka", 0],
      ["sena", 0],
      ["torori", 0],
      ["mangjing", 0],
    ],
  );
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

test("only the wide theme picker lowers Eureka and Sena portraits", () => {
  assert.deepEqual(
    STREAMER_THEMES.map((theme) => (
      streamerThemePickerPortraitOffsetY(theme)
    )),
    [0, 10, 10, 0, 0],
  );
  assert.deepEqual(
    STREAMER_THEMES.map(({ portrait }) => portrait.offsetY),
    [0, 0, 0, 0, 0],
    "compact current-theme avatars must keep the canonical crop",
  );
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

test("Torori Koko uses a sky-blue axis distinct from Mangjing blue", () => {
  const torori = STREAMER_THEMES.find((theme) => theme.id === "torori");
  const mangjing = STREAMER_THEMES.find(
    (theme) => theme.id === "mangjing",
  );
  assert.ok(torori);
  assert.ok(mangjing);

  const hueDistance = Math.min(
    Math.abs(torori.hue - mangjing.hue),
    360 - Math.abs(torori.hue - mangjing.hue),
  );
  assert.equal(torori.hue, 198);
  assert.ok(hueDistance >= 25);
  assert.match(
    getStreamerThemeTokens(torori, "light").accentInk,
    /^hsl\(198 /,
  );
  assert.match(
    getStreamerThemeTokens(torori, "dark").background,
    /^hsl\(198 /,
  );
  assert.match(
    getStreamerThemeTokens(torori, "dark").accentInk,
    /^hsl\(198 /,
  );
});

test("the shell previews draft themes and commits only after confirmation", async () => {
  const [
    appSource,
    sharedSetupSource,
    pickerSource,
    pickerCss,
    globalsSource,
  ] =
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
        new URL(
          "../app/_platform/theme/streamer-theme-picker.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/globals.css", import.meta.url),
        "utf8",
      ),
    ]);

  const currentThemeIndex = appSource.indexOf(
    "<StreamerThemeCurrent",
  );
  const changeButtonIndex = appSource.indexOf(
    "테마 교환",
    currentThemeIndex,
  );
  const gameSelectorIndex = appSource.indexOf(
    'className="exlab-select-field"',
  );

  assert.ok(currentThemeIndex >= 0);
  assert.ok(changeButtonIndex > currentThemeIndex);
  assert.ok(gameSelectorIndex > changeButtonIndex);
  assert.doesNotMatch(sharedSetupSource, /StreamerThemePicker/);
  assert.match(pickerSource, /aria-label=\{theme\.name\}/);
  assert.match(pickerSource, /현재 테마: \$\{theme\.name\}/);
  assert.doesNotMatch(appSource, /exlab-toolbar-theme-picker/);
  assert.match(
    appSource,
    /effectiveStreamerThemeId\(themeSelection\)/,
  );
  assert.match(
    appSource,
    /data-streamer-theme=\{activeStreamerThemeId\}/,
  );
  assert.match(
    appSource,
    /style=\{streamerThemeCssVariables\(activeStreamerThemeId,\s*"light"\)\}/,
  );
  assert.match(
    appSource,
    /<StreamerThemeCurrent[\s\S]*?value=\{activeStreamerThemeId\}/,
  );
  assert.match(
    appSource,
    /streamerThemeId=\{activeStreamerThemeId\}/,
  );
  assert.match(
    appSource,
    /dispatchThemeSelection\(\{ type: "preview", themeId \}\)/,
  );
  assert.match(
    appSource,
    /writeStreamerTheme\(window\.localStorage,\s*confirmedThemeId\)/,
  );
  assert.match(
    pickerSource,
    /value === theme\.id \? " is-selected" : ""/,
  );
  assert.match(
    pickerCss,
    /\.exlab-theme-card-option\.is-selected,[\s\S]*?transform:\s*translateY\(-2px\);/,
  );
  assert.match(
    pickerCss,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.exlab-theme-card-option:hover\s*\{[\s\S]*?transform:\s*translateY\(-2px\);/,
  );
  assert.match(
    pickerCss,
    /\.exlab-theme-card-option:hover \.exlab-theme-card\s*\{[\s\S]*?box-shadow:/,
  );
  assert.match(
    globalsSource,
    /\.exlab-current-theme \.exlab-theme-card-portrait\s*\{[\s\S]*?height: 32px;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-theme-change-button\s*\{[\s\S]*?min-height: 34px;/,
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
  assert.match(appSource, /required=\{themeSelectionRequired\}/);
  assert.match(
    appSource,
    /hasStoredStreamerThemeChoice\(\s*window\.localStorage/,
  );
  assert.match(appSource, /streamerThemeId=\{activeStreamerThemeId\}/);
  assert.match(
    appSource,
    /className="exlab-onboarding-theme-picker"/,
  );
  const globalsSource = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(
    globalsSource,
    /\.exlab-onboarding-theme-picker \.exlab-streamer-theme-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?margin-inline:\s*auto;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-onboarding-theme-picker \.exlab-theme-card\s*\{[\s\S]*?aspect-ratio:\s*auto;[\s\S]*?block-size:\s*120px;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-theme-welcome\s*\{[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-onboarding-theme-picker\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-width:\s*none;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-onboarding-theme-frame\.can-scroll-down[\s\S]*?\.exlab-theme-scroll-cue\.is-bottom[\s\S]*?\{[\s\S]*?opacity:\s*0\.9;/,
  );
  assert.match(
    globalsSource,
    /@media \(max-width:\s*640px\)[\s\S]*?\.exlab-theme-welcome > footer\s*\{[\s\S]*?flex-direction:\s*column;/,
  );
  assert.match(
    globalsSource,
    /\.exlab-theme-welcome\.is-confirming[\s\S]*?\.exlab-theme-card-option\.is-selected\s*\{[\s\S]*?block-size:\s*160px;/,
  );
  assert.match(
    appSource,
    /THEME_CONFIRM_TRANSITION_MS[\s\S]*?\+\s*THEME_CONFIRM_HOLD_MS/,
  );
  assert.match(
    appSource,
    /input\[type="radio"\]:checked:not\(:disabled\)/,
  );
  assert.match(appSource, /themeReturnFocusRef\.current/);
  assert.match(
    appSource,
    /themeReturnFocusRef\.current = themeTriggerRef\.current/,
  );
  assert.match(
    appSource,
    /document\.activeElement === trigger/,
  );
  assert.match(
    appSource,
    /gameSurfaceRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.doesNotMatch(
    appSource,
    /className=\{`exlab-theme-welcome[\s\S]{0,300}aria-busy=/,
  );
  assert.match(
    appSource,
    /className="exlab-theme-welcome-status"[\s\S]*?aria-live="polite"/,
  );
  assert.match(appSource, /return \(\) => window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(
    globalsSource,
    /\.exlab-onboarding-theme-picker \.exlab-theme-card\s*\{[\s\S]*?block-size:\s*clamp\(/,
  );
  assert.doesNotMatch(
    globalsSource,
    /\.exlab-onboarding-theme-picker[\s\S]{0,120}\.exlab-theme-card-option:last-child/,
  );
  assert.match(showdownCss, /--stage:\s*var\(--exlab-stage-background/);
  assert.match(showdownCss, /--stage-accent:\s*var\(--exlab-stage-accent/);
  assert.doesNotMatch(
    showdownCss.slice(showdownCss.indexOf(":scope.race-screen")),
    /background:\s*#1f1118/,
  );
});
