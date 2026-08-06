import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellCssUrl = new URL(
  "../app/games/roulette/styles/roulette-shell.css",
  import.meta.url,
);
const cinematicCssUrl = new URL(
  "../app/games/roulette/styles/roulette-cinematic.css",
  import.meta.url,
);

test("Roulette does not show a duplicate result-lock badge over the stage", async () => {
  const [shellCss, cinematicCss] = await Promise.all([
    readFile(shellCssUrl, "utf8"),
    readFile(cinematicCssUrl, "utf8"),
  ]);
  const legacyBadge = /content:\s*['"]결과 고정 · 클릭 순간 확정['"]/;
  const suppression = /\.broadcast-focus\.reveal-phase--result-committed \.broadcast-focus__stage::after\s*\{[\s\S]*?display:\s*none !important;[\s\S]*?content:\s*none !important;[\s\S]*?\}/;

  assert.ok(
    !legacyBadge.test(cinematicCss) || suppression.test(shellCss),
    "the locking beat may remain, but its duplicate top-right badge must not render",
  );
});
