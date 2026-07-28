import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RACE_MAP_MODE,
  obstacleColor,
  obstaclePaletteEntry,
  raceMapTheme,
  RACE_MAP_THEMES,
  RACE_OBSTACLE_PALETTE,
  RACE_OBSTACLE_ROLE_COLORS,
  showdownWallColor,
} from "../app/marble/race-theme";
import {
  getStreamerThemeTokens,
  STREAMER_THEMES,
} from "../app/_platform/theme/streamerThemes";

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

test("race map defaults to light and shares the canonical five-color palette", () => {
  assert.equal(DEFAULT_RACE_MAP_MODE, "light");
  assert.deepEqual(
    RACE_OBSTACLE_PALETTE.map(({ key, value }) => [key, value]),
    [
      ["hot-pink", "#ffb6c1"],
      ["lemon", "#ffd166"],
      ["mint", "#34e0a8"],
      ["sky", "#4ea9f0"],
      ["lavender", "#7e57c2"],
    ],
  );
});

test("obstacle roles use distinct colors that match their physical behavior", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(RACE_OBSTACLE_ROLE_COLORS).map(([role, color]) => [
        role,
        color.key,
      ]),
    ),
    {
      bumper: "hot-pink",
      pin: "periwinkle",
      guide: "mint",
      "elastic-wall": "sky",
      spinner: "lavender",
    },
  );
  assert.equal(RACE_OBSTACLE_ROLE_COLORS.pin.value, "#6667d9");
});

test("obstacle colors wrap deterministically in both directions", () => {
  assert.equal(obstacleColor(0), "#ffb6c1");
  assert.equal(obstacleColor(5), "#ffb6c1");
  assert.equal(obstacleColor(-1), "#7e57c2");
  assert.equal(obstaclePaletteEntry(7).key, "mint");
});

test("light and dark map labels and primary text meet contrast targets", () => {
  for (const theme of Object.values(RACE_MAP_THEMES)) {
    assert.ok(contrastRatio(theme.text, theme.background) >= 6.5);
    assert.ok(contrastRatio(theme.text, theme.track) >= 6.5);
    assert.ok(contrastRatio(theme.labelText, theme.label) >= 6.5);
    assert.ok(contrastRatio(theme.outline, theme.track) >= 3);
  }
});

test("every streamer supplies a distinct high-contrast Showdown wall color", () => {
  const lightWalls = STREAMER_THEMES.map((streamer) => {
    const wall = getStreamerThemeTokens(streamer, "light").accentInk;
    assert.equal(raceMapTheme("light", wall).wall, wall);
    return wall;
  });
  const darkWalls = STREAMER_THEMES.map((streamer) => {
    const wall = getStreamerThemeTokens(streamer, "dark").accentInk;
    assert.equal(raceMapTheme("dark", wall).wall, wall);
    return wall;
  });

  assert.equal(new Set(lightWalls).size, STREAMER_THEMES.length);
  assert.equal(new Set(darkWalls).size, STREAMER_THEMES.length);
});

test("Showdown walls keep one streamer triad role visible in both map modes", () => {
  for (const streamer of STREAMER_THEMES) {
    const lightWall = showdownWallColor(streamer.palette, "light");
    const darkWall = showdownWallColor(streamer.palette, "dark");

    assert.equal(lightWall, streamer.palette.dark);
    assert.equal(darkWall, streamer.palette.light);
    assert.ok(
      contrastRatio(lightWall, RACE_MAP_THEMES.light.track) >= 3,
      `${streamer.id} light-map wall contrast`,
    );
    assert.ok(
      contrastRatio(darkWall, RACE_MAP_THEMES.dark.track) >= 3,
      `${streamer.id} dark-map wall contrast`,
    );
  }
});

test("Torori dark stays saturated, readable, and darker than the elastic wall", () => {
  const torori = STREAMER_THEMES.find((streamer) => streamer.id === "torori");
  assert.ok(torori);

  const tororiDark = torori.palette.dark;
  const elasticWall = RACE_OBSTACLE_ROLE_COLORS["elastic-wall"].value;

  assert.equal(tororiDark, "#176188");
  assert.equal(torori.palette.main, "#4baedc");
  assert.equal(elasticWall, "#4ea9f0");
  assert.ok(
    relativeLuminance(tororiDark) < relativeLuminance(elasticWall),
    "Torori structure must remain darker than the elastic-wall role",
  );
  assert.ok(
    contrastRatio("#ffffff", tororiDark) >= 6.5,
    "Torori dark must support small white labels",
  );
  assert.ok(
    contrastRatio(tororiDark, RACE_MAP_THEMES.light.track) >= 6.5,
    "Torori dark must remain clear against the light track",
  );
  assert.ok(
    contrastRatio(tororiDark, torori.palette.main) >= 2.5,
    "Torori dark and main roles must remain visually distinct",
  );
});
