/**
 * The settled-result layer for a Showdown race: the presentation records,
 * the reducer that drives the common presentation machine, the reveal
 * identity and the projection that reads an already-simulated race.
 *
 * The projection describes a finished result; it never decides one. Replaying
 * a run bumps the playback epoch so a callback from the previous playback is
 * rejected instead of driving the current stage.
 */

import {
  createResultPresentationProjection,
  createStagePresentationAnchor,
  reduceResultPresentation,
  type ResultPresentationEvent,
  type ResultPresentationState,
  type ResultPresentationToken,
} from "../../_platform/presentation";
import {
  FINISH_LINE_WIDTH,
  FINISH_LINE_X,
  FINISH_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./course";
import { resolveFinishRecords } from "./race-presentation";
import type { Candidate, RacePlan } from "./types";

export const RESULT_HERO_HOLD_MS = 2_200;
export const RESULT_DOCK_DURATION_MS = 400;

export function candidateForSlot(
  plan: RacePlan,
  slotId: string,
): Candidate | undefined {
  const candidateId = plan.slotToCandidateId[slotId];
  return plan.candidates.find((candidate) => candidate.id === candidateId);
}

export type ShowdownPresentationWinner = Readonly<{
  slotId: string;
  candidateId: string;
  name: string;
  elapsedMs?: number;
}>;

export type ShowdownPresentationRow = Readonly<{
  rank: number;
  slotId: string;
  candidateId: string;
  name: string;
}>;

export type ShowdownPresentationSummary = Readonly<{
  winnerCount: number;
  arrivedCount: number;
  participantCount: number;
}>;

export type ShowdownResultPresentationState = ResultPresentationState<
  ShowdownPresentationWinner,
  ShowdownPresentationRow,
  ShowdownPresentationSummary
>;

export type ShowdownResultPresentationEvent = ResultPresentationEvent<
  ShowdownPresentationWinner,
  ShowdownPresentationRow,
  ShowdownPresentationSummary
>;

export function showdownResultPresentationReducer(
  state: ShowdownResultPresentationState,
  event: ShowdownResultPresentationEvent,
) {
  return reduceResultPresentation(state, event);
}

export function showdownPresentationIdentity(
  runId: string,
  playbackEpoch: number,
): ResultPresentationToken {
  return {
    runId: `showdown:${runId}`,
    presentationId: `showdown-reveal:${runId}:${playbackEpoch}`,
  };
}

export function createShowdownResultProjection(
  plan: RacePlan,
  frameIndex: number,
  playbackEpoch: number,
) {
  const frame =
    plan.simulation.frames[
      Math.min(frameIndex, plan.simulation.frames.length - 1)
    ];
  const finishRecords = resolveFinishRecords(plan.simulation.frames);
  const arrivedRows = frame.finishedSlotIds.flatMap((slotId, index) => {
    const candidate = candidateForSlot(plan, slotId);
    if (!candidate) return [];
    return [{
      rank: index + 1,
      slotId,
      candidateId: candidate.id,
      name: candidate.name,
    }];
  });
  const token = showdownPresentationIdentity(plan.runId, playbackEpoch);

  return createResultPresentationProjection({
    gameId: "showdown",
    runId: token.runId,
    presentationId: token.presentationId,
    committedAt: new Date().toISOString(),
    anchor: createStagePresentationAnchor({
      xRatio:
        (FINISH_LINE_X + FINISH_LINE_WIDTH / 2) / WORLD_WIDTH,
      yRatio: FINISH_Y / WORLD_HEIGHT,
      sourceId: "finish-line",
    }),
    primaryWinners: arrivedRows
      .slice(0, plan.winnerCount)
      .map((row) => ({
        slotId: row.slotId,
        candidateId: row.candidateId,
        name: row.name,
        elapsedMs: finishRecords.get(row.slotId)?.elapsedMs,
      })),
    rankingRows: arrivedRows,
    summary: {
      winnerCount: plan.winnerCount,
      arrivedCount: arrivedRows.length,
      participantCount: plan.candidates.length,
    },
  });
}
