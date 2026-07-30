/**
 * The pure layer behind the Roulette round: option shapes, the round and
 * presentation records, roster text handling and the audit record that is
 * frozen before any reveal starts.
 *
 * It lives here rather than in RouletteGame.tsx because none of it touches
 * React. lib/prizeRecipients already took `createId` as an injected
 * parameter purely because that function used to sit in the component file
 * where lib could not import it.
 */


import type { CSSProperties } from 'react';

import { sharedRosterNameKey } from '../../../_platform/roster';
import type { SharedRosterSnapshot } from '../../../_platform/sharedRosterSnapshot';
import {
  reduceResultPresentation,
  type ResultPresentationEvent,
  type ResultPresentationPhase,
  type ResultPresentationState,
  type ResultPresentationToken,
} from '../../../_platform/presentation';
import type { RouletteRevealPhase } from '../components/RouletteWheel';
import type { BroadcastSession } from './broadcastSession';
import type { PresentationRunToken } from './presentationRun';
import type { RaffleStatus } from './raffleLifecycle';
import type {
  DartPhysicalCommit,
  DartShotPlan,
  RouletteFinishLanding,
  SpinPhysicalCommit,
} from './roulette';
import type {
  DrawMode,
  DrawRecord,
  DrawTarget,
  Participant,
  Prize,
  WheelPresentation,
} from '../types';

export type DrawOption = {
  id: string;
  /** Inventory source for a product sector; participant options use their own id. */
  sourceId?: string;
  name: string;
  weight: number;
};

export type SideTab = 'participants' | 'prizes' | 'history';
export type SetupStartStep = 'edit';
export type SetupReturnStatus = Extract<RaffleStatus, 'configuring' | 'ready' | 'completed'>;

export type CurrentRound = {
  id: string;
  sessionId: string;
  /** Optional broadcaster-supplied context shown throughout the live result. */
  label?: string;
  /** Optional reward/event separated from the on-air title. */
  rewardLabel?: string;
  target: DrawTarget;
  mode: DrawMode;
  wheelPresentation: WheelPresentation;
  candidateCount: number;
  /** A limited people pool stays fixed for the whole active round. */
  poolLimit: number;
  removeAfterDraw: boolean;
  useWeights: boolean;
  recipientId?: string;
  recipient?: string;
  prizeAssignmentBatchId?: string;
  results: DrawRecord[];
};

export type PlannedPresentation = {
  options: DrawOption[];
  winnerIndex: number;
  target: DrawTarget;
  selectedAt: string;
  candidateFingerprint: string;
  candidateTotalWeight: number;
  /** Physical coordinate inside the slice that selected this result. */
  landing: RouletteFinishLanding;
  /** Click-time rotor coordinate that physically selected an automatic winner. */
  spinCommit?: SpinPhysicalCommit;
  /** Result-neutral physical coordinates fixed once for a dart reveal. */
  dartShot?: DartShotPlan;
  /** Rotor/aim impact that physically selected a dart winner at click time. */
  dartCommit?: DartPhysicalCommit;
  recipientId?: string;
  recipient?: string;
};

export type CommittedPresentation = PlannedPresentation & {
  /** Click-time audit record persisted before the reveal starts. */
  lockedResult: DrawRecord;
};

export type ActivePresentation = CommittedPresentation & {
  /** Rejects an animation callback from an older result or abandoned round. */
  revealId: number;
  /** Replays the same committed result without entering any persistence path. */
  isReplay?: boolean;
};

export type PresentationBeat = 'idle' | 'motion' | 'hero' | 'dock';
export type CinematicRevealPhase = 'idle' | 'result-committed' | 'motion-started' | RouletteRevealPhase;
export type PresentationCompletion = PresentationRunToken;

export type CinematicCameraStyle = CSSProperties & {
  '--cinematic-impact-x': string;
  '--cinematic-impact-y': string;
  '--cinematic-final-x': string;
  '--cinematic-final-y': string;
};

export type WinnerHeroState = {
  revealId: number;
  result: DrawRecord;
};

export type RoulettePresentationWinner = Readonly<{
  id: string;
  name: string;
  target: DrawTarget;
}>;

export type RoulettePresentationRow = Readonly<{
  id: string;
  name: string;
}>;

export type RoulettePresentationSummary = Readonly<{
  target: DrawTarget;
  presentation?: WheelPresentation;
}>;

export type RouletteResultPresentationState = ResultPresentationState<
  RoulettePresentationWinner,
  RoulettePresentationRow,
  RoulettePresentationSummary
>;

export type RouletteResultPresentationEvent = ResultPresentationEvent<
  RoulettePresentationWinner,
  RoulettePresentationRow,
  RoulettePresentationSummary
>;

export const WINNER_HERO_HOLD_MS = 2_200;
export const WINNER_DOCK_DURATION_MS = 400;

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function rouletteResultPresentationReducer(
  state: RouletteResultPresentationState,
  event: RouletteResultPresentationEvent,
) {
  return reduceResultPresentation(state, event);
}

export function roulettePresentationBeat(phase: ResultPresentationPhase): PresentationBeat {
  if (phase === 'evidence') return 'motion';
  if (phase === 'hero') return 'hero';
  if (phase === 'docking') return 'dock';
  return 'idle';
}

