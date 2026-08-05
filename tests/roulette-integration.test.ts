import assert from "node:assert/strict";
import test from "node:test";

import type { DrawRecord } from "../app/games/roulette/types";
import {
  appendBroadcastSessionResult,
  createBroadcastSession,
  updateBroadcastSessionGoal,
} from "../app/games/roulette/lib/broadcastSession";
import {
  consumePendingRecord,
  mergeRecoveredHistory,
  parsePendingRaffleLock,
  type PendingRaffleLock,
} from "../app/games/roulette/lib/pendingRaffle";
import {
  getRaffleTransition,
  isRaffleActive,
  RAFFLE_EVENTS,
  RAFFLE_STATUSES,
  type RaffleEvent,
  type RaffleStatus,
} from "../app/games/roulette/lib/raffleLifecycle";
import {
  buildCommittedSpinRouletteFinishPlan,
  createSpinPhysicalCommit,
  getRouletteSliceIndexAtScreenAngle,
} from "../app/games/roulette/lib/roulette";
import { derivePreparationReadiness } from "../app/games/roulette/lib/preparation";
import { ROULETTE_WHEEL_PALETTE } from "../app/games/roulette/lib/wheelPalette";
import { readFile } from "node:fs/promises";

const ALLOWED_TRANSITIONS: Record<
  RaffleStatus,
  Partial<Record<RaffleEvent, RaffleStatus>>
> = {
  roster: {
    "save-roster": "configuring",
    "cancel-roster-configuring": "configuring",
    "cancel-roster-ready": "ready",
    "cancel-roster-completed": "completed",
  },
  configuring: {
    "open-roster": "roster",
    "resume-ready": "ready",
    "resume-completed": "completed",
    "open-stage": "ready",
  },
  ready: {
    "open-roster": "roster",
    "end-broadcast": "configuring",
    "lock-result": "locking",
  },
  locking: {
    "start-presentation": "presenting",
  },
  presenting: {
    "lock-result": "locking",
    "complete-round": "completed",
  },
  completed: {
    "open-roster": "roster",
    "end-broadcast": "configuring",
    "replay-result": "locking",
    "start-next-round": "ready",
  },
};

test("Roulette lifecycle rejects every undefined transition", () => {
  for (const status of RAFFLE_STATUSES) {
    for (const event of RAFFLE_EVENTS) {
      assert.equal(
        getRaffleTransition(status, event),
        ALLOWED_TRANSITIONS[status][event] ?? null,
        `${status} + ${event}`,
      );
    }
  }
  assert.deepEqual(RAFFLE_STATUSES.filter(isRaffleActive), [
    "locking",
    "presenting",
  ]);
});

test("Roulette result is derived from the committed physical stop", () => {
  const weights = [1, 2, 1];
  const commit = createSpinPhysicalCommit(
    137.25,
    1_080,
    3,
    weights,
    () => 0.42,
    {
      anchorRadiusPixels: 5.12,
      anchorCenterRadiusPixels: 336.32,
    },
  );

  assert.ok(commit);
  assert.equal(
    commit.winnerIndex,
    getRouletteSliceIndexAtScreenAngle(
      commit.stopRotation,
      weights.length,
      weights,
    ),
  );

  const plan = buildCommittedSpinRouletteFinishPlan(
    commit,
    weights.length,
    weights,
  );
  assert.ok(plan);
  assert.equal(
    getRouletteSliceIndexAtScreenAngle(
      plan.finalRotation,
      weights.length,
      weights,
    ),
    commit.winnerIndex,
  );
  assert.equal(
    buildCommittedSpinRouletteFinishPlan(commit, 3, [1, 3, 1]),
    null,
  );
});

test("Roulette wheel interleaves the streamer triad with five game colours", () => {
  assert.deepEqual(
    ROULETTE_WHEEL_PALETTE.map(({ key }) => key),
    [
      "theme-main",
      "lemon",
      "theme-dark",
      "mint",
      "theme-light",
      "sky",
      "lavender",
      "orange",
    ],
  );
  assert.equal(
    new Set(ROULETTE_WHEEL_PALETTE.map(({ color }) => color)).size,
    8,
  );
  assert.deepEqual(
    ROULETTE_WHEEL_PALETTE.map(({ labelTone }) => labelTone),
    ["accent", "ink", "stage", "ink", "ink", "ink", "stage", "ink"],
  );
});

