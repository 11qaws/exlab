import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  getStreamerThemeTokens,
  STREAMER_THEMES,
  STREAMER_THEME_CONTRAST_TARGETS,
  streamerThemeContrastReport,
  streamerThemeCssVariables,
  themeColorContrastRatio,
} from "../app/_platform/theme/streamerThemes";
import { STREAMER_COLOR_PALETTES } from "../app/_platform/theme/streamerPalettes";
import {
  streamerThemeCurrentPortraitZoom,
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
      height: portrait.height,
      id,
      mimeType: portrait.mimeType,
      path: portrait.path,
      width: portrait.width,
    })),
    [
      {
        height: 720,
        id: "amoretto",
        mimeType: "image/webp",
        path: "themes/streamers/amoretto-portrait.webp",
        width: 1280,
      },
      {
        height: 441,
        id: "eureka",
        mimeType: "image/webp",
        path: "themes/streamers/eureka-portrait.webp",
        width: 439,
      },
      {
        height: 400,
        id: "sena",
        mimeType: "image/webp",
        path: "themes/streamers/sena-portrait.webp",
        width: 400,
      },
      {
        height: 960,
        id: "torori",
        mimeType: "image/webp",
        path: "themes/streamers/torori-portrait.webp",
        width: 960,
      },
      {
        height: 720,
        id: "mangjing",
        mimeType: "image/webp",
        path: "themes/streamers/mangjing-portrait.webp",
        width: 1280,
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

test("streamer palettes expose one image-derived dark, main, and light triad", () => {
  assert.deepEqual(STREAMER_COLOR_PALETTES, {
    amoretto: {
      dark: "#8f3655",
      main: "#e84f83",
      light: "#f6c8d8",
    },
    eureka: {
      dark: "#16664f",
      main: "#2fbfa7",
      light: "#f2d76b",
    },
    sena: {
      dark: "#572b43",
      main: "#443e4b",
      light: "#bdacbb",
    },
    torori: {
      dark: "#176188",
      main: "#4baedc",
      light: "#d6f1fb",
    },
    mangjing: {
      dark: "#2f478f",
      main: "#7d90ca",
      light: "#cedafa",
    },
  });

  const mainLabelColours = {
    amoretto: "#2a0c16",
    eureka: "#062c25",
    sena: "#ffffff",
    torori: "#041f2b",
    mangjing: "#01040c",
  } as const;

  for (const theme of STREAMER_THEMES) {
    const palette = STREAMER_COLOR_PALETTES[theme.id];
    const variables = streamerThemeCssVariables(theme, "light");
    assert.deepEqual(theme.palette, palette);
    assert.equal(variables["--exlab-palette-dark"], palette.dark);
    assert.equal(variables["--exlab-palette-main"], palette.main);
    assert.equal(variables["--exlab-palette-light"], palette.light);
    assert.ok(
      themeColorContrastRatio("#ffffff", palette.dark) >= 6.5,
      `${theme.id} dark should support small white labels`,
    );
    assert.ok(
      themeColorContrastRatio(mainLabelColours[theme.id], palette.main) >=
        4.5,
      `${theme.id} main should keep normal labels readable`,
    );
    assert.ok(
      themeColorContrastRatio(theme.light.accentOn, palette.main) >= 4.5,
      `${theme.id} shared on-accent token should stay readable on palette main`,
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

test("only compact current avatars shrink Amoretto and Mangjing portraits", () => {
  const currentZooms = STREAMER_THEMES.map((theme) => (
    streamerThemeCurrentPortraitZoom(theme)
  ));
  const canonicalZooms = STREAMER_THEMES.map(
    ({ portrait }) => portrait.zoom,
  );

  assert.deepEqual(currentZooms, [1.935, 1.15, 1.15, 1.8, 3.15]);
  assert.deepEqual(
    canonicalZooms,
    [2.15, 1.15, 1.15, 1.8, 3.5],
    "theme picker portraits must keep their canonical zoom",
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
  // The compact header control is still 34px. It now reads that value from a
  // named rung instead of a literal, so both halves are pinned here.
  assert.match(
    globalsSource,
    /\.exlab-theme-change-button\s*\{[\s\S]*?min-height: var\(--exlab-control-xs\);/,
  );
  assert.match(globalsSource, /--exlab-control-xs:\s*34px;/);
});

test("the first visit reuses profile cards and Showdown consumes stage tokens", async () => {
  const [appSource, showdownCss, pickerCss] = await Promise.all([
    readFile(new URL("../app/ExlabApp.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/games/showdown/showdown-game.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/_platform/theme/streamer-theme-picker.css",
        import.meta.url,
      ),
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
    /"--exlab-theme-confirm-blink-duration":\s*`\$\{THEME_CONFIRM_BLINK_MS\}ms`/,
  );
  assert.match(
    appSource,
    /"--exlab-theme-confirm-transition-duration":\s*`\$\{THEME_CONFIRM_TRANSITION_MS\}ms`/,
  );
  assert.match(
    globalsSource,
    /\.exlab-theme-welcome\.is-confirming[\s\S]*?\.exlab-theme-card-option\.is-selected[\s\S]*?\.exlab-theme-card\s*\{[\s\S]*?animation:\s*exlab-theme-confirm-double-blink[\s\S]*?var\(--exlab-theme-confirm-blink-duration,\s*500ms\)[\s\S]*?var\(--exlab-theme-confirm-transition-duration,\s*420ms\)[\s\S]*?both;/,
  );
  const blinkKeyframes = globalsSource.slice(
    globalsSource.indexOf("@keyframes exlab-theme-confirm-double-blink"),
    globalsSource.indexOf(
      ".exlab-theme-welcome > footer",
      globalsSource.indexOf("@keyframes exlab-theme-confirm-double-blink"),
    ),
  );
  assert.ok(blinkKeyframes.length > 0);
  assert.match(
    blinkKeyframes,
    /0%,\s*25%,\s*50%,\s*75%,\s*100%\s*\{\s*opacity:\s*1;/,
  );
  const opacityTroughs = blinkKeyframes.match(
    /([\d.]+)%,\s*([\d.]+)%\s*\{\s*opacity:\s*0\.44;/,
  );
  assert.deepEqual(opacityTroughs?.slice(1), ["12.5", "62.5"]);
  assert.match(
    pickerCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.exlab-theme-welcome\.is-confirming[\s\S]*?\.exlab-theme-card-option\.is-selected[\s\S]*?\.exlab-theme-card\s*\{[\s\S]*?animation:\s*none !important;/,
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
