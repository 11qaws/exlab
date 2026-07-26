import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  STREAMER_THEMES,
  STREAMER_THEME_CONTRAST_TARGETS,
  streamerThemeContrastReport,
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