const LOCKED_RESULT: DrawRecord = {
  id: "result-1",
  sessionId: "session-1",
  createdAt: "2026-07-27T00:00:00.000Z",
  roundId: "round-1",
  roundOrder: 1,
  mode: "wheel",
  presentation: "spin",
  target: "people",
  winner: "아모레또",
};

const PENDING: PendingRaffleLock = {
  version: 1,
  roundId: "round-1",
  savedAt: "2026-07-27T00:00:00.000Z",
  records: [LOCKED_RESULT],
};

test("Roulette pending result recovers once without duplication", () => {
  const parsed = parsePendingRaffleLock(JSON.stringify(PENDING));
  assert.deepEqual(parsed, PENDING);
  assert.equal(parsePendingRaffleLock("{broken"), null);

  const revealed = {
    ...LOCKED_RESULT,
    revealedAt: "2026-07-27T00:00:05.000Z",
  };
  assert.deepEqual(mergeRecoveredHistory([revealed], PENDING), [revealed]);
  assert.equal(consumePendingRecord(PENDING, LOCKED_RESULT.id), null);
});

test("Roulette session goal never drops below its revealed result count", () => {
  const initial = createBroadcastSession("session-1", "people", 5);
  assert.equal(initial.goal, 5);

  const revealed = appendBroadcastSessionResult(initial, LOCKED_RESULT);
  assert.equal(revealed.results.length, 1);
  assert.ok(revealed.goal >= revealed.results.length);
  assert.equal(updateBroadcastSessionGoal(revealed, 0).goal, 1);

  const secondResult: DrawRecord = {
    ...LOCKED_RESULT,
    id: "result-2",
    roundId: "round-2",
    roundOrder: 2,
  };
  const twiceRevealed = appendBroadcastSessionResult(revealed, secondResult);
  assert.ok(twiceRevealed.goal >= twiceRevealed.results.length);
  assert.equal(updateBroadcastSessionGoal(twiceRevealed, 1).goal, 2);

  const forcedOneGoal = { ...revealed, goal: 1 };
  const repairedByAppend = appendBroadcastSessionResult(forcedOneGoal, secondResult);
  assert.equal(repairedByAppend.results.length, 2);
  assert.equal(repairedByAppend.goal, 2);
});

test("Roulette extends the draw without adding a layout-changing confirmation toast", async () => {
  const gameSource = await readFile(
    new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
    "utf8",
  );
  const addOneMoreSource = gameSource.match(
    /const addOneMoreResult = \(\) => \{[\s\S]*?\n  \};/,
  )?.[0];

  assert.ok(addOneMoreSource);
  const successPath = addOneMoreSource.slice(
    addOneMoreSource.indexOf("const nextGoal"),
  );
  assert.match(successPath, /updateBroadcastSessionGoal\(session, nextGoal\)/);
  assert.match(successPath, /beginNextRound\(\)/);
  assert.doesNotMatch(successPath, /showToast\(/);
  assert.match(
    gameSource,
    /const beginNextRound = \(\) => \{[\s\S]*?focusLiveStage\(\);[\s\S]*?\n  \};/,
  );
});

test("embedded Roulette pauses previews and locks navigation while editing a roster", async () => {
  const [gameSource, previewSource] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/components/DrawPreviewDirector.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    gameSource,
    /export type RouletteGameProps = EmbeddedGameProps;/,
  );
  assert.match(
    gameSource,
    /active = visible \?\? true/,
  );
  assert.match(
    gameSource,
    /raffleStatus === 'ready'[\s\S]*?lifecycle: 'waiting'[\s\S]*?raffleStatus === 'locking'[\s\S]*?lifecycle: 'active'[\s\S]*?raffleStatus === 'presenting'[\s\S]*?lifecycle: 'settling'/,
  );
  assert.match(
    gameSource,
    /raffleStatus === 'roster'[\s\S]*?setupReturnStatus !== 'configuring'[\s\S]*?setupReturnStatus === 'completed'[\s\S]*?'result'[\s\S]*?'waiting'/,
    "editing a live or completed roster must preserve the host navigation lock",
  );
  assert.match(
    gameSource,
    /onHostStateChange\?\.\(hostState\)/,
  );
  assert.match(gameSource, /enabled=\{active\}/);
  assert.match(
    gameSource,
    /setupReturnStatus !== 'configuring'[\s\S]*?setBroadcastSession\(null\)/,
  );
  assert.match(previewSource, /const active = enabled && inViewport && documentVisible;/);
  assert.match(previewSource, /onCycleBoundary\?\.\(\);/);
  assert.match(
    previewSource,
    /\[active, clearTimers, cycleSignature, startCycle\]/,
  );
  assert.doesNotMatch(
    previewSource,
    /\[active, clearTimers, previewSignature, startCycle\]/,
  );
});

