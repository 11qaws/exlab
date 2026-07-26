import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gameSource = readFileSync(
  new URL("../app/marble/MarbleGame.tsx", import.meta.url),
  "utf8",
);
const canvasSource = readFileSync(
  new URL("../app/marble/RaceCanvas.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../app/marble/marble-game.css", import.meta.url),
  "utf8",
);

test("frame-by-frame race metrics are not exposed as a live region", () => {
  assert.doesNotMatch(
    gameSource,
    /className="race-status"\s+aria-live=/,
  );
  assert.match(
    gameSource,
    /className="visually-hidden"\s+aria-live="polite"/,
  );
  assert.match(
    gameSource,
    /className="finish-banner"\s+aria-live="assertive"/,
  );
});

test("broadcast waiting dialog starts focused without claiming a modal trap", () => {
  assert.doesNotMatch(gameSource, /aria-modal="true"/);
  assert.match(
    gameSource,
    /aria-labelledby="broadcast-waiting-title"/,
  );
  assert.match(
    gameSource,
    /onClick=\{handleRaceStart\}[\s\S]*?autoFocus/,
  );
});

test("mobile leaderboard keeps the first active contender visible", () => {
  assert.match(gameSource, /"is-active-contender"/);
  assert.match(
    cssSource,
    /\.leaderboard li\.is-active-contender\s*\{\s*display:\s*grid;/,
  );
  assert.match(
    cssSource,
    /\.leaderboard\s*\{[\s\S]*?max-height:\s*216px;/,
  );
});

test("semantic canvas obstacles use the theme outline", () => {
  assert.match(canvasSource, /isSemanticObstacle/);
  assert.match(canvasSource, /context\.strokeStyle = theme\.outline;/);
  assert.match(canvasSource, /context\.stroke\(\);/);
});
