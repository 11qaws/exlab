import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rouletteSourceUrl = new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url);
const dockSourceUrl = new URL("../app/games/roulette/components/BroadcastActionDock.tsx", import.meta.url);
const viewportCssUrl = new URL("../app/games/roulette/styles/roulette-viewport.css", import.meta.url);
const liveInfoCssUrl = new URL("../app/games/roulette/styles/roulette-live-info.css", import.meta.url);
const embedCssUrl = new URL("../app/games/roulette/styles/roulette-embed.css", import.meta.url);

test("Roulette keeps the result board and action dock mounted while a result is presented", async () => {
  const source = await readFile(rouletteSourceUrl, "utf8");

  assert.ok(source.includes("const showResultsPanel = isStageOnly || ("));
  assert.ok(source.includes("raffleStatus === 'ready' || isPresentationRunning || raffleStatus === 'completed'"));
  assert.ok(source.includes("phase=\"presenting\""));
  assert.ok(source.includes("primaryAction={presentingPrimaryAction}"));
  assert.ok(source.includes("secondaryActions={presentingSecondaryActions}"));
});

test("the action dock exposes a distinct non-interactive presentation phase", async () => {
  const source = await readFile(dockSourceUrl, "utf8");
  assert.ok(source.includes("'ready' | 'presenting' | 'completed'"));
});

test("roomy motion frames retain roster, stage, results and action grid areas", async () => {
  const css = await readFile(liveInfoCssUrl, "utf8");

  assert.ok(css.includes("@media (min-width: 1181px) and (min-height: 720px)"));
  assert.ok(css.includes("'roster stage results'"));
  assert.ok(css.includes("'action action results'"));
  assert.ok(css.includes("--wheel-proof-band: 4rem"));
  assert.match(css, /is-stage-only[\s\S]*> \.broadcast-focus__results[\s\S]*display: grid;/);
  assert.match(css, /is-stage-only[\s\S]*> \.broadcast-focus__action[\s\S]*visibility: visible;/);
});

test("every desktop action-dock geometry rule also recognizes presenting", async () => {
  const css = await readFile(viewportCssUrl, "utf8");
  const phaseGroups = css.match(/\.broadcast-action-dock--ready,[\s\S]*?\.broadcast-action-dock--completed/g) ?? [];
  assert.ok(phaseGroups.length >= 6);
  assert.ok(phaseGroups.every((group) => group.includes(".broadcast-action-dock--presenting")));
});

test("large embedded screens scale the whole live shell and stop below the desktop threshold", async () => {
  const css = await readFile(embedCssUrl, "utf8");

  assert.ok(css.includes("@supports (zoom: 1)"));
  assert.match(css, /min-width: 1600px[\s\S]*zoom: 1\.06/);
  assert.match(css, /min-width: 1920px[\s\S]*zoom: 1\.12/);
  assert.match(css, /min-width: 2880px[\s\S]*zoom: 1\.24/);
  assert.ok(css.includes("@media (max-width: 620px), (max-height: 599px)"));
});