test("Roulette preserves unfinished progress but closes completed sessions", async () => {
  const [source, wheelSource] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/RouletteWheel.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(source, /const \[pausedBroadcastSession, setPausedBroadcastSession\]/);
  assert.match(
    source,
    /activeSession\.results\.length < activeSession\.goal[\s\S]*?setPausedBroadcastSession\(shouldPauseSession \? activeSession : null\)/,
  );
  assert.match(source, /className="roulette-session-hub"/);
  assert.match(source, /진행[\s\S]*?pausedSessionResults\.length[\s\S]*?pausedBroadcastSession\.goal/);
  assert.match(
    source,
    /const finishCompletedBroadcast = \(\) => \{[\s\S]*?finishBroadcast\(false\)[\s\S]*?추첨 세션을 종료했어요/,
  );
  assert.match(source, /label: '세션 종료 · 설계로'[\s\S]*?onClick: finishCompletedBroadcast/);
  assert.match(
    source,
    /lastEndedSessionNotice[\s\S]*?이전 추첨 세션 종료 · \$\{preparation\.statusLabel\}[\s\S]*?현재 준비 상태:/,
  );
  assert.match(
    source,
    /if \(broadcastSession \|\| pausedBroadcastSession\)[\s\S]*?현재 추첨 세션을 종료한 뒤 당첨 기록을 비울 수 있어요/,
  );
  assert.match(
    source,
    /disabled=\{isStageLocked \|\| Boolean\(broadcastSession \|\| pausedBroadcastSession\) \|\| history\.length === 0\}/,
  );
  assert.doesNotMatch(source, /결과 화면 다시 열기/);
  assert.doesNotMatch(source, /완료한 세션 종료/);
  assert.match(source, /updateBroadcastSessionGoal\(session, nextGoal\)/);
  assert.match(
    source,
    /session\.results\.length > 0 && lastCommittedPresentation[\s\S]*?setPresentedOptions\(lastCommittedPresentation\.options\)[\s\S]*?setWinnerIndex\(lastCommittedPresentation\.winnerIndex\)/,
  );
  assert.match(source, /settled=\{!preview && raffleStatus === 'completed'/);
  assert.match(
    wheelSource,
    /settledPlan\.finalRotation[\s\S]*?completedSpinKey\.current = spinKey[\s\S]*?setLandingVisual/,
  );
  assert.match(
    wheelSource,
    /setDartImpactRotation\([\s\S]*?settledPlan\.impactRotation/,
    "a reopened Dart result must restore its board-local impact angle",
  );
  assert.match(
    wheelSource,
    /const reducedMotion = window\.matchMedia[\s\S]*?if \(reducedMotion\) \{[\s\S]*?setRotation\(finishPlan\.finalRotation\)[\s\S]*?beginProofHold\(spinKey, runRevealId, isDartPresentation\)[\s\S]*?return;/,
    "reduced motion must settle directly instead of waiting for a discarded transitionend",
  );
  assert.match(
    wheelSource,
    /const proofHoldDelay = window\.matchMedia[\s\S]*?\? 0[\s\S]*?: dartReveal \? DART_STOP_HOLD_DELAY : STOP_HOLD_DELAY/,
  );
  assert.match(
    source,
    /const committedRoundResult = activePresentation\?\.lockedResult[\s\S]*?committedRoundResult\?\.recipientId[\s\S]*?committedRoundResult\?\.recipient/,
    "a reopened prize result must keep the committed recipient instead of advancing the title",
  );
  assert.match(source, /type: 'presentation-restarted'/);
  assert.match(
    source,
    /if \(!isReplay && activeRound\) \{[\s\S]*?setHistory[\s\S]*?appendBroadcastSessionResult[\s\S]*?setExcludedParticipantIds[\s\S]*?setPrizes/,
  );
  assert.match(source, /pendingCount=\{sessionPendingCount\}/);
  assert.match(
    source,
    /const resultBoardAnnouncement = latestVisibleSessionResult[\s\S]*?당첨자:[\s\S]*?role="status"[\s\S]*?\{resultBoardAnnouncement \?\? ''\}/,
  );
  assert.match(
    source,
    /<WinnerHero[\s\S]*?announcement=""/,
    "the hero stays visual-only so the persistent live region announces exactly once",
  );
  assert.match(
    source,
    /<CurrentRoundWinners[\s\S]*?announcement=""/,
    "the conditional result board must not duplicate the persistent live region",
  );
  assert.match(source, /winnerGoal:\s*setupWinnerGoal/);
  assert.match(source, /maximumWinnerGoal:\s*setupMaximumWinnerGoal/);
  assert.match(
    source,
    /if \(shouldPauseSession\) \{\s*focusPreparationPrimary\(\);\s*\}/,
  );
  assert.match(
    source,
    /completedPrimaryActionRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    source,
    /const focusPreparationPrimary = useCallback[\s\S]*?finishBroadcast[\s\S]*?else \{\s*focusPreparationPrimary\(\)/,
  );
  assert.match(
    source,
    /prefersReducedMotion\(\)[\s\S]*?reduceMotion \? 0 : WINNER_DOCK_DURATION_MS[\s\S]*?reduceMotion \? 0 : WINNER_HERO_HOLD_MS/,
  );
  assert.doesNotMatch(source, /participants\.slice\(0,\s*18\)/);
});

test("Roulette proof layer stays above the pointer and Dart boundary callout is restored", async () => {
  const [wheelSource, wheelCss, finishSource, finishCss] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/components/RouletteWheel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/RouletteWheel.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/DartFinish.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/DartFinish.css", import.meta.url),
      "utf8",
    ),
  ]);

  const pointerPosition = wheelSource.indexOf('className="roulette-wheel__pointer"');
  const proofLayerPosition = wheelSource.indexOf('className="roulette-wheel__proof-layer"');
  assert.ok(pointerPosition >= 0);
  assert.ok(proofLayerPosition > pointerPosition);
  assert.match(
    wheelSource,
    /className="roulette-wheel__proof-layer"[\s\S]*?<BoundaryNames[\s\S]*?<WinnerNameplate/,
  );
  assert.match(
    wheelCss,
    /\.roulette-wheel__pointer\s*\{[\s\S]*?z-index:\s*8/,
  );
  assert.match(
    wheelCss,
    /\.roulette-wheel__proof-layer\s*\{[\s\S]*?z-index:\s*30/,
  );
  assert.match(
    finishSource,
    /className="dart-finish__boundary-callout">경계선!<\/span>/,
  );
  assert.match(
    finishCss,
    /\.dart-finish--impact\.is-boundary-hit \.dart-finish__boundary-callout,[\s\S]*?\.dart-finish--coast\.is-boundary-hit \.dart-finish__boundary-callout[\s\S]*?dart-boundary-callout 720ms/,
  );
  assert.doesNotMatch(
    finishCss,
    /\.dart-finish--settled\.is-boundary-hit \.dart-finish__boundary-callout/,
  );
  assert.match(
    finishCss,
    /\.roulette-wheel\.is-dart-names-revealed \.dart-finish__boundary-callout\s*\{[\s\S]*?animation:\s*none;[\s\S]*?opacity:\s*0/,
  );
});

test("Roulette stop proof stays inside a stable wheel frame and follows slice contrast", async () => {
  const [wheelSource, finishSource, finishCss, viewportCss] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/components/RouletteWheel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/DartFinish.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/DartFinish.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/styles/roulette-viewport.css", import.meta.url),
      "utf8",
    ),
  ]);

  const reservedBoundaryBand = viewportCss.match(
    /:scope \.app-shell--live \.roulette-wheel :is\([\s\S]*?\)\s*\{[\s\S]*?bottom:\s*calc\(100% \+ 1rem\);[\s\S]*?\}/,
  );
  assert.ok(reservedBoundaryBand);
  assert.doesNotMatch(reservedBoundaryBand[0], /winner-nameplate/);
  assert.match(
    finishCss,
    /\.winner-nameplate\s*\{[\s\S]*?top:\s*8\.4%;/,
    "the interior winner card remains below the pointer inside the wheel",
  );
  assert.match(
    wheelSource,
    /<WinnerNameplate[\s\S]*?tone=\{[\s\S]*?slices\[winnerIndex\]\?\.labelTone/,
  );
  assert.match(
    wheelSource,
    /<BoundaryNames[\s\S]*?leftTone=\{[\s\S]*?slices\[boundaryLeftIndex\]\?\.labelTone[\s\S]*?rightTone=\{[\s\S]*?slices\[boundaryRightIndex\]\?\.labelTone/,
  );
  assert.match(finishSource, /winner-nameplate--tone-\$\{tone\}/);
  assert.match(finishSource, /boundary-names__candidate--tone-\$\{leftTone\}/);
  assert.match(
    finishCss,
    /\.boundary-names__candidate\s*\{[\s\S]*?color:\s*var\(--candidate-foreground, var\(--ink, #251c32\)\)/,
  );
  assert.match(
    finishCss,
    /\.boundary-names__candidate--tone-accent\s*\{[\s\S]*?--candidate-foreground:\s*var\(--exlab-on-accent, #251c32\)/,
  );
  assert.match(
    finishCss,
    /\.boundary-names__candidate--tone-stage\s*\{[\s\S]*?--candidate-foreground:\s*var\(--exlab-stage-text, #fff\);[\s\S]*?background:\s*var\(--candidate-color\)/,
  );
  assert.match(
    viewportCss,
    /\.app-shell--live[\s\S]*?\.broadcast-focus:has\(\.roulette-wheel:not\(\.is-dart\)\):not\(\.is-result-docking\)[\s\S]*?\.broadcast-focus__camera\s*\{[\s\S]*?animation:\s*none;[\s\S]*?transform:\s*none;[\s\S]*?transform-origin:\s*50% 50%;/,
  );
  assert.doesNotMatch(
    viewportCss,
    /reveal-phase--boundary-entered:not\(:has\(\.roulette-wheel\.is-dart\)\)[\s\S]*?--cinematic-camera-scale:/,
  );
  assert.match(
    finishCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.winner-nameplate,[\s\S]*?\.winner-nameplate \*[\s\S]*?animation-duration:\s*1ms !important;[\s\S]*?transition-duration:\s*1ms !important;/,
  );
});

test("completed Roulette prioritizes another draw and keeps the wheel grid stable", async () => {
  const [
    source,
    wheelSource,
    wheelCss,
    gameCss,
    skinCss,
    embedCss,
    winnersCss,
  ] =
    await Promise.all([
      readFile(
        new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/games/roulette/components/RouletteWheel.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/games/roulette/components/RouletteWheel.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/games/roulette/roulette-game.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/games/roulette/styles/roulette-skin.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/games/roulette/styles/roulette-embed.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/games/roulette/components/CurrentRoundWinners.css",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(
    source,
    /const completedPrimaryAction[\s\S]*?id: 'add-one-more'[\s\S]*?label: addOneMoreLabel/,
  );
  assert.match(
    source,
    /completedSecondaryActions[\s\S]*?id: 'finish-session'[\s\S]*?tone: 'quiet'/,
  );
  assert.doesNotMatch(source, /label: '같은 결과 다시 보기'/);
  assert.match(
    source,
    /completedPrimaryActionRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(source, /roulette-live-announcement/);
  assert.match(
    winnersCss,
    /\.app-shell > \.current-round-winners__announcement\s*\{[\s\S]*?position:\s*absolute/,
  );
  assert.match(
    embedCss,
    /> \.broadcast-phase-bar\s*\{[\s\S]*?grid-row:\s*1/,
  );
  assert.match(
    embedCss,
    /> \.broadcast-focus\s*\{[\s\S]*?grid-row:\s*2/,
  );
  assert.match(embedCss, /--hot-pink:\s*var\(--exlab-palette-main\)/);
  assert.match(
    embedCss,
    /--hot-pink-strong:\s*var\(--exlab-palette-dark\)/,
  );
  assert.match(embedCss, /--magenta:\s*var\(--exlab-palette-dark\)/);
  assert.match(
    await readFile(
      new URL(
        "../app/games/roulette/styles/roulette-cinematic.css",
        import.meta.url,
      ),
      "utf8",
    ),
    /\.raffle-status-path \.is-current > span[\s\S]*?color:\s*var\(--exlab-stage-text,\s*#fff\)/,
  );
  assert.doesNotMatch(
    gameCss,
    /\.broadcast-focus__visual\.is-round-complete[\s\S]{0,180}max-height:/,
  );
  assert.match(wheelSource, /ROULETTE_WHEEL_PALETTE/);
  assert.match(wheelSource, /roulette-wheel__label--tone-\$\{slice\.labelTone\}/);
  assert.match(
    wheelCss,
    /\.roulette-wheel__label--tone-stage[\s\S]*?stroke:/,
    "dark slices retain a structural label separator",
  );
  assert.match(
    skinCss,
    /\.roulette-wheel__label,[\s\S]*?\.roulette-wheel__label--tone-accent[\s\S]*?fill:\s*#251c32[\s\S]*?\.roulette-wheel__label--tone-ink[\s\S]*?fill:\s*#251c32[\s\S]*?\.roulette-wheel__label--tone-stage[\s\S]*?fill:\s*#fff/,
    "standalone tone rules must follow and override the generic label rule",
  );
  assert.match(
    embedCss,
    /:is\(\.roulette-wheel__label,\s*\.roulette-wheel__empty-copy\)[\s\S]*?\.roulette-wheel__label--tone-accent[\s\S]*?fill:\s*var\(--exlab-on-accent,\s*#251c32\)[\s\S]*?\.roulette-wheel__label--tone-ink[\s\S]*?fill:\s*#251c32[\s\S]*?\.roulette-wheel__label--tone-stage[\s\S]*?fill:\s*#fff/,
    "embedded tone rules must follow and override the generic label rule",
  );
});

test("compact Roulette keeps one-column flow and never overlays short-screen results", async () => {
  const [liveInfoCss, viewportCss, embedCss] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/styles/roulette-live-info.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/styles/roulette-viewport.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/styles/roulette-embed.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    liveInfoCss,
    /@media \(max-width: 900px\)[\s\S]*?broadcast-focus\.has-no-results-panel:not\(\.is-stage-only\):not\(\.is-completed\)[\s\S]*?grid-template-areas:\s*'stage'\s*'action'\s*'roster'[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    liveInfoCss,
    /@media \(min-width: 901px\)[\s\S]*?broadcast-focus\.has-no-results-panel:not\(\.is-stage-only\):not\(\.is-completed\) \.broadcast-focus__stage[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\)/,
    "the 1600px legacy showcase must not place the live wheel in a zero-height row",
  );
  assert.match(
    viewportCss,
    /@media \(max-width: 900px\) and \(max-height: 720px\)[\s\S]*?broadcast-focus__action[\s\S]*?position:\s*static[\s\S]*?bottom:\s*auto/,
  );
  assert.match(
    embedCss,
    /broadcast-phase-bar__tools button\s*\{[\s\S]*?white-space:\s*nowrap/,
  );
});

test("Roulette blocks duplicate roster entries until the common policy allows them", () => {
  const base = {
    target: "people" as const,
    participantTotal: 3,
    eligibleParticipantCount: 3,
    candidateParticipantCount: 3,
    excludedParticipantCount: 0,
    poolLimit: 0,
    prizeInventoryCount: 0,
    prizeRecipientCount: 0,
    assignedPrizeRecipientCount: 0,
    drawOptionCount: 3,
    useWeights: false,
    duplicateParticipantCount: 1,
  };

  assert.deepEqual(
    derivePreparationReadiness({
      ...base,
      allowDuplicateNames: false,
    }),
    {
      state: "blocked",
      issue: "people-duplicate-names",
      recovery: "open-roster",
      statusLabel: "동일 이름 1건",
      ctaLabel: "명단 정리",
    },
  );
  assert.equal(
    derivePreparationReadiness({
      ...base,
      allowDuplicateNames: true,
    }).state,
    "ready",
  );
});

test("compact Roulette and Dart reserve screen space for boundary names", async () => {
  const [viewportCss, embedCss, previewDirectorCss] = await Promise.all([
    readFile(
      new URL(
        "../app/games/roulette/styles/roulette-viewport.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/styles/roulette-embed.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/components/DrawPreviewDirector.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(viewportCss, /--wheel-proof-band:\s*5\.5rem/);
  assert.match(
    viewportCss,
    /padding:\s*var\(--wheel-proof-band\)\s*var\(--wheel-stage-padding\)\s*var\(--wheel-stage-floor\)/,
  );
  assert.match(
    viewportCss,
    /\.boundary-names--dart\.is-final[\s\S]*?bottom:\s*calc\(100% \+ 1rem\)/,
  );
  assert.match(
    viewportCss,
    /\.boundary-names--dart\s*\{\s*width:\s*min\(96%, 28rem\)/,
  );
  assert.match(
    viewportCss,
    /@media \(min-width: 901px\) and \(max-width: 1180px\) and \(max-height: 780px\)[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto[\s\S]*?broadcast-action-dock__controls[\s\S]*?height:\s*auto/,
    "medium short viewports must release the completed dock's fixed heights",
  );
  assert.match(
    embedCss,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\)[\s\S]*?app-shell\.app-shell--preparation\.is-embedded,[\s\S]*?roulette-shared-setup\s*\{[\s\S]*?block-size:\s*100%;[\s\S]*?overflow:\s*hidden/,
    "the integrated setup shell and shared workspace must inherit one definite host height",
  );
  assert.doesNotMatch(
    embedCss,
    /app-shell\.app-shell--preparation\.is-embedded\s*\{\s*height:\s*auto/,
  );
  assert.match(
    previewDirectorCss,
    /\.draw-preview-director\.broadcast-focus\s*\{[\s\S]*?height:\s*100%;/,
    "the setup preview director must fill the shared preview stage",
  );
  assert.match(
    embedCss,
    /@media \(min-width: 901px\) and \(min-height: 600px\) and \(max-height: 780px\)[\s\S]*?app-shell\.app-shell--live\.is-embedded:has\([\s\S]*?broadcast-focus\.is-completed[\s\S]*?height:\s*100% !important[\s\S]*?margin:\s*0/,
    "the integrated compact completed board must inherit the shared host height",
  );
  assert.match(
    embedCss,
    /@media \(min-width: 641px\) and \(min-height: 600px\) and \(max-height: 820px\)[\s\S]*?--exlab-setup-gap-group:\s*8px[\s\S]*?--round-setup-control-row-size:\s*56px[\s\S]*?margin-block-start:\s*8px/,
    "short setup screens must compact before they overflow",
  );
  assert.match(
    embedCss,
    /@media \(min-width: 641px\) and \(min-height: 600px\) and \(max-height: 760px\)[\s\S]*?exlab-setup-workspace__eyebrow,[\s\S]*?exlab-setup-option-group__legend small[\s\S]*?display:\s*none/,
    "720p setup hides only repeated helper labels",
  );
});

test("embedded Roulette delegates advanced controls to the shared setup workspace", async () => {
  const [
    gameSource,
    setupSource,
    setupCss,
    embedCss,
    workspaceCss,
    preparationCss,
  ] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/components/RoundSetupPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/components/RoundSetupPanel.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/styles/roulette-embed.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/_platform/components/SetupWorkspace.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/styles/roulette-preparation.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    gameSource,
    /essentialSettings=\{\([\s\S]*?<RoundSetupPanel[\s\S]*?includeAdvancedSettings=\{false\}[\s\S]*?advancedSettings=\{\([\s\S]*?<RoundSetupAdvancedSettings/,
    "embedded Roulette should expose essential and advanced controls through separate shared slots",
  );
  assert.match(
    setupSource,
    /export function RoundSetupAdvancedSettings/,
    "the same typed setup props should drive the extracted advanced controls",
  );
  assert.match(
    setupSource,
    /\{includeAdvancedSettings && \([\s\S]*?<details[\s\S]*?<RoundSetupAdvancedSettings \{\.\.\.props\} \/>/,
    "standalone Roulette should retain its local advanced disclosure",
  );
  assert.match(
    setupSource,
    /aria-label="후보 수"[\s\S]*?onPoolLimitChange\([\s\S]*?Number\(event\.target\.value\)/,
    "large candidate pools should allow direct numeric entry inside the shared stepper geometry",
  );
  assert.match(
    setupSource,
    /aria-label=\{`\$\{participant\.name\} 추첨권`\}[\s\S]*?onParticipantWeightChange\([\s\S]*?Number\(event\.target\.value\)/,
    "participant weights should not require dozens of one-step clicks",
  );

  const essentialSource = setupSource.slice(
    setupSource.indexOf("export default function RoundSetupPanel"),
  );
  const textPosition = essentialSource.indexOf('kind="text"');
  const choicePosition = essentialSource.indexOf('kind="choice"');
  const numberPosition = essentialSource.indexOf('kind="number"');
  assert.ok(
    textPosition >= 0 &&
      textPosition < choicePosition &&
      choicePosition < numberPosition,
    "text, choice, and numeric controls should follow the shared type order",
  );
  assert.match(
    setupCss,
    /\.roulette-setup-workspace \.round-setup--compact\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/,
    "embedded input groups should use the shared dividers instead of another card",
  );
  assert.match(
    setupCss,
    /\.round-setup__data-slot\.round-setup__data-slot--external-roster\s*\{\s*display:\s*none;/,
    "the externally managed roster must not leave a hidden data panel in the setup height",
  );
  assert.match(
    embedCss,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\)[\s\S]*?\.roulette-shared-setup\s*\{[\s\S]*?block-size:\s*100%;[\s\S]*?overflow:\s*hidden/,
    "the embedded shell should own the available desktop height",
  );
  assert.match(
    workspaceCss,
    /@media \(min-width:\s*641px\) and \(min-height:\s*600px\)[\s\S]*?\.exlab-setup-workspace\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?\.exlab-setup-workspace__advanced-content\s*\{[\s\S]*?overflow-y:\s*auto/,
    "opening advanced controls must stay inside the desktop setup viewport",
  );
  assert.doesNotMatch(
    preparationCss,
    /\.roulette-setup-workspace\s*\{[\s\S]*?grid-template-areas:/,
    "Roulette mobile should keep the common settings, preview, advanced, actions order",
  );
  assert.match(
    setupCss,
    /\.roulette-setup-workspace\s+\.round-setup__advanced-body\s*\{[\s\S]*?max-block-size:\s*none;[\s\S]*?overflow:\s*visible;/,
    "embedded mobile advanced options should use the document flow",
  );
  assert.match(
    setupCss,
    /\.roulette-setup-workspace\s+\.round-setup__prizes\s*\{[\s\S]*?overflow:\s*visible;/,
    "embedded product editing should have one settings scroll owner",
  );
});

test("compact Roulette proof, camera, and live focus stay connected", async () => {
  const [
    wheelSource,
    finishSource,
    labelSource,
    gameSource,
    cinematicCss,
  ] = await Promise.all([
    readFile(
      new URL("../app/games/roulette/components/RouletteWheel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/components/DartFinish.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/games/roulette/lib/wheelLabelReadability.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/games/roulette/styles/roulette-cinematic.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(wheelSource, /aria-live=\{showWinner \? 'off' : 'polite'\}/);
  assert.doesNotMatch(wheelSource, /leftNumber=\{/);
  assert.doesNotMatch(wheelSource, /rightNumber=\{/);
  assert.doesNotMatch(wheelSource, /number=\{winnerIndex \+ 1\}/);
  assert.doesNotMatch(wheelSource, /labelKind === ['"]number['"]/);
  assert.doesNotMatch(finishSource, /#\$\{number\}/);
  assert.doesNotMatch(finishSource, /number\?:\s*number/);
  assert.match(finishSource, /<ProofNickname name=\{leftName\} \/>/);
  assert.match(finishSource, /<ProofNickname name=\{rightName\} \/>/);
  assert.doesNotMatch(labelSource, /['"]number['"]/);
  assert.doesNotMatch(labelSource, /NUMBER_TARGET_RENDERED_FONT/);
  assert.match(
    cinematicCss,
    /reveal-phase--dart-names-revealed[\s\S]*?transform-origin:\s*var\(--cinematic-final-x, 50%\) 0%/,
  );
  assert.match(gameSource, /const liveStageTitleRef = useRef<HTMLElement>\(null\)/);
  assert.match(gameSource, /liveStageTitleRef\.current\?\.focus\(\)/);
  assert.match(
    gameSource,
    /ref=\{liveStageTitleRef\} id="stage-title" tabIndex=\{-1\}/,
  );
});
