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

test("live leaderboard records finish times and swaps ranks in 200ms", () => {
  assert.match(gameSource, /LEADERBOARD_SWAP_DURATION_MS = 200/);
  assert.match(gameSource, /resolveFinishRecords\(plan\.simulation\.frames\)/);
  assert.match(gameSource, /getSnapshotBeforeUpdate/);
  assert.match(gameSource, /data-rank-slot-id=\{slotId\}/);
  assert.match(
    gameSource,
    /translate\(\$\{offsetX\}px, \$\{offsetY\}px\)/,
  );
  assert.match(
    gameSource,
    /this\.props\.reducedMotion[\s\S]*?this\.cancelRankAnimations\(\)/,
  );
  assert.match(gameSource, /element\.dataset\.rankAnimating = "true"/);
  assert.match(
    gameSource,
    /transform \$\{LEADERBOARD_SWAP_DURATION_MS\}ms/,
  );
  assert.match(
    gameSource,
    /key=\{`\$\{plan\.runId\}:\$\{playbackEpoch\}`\}/,
  );
  assert.match(gameSource, /className=\{\[[\s\S]*?"leaderboard-time"/);
  assert.match(cssSource, /font-variant-numeric:\s*tabular-nums;/);
});

test("live race clock and result announcement share physical finish time", () => {
  assert.match(
    gameSource,
    /const raceElapsedMs = resolveRaceElapsedMs\(\s*renderFrameIndex,\s*FRAME_RATE,\s*\)/,
  );
  assert.match(gameSource, /className="race-clock"/);
  assert.match(
    gameSource,
    /aria-label=\{`현재 경기 시간 \$\{raceElapsedTime\}`\}/,
  );
  assert.match(
    gameSource,
    /const winnerRows = arrivedRows\.slice\(0, plan\.winnerCount\)/,
  );
  assert.match(gameSource, /className="winner-finish-time"/);
  assert.match(gameSource, /className="result-finish-time"/);
  assert.match(
    gameSource,
    /const finishRecord = finishRecords\.get\(slotId\)/,
  );
  assert.match(
    cssSource,
    /\.race-clock\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
  );
  assert.match(
    cssSource,
    /\.winner-finish-time\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
  );
});

test("semantic canvas obstacles use the theme outline", () => {
  assert.match(canvasSource, /isSemanticObstacle/);
  assert.match(canvasSource, /context\.strokeStyle = theme\.outline;/);
  assert.match(canvasSource, /context\.stroke\(\);/);
});

test("final overtakes use one hidden live announcement and a visual cue", () => {
  assert.match(
    gameSource,
    /className="final-overtake-cue" aria-hidden="true"/,
  );
  assert.match(gameSource, /FINAL OVERTAKE/);
  assert.match(gameSource, /finalOvertake=\{finalOvertakeCue\}/);
  assert.match(canvasSource, /overtakeZoomIntensity/);
  assert.match(
    canvasSource,
    /const cinematicScale = 1 \+ cinematicIntensity;/,
  );
  assert.match(
    canvasSource,
    /finalOvertake\?\.toSlotId \?\? activeLeadChange\?\.toSlotId/,
  );
  assert.match(
    cssSource,
    /\.race-canvas\.is-final-overtake/,
  );
  assert.doesNotMatch(
    gameSource,
    /final-overtake-cue" aria-live=/,
  );
  assert.doesNotMatch(canvasSource, /cinematicHandoffRef/);
});

test("result presentation waits three visible seconds after the full result gate", () => {
  assert.match(gameSource, /resultHoldRemainingMs/);
  assert.match(gameSource, /plan\.simulation\.resultGateCount/);
  assert.match(
    gameSource,
    /resultGateFrameIndex:\s*plan\.simulation\.resultGateFrameIndex/,
  );
  assert.match(gameSource, /결과 발표까지/);
});

test("hidden tabs cannot advance the presentation clock", () => {
  assert.match(
    gameSource,
    /document\.visibilityState === "hidden"[\s\S]*?lastPlaybackTimestamp\.current = null;[\s\S]*?requestAnimationFrame\(animate\);[\s\S]*?return;/,
  );
});

test("slow-motion renders fractional source frames without reallocating the canvas", () => {
  assert.match(
    gameSource,
    /activeOvertake && !reducedMotion[\s\S]*?\? renderSourceFrame[\s\S]*?: nextFrame/,
  );
  assert.match(
    canvasSource,
    /const baseIndex = Math\.floor\(clampedIndex\)/,
  );
  assert.match(
    canvasSource,
    /if \(canvas\.width !== pixelWidth\) canvas\.width = pixelWidth;/,
  );
  assert.match(
    canvasSource,
    /if \(canvas\.height !== pixelHeight\) canvas\.height = pixelHeight;/,
  );
});

test("a failed random preview seed retries instead of freezing on the static map", () => {
  assert.match(
    gameSource,
    /catch \{[\s\S]*?setPreviewPlan\(null\);[\s\S]*?setPreviewCycle\(\(value\) => value \+ 1\)/,
  );
  assert.match(gameSource, /window\.clearTimeout\(retryTimer\);/);
});
