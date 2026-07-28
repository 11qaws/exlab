import type { DrawRecord, DrawTarget } from '../types';

export type BroadcastSession = {
  id: string;
  target: DrawTarget;
  /** Total results the host intends to reveal before this session is complete. */
  goal: number;
  /** Revealed results in the exact order the audience saw them. */
  results: DrawRecord[];
};

function normalizedGoal(goal: number, revealedCount = 0) {
  const finiteGoal = Number.isFinite(goal) ? Math.floor(goal) : 1;
  return Math.max(1, revealedCount, finiteGoal);
}

export function createBroadcastSession(
  id: string,
  target: DrawTarget,
  goal = 1,
): BroadcastSession {
  return { id, target, goal: normalizedGoal(goal), results: [] };
}

export function updateBroadcastSessionGoal(
  session: BroadcastSession,
  goal: number,
): BroadcastSession {
  const nextGoal = normalizedGoal(goal, session.results.length);
  return nextGoal === session.goal ? session : { ...session, goal: nextGoal };
}

/**
 * Adds one revealed result without allowing a late animation callback or a
 * result from another stage to contaminate the on-air winner board.
 */
export function appendBroadcastSessionResult(
  session: BroadcastSession,
  result: DrawRecord,
): BroadcastSession {
  if (
    result.sessionId !== session.id
    || result.target !== session.target
    || session.results.some((item) => item.id === result.id)
  ) {
    return session;
  }

  const results = [...session.results, result];
  return {
    ...session,
    goal: normalizedGoal(session.goal, results.length),
    results,
  };
}
