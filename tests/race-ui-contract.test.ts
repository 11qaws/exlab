import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gameSource = readFileSync(
  new URL("../app/games/showdown/ShowdownGame.tsx", import.meta.url),
  "utf8",
);
const canvasSource = readFileSync(
  new URL("../app/games/showdown/RaceCanvas.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../app/games/showdown/showdown-game.css", import.meta.url),
  "utf8",
);
const setupWorkspaceCssSource = readFileSync(
  new URL(
    "../app/_platform/components/SetupWorkspace.css",
    import.meta.url,
  ),
  "utf8",
);
const globalsCssSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
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

test("embedded Race uses the shared roster contract without promotional copy", () => {
  assert.match(
    gameSource,
    /export type ShowdownGameProps = EmbeddedGameProps;/,
  );
  assert.match(
    gameSource,
    /roster\s*\?\s*sharedRosterSnapshotText\(roster\)/,
  );
  assert.match(
    gameSource,
    /participantIds:\s*roster\?\.participants\.map/,
  );
  assert.match(
    gameSource,
    /active = visible \?\? true/,
  );
  assert.match(
    gameSource,
    /onHostStateChange\?\.\(hostState\)/,
  );
  assert.match(
    gameSource,
    /phase === "generating"[\s\S]*?phase === "waiting"[\s\S]*?phase === "countdown"[\s\S]*?phase === "running"[\s\S]*?phase === "result"/,
  );
  assert.match(
    gameSource,
    /phase === "error"\s*\?\s*"recoverable"/,
  );
  assert.match(
    gameSource,
    /phase === "error"\s*\?\s*"준비로 돌아가기"/,
  );
  assert.match(
    gameSource,
    /aria-label="조 개수"[\s\S]*?setGroupCount\(nextCount\)/,
  );
  assert.doesNotMatch(gameSource, /전체 명단 편집/);
  assert.match(gameSource, /\{!embedded && \(\s*<header className="product-header">/);
  assert.doesNotMatch(gameSource, /모든 이름이/);
  assert.doesNotMatch(gameSource, /조별 Race로 이어집니다/);
  assert.doesNotMatch(gameSource, /1,000px 목표 추격 보정/);
  assert.match(gameSource, /<details className="course-legend-details">/);
  assert.match(gameSource, /if \(!active\) return undefined;/);
  assert.doesNotMatch(cssSource, /\.intro(?:\s|[>{.:])/);
});

test("standalone Showdown uses the same default roster as the platform", () => {
  assert.match(
    gameSource,
    /import \{ DEFAULT_ROSTER_TEXT \} from "\.\.\/\.\.\/_platform\/defaultRoster";/,
  );
  assert.match(gameSource, /useState\(DEFAULT_ROSTER_TEXT\)/);
  assert.match(
    gameSource,
    /readPlatformPreferences\(localStorage\)/,
  );
  assert.match(gameSource, /writeSharedRoster\(localStorage, rosterText\)/);
  assert.doesNotMatch(gameSource, /const DEFAULT_ROSTER\s*=/);
  assert.doesNotMatch(gameSource, /localStorage\.getItem\(ROSTER_KEY\)/);
});

test("scoped Showdown roots retain their intended frame colors and sizing", () => {
  assert.match(
    cssSource,
    /:scope\.race-screen\s*\{[\s\S]*?background:\s*var\(--stage\);[\s\S]*?color:\s*var\(--stage-ink\);/,
  );
  assert.match(
    cssSource,
    /:scope\.preparation-screen\.is-embedded\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?padding:\s*0;/,
  );
  assert.doesNotMatch(cssSource, /^\.race-screen\s*\{/m);
  assert.doesNotMatch(cssSource, /result-screen/);
  assert.match(
    gameSource,
    /className=\{`showdown-game race-screen\$\{[\s\S]*?phase === "result" \? " is-results" : ""[\s\S]*?embedded \? " is-embedded" : ""[\s\S]*?\}`\}/,
  );
  assert.doesNotMatch(gameSource, /showdown-game result-screen/);
  assert.match(
    cssSource,
    /:scope\.race-screen\.is-embedded\s*\{[\s\S]*?var\(--exlab-stage-height-dynamic\)[\s\S]*?min-height:\s*0;/,
  );
});

test("desktop Showdown setup uses the common viewport and overflow owner", () => {
  assert.match(
    globalsCssSource,
    /@media \(min-width:\s*901px\) and \(min-height:\s*600px\)[\s\S]*?\.exlab-game-instance\s*\{[\s\S]*?var\(--exlab-stage-height-dynamic\)[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    globalsCssSource,
    /@media \(min-width:\s*641px\) and \(max-width:\s*900px\) and \(min-height:\s*600px\)[\s\S]*?app-shell--preparation[\s\S]*?showdown-game\.preparation-screen[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    cssSource,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\)\s*\{[\s\S]*?:scope\.preparation-screen\.is-embedded\s*\{[\s\S]*?block-size:\s*100%;[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    cssSource,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\) and \(max-height:\s*760px\)[\s\S]*?--exlab-setup-gap-group:\s*4px[\s\S]*?exlab-setup-workspace__intro[\s\S]*?display:\s*none/,
  );
  assert.match(
    setupWorkspaceCssSource,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\)[\s\S]*?\.exlab-setup-workspace\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    setupWorkspaceCssSource,
    /\.exlab-setup-workspace__settings\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-width:\s*thin;/,
  );
  assert.match(
    cssSource,
    /\.showdown-setup-workspace \.exlab-setup-workspace__preview-stage\s*\{\s*min-height:\s*0;/,
  );
  assert.match(
    gameSource,
    /advancedSettings=\{\([\s\S]*?embedded-history-panel[\s\S]*?\)\}\s*advancedSettingsLabel=/,
  );
  assert.match(
    cssSource,
    /\.showdown-setup-workspace \.roster-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.doesNotMatch(gameSource, />\s*새 배치\s*</);
  assert.match(
    cssSource,
    /\.showdown-preview-footer\s*\{[\s\S]*?grid-template-columns:\s*minmax\(180px,\s*1fr\)\s+auto;/,
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

test("mobile Showdown canvas keeps scaled marble nameplates", () => {
  assert.match(canvasSource, /if \(topSlots\.has\(pose\.slotId\)\) \{/);
  assert.doesNotMatch(
    canvasSource,
    /topSlots\.has\(pose\.slotId\) && scale > 0\.55/,
  );
  assert.match(canvasSource, /resolveMarbleLabelMetrics\(scale\)/);
  assert.match(canvasSource, /labelMetrics\.height/);
  assert.match(canvasSource, /labelMetrics\.padding/);
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
  assert.match(gameSource, /className="showdown-result-time"/);
  assert.match(gameSource, /"leaderboard-time"/);
  assert.match(
    gameSource,
    /const finishRecord = finished\s*\?\s*finishRecords\.get\(slotId\)/,
  );
  assert.match(
    cssSource,
    /\.race-clock\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
  );
  assert.match(
    cssSource,
    /\.showdown-result-time\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
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
  assert.doesNotMatch(gameSource, /0\.5× SLOW/);
  assert.doesNotMatch(canvasSource, /cinematicHandoffRef/);
});

test("the exact finish marker is rendered beside the line above race objects", () => {
  const marbleLayerIndex = canvasSource.indexOf(
    "frame.poses.forEach((pose) => {",
    canvasSource.indexOf("const topSlots"),
  );
  const finishOverlayIndex = canvasSource.lastIndexOf("drawFinishFlag(");

  assert.ok(marbleLayerIndex >= 0);
  assert.ok(finishOverlayIndex > marbleLayerIndex);
  assert.match(canvasSource, /resolveFinishFlagLayout/);
  assert.doesNotMatch(
    canvasSource,
    /context\.fillText\(\s*"FINISH",\s*startX/,
  );
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

test("preview preparation never renders the retired static SVG map", () => {
  assert.doesNotMatch(gameSource, /function StartPreview/);
  assert.doesNotMatch(gameSource, /className="preview-course"/);
  assert.doesNotMatch(gameSource, /<svg/);
  assert.match(
    gameSource,
    /showdownWallColor\([\s\S]*?getStreamerTheme\(streamerThemeId\)\.palette,[\s\S]*?mapMode/,
    "the selected streamer triad owns a contrast-safe physical course wall",
  );
  assert.match(
    gameSource,
    /className="map-preview live-preview preview-loading"[\s\S]*?role="status"[\s\S]*?aria-busy="true"/,
  );
});

test("a failed random preview seed keeps the neutral loader and retries", () => {
  assert.match(
    gameSource,
    /catch \{[\s\S]*?setPreviewPlan\(null\);[\s\S]*?setPreviewCycle\(\(value\) => value \+ 1\)/,
  );
  assert.match(gameSource, /window\.clearTimeout\(retryTimer\);/);
  assert.match(
    gameSource,
    /if \(!previewPlan\) \{[\s\S]*?preview-loading[\s\S]*?aria-busy="true"/,
  );
});

test("Showdown commits roster changes only when the 10-second preview cycle ends", () => {
  assert.match(
    gameSource,
    /createPreviewCycleBuffer\(\s*defaultPreviewCandidates,\s*resolvePreviewCandidates\(candidates\),\s*\)/,
  );
  assert.match(
    gameSource,
    /if \(elapsedMs >= PREVIEW_DURATION_MS\) \{[\s\S]*?advancePreviewCycle\([\s\S]*?requestedCandidatesRef\.current[\s\S]*?setPreviewCycle/,
  );
  assert.match(
    gameSource,
    /\[active, candidateCycle\.active, layoutSeed, previewCycle\]/,
  );
});
