import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STREAMER_THEMES,
  streamerThemePortraitUrls,
} from "../app/_platform/theme/streamerThemes";

const MAX_PORTRAIT_BYTES = 120 * 1024;
const MAX_TOTAL_PORTRAIT_BYTES = 320 * 1024;

function readUint24LE(buffer: Buffer, offset: number) {
  return (
    buffer[offset]
    | (buffer[offset + 1] << 8)
    | (buffer[offset + 2] << 16)
  );
}

function readWebpDimensions(buffer: Buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    assert.deepEqual(
      [...buffer.subarray(23, 26)],
      [0x9d, 0x01, 0x2a],
    );
    return {
      height: buffer.readUInt16LE(28) & 0x3fff,
      width: buffer.readUInt16LE(26) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    assert.equal(buffer[20], 0x2f);
    return {
      height:
        1
        + ((buffer[22] >> 6)
          | (buffer[23] << 2)
          | ((buffer[24] & 0x0f) << 10)),
      width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
    };
  }
  if (chunk === "VP8X") {
    return {
      height: 1 + readUint24LE(buffer, 27),
      width: 1 + readUint24LE(buffer, 24),
    };
  }

  assert.fail(`unsupported WebP chunk ${JSON.stringify(chunk)}`);
}

test("streamer portraits stay optimized and match their asset manifest", async () => {
  let totalBytes = 0;
  const paths = STREAMER_THEMES.map(({ portrait }) => portrait.path);

  assert.equal(new Set(paths).size, STREAMER_THEMES.length);

  for (const theme of STREAMER_THEMES) {
    const { portrait } = theme;
    assert.match(portrait.path, /^themes\/streamers\/.+\.webp$/);
    assert.doesNotMatch(portrait.path, /(?:^|\/)\.\.(?:\/|$)/);
    assert.equal(portrait.mimeType, "image/webp");

    const assetUrl = new URL(
      `../public/${portrait.path}`,
      import.meta.url,
    );
    const file = await readFile(assetUrl);
    const dimensions = readWebpDimensions(file);
    totalBytes += file.byteLength;

    assert.ok(
      file.byteLength <= MAX_PORTRAIT_BYTES,
      `${theme.id} portrait is ${file.byteLength} bytes`,
    );
    assert.equal(dimensions.width, portrait.width);
    assert.equal(dimensions.height, portrait.height);
  }

  assert.ok(
    totalBytes <= MAX_TOTAL_PORTRAIT_BYTES,
    `portrait total is ${totalBytes} bytes`,
  );
});

test("streamer portrait URLs preserve root and GitHub Pages bases", () => {
  assert.deepEqual(
    streamerThemePortraitUrls("/").map((url) => url.slice(0, 1)),
    ["/", "/", "/", "/"],
  );
  assert.ok(
    streamerThemePortraitUrls("/exlab/").every((url) =>
      url.startsWith("/exlab/themes/streamers/")
    ),
  );
  assert.ok(
    streamerThemePortraitUrls(".").every((url) =>
      url.startsWith("./themes/streamers/")
    ),
  );
});

test("theme portraits preload at boot and stay decoded for instant picker display", async () => {
  const [pickerSource, appSource, preloadSource, layoutSource, pagesConfig] =
    await Promise.all([
    readFile(
      new URL(
        "../app/_platform/theme/StreamerThemePicker.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/ExlabApp.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/_platform/theme/streamerThemePortraitPreload.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pickerSource, /decoding="async"/);
  assert.match(pickerSource, /loading="eager"/);
  assert.match(
    pickerSource,
    /value === theme\.id \? "high" : "auto"/,
  );
  assert.doesNotMatch(pickerSource, /loading="lazy"/);
  assert.match(pickerSource, /height=\{theme\.portrait\.height\}/);
  assert.match(pickerSource, /width=\{theme\.portrait\.width\}/);

  assert.match(appSource, /preloadStreamerThemePortraits\("\."\)/);
  assert.match(
    appSource,
    /const themePickerReady =\s*preferencesReady && themePortraitLoadStatus !== "loading"/,
  );
  assert.match(
    appSource,
    /const appReady =[\s\S]*?!themeSelectionRequired[\s\S]*?themePortraitLoadStatus !== "loading"/,
  );
  assert.match(appSource, /loadImage=\{preferencesReady\}/);
  assert.match(
    appSource,
    /rosterEditorOpen \|\| \(themePickerReady && themePickerOpen\)/,
  );
  assert.match(appSource, /\{themePickerReady \? "테마 교환" : "테마 준비 중"\}/);
  assert.match(appSource, /테마 이미지 준비 중…/);
  assert.doesNotMatch(appSource, /requestIdleCallback/);
  assert.doesNotMatch(appSource, /themePortraitsWarmedRef/);

  assert.match(preloadSource, /retainedPortraitImages/);
  assert.match(preloadSource, /portraitDecodePromises/);
  assert.match(preloadSource, /image\.fetchPriority = "high"/);
  assert.match(preloadSource, /await image\.decode\(\)/);
  assert.match(preloadSource, /PORTRAIT_DECODE_TIMEOUT_MS = 8_000/);
  assert.match(
    preloadSource,
    /setTimeout\(\s*\(\) => finish\(false\)/,
  );
  assert.match(preloadSource, /Promise\.all\(/);

  assert.match(layoutSource, /preload\(`\/\$\{asset\.path\}`/);
  assert.match(layoutSource, /as: "image"/);
  assert.match(layoutSource, /fetchPriority: "high"/);
  assert.match(layoutSource, /STREAMER_THEME_PORTRAIT_ASSETS/);
  assert.match(pagesConfig, /streamerThemePortraitPreloads/);
  assert.match(pagesConfig, /fetchpriority: "high"/);
});
