import type {
  ResultPresentationPhase,
  ResultPresentationProjection,
  ResultPresentationToken,
} from "./types";

type ActivePresentationPhase = Exclude<ResultPresentationPhase, "live">;

export type LiveResultPresentationState = Readonly<{
  phase: "live";
  runId: string | null;
  presentationId: null;
  projection: null;
}>;

export type ActiveResultPresentationState<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
> = Readonly<{
  phase: ActivePresentationPhase;
  runId: string;
  presentationId: string;
  projection: ResultPresentationProjection<
    TWinner,
    TRankingRow,
    TSummary
  >;
}>;

export type ResultPresentationState<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
> =
  | LiveResultPresentationState
  | ActiveResultPresentationState<TWinner, TRankingRow, TSummary>;

export const RESULT_PRESENTATION_TRANSITIONS = {
  live: ["evidence"],
  evidence: ["hero"],
  hero: ["docking"],
  docking: ["settled"],
  settled: ["evidence"],
} as const satisfies Readonly<
  Record<ResultPresentationPhase, readonly ResultPresentationPhase[]>
>;

export type ResultPresentationEvent<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
> =
  | {
      type: "run-started";
      runId: string;
      previousRunId: string | null;
    }
  | {
      type: "result-committed";
      projection: ResultPresentationProjection<
        TWinner,
        TRankingRow,
        TSummary
      >;
    }
  | {
      type: "evidence-complete";
      token: ResultPresentationToken;
    }
  | {
      type: "hero-complete";
      token: ResultPresentationToken;
    }
  | {
      type: "docking-complete";
      token: ResultPresentationToken;
    }
  | {
      type: "presentation-restarted";
      token: ResultPresentationToken;
      projection: ResultPresentationProjection<
        TWinner,
        TRankingRow,
        TSummary
      >;
    };

export function createResultPresentationState(
  runId: string | null = null,
): LiveResultPresentationState {
  if (runId !== null && runId.trim().length === 0) {
    throw new Error("runId must not be blank.");
  }

  return Object.freeze({
    phase: "live",
    runId,
    presentationId: null,
    projection: null,
  });
}

export function resultPresentationToken(
  state: ResultPresentationState,
): ResultPresentationToken | null {
  if (state.phase === "live") {
    return null;
  }
  return Object.freeze({
    runId: state.runId,
    presentationId: state.presentationId,
  });
}

export function isCurrentResultPresentation(
  state: ResultPresentationState,
  token: ResultPresentationToken,
): boolean {
  return state.phase !== "live"
    && state.runId === token.runId
    && state.presentationId === token.presentationId;
}

function activateProjection<TWinner, TRankingRow, TSummary>(
  projection: ResultPresentationProjection<
    TWinner,
    TRankingRow,
    TSummary
  >,
): ActiveResultPresentationState<TWinner, TRankingRow, TSummary> {
  return Object.freeze({
    phase: "evidence",
    runId: projection.runId,
    presentationId: projection.presentationId,
    projection,
  });
}

function advancePresentation<TWinner, TRankingRow, TSummary>(
  state: ResultPresentationState<TWinner, TRankingRow, TSummary>,
  token: ResultPresentationToken,
  expectedPhase: ActivePresentationPhase,
  nextPhase: ActivePresentationPhase,
): ResultPresentationState<TWinner, TRankingRow, TSummary> {
  if (
    state.phase !== expectedPhase
    || !isCurrentResultPresentation(state, token)
  ) {
    return state;
  }

  return Object.freeze({ ...state, phase: nextPhase });
}

/**
 * Pure presentation reducer. Unknown, duplicate, out-of-order, or stale
 * completion events are intentionally idempotent no-ops.
 */
export function reduceResultPresentation<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
>(
  state: ResultPresentationState<TWinner, TRankingRow, TSummary>,
  event: ResultPresentationEvent<TWinner, TRankingRow, TSummary>,
): ResultPresentationState<TWinner, TRankingRow, TSummary> {
  switch (event.type) {
    case "run-started": {
      if (event.runId.trim().length === 0) {
        return state;
      }
      if (state.runId === event.runId) {
        return state;
      }
      if (state.runId !== event.previousRunId) {
        return state;
      }
      return createResultPresentationState(event.runId);
    }
    case "result-committed":
      if (
        state.phase !== "live"
        || state.runId !== event.projection.runId
      ) {
        return state;
      }
      return activateProjection(event.projection);
    case "evidence-complete":
      return advancePresentation(
        state,
        event.token,
        "evidence",
        "hero",
      );
    case "hero-complete":
      return advancePresentation(
        state,
        event.token,
        "hero",
        "docking",
      );
    case "docking-complete":
      return advancePresentation(
        state,
        event.token,
        "docking",
        "settled",
      );
    case "presentation-restarted":
      if (
        state.phase !== "settled"
        || !isCurrentResultPresentation(state, event.token)
        || event.projection.runId !== state.runId
        || event.projection.presentationId === state.presentationId
      ) {
        return state;
      }
      return activateProjection(event.projection);
  }
}