export function roulettePresentationIdentity(
  resultId: string,
  revealId: number,
): ResultPresentationToken {
  return {
    runId: `roulette:${resultId}`,
    presentationId: `roulette-reveal:${revealId}`,
  };
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sharedRosterNames(value: string) {
  return value
    .split(/[\r\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function stableSharedParticipantId(name: string, index: number) {
  let hash = 0x811c9dc5;
  const token = `${index}\u001f${name}`;
  for (let cursor = 0; cursor < token.length; cursor += 1) {
    hash ^= token.charCodeAt(cursor);
    hash = Math.imul(hash, 0x01000193);
  }
  return `shared-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function participantsFromSharedRoster(
  value: string,
  current: readonly Participant[] = [],
) {
  const currentByName = new Map<string, Participant[]>();
  current.forEach((participant) => {
    const key = sharedRosterNameKey(participant.name);
    const matchingParticipants = currentByName.get(key) ?? [];
    matchingParticipants.push(participant);
    currentByName.set(key, matchingParticipants);
  });

  return sharedRosterNames(value).map((name, index) => {
    const existing = currentByName
      .get(sharedRosterNameKey(name))
      ?.shift();
    return existing
      ? { ...existing, name }
      : {
          id: stableSharedParticipantId(name, index),
          name,
          weight: 1,
        };
  });
}

export function participantsFromSharedRosterSnapshot(
  snapshot: SharedRosterSnapshot,
  current: readonly Participant[] = [],
) {
  const currentById = new Map(
    current.map((participant) => [participant.id, participant]),
  );

  return snapshot.participants.map((sharedParticipant) => {
    const existing = currentById.get(sharedParticipant.id);
    return existing
      ? {
          ...existing,
          id: sharedParticipant.id,
          name: sharedParticipant.name,
        }
      : {
          id: sharedParticipant.id,
          name: sharedParticipant.name,
          weight: 1,
        };
  });
}

export function sharedRosterTextFromParticipants(participants: readonly Participant[]) {
  return participants.map((participant) => participant.name.trim()).filter(Boolean).join('\n');
}

export function findDuplicateParticipantNames(
  participants: readonly Participant[],
) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  participants.forEach((participant) => {
    const name = participant.name.trim();
    const key = sharedRosterNameKey(name);
    if (seen.has(key)) duplicates.add(name);
    else seen.add(key);
  });
  return [...duplicates];
}

export const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });
export const TIME_WITH_SECONDS_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatTime(iso: string, includeSeconds = false) {
  return (includeSeconds ? TIME_WITH_SECONDS_FORMATTER : TIME_FORMATTER).format(new Date(iso));
}

export function endedSessionNotice(session: BroadcastSession) {
  if (session.results.length === 0) {
    return '공개 결과 없이 세션을 종료했습니다. 방송 화면을 다시 열면 새 추첨 세션이 시작됩니다.';
  }
  const unit = session.target === 'people' ? '명' : '회';
  return `공개 결과 ${session.results.length}${unit}은 당첨 기록에 남았습니다. 방송 화면을 다시 열면 새 추첨 세션이 시작됩니다.`;
}

export function prizeTotal(prizes: Prize[]) {
  return prizes.reduce((sum, prize) => (
    prize.name.trim() ? sum + Math.max(0, prize.quantity) : sum
  ), 0);
}

export function totalEffectiveWeight(options: readonly DrawOption[]) {
  return options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
}

/** A compact audit marker without persisting an unbounded copy of a large roster. */
export function fingerprintOptions(options: readonly DrawOption[]) {
  let hash = 0x811c9dc5;

  for (const option of options) {
    const token = `${option.id}\u001f${option.name}\u001f${option.weight}\u001e`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function attachLockedResult(
  presentation: PlannedPresentation,
  round: CurrentRound,
  roundOrder: number,
): CommittedPresentation | null {
  const chosen = presentation.options[presentation.winnerIndex];
  if (!chosen) return null;

  return {
    ...presentation,
    lockedResult: {
      id: createId('result'),
      sessionId: round.sessionId,
      createdAt: presentation.selectedAt,
      roundId: round.id,
      roundLabel: round.label,
      rewardLabel: round.rewardLabel,
      roundOrder,
      mode: round.mode,
      presentation: round.mode === 'wheel' ? round.wheelPresentation : undefined,
      candidateCount: presentation.options.length,
      candidateFingerprint: presentation.candidateFingerprint,
      candidateTotalWeight: presentation.candidateTotalWeight,
      useWeights: round.useWeights,
      removeAfterDraw: round.removeAfterDraw,
      target: presentation.target,
      winner: chosen.name,
      prize: presentation.target === 'prizes' ? chosen.name : undefined,
      prizeId: presentation.target === 'prizes' ? chosen.sourceId ?? chosen.id : undefined,
      prizeUnitId: presentation.target === 'prizes' ? `${chosen.id}::${round.id}` : undefined,
      prizeProbabilityModel: presentation.target === 'prizes' ? 'quantity-ratio' : undefined,
      recipientId: presentation.target === 'prizes' ? presentation.recipientId : undefined,
      recipient: presentation.target === 'prizes' ? presentation.recipient : undefined,
      prizeAssignmentBatchId: presentation.target === 'prizes'
        ? round.prizeAssignmentBatchId
        : undefined,
    },
  };
}

