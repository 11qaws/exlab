import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const globalCss = read("../app/globals.css");
const themePickerCss = read(
  "../app/_platform/theme/streamer-theme-picker.css",
);
const setupWorkspaceSource = read(
  "../app/_platform/components/SetupWorkspace.tsx",
);
const showdownSource = read("../app/marble/ShowdownGame.tsx");
const showdownCss = read("../app/marble/showdown-game.css");
const rouletteSource = read(
  "../app/games/roulette/RouletteGame.tsx",
);
const rouletteFoundationCss = read(
  "../app/games/roulette/styles/roulette-foundation.css",
);
const rouletteUiCss = read(
  "../app/games/roulette/roulette-game.css",
);
const previewSource = read(
  "../app/games/roulette/components/DrawPreviewDirector.tsx",
);
const previewCss = read(
  "../app/games/roulette/components/DrawPreviewDirector.css",
);
const actionDockCss = read(
  "../app/games/roulette/components/BroadcastActionDock.css",
);
const roulettePreparationCss = read(
  "../app/games/roulette/styles/roulette-preparation.css",
);

test("the shared shell gives visible controls hover, press, disabled and reduced-motion feedback", () => {
  assert.match(globalCss, /button:not\(\.exlab-roster-dialog-scrim\)/);
  assert.match(globalCss, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(
    globalCss,
    /:active\s*\{[\s\S]*?filter: brightness\(0\.91\)[\s\S]*?scale: 0\.97/,
  );
  assert.match(
    globalCss,
    /button:disabled,\s*button\[aria-disabled="true"\][\s\S]*?scale: 1/,
  );
  assert.match(
    globalCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?:active[\s\S]*?scale: 1/,
  );
});

test("theme and shared setup choices expose selection and busy states", () => {
  assert.match(
    themePickerCss,
    /\.exlab-theme-card-option:active[\s\S]*?scale\(0\.98\)/,
  );
  assert.match(
    globalCss,
    /\.exlab-roster-duplicate-policy:has\(input:checked\)/,
  );
  assert.equal(
    (
      setupWorkspaceSource.match(
        /inert=\{resolvedBusy \|\| undefined\}/g,
      )
      ?? []
    ).length,
    1,
  );
});

test("Showdown buttons keep theme-relative feedback and announce toggle state", () => {
  assert.match(
    showdownCss,
    /button:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)/,
  );
  assert.match(
    showdownCss,
    /\.toggle-button\[aria-pressed="true"\],[\s\S]*?\.icon-button\[aria-pressed="true"\]/,
  );
  assert.match(
    showdownCss,
    /\.primary-button:hover:not\(:disabled\)[\s\S]*?var\(--accent-dark\)/,
  );
  assert.doesNotMatch(
    showdownCss,
    /\.primary-button:hover:not\(:disabled\)\s*\{\s*background:\s*#8f1740/,
  );
  assert.match(
    showdownSource,
    /className="icon-button"[\s\S]*?aria-pressed=\{soundEnabled\}/,
  );
  assert.match(
    showdownSource,
    /raceStartPendingRef\.current[\s\S]*?aria-busy=\{raceStartPending \|\| undefined\}/,
  );
  assert.match(
    showdownSource,
    /Promise\.race\([\s\S]*?AUDIO_RESUME_TIMEOUT_MS[\s\S]*?if \(!audioReady\) setSoundEnabled\(false\)/,
  );
  assert.match(
    showdownSource,
    /startRequest !== raceStartRequestRef\.current[\s\S]*?startGeneration !== generationKey\.current/,
  );
});

test("Roulette buttons never animate while disabled and expose asynchronous progress", () => {
  assert.match(
    rouletteFoundationCss,
    /\.compact-button:hover:not\(:disabled\)/,
  );
  assert.match(
    rouletteFoundationCss,
    /\.compact-button:active:not\(:disabled\)/,
  );
  assert.match(
    rouletteFoundationCss,
    /button:disabled,[\s\S]*?cursor: not-allowed;[\s\S]*?scale: 1/,
  );
  assert.match(
    rouletteUiCss,
    /\.live-tabs button:focus-visible[\s\S]*?outline-offset: -3px/,
  );
  assert.match(
    rouletteSource,
    /aria-busy=\{copyingParticipantList \|\| undefined\}/,
  );
  assert.match(
    rouletteSource,
    /disabled=\{isStageLocked \|\| Boolean\(broadcastSession \|\| pausedBroadcastSession\) \|\| history\.length === 0\}/,
  );
  assert.match(previewSource, /aria-busy=\{moving \|\| undefined\}/);
  assert.match(
    previewCss,
    /\.draw-preview-director__replay:hover:not\(:disabled\)/,
  );
  assert.match(
    previewCss,
    /\.draw-preview-director__replay:disabled[\s\S]*?cursor: wait/,
  );
  assert.match(
    rouletteFoundationCss,
    /:where\([\s\S]*?button:not\(\.roster-drawer__scrim\)[\s\S]*?transform 120ms ease-out/,
  );
  assert.match(
    rouletteFoundationCss,
    /\.broadcast-action-dock__button,[\s\S]*?:active:not\(:disabled\):not\(\[aria-disabled='true'\]\)[\s\S]*?scale: 1/,
  );
  assert.match(
    actionDockCss,
    /prefers-reduced-motion[\s\S]*?\.broadcast-action-dock__button:is\(:hover, :active\)[\s\S]*?transform: none/,
  );
  assert.match(
    roulettePreparationCss,
    /prefers-reduced-motion[\s\S]*?\.preparation-preview__primary:is\(:hover, :active\)[\s\S]*?transform: none/,
  );
});

test("Roulette session end control follows the selected streamer theme", () => {
  const sessionEndRule =
    roulettePreparationCss.match(
      /\.roulette-session-hub__actions \.compact-button--danger\s*\{([\s\S]*?)\}/,
    )?.[1] ?? "";

  assert.match(
    sessionEndRule,
    /border-color:\s*var\(--exlab-accent-ink,\s*var\(--ink\)\)/,
  );
  assert.match(sessionEndRule, /color:\s*var\(--ink\)/);
  assert.doesNotMatch(sessionEndRule, /#dfb6b6|#9f3535/i);
  assert.match(
    roulettePreparationCss,
    /\.roulette-session-hub__actions \.compact-button--danger:focus-visible\s*\{[\s\S]*?outline-color:\s*var\(--exlab-accent-ink,\s*var\(--ink\)\)/,
  );
});
