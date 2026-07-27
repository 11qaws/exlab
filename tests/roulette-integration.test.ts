import assert from "node:assert/strict";
import test from "node:test";

import type { DrawRecord } from "../app/games/roulette/types";
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

  assert.match(gameSource, /active\?: boolean;/);
  assert.match(
    gameSource,
    /broadcastSession !== null \|\| raffleStatus === 'roster'/,
  );
  assert.match(gameSource, /enabled=\{active\}/);
  assert.match(
    gameSource,
    /setupReturnStatus !== 'configuring'[\s\S]*?setBroadcastSession\(null\)/,
  );
  assert.match(previewSource, /const active = enabled && inViewport && documentVisible;/);
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
  const viewportCss = await readFile(
    new URL(
      "../app/games/roulette/styles/roulette-viewport.css",
      import.meta.url,
    ),
    "utf8",
  );

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
});
