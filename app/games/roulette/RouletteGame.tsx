'use client';

/* eslint-disable react-hooks/set-state-in-effect -- The imported raffle state
 * machine reconciles controlled roster data and persisted crash-recovery locks
 * inside effects. Moving those transitions into render would make result
 * commitment and recovery ordering less safe. */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { SetupWorkspace } from '../../_platform/components/SetupWorkspace';
import { SharedSetupSummary } from '../../_platform/components/SharedSetupSummary';
import {
  INITIAL_GAME_HOST_STATE,
  isGameSwitchLocked,
  type EmbeddedGameProps,
  type GameHostState,
} from '../../_platform/contracts';
import {
  sharedRosterSnapshotText,
} from '../../_platform/sharedRosterSnapshot';
import {
  advancePreviewCycle,
  createPreviewCycleBuffer,
  DEFAULT_PREVIEW_ROSTER_NAMES,
  previewRosterNamesOrDefault,
} from '../../_platform/previewRoster';
import {
  createResultPresentationProjection,
  createResultPresentationState,
  createStagePresentationAnchor,
  resultPresentationToken,
} from '../../_platform/presentation';
import BroadcastActionDock, { type BroadcastDockAction } from './components/BroadcastActionDock';
import BroadcastCandidateRoster from './components/BroadcastCandidateRoster';
import CurrentRoundWinners from './components/CurrentRoundWinners';
import DrawPreviewDirector from './components/DrawPreviewDirector';
import ParticipantSetup from './components/ParticipantSetup';
import RouletteWheel, {
  type RouletteRevealEvent,
  type RouletteWheelHandle,
} from './components/RouletteWheel';
import RoundSetupPanel, {
  RoundSetupAdvancedSettings,
  describeRoundSetupAdvancedSettings,
  type RoundSetupPanelProps,
} from './components/RoundSetupPanel';
import WinnerHero from './components/WinnerHero';
import {
  appendBroadcastSessionResult,
  createBroadcastSession,
  updateBroadcastSessionGoal,
  type BroadcastSession,
} from './lib/broadcastSession';
import { sampleWithoutReplacement } from './lib/draw';
import { createHistoryCsv } from './lib/historyCsv';
import {
  readStoredRouletteHistory,
  writeStoredRouletteHistory,
} from './lib/historyStorage';
import { createPrizeDrawOptions } from './lib/prizeDraw';
import {
  appendPrizeAssignmentResult,
  arePrizeRecipientPlansEqual,
  countAssignedPrizeRecipients,
  createLinkedPrizeRecipients,
  findLatestPeopleWinnerResults,
  findNextPrizeRecipient,
  reconcileManualPrizeRecipients,
  retainAssignedPrizeRecipientIds,
  retainPrizeAssignmentResults,
} from './lib/prizeRecipients';
import {
  getRaffleTransition,
  isRaffleActive,
  RAFFLE_STATUS_META,
  type RaffleEvent,
  type RaffleStatus,
} from './lib/raffleLifecycle';
import {
  consumePendingRecord,
  mergeRecoveredHistory,
  readPendingRaffleLock,
  removePendingRaffleLock,
  type PendingRaffleLock,
  writePendingRaffleLock,
} from './lib/pendingRaffle';
import { derivePreparationReadiness } from './lib/preparation';
import {
  createStoredPrizeAssignment,
  mergePrizeAssignmentResults,
  readStoredPrizeAssignment,
  removeStoredPrizeAssignment,
  writeStoredPrizeAssignment,
} from './lib/prizeAssignmentStorage';
import {
  isCurrentPresentationCompletion,
} from './lib/presentationRun';
import {
  createDartAimSession,
  createDartPhysicalCommit,
  createRouletteGeometrySignature,
  createSpinPhysicalCommit,
  resolveDartImpactPoint,
  type DartAimSession,
  type DartPhysicalCommit,
  type SpinPhysicalCommit,
} from './lib/roulette';
import type {
  DrawMode,
  DrawRecord,
  DrawTarget,
  Participant,
  Prize,
  PrizeRecipient,
  PrizeRecipientSource,
  WheelPresentation,
} from './types';

import './styles/roulette-foundation.css';
import './styles/roulette-skin.css';
import './styles/roulette-shell.css';
import './roulette-game.css';
import './styles/roulette-cinematic.css';
import './styles/roulette-flow.css';
import './styles/roulette-preparation.css';
import './styles/roulette-viewport.css';
import './styles/roulette-live-info.css';
import './styles/roulette-embed.css';

import {
  WINNER_DOCK_DURATION_MS,
  WINNER_HERO_HOLD_MS,
  attachLockedResult,
  createId,
  endedSessionNotice,
  findDuplicateParticipantNames,
  fingerprintOptions,
  formatTime,
  participantsFromSharedRoster,
  participantsFromSharedRosterSnapshot,
  prefersReducedMotion,
  prizeTotal,
  roulettePresentationBeat,
  roulettePresentationIdentity,
  rouletteResultPresentationReducer,
  sharedRosterNames,
  sharedRosterTextFromParticipants,
  totalEffectiveWeight,
  type ActivePresentation,
  type CinematicCameraStyle,
  type CinematicRevealPhase,
  type CommittedPresentation,
  type CurrentRound,
  type DrawOption,
  type PresentationCompletion,
  type RouletteResultPresentationEvent,
  type RouletteResultPresentationState,
  type SetupReturnStatus,
  type SetupStartStep,
  type SideTab,
  type WinnerHeroState,
} from './lib/roundContract';

export type RouletteGameProps = EmbeddedGameProps;

type PeoplePreviewInput = Readonly<{
  names: readonly string[];
  weights?: readonly number[];
}>;

export function RouletteGame({
  embedded = false,
  visible,
  active = visible ?? true,
  roster,
  rosterText: legacyRosterText,
  onRosterTextChange,
  allowDuplicateNames: legacyAllowDuplicateNames,
  onRequestRosterEdit,
  onHostStateChange,
  onActivityChange,
}: RouletteGameProps) {
  const rosterText = roster
    ? sharedRosterSnapshotText(roster)
    : legacyRosterText;
  const allowDuplicateNames =
    roster?.allowDuplicateNames
    ?? legacyAllowDuplicateNames
    ?? false;
  const [drawMode] = useState<DrawMode>('wheel');
  const [wheelPresentation, setWheelPresentation] = useState<WheelPresentation>('spin');
  const [drawTarget, setDrawTarget] = useState<DrawTarget>('people');
  const [winnerGoals, setWinnerGoals] = useState<Record<DrawTarget, number>>({
    people: 1,
    prizes: 1,
  });
  const [participants, setParticipants] = useState<Participant[]>(() => (
    roster
      ? participantsFromSharedRosterSnapshot(roster)
      : rosterText === undefined
        ? []
        : participantsFromSharedRoster(rosterText)
  ));
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [excludedParticipantIds, setExcludedParticipantIds] = useState<string[]>([]);
  const [poolLimit, setPoolLimit] = useState(0);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [drawLabel, setDrawLabel] = useState('');
  const [rewardLabel, setRewardLabel] = useState('');
  const [removeAfterDraw, setRemoveAfterDraw] = useState(true);
  const [weightModes, setWeightModes] = useState<Record<DrawTarget, boolean>>({ people: false, prizes: false });
  const [prizeRecipients, setPrizeRecipients] = useState<PrizeRecipient[]>([]);
  const [prizeRecipientText, setPrizeRecipientText] = useState('');
  const [prizeRecipientSource, setPrizeRecipientSource] = useState<PrizeRecipientSource>('manual');
  const [assignedPrizeRecipientIds, setAssignedPrizeRecipientIds] = useState<string[]>([]);
  const [prizeAssignmentResults, setPrizeAssignmentResults] = useState<DrawRecord[]>([]);
  const [prizeAssignmentBatchId, setPrizeAssignmentBatchId] = useState<string | null>(null);
  const [prizeAssignmentHydrated, setPrizeAssignmentHydrated] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [presentedOptions, setPresentedOptions] = useState<DrawOption[]>([]);
  const [activePresentation, setActivePresentation] = useState<ActivePresentation | null>(null);
  const [lastCommittedPresentation, setLastCommittedPresentation] = useState<ActivePresentation | null>(null);
  const [resultPresentation, dispatchResultPresentationState] = useReducer(
    rouletteResultPresentationReducer,
    undefined,
    () => createResultPresentationState('roulette:idle:0'),
  );
  const presentationBeat = roulettePresentationBeat(resultPresentation.phase);
  const [cinematicRevealPhase, setCinematicRevealPhase] = useState<CinematicRevealPhase>('idle');
  const [winnerHero, setWinnerHero] = useState<WinnerHeroState | null>(null);
  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [broadcastSession, setBroadcastSession] = useState<BroadcastSession | null>(null);
  const [pausedBroadcastSession, setPausedBroadcastSession] = useState<BroadcastSession | null>(null);
  const [rotorReady, setRotorReady] = useState(false);
  const [dartAimSession, setDartAimSession] = useState<DartAimSession | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('participants');
  const [raffleStatus, setRaffleStatus] = useState<RaffleStatus>('configuring');
  const [setupReturnStatus, setSetupReturnStatus] = useState<SetupReturnStatus>('configuring');
  const [setupSession, setSetupSession] = useState(0);
  const [setupStartStep, setSetupStartStep] = useState<SetupStartStep>('edit');
  const [participantPreviewDraft, setParticipantPreviewDraft] = useState<Participant[]>([]);
  const [rosterEditorDirty, setRosterEditorDirty] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastEndedSessionNotice, setLastEndedSessionNotice] = useState<string | null>(null);
  const [copyingParticipantList, setCopyingParticipantList] =
    useState(false);
  const rouletteRootRef = useRef<HTMLDivElement>(null);
  const liveStageTitleRef = useRef<HTMLElement>(null);
  const completedPrimaryActionRef = useRef<HTMLButtonElement>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);
  const toolsDrawerRef = useRef<HTMLElement>(null);
  const rosterTriggerRef = useRef<HTMLElement | null>(null);
  const raffleStatusRef = useRef<RaffleStatus>('configuring');
  const hostStateChangeRef = useRef(onHostStateChange);
  const activityChangeRef = useRef(onActivityChange);
  const resultPresentationRef = useRef<RouletteResultPresentationState>(resultPresentation);
  const presentationRunRef = useRef(0);
  const spinKeyRef = useRef(0);
  const presentationStartTimerRef = useRef<number | null>(null);
  const winnerHeroTimerRef = useRef<number | null>(null);
  const winnerDockTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const dartAimSequenceRef = useRef(0);
  const dartAimContextRef = useRef<string | null>(null);
  const liveWheelRef = useRef<RouletteWheelHandle>(null);
  const historyStorageWarningShownRef = useRef(false);
  const prizeAssignmentStorageWarningShownRef = useRef(false);
  const pendingRecoveryNeedsCleanupRef = useRef(false);
  const resolvedRevealIdsRef = useRef(new Set<number>());
  const useWeights = drawTarget === 'people' ? weightModes.people : false;
  const normalizedExternalRoster = rosterText === undefined
    ? null
    : sharedRosterNames(rosterText).join('\n');
  const externalRosterIdentity = roster
    ? roster.participants
        .map((participant) => `${participant.id}\u001f${participant.name}`)
        .join('\u001e')
    : normalizedExternalRoster;
  const dispatchResultPresentation = useCallback((
    event: RouletteResultPresentationEvent,
  ) => {
    resultPresentationRef.current = rouletteResultPresentationReducer(
      resultPresentationRef.current,
      event,
    );
    dispatchResultPresentationState(event);
  }, []);

  useEffect(() => {
    hostStateChangeRef.current = onHostStateChange;
  }, [onHostStateChange]);

  useEffect(() => {
    activityChangeRef.current = onActivityChange;
  }, [onActivityChange]);

  const hostState = useMemo<GameHostState>(() => {
    if (
      raffleStatus === 'roster'
      && setupReturnStatus !== 'configuring'
    ) {
      return {
        lifecycle:
          setupReturnStatus === 'completed'
            ? 'result'
            : 'waiting',
        statusLabel: '명단 편집 중',
        sessionId: broadcastSession?.id,
        runId: currentRound?.id,
      };
    }
    if (raffleStatus === 'ready') {
      return {
        lifecycle: 'waiting',
        statusLabel: '추첨 대기 중',
        sessionId: broadcastSession?.id,
        runId: currentRound?.id,
      };
    }
    if (raffleStatus === 'locking') {
      return {
        lifecycle: 'active',
        statusLabel: '결과 확정 중',
        sessionId: broadcastSession?.id,
        runId: currentRound?.id,
      };
    }
    if (raffleStatus === 'presenting') {
      return {
        lifecycle: 'settling',
        statusLabel: '결과 공개 중',
        sessionId: broadcastSession?.id,
        runId: currentRound?.id,
      };
    }
    if (raffleStatus === 'completed') {
      return {
        lifecycle: 'result',
        statusLabel: '추첨 결과',
        sessionId: broadcastSession?.id,
        runId: currentRound?.id,
      };
    }
    return INITIAL_GAME_HOST_STATE;
  }, [
    broadcastSession?.id,
    currentRound?.id,
    raffleStatus,
    setupReturnStatus,
  ]);

  useEffect(() => {
    onHostStateChange?.(hostState);
    onActivityChange?.(isGameSwitchLocked(hostState.lifecycle));
  }, [hostState, onActivityChange, onHostStateChange]);

  useEffect(() => () => {
    hostStateChangeRef.current?.(INITIAL_GAME_HOST_STATE);
    activityChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (
      normalizedExternalRoster === null
      || raffleStatus !== 'configuring'
      || rosterEditorDirty
    ) return;

    const rosterMatches = roster
      ? participants.length === roster.participants.length
        && participants.every((participant, index) => {
          const sharedParticipant = roster.participants[index];
          return (
            participant.id === sharedParticipant.id
            && participant.name === sharedParticipant.name
          );
        })
      : sharedRosterTextFromParticipants(participants)
        === normalizedExternalRoster;
    if (rosterMatches) return;

    const nextParticipants = roster
      ? participantsFromSharedRosterSnapshot(roster, participants)
      : participantsFromSharedRoster(
          normalizedExternalRoster,
          participants,
        );
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    setParticipants(nextParticipants);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolLimit((limit) => Math.min(limit, nextParticipants.length));
    setPoolIds([]);
    setParticipantPreviewDraft([]);
  }, [
    externalRosterIdentity,
    normalizedExternalRoster,
    participants,
    raffleStatus,
    roster,
    rosterEditorDirty,
  ]);

  const setUseWeights = useCallback((value: boolean) => {
    if (drawTarget !== 'people') return;
    setWeightModes((modes) => ({ ...modes, [drawTarget]: value }));
  }, [drawTarget]);

  const primeDartAim = useCallback(() => {
    const id = dartAimSequenceRef.current + 1;
    dartAimSequenceRef.current = id;
    const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
    setDartAimSession(createDartAimSession(id, startedAt));
  }, []);

  useEffect(() => {
    const aimContext = raffleStatus === 'ready' && wheelPresentation === 'dart'
      ? `ready:${currentRound?.id ?? 'first'}`
      : null;
    if (aimContext) {
      if (dartAimContextRef.current !== aimContext) {
        dartAimContextRef.current = aimContext;
        primeDartAim();
      }
      return;
    }
    if (raffleStatus === 'configuring' || raffleStatus === 'completed') {
      dartAimContextRef.current = null;
      setDartAimSession(null);
    }
  }, [currentRound?.id, currentRound?.results.length, currentRound?.wheelPresentation, primeDartAim, raffleStatus, wheelPresentation]);

  const handleRouletteRevealPhase = useCallback((event: RouletteRevealEvent) => {
    // Animation callbacks can arrive after a round was reset. Only the wheel
    // run that is currently on air may move the cinematic camera/state.
    if (
      event.spinKey !== spinKeyRef.current ||
      event.revealId !== presentationRunRef.current
    ) return;
    setCinematicRevealPhase(event.phase);
  }, []);

  const transitionRaffle = useCallback((event: RaffleEvent) => {
    const nextStatus = getRaffleTransition(raffleStatusRef.current, event);
    if (!nextStatus) return false;
    raffleStatusRef.current = nextStatus;
    if (nextStatus === 'ready') setRotorReady(false);
    setRaffleStatus(nextStatus);
    return true;
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3200);
  }, []);

  const focusLiveStage = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => liveStageTitleRef.current?.focus());
    });
  }, []);

  const focusPreparationPrimary = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        rouletteRootRef.current
          ?.querySelector<HTMLButtonElement>(
            '.exlab-setup-workspace__primary-action button, .preparation-preview__primary',
          )
          ?.focus();
      });
    });
  }, []);

  const persistPendingResults = useCallback((roundId: string, records: DrawRecord[]) => {
    try {
      writePendingRaffleLock(localStorage, {
        version: 1,
        roundId,
        savedAt: new Date().toISOString(),
        records,
      });
      return true;
    } catch {
      showToast('결과는 고정됐지만 복구용 기록을 저장하지 못했어요. 이 탭을 닫지 마세요.');
      return false;
    }
  }, [showToast]);

  const cancelWinnerRevealTimers = useCallback(() => {
    if (presentationStartTimerRef.current !== null) {
      window.clearTimeout(presentationStartTimerRef.current);
      presentationStartTimerRef.current = null;
    }
    if (winnerHeroTimerRef.current !== null) {
      window.clearTimeout(winnerHeroTimerRef.current);
      winnerHeroTimerRef.current = null;
    }
    if (winnerDockTimerRef.current !== null) {
      window.clearTimeout(winnerDockTimerRef.current);
      winnerDockTimerRef.current = null;
    }
  }, []);

  const closeTools = useCallback((restoreFocus = false) => {
    setToolsOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => toolsTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!toolsOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => toolsCloseRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTools(true);
        return;
      }

      if (event.key !== 'Tab') return;

      const drawer = toolsDrawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>([
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(','))).filter((element) => !element.hasAttribute('hidden'));

      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTools, toolsOpen]);

  useEffect(() => {
    let storedHistory: DrawRecord[] = [];
    try {
      storedHistory = readStoredRouletteHistory(localStorage);
    } catch {
      // A history failure should never prevent a live giveaway from working.
    }

    try {
      const pending = readPendingRaffleLock(localStorage);
      if (pending) {
        const knownIds = new Set(storedHistory.map((record) => record.id));
        const recoveredCount = pending.records.filter((record) => !knownIds.has(record.id)).length;
        storedHistory = mergeRecoveredHistory(storedHistory, pending);
        pendingRecoveryNeedsCleanupRef.current = true;
        if (recoveredCount > 0) {
          showToast(`이전 회차에서 확정된 결과 ${recoveredCount}건을 당첨 기록에 복구했어요.`);
        }
      }
    } catch {
      // Invalid recovery data is ignored without blocking a fresh raffle.
    }

    setHistory(storedHistory);
    setHistoryHydrated(true);
  }, [showToast]);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      writeStoredRouletteHistory(localStorage, history);
      if (pendingRecoveryNeedsCleanupRef.current) {
        removePendingRaffleLock(localStorage);
        pendingRecoveryNeedsCleanupRef.current = false;
      } else {
        const pending = readPendingRaffleLock(localStorage);
        if (pending) {
          let nextPending: PendingRaffleLock | null = pending;
          history.forEach((record) => {
            if (!nextPending || !record.revealedAt) return;
            nextPending = consumePendingRecord(nextPending, record.id);
          });
          if (nextPending) {
            writePendingRaffleLock(localStorage, nextPending);
          } else {
            removePendingRaffleLock(localStorage);
          }
        }
      }
    } catch {
      if (history.length === 0 || historyStorageWarningShownRef.current) return;
      historyStorageWarningShownRef.current = true;
      showToast('당첨 기록을 브라우저에 저장하지 못했어요. CSV로 내려받아 보관해 주세요.');
    }
  }, [history, historyHydrated, showToast]);

  useEffect(() => {
    try {
      const stored = readStoredPrizeAssignment(localStorage);
      if (stored) {
        setPrizeRecipients(stored.recipients);
        setPrizeRecipientText(stored.recipients.map((recipient) => recipient.name).join('\n'));
        setPrizeRecipientSource(stored.source);
        setAssignedPrizeRecipientIds(stored.assignedRecipientIds);
        setPrizeAssignmentResults(stored.results);
        setPrizeAssignmentBatchId(stored.batchId);
      }
    } catch {
      // An unavailable browser store must not block a live draw.
    } finally {
      setPrizeAssignmentHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!prizeAssignmentHydrated) return;
    try {
      if (prizeRecipients.length === 0) {
        removeStoredPrizeAssignment(localStorage);
        return;
      }
      if (!prizeAssignmentBatchId) return;
      writeStoredPrizeAssignment(
        localStorage,
        createStoredPrizeAssignment(
          prizeAssignmentBatchId,
          prizeRecipientSource,
          prizeRecipients,
          prizeAssignmentResults,
        ),
      );
    } catch {
      if (prizeAssignmentStorageWarningShownRef.current) return;
      prizeAssignmentStorageWarningShownRef.current = true;
      showToast('상품 배정 진행을 브라우저에 저장하지 못했어요. 이 탭을 닫기 전에 배정을 마쳐 주세요.');
    }
  }, [
    assignedPrizeRecipientIds,
    prizeAssignmentBatchId,
    prizeAssignmentHydrated,
    prizeAssignmentResults,
    prizeRecipientSource,
    prizeRecipients,
    showToast,
  ]);

  useEffect(() => {
    if (!historyHydrated || !prizeAssignmentHydrated || !prizeAssignmentBatchId) return;
    const reconciledResults = mergePrizeAssignmentResults(
      prizeAssignmentBatchId,
      prizeRecipients,
      prizeAssignmentResults,
      history,
    );
    const reconciledAssignedIds = reconciledResults.map((result) => result.recipientId as string);
    if (reconciledResults.map((result) => result.id).join('|') !== prizeAssignmentResults.map((result) => result.id).join('|')) {
      setPrizeAssignmentResults(reconciledResults);
    }
    if (reconciledAssignedIds.join('|') !== assignedPrizeRecipientIds.join('|')) {
      setAssignedPrizeRecipientIds(reconciledAssignedIds);
    }
  }, [
    assignedPrizeRecipientIds,
    history,
    historyHydrated,
    prizeAssignmentBatchId,
    prizeAssignmentHydrated,
    prizeAssignmentResults,
    prizeRecipients,
  ]);

  useEffect(() => {
    if (!isRaffleActive(raffleStatus)) return undefined;

    const protectActiveRound = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectActiveRound);
    return () => window.removeEventListener('beforeunload', protectActiveRound);
  }, [raffleStatus]);

  useEffect(() => {
    if (!window.location.hash.startsWith('#import=')) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    showToast('네이버 URL 자동 가져오기는 종료됐어요. 카페 페이지를 붙여넣어 주세요.');
  }, [showToast]);

  useEffect(() => {
    // An inactive keep-alive game must not move the shared page, but the active
    // embedded game still needs to reset its viewport when preparation changes
    // into the broadcast surface. Otherwise a mobile user enters the live
    // screen at the old preparation CTA scroll position underneath the sticky
    // exlab header.
    if (!embedded || active) window.scrollTo(0, 0);
  }, [active, embedded, raffleStatus]);

  useEffect(() => () => {
    // Ignore a late browser animation callback after this app has gone away.
    presentationRunRef.current += 1;
    cancelWinnerRevealTimers();
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, [cancelWinnerRevealTimers]);

  const excludedParticipantIdSet = useMemo(
    () => new Set(excludedParticipantIds),
    [excludedParticipantIds],
  );
  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !excludedParticipantIdSet.has(participant.id)),
    [excludedParticipantIdSet, participants],
  );

  useEffect(() => {
    // A limited candidate pool must not silently refill while a round owns its
    // snapshot. An early-ended dart round is complete for this purpose.
    if (currentRound && isRaffleActive(raffleStatus)) return;

    if (poolLimit === 0) {
      if (poolIds.length > 0) setPoolIds([]);
      return;
    }

    const limit = Math.min(poolLimit, eligibleParticipants.length);
    const availableIds = new Set(eligibleParticipants.map((participant) => participant.id));
    const retained = poolIds.filter((id) => availableIds.has(id)).slice(0, limit);
    if (retained.length === limit) {
      if (retained.join('|') !== poolIds.join('|')) setPoolIds(retained);
      return;
    }

    const remaining = eligibleParticipants.filter((participant) => !retained.includes(participant.id));
    const fill = sampleWithoutReplacement(remaining, limit - retained.length).map((participant) => participant.id);
    setPoolIds([...retained, ...fill]);
  }, [currentRound, eligibleParticipants, poolIds, poolLimit, raffleStatus]);

  const candidateParticipants = useMemo(() => {
    if (poolLimit === 0) return eligibleParticipants;
    const selected = new Set(poolIds);
    return eligibleParticipants.filter((participant) => selected.has(participant.id));
  }, [eligibleParticipants, poolIds, poolLimit]);
  const duplicateParticipantNames = useMemo(
    () => findDuplicateParticipantNames(participants),
    [participants],
  );

  const drawOptions = useMemo<DrawOption[]>(() => {
    const options = drawTarget === 'people'
      ? candidateParticipants.map((participant) => ({
          id: participant.id,
          name: participant.name,
          weight: useWeights ? participant.weight : 1,
        }))
      : createPrizeDrawOptions(prizes);

    return useWeights ? options.filter((option) => option.weight > 0) : options;
  }, [candidateParticipants, drawTarget, prizes, useWeights]);


  const drawOptionNames = useMemo(() => drawOptions.map((option) => option.name), [drawOptions]);
  const drawOptionWeights = useMemo(() => drawOptions.map((option) => option.weight), [drawOptions]);
  const requestedPeoplePreview = useMemo<PeoplePreviewInput>(() => {
    if (raffleStatus === 'roster') {
      const names = participantPreviewDraft
        .map((participant) => participant.name.trim())
        .filter(Boolean);
      return {
        names,
        weights: useWeights
          ? participantPreviewDraft.map((participant) => participant.weight)
          : undefined,
      };
    }
    return {
      names: drawOptionNames,
      weights: drawOptionWeights,
    };
  }, [
    drawOptionNames,
    drawOptionWeights,
    participantPreviewDraft,
    raffleStatus,
    useWeights,
  ]);
  const requestedPeoplePreviewRef = useRef(requestedPeoplePreview);
  useEffect(() => {
    requestedPeoplePreviewRef.current = requestedPeoplePreview;
  }, [requestedPeoplePreview]);
  const [peoplePreviewCycle, setPeoplePreviewCycle] = useState(() => (
    createPreviewCycleBuffer<PeoplePreviewInput>(
      {
        names: [...DEFAULT_PREVIEW_ROSTER_NAMES],
        weights: undefined,
      },
      {
        names: previewRosterNamesOrDefault(requestedPeoplePreview.names),
        weights: requestedPeoplePreview.names.length > 0
          ? requestedPeoplePreview.weights
          : undefined,
      },
    )
  ));
  const advancePeoplePreviewCycle = useCallback(() => {
    const requested = requestedPeoplePreviewRef.current;
    const latestPending: PeoplePreviewInput = {
      names: previewRosterNamesOrDefault(requested.names),
      weights: requested.names.length > 0
        ? requested.weights
        : undefined,
    };
    setPeoplePreviewCycle((state) => (
      advancePreviewCycle(state, latestPending)
    ));
  }, []);
  const displayOptions = useMemo(
    () => spinning || winnerIndex !== null ? presentedOptions : drawOptions,
    [drawOptions, presentedOptions, spinning, winnerIndex],
  );
  const displayNames = useMemo(() => displayOptions.map((option) => option.name), [displayOptions]);
  const displayWeights = useMemo(() => displayOptions.map((option) => option.weight), [displayOptions]);
  const availablePrizeCount = prizeTotal(prizes);
  const recentPeopleWinnerResults = useMemo(
    () => findLatestPeopleWinnerResults(history),
    [history],
  );
  const recentLinkedPrizeRecipients = useMemo(
    () => createLinkedPrizeRecipients(recentPeopleWinnerResults),
    [recentPeopleWinnerResults],
  );
  const recentWinnersAlreadyLoaded = prizeRecipientSource === 'linked'
    && arePrizeRecipientPlansEqual(prizeRecipients, recentLinkedPrizeRecipients);
  const nextPrizeRecipient = useMemo(
    () => findNextPrizeRecipient(prizeRecipients, assignedPrizeRecipientIds),
    [assignedPrizeRecipientIds, prizeRecipients],
  );
  const assignedPrizeRecipientCount = useMemo(
    () => countAssignedPrizeRecipients(prizeRecipients, assignedPrizeRecipientIds),
    [assignedPrizeRecipientIds, prizeRecipients],
  );
  const isPresentationLocked = raffleStatus === 'locking' || raffleStatus === 'presenting';
  const isStageLocked = isRaffleActive(raffleStatus);
  const isConfigurationEditable = raffleStatus === 'configuring' && pausedBroadcastSession === null;
  const remainingPrizeRecipientCount = Math.max(
    0,
    prizeRecipients.length - assignedPrizeRecipientCount,
  );
  const maximumWinnerGoal = drawTarget === 'people'
    ? drawOptions.length
    : prizeRecipients.length > 0
      ? Math.min(availablePrizeCount, remainingPrizeRecipientCount)
      : availablePrizeCount;
  const winnerGoal = Math.max(
    1,
    Math.min(winnerGoals[drawTarget], Math.max(1, maximumWinnerGoal)),
  );
  const setupWinnerGoal = pausedBroadcastSession?.goal ?? winnerGoal;
  const setupMaximumWinnerGoal = pausedBroadcastSession
    ? Math.max(pausedBroadcastSession.goal, maximumWinnerGoal)
    : maximumWinnerGoal;

  useEffect(() => {
    if (!isConfigurationEditable || maximumWinnerGoal < 1) return;
    setWinnerGoals((goals) => {
      const normalizedGoal = Math.max(
        1,
        Math.min(maximumWinnerGoal, Math.floor(goals[drawTarget]) || 1),
      );
      return goals[drawTarget] === normalizedGoal
        ? goals
        : { ...goals, [drawTarget]: normalizedGoal };
    });
  }, [drawTarget, isConfigurationEditable, maximumWinnerGoal]);

  const changeWinnerGoal = (value: number) => {
    if (!isConfigurationEditable || maximumWinnerGoal < 1) return;
    const normalizedGoal = Math.max(1, Math.min(maximumWinnerGoal, Math.floor(value) || 1));
    setWinnerGoals((goals) => ({ ...goals, [drawTarget]: normalizedGoal }));
  };

  const buildPresentationPlan = useCallback((
    snapshot: readonly DrawOption[],
    target: DrawTarget,
    recipientIdSnapshot: string | undefined,
    recipientSnapshot: string | undefined,
    wheelReveal: WheelPresentation,
    spinPhysicalCommit?: SpinPhysicalCommit,
    dartPhysicalCommit?: DartPhysicalCommit,
  ) => {
    const options = [...snapshot];
    const selectedAt = new Date().toISOString();

    if (wheelReveal === 'dart') {
      if (
        !dartPhysicalCommit
        || dartPhysicalCommit.winnerIndex < 0
        || dartPhysicalCommit.winnerIndex >= options.length
        || dartPhysicalCommit.geometrySignature !== createRouletteGeometrySignature(
          options.length,
          options.map((option) => option.weight),
        )
      ) return [];

      return [{
        options,
        winnerIndex: dartPhysicalCommit.winnerIndex,
        target,
        selectedAt,
        recipientId: recipientIdSnapshot,
        recipient: recipientSnapshot,
        candidateFingerprint: fingerprintOptions(options),
        candidateTotalWeight: totalEffectiveWeight(options),
        landing: dartPhysicalCommit.landing,
        dartShot: dartPhysicalCommit.shot,
        dartCommit: dartPhysicalCommit,
      }];
    }

    if (
      !spinPhysicalCommit
      || spinPhysicalCommit.winnerIndex < 0
      || spinPhysicalCommit.winnerIndex >= options.length
      || spinPhysicalCommit.geometrySignature !== createRouletteGeometrySignature(
        options.length,
        options.map((option) => option.weight),
      )
    ) return [];

    return [{
      options,
      winnerIndex: spinPhysicalCommit.winnerIndex,
      target,
      selectedAt,
      recipientId: recipientIdSnapshot,
      recipient: recipientSnapshot,
      candidateFingerprint: fingerprintOptions(options),
      candidateTotalWeight: totalEffectiveWeight(options),
      landing: spinPhysicalCommit.landing,
      spinCommit: spinPhysicalCommit,
    }];
  }, []);

  /**
   * Starts an already-committed reveal. Selection happened before this call;
   * the short locking beat makes that boundary visible on the broadcast.
   */
  const launchCommittedPresentation = useCallback((
    presentation: CommittedPresentation,
    isReplay = false,
  ) => {
    const previousPresentationToken = isReplay
      ? resultPresentationToken(resultPresentationRef.current)
      : null;
    if (isReplay && !previousPresentationToken) return false;
    if (!transitionRaffle(isReplay ? 'replay-result' : 'lock-result')) return false;

    cancelWinnerRevealTimers();
    setWinnerHero(null);
    const revealId = presentationRunRef.current + 1;
    presentationRunRef.current = revealId;
    const presentationToken = roulettePresentationIdentity(
      presentation.lockedResult.id,
      revealId,
    );
    const resultAnchor = resolveDartImpactPoint(presentation.dartShot);
    const projection = createResultPresentationProjection({
      gameId: 'roulette',
      runId: presentationToken.runId,
      presentationId: presentationToken.presentationId,
      committedAt: presentation.lockedResult.createdAt,
      anchor: createStagePresentationAnchor({
        xRatio: resultAnchor.xPercent / 100,
        yRatio: resultAnchor.yPercent / 100,
        sourceId: presentation.lockedResult.id,
      }),
      primaryWinners: [{
        id: presentation.lockedResult.id,
        name: presentation.lockedResult.winner,
        target: presentation.lockedResult.target,
      }],
      rankingRows: [{
        id: presentation.lockedResult.id,
        name: presentation.lockedResult.winner,
      }],
      summary: {
        target: presentation.lockedResult.target,
        presentation: presentation.lockedResult.presentation,
      },
    });

    if (isReplay) {
      dispatchResultPresentation({
        type: 'presentation-restarted',
        token: previousPresentationToken ?? presentationToken,
        projection,
      });
    } else {
      const previousRunId = resultPresentationRef.current.runId;
      dispatchResultPresentation({
        type: 'run-started',
        previousRunId,
        runId: presentationToken.runId,
      });
      dispatchResultPresentation({
        type: 'result-committed',
        projection,
      });
    }
    setActivePresentation({ ...presentation, revealId, isReplay });
    setPresentedOptions(presentation.options);
    // Keep the committed winner out of the visual component until motion
    // begins. This preserves the high-speed ready wheel during the lock badge
    // and prevents a one-frame winner highlight before the reveal.
    setWinnerIndex(null);
    setSpinning(false);
    setCinematicRevealPhase('result-committed');

    // Keep one short, visible frame between "the result is fixed" and the
    // presentation. The wheel continues its idle high-speed rotation in this
    // phase, so the pause proves ordering without killing momentum.
    const beginPresentation = () => {
      if (presentationRunRef.current !== revealId) return;
      presentationStartTimerRef.current = null;
      if (!transitionRaffle('start-presentation')) return;
      const nextSpinKey = spinKeyRef.current + 1;
      spinKeyRef.current = nextSpinKey;
      setSpinKey(nextSpinKey);
      setWinnerIndex(presentation.winnerIndex);
      setCinematicRevealPhase('motion-started');
      setSpinning(true);
    };

    if (presentation.dartCommit) beginPresentation();
    else presentationStartTimerRef.current = window.setTimeout(beginPresentation, 140);

    return true;
  }, [cancelWinnerRevealTimers, dispatchResultPresentation, transitionRaffle]);

  const clearStagePresentation = (preserveSettledProjection = false) => {
    cancelWinnerRevealTimers();
    setWinnerIndex(null);
    setPresentedOptions([]);
    setActivePresentation(null);
    setWinnerHero(null);
    if (!preserveSettledProjection) {
      const previousRunId = resultPresentationRef.current.runId;
      dispatchResultPresentation({
        type: 'run-started',
        previousRunId,
        runId: `roulette:idle:${presentationRunRef.current + 1}`,
      });
    }
    setCinematicRevealPhase('idle');
  };

  const clearCurrentRound = (preserveSettledProjection = false) => {
    presentationRunRef.current += 1;
    clearStagePresentation(preserveSettledProjection);
    setSpinning(false);
    setCurrentRound(null);
  };
  const prepareNextRoundSettings = () => {
    if (raffleStatus === 'configuring') clearStagePresentation();
  };

  const changeTarget = (target: DrawTarget) => {
    if (!isConfigurationEditable) return;
    setDrawTarget(target);
    prepareNextRoundSettings();
  };

  const changeWheelPresentation = (presentation: WheelPresentation) => {
    if (!isConfigurationEditable) return;
    setWheelPresentation(presentation);
    prepareNextRoundSettings();
  };

  const completeDraw = (completion: PresentationCompletion) => {
    const presentation = activePresentation;
    const activeRound = currentRound;
    const isReplay = presentation?.isReplay === true;
    if (
      raffleStatusRef.current !== 'presenting' ||
      !spinning ||
      !presentation ||
      (!isReplay && !activeRound) ||
      !isCurrentPresentationCompletion(
        completion,
        spinKeyRef.current,
        presentationRunRef.current,
        presentation.revealId,
      )
    ) {
      return;
    }

    const chosen = presentation.options[presentation.winnerIndex];
    if (!chosen) {
      setSpinning(false);
      return;
    }

    if (resolvedRevealIdsRef.current.has(presentation.revealId)) return;
    resolvedRevealIdsRef.current.add(presentation.revealId);
    if (resolvedRevealIdsRef.current.size > 200) {
      const oldestRevealId = resolvedRevealIdsRef.current.values().next().value;
      if (typeof oldestRevealId === 'number') resolvedRevealIdsRef.current.delete(oldestRevealId);
    }

    const result: DrawRecord = isReplay
      ? presentation.lockedResult
      : {
          ...presentation.lockedResult,
          revealedAt: new Date().toISOString(),
        };

    if (!isReplay && activeRound) {
      setLastCommittedPresentation({
        ...presentation,
        lockedResult: result,
        isReplay: false,
      });
      setHistory((items) => [result, ...items].slice(0, 100));
      setCurrentRound((round) => {
        if (!round) return { ...activeRound, results: [...activeRound.results, result] };
        return { ...round, results: [...round.results, result] };
      });
      setBroadcastSession((session) => (
        session ? appendBroadcastSessionResult(session, result) : session
      ));

      if (presentation.target === 'people' && activeRound.removeAfterDraw) {
        setExcludedParticipantIds((ids) => (ids.includes(chosen.id) ? ids : [...ids, chosen.id]));
      }

      if (presentation.target === 'prizes') {
        const prizeId = chosen.sourceId ?? chosen.id;
        setPrizes((items) => items.map((prize) => (
          prize.id === prizeId
            ? { ...prize, quantity: Math.max(0, prize.quantity - 1) }
            : prize
        )));
        if (result.recipientId) {
          const completedRecipientId = result.recipientId;
          setAssignedPrizeRecipientIds((ids) => (
            ids.includes(completedRecipientId) ? ids : [...ids, completedRecipientId]
          ));
          setPrizeAssignmentResults((items) => appendPrizeAssignmentResult(items, result));
        }
        setSideTab('history');
      }
    }

    setSpinning(false);
    cancelWinnerRevealTimers();
    const presentationToken = roulettePresentationIdentity(
      result.id,
      presentation.revealId,
    );
    dispatchResultPresentation({
      type: 'evidence-complete',
      token: presentationToken,
    });
    setWinnerHero({
      revealId: presentation.revealId,
      result,
    });

    const reduceMotion = prefersReducedMotion();
    winnerHeroTimerRef.current = window.setTimeout(() => {
      if (presentationRunRef.current !== presentation.revealId) return;

      winnerHeroTimerRef.current = null;
      dispatchResultPresentation({
        type: 'hero-complete',
        token: presentationToken,
      });
      winnerDockTimerRef.current = window.setTimeout(() => {
        if (presentationRunRef.current !== presentation.revealId) return;

        winnerDockTimerRef.current = null;
        setWinnerHero(null);
        dispatchResultPresentation({
          type: 'docking-complete',
          token: presentationToken,
        });
        setCinematicRevealPhase('idle');
        transitionRaffle('complete-round');
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() =>
            completedPrimaryActionRef.current?.focus({ preventScroll: true })
          );
        });
      }, reduceMotion ? 0 : WINNER_DOCK_DURATION_MS);
    }, reduceMotion ? 0 : WINNER_HERO_HOLD_MS);
  };
  const freezePhysicalDart = () => {
    const capture = liveWheelRef.current?.freezeDartAim();
    if (!capture) return null;
    return createDartPhysicalCommit(
      capture.rotation,
      capture.angularVelocity,
      drawOptions.length,
      drawOptionWeights,
      capture.shot,
    );
  };

  const capturePhysicalSpin = () => {
    const capture = liveWheelRef.current?.captureRotor();
    if (!capture) return null;
    return createSpinPhysicalCommit(
      capture.rotation,
      capture.angularVelocity,
      drawOptions.length,
      drawOptionWeights,
      undefined,
      capture.selectionGeometry,
    );
  };

  const startDraw = () => {
    if (raffleStatusRef.current !== 'ready') return;
    if (!rotorReady) return;
    if (!broadcastSession || broadcastSession.target !== drawTarget) {
      showToast('방송 세션을 다시 열어 주세요.');
      return;
    }
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient) {
      showToast('받을 사람 전원의 상품 배정이 끝났어요. 설계 화면에서 배정을 다시 시작해 주세요.');
      return;
    }

    const spinCommit = wheelPresentation === 'spin' ? capturePhysicalSpin() : undefined;
    const dartCommit = wheelPresentation === 'dart' ? freezePhysicalDart() : undefined;
    if (wheelPresentation === 'spin' && !spinCommit) {
      showToast('원판 위치가 준비될 때까지 잠시 기다려 주세요.');
      return;
    }
    if (wheelPresentation === 'dart' && !dartCommit) {
      showToast('다트 조준점이 준비될 때까지 잠시 기다려 주세요.');
      return;
    }

    clearStagePresentation();
    const recipientIdSnapshot = drawTarget === 'prizes' ? nextPrizeRecipient?.id : undefined;
    const recipientSnapshot = drawTarget === 'prizes' ? nextPrizeRecipient?.name : undefined;
    const presentations = buildPresentationPlan(
      drawOptions,
      drawTarget,
      recipientIdSnapshot,
      recipientSnapshot,
      wheelPresentation,
      spinCommit ?? undefined,
      dartCommit ?? undefined,
    );
    if (presentations.length === 0) {
      if (dartCommit) primeDartAim();
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    const nextRound: CurrentRound = {
      id: createId('round'),
      sessionId: broadcastSession.id,
      label: drawLabel.trim() || undefined,
      rewardLabel: drawTarget === 'people' ? rewardLabel.trim() || undefined : undefined,
      target: drawTarget,
      mode: drawMode,
      wheelPresentation,
      candidateCount: drawOptions.length,
      poolLimit,
      removeAfterDraw,
      useWeights,
      recipientId: recipientIdSnapshot,
      recipient: recipientSnapshot,
      prizeAssignmentBatchId: drawTarget === 'prizes' && recipientIdSnapshot
        ? prizeAssignmentBatchId ?? undefined
        : undefined,
      results: [],
    };
    const committedPresentations = presentations.flatMap((presentation, index) => {
      const committed = attachLockedResult(presentation, nextRound, broadcastSession.results.length + index + 1);
      return committed ? [committed] : [];
    });
    const firstPresentation = committedPresentations[0];
    if (!firstPresentation || committedPresentations.length !== presentations.length) {
      if (dartCommit) primeDartAim();
      return;
    }

    const pendingSaved = persistPendingResults(
      nextRound.id,
      committedPresentations.map((presentation) => presentation.lockedResult),
    );
    if (!launchCommittedPresentation(firstPresentation)) {
      if (pendingSaved) {
        try { removePendingRaffleLock(localStorage); } catch { /* ignored */ }
      }
      if (dartCommit) primeDartAim();
      return;
    }

    setCurrentRound(nextRound);
    setToolsOpen(false);
  };

  const reshufflePool = () => {
    if ((raffleStatus !== 'configuring' && raffleStatus !== 'ready') || poolLimit === 0) return;
    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    showToast(`후보 ${count}명을 새로 골랐어요.`);
  };

  const restoreRosterFocus = (returnStatus: SetupReturnStatus) => {
    window.requestAnimationFrame(() => {
      const previousTrigger = rosterTriggerRef.current;
      if (previousTrigger?.isConnected && !previousTrigger.closest('[inert]')) {
        previousTrigger.focus();
        return;
      }

      const fallbackSelector = returnStatus === 'configuring'
        ? '.preparation-preview__primary'
        : '.broadcast-focus__action button, .broadcast-header__actions button';
      rouletteRootRef.current?.querySelector<HTMLElement>(fallbackSelector)?.focus();
    });
  };

  const openParticipantEditor = (returnStatus: SetupReturnStatus, startStep: SetupStartStep = 'edit') => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!transitionRaffle('open-roster')) return;
    rosterTriggerRef.current = trigger;
    setParticipantPreviewDraft(participants);
    setRosterEditorDirty(false);
    setSetupStartStep(startStep);
    setSetupReturnStatus(returnStatus);
    setSetupSession((value) => value + 1);
    setToolsOpen(false);
  };

  const requestPreparationRosterEdit = () => {
    if (embedded && onRequestRosterEdit) {
      onRequestRosterEdit();
      return;
    }
    openParticipantEditor('configuring');
  };

  const clearParticipantRoster = () => {
    if (raffleStatus !== 'roster' || participants.length === 0) return;
    if (!window.confirm(`현재 명단 ${participants.length}명을 비울까요? 당첨 기록과 상품 설정은 유지됩니다.`)) return;

    const shouldLeaveSession = setupReturnStatus !== 'configuring';
    const shouldPauseSession = Boolean(
      shouldLeaveSession
      && broadcastSession
      && broadcastSession.results.length < broadcastSession.goal,
    );
    setParticipants([]);
    setParticipantPreviewDraft([]);
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    clearCurrentRound(shouldPauseSession);
    setSetupReturnStatus('configuring');
    setSetupStartStep('edit');
    setSetupSession((value) => value + 1);
    setRosterEditorDirty(false);
    if (shouldLeaveSession) {
      setPausedBroadcastSession(shouldPauseSession ? broadcastSession : null);
      if (broadcastSession && !shouldPauseSession) {
        setLastCommittedPresentation(null);
        setLastEndedSessionNotice(endedSessionNotice(broadcastSession));
      }
      setBroadcastSession(null);
      setRotorReady(false);
    }
    onRosterTextChange?.('');
    showToast(shouldLeaveSession && broadcastSession
      ? shouldPauseSession
        ? `명단을 비웠어요. 진행 ${broadcastSession.results.length}/${broadcastSession.goal} 세션은 일시정지했습니다.`
        : `명단을 비웠어요. 완료한 추첨 세션은 종료했고 결과는 당첨 기록에 남겼습니다.`
      : '명단을 비웠어요. 새 명단을 입력하거나 카페 댓글에서 가져와 주세요.');
  };

  const cancelParticipantEditor = () => {
    if (rosterEditorDirty && !window.confirm('저장하지 않은 명단 변경을 버리고 닫을까요?')) return;
    const event = setupReturnStatus === 'configuring'
      ? 'cancel-roster-configuring'
      : setupReturnStatus === 'completed'
        ? 'cancel-roster-completed'
        : 'cancel-roster-ready';
    setParticipantPreviewDraft([]);
    setRosterEditorDirty(false);
    if (transitionRaffle(event)) {
      restoreRosterFocus(setupReturnStatus);
    }
  };

  const saveParticipants = (nextParticipants: Participant[]) => {
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    const shouldLeaveSession = setupReturnStatus !== 'configuring';
    const shouldPauseSession = Boolean(
      shouldLeaveSession
      && broadcastSession
      && broadcastSession.results.length < broadcastSession.goal,
    );
    setParticipants(nextParticipants);
    setParticipantPreviewDraft([]);
    setRosterEditorDirty(false);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolLimit((limit) => Math.min(limit, nextParticipants.length));
    clearCurrentRound(shouldPauseSession);
    setToolsOpen(false);
    if (shouldLeaveSession) {
      setPausedBroadcastSession(shouldPauseSession ? broadcastSession : null);
      if (broadcastSession && !shouldPauseSession) {
        setLastCommittedPresentation(null);
        setLastEndedSessionNotice(endedSessionNotice(broadcastSession));
      }
      setBroadcastSession(null);
      setRotorReady(false);
    }
    onRosterTextChange?.(sharedRosterTextFromParticipants(nextParticipants));
    if (transitionRaffle('save-roster')) {
      restoreRosterFocus('configuring');
    }
    showToast(shouldLeaveSession && broadcastSession
      ? shouldPauseSession
        ? `${nextParticipants.length}명으로 명단을 저장했어요. 진행 ${broadcastSession.results.length}/${broadcastSession.goal} 세션은 유지됩니다.`
        : `${nextParticipants.length}명으로 명단을 저장했어요. 완료한 추첨 세션은 종료했고 결과는 당첨 기록에 남겼습니다.`
      : `${nextParticipants.length}명의 참여자 명단을 준비했어요.`);
  };

  const startBroadcast = (discardPausedSession = false) => {
    if (raffleStatus !== 'configuring') return;
    if (pausedBroadcastSession && !discardPausedSession) {
      showToast('일시정지한 세션을 계속하거나 명시적으로 새 세션을 시작해 주세요.');
      return;
    }
    if (
      drawTarget === 'people'
      && duplicateParticipantNames.length > 0
      && !allowDuplicateNames
    ) {
      showToast('동일 이름을 정리하거나 공통 설정에서 허용해 주세요.');
      return;
    }
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '먼저 참여자 명단을 준비해 주세요.' : '먼저 상품을 추가해 주세요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient) {
      showToast('받을 사람 전원의 상품 배정이 끝났어요. 먼저 배정을 다시 시작해 주세요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !prizeAssignmentBatchId) {
      setPrizeAssignmentBatchId(createId('prize-assignment'));
    }
    setToolsOpen(false);
    setPausedBroadcastSession(null);
    setLastCommittedPresentation(null);
    setLastEndedSessionNotice(null);
    clearCurrentRound();
    if (transitionRaffle('open-stage')) {
      setBroadcastSession(createBroadcastSession(createId('session'), drawTarget, winnerGoal));
      focusLiveStage();
    }
  };

  const finishBroadcast = (preserveSession = true) => {
    const activeSession = broadcastSession;
    if (!transitionRaffle('end-broadcast')) return false;
    const shouldPauseSession = Boolean(
      preserveSession
      && activeSession
      && activeSession.results.length < activeSession.goal,
    );
    clearCurrentRound(shouldPauseSession);
    setPausedBroadcastSession(shouldPauseSession ? activeSession : null);
    setBroadcastSession(null);
    if (!shouldPauseSession) {
      setLastCommittedPresentation(null);
      if (activeSession) setLastEndedSessionNotice(endedSessionNotice(activeSession));
    }
    setRotorReady(false);
    setToolsOpen(false);
    if (shouldPauseSession) {
      focusPreparationPrimary();
    } else {
      focusPreparationPrimary();
    }
    return true;
  };

  const finishCompletedBroadcast = () => {
    if (!finishBroadcast(false)) return false;
    showToast('추첨 세션을 종료했어요. 공개된 결과는 당첨 기록에 남아 있고, 이제 새 추첨을 설계할 수 있어요.');
    return true;
  };

  const resumePausedBroadcast = () => {
    const session = pausedBroadcastSession;
    if (raffleStatus !== 'configuring' || !session) return;
    if (session.results.length >= session.goal) {
      setPausedBroadcastSession(null);
      setLastCommittedPresentation(null);
      setLastEndedSessionNotice(endedSessionNotice(session));
      showToast('완료한 추첨은 이미 종료되었어요. 방송 화면을 열면 새 세션이 시작됩니다.');
      focusPreparationPrimary();
      return;
    }
    const resumeEvent: RaffleEvent = session.results.length > 0
      ? 'resume-completed'
      : 'resume-ready';
    if (!transitionRaffle(resumeEvent)) return;
    setDrawTarget(session.target);
    setWinnerGoals((goals) => ({ ...goals, [session.target]: session.goal }));
    setBroadcastSession(session);
    setPausedBroadcastSession(null);
    setLastEndedSessionNotice(null);
    setToolsOpen(false);
    if (session.results.length > 0 && lastCommittedPresentation) {
      setPresentedOptions(lastCommittedPresentation.options);
      setActivePresentation(lastCommittedPresentation);
      setWinnerIndex(lastCommittedPresentation.winnerIndex);
      setSpinning(false);
      setWinnerHero(null);
      setCinematicRevealPhase('idle');
    }
    focusLiveStage();
    const completed = session.results.length >= session.goal;
    showToast(completed
      ? '완료한 추첨 결과 화면을 다시 열었어요.'
      : session.results.length > 0
        ? `진행 ${session.results.length}/${session.goal} 지점에서 추첨을 이어갑니다.`
      : '대기 중이던 추첨 세션을 다시 열었어요.');
  };

  const confirmPausedSessionDiscard = () => {
    if (!pausedBroadcastSession) return true;
    const progress = `${pausedBroadcastSession.results.length}/${pausedBroadcastSession.goal}`;
    return window.confirm(`일시정지한 추첨 세션(${progress})을 종료할까요? 당첨 기록은 남지만 이 세션으로는 돌아갈 수 없습니다.`);
  };

  const discardPausedBroadcast = () => {
    if (!pausedBroadcastSession || !confirmPausedSessionDiscard()) return;
    const endedSession = pausedBroadcastSession;
    setPausedBroadcastSession(null);
    setLastCommittedPresentation(null);
    setLastEndedSessionNotice(endedSessionNotice(endedSession));
    clearCurrentRound();
    showToast('일시정지한 세션을 종료했어요. 공개된 결과는 당첨 기록에 남아 있습니다.');
    focusPreparationPrimary();
  };

  const startNewBroadcast = () => {
    if (!confirmPausedSessionDiscard()) return;
    startBroadcast(true);
  };
  const resetEverything = () => {
    if (isStageLocked) return;
    if (!window.confirm('명단, 상품, 당첨 제외, 당첨 기록과 추첨 설정을 모두 초기화할까요? 이 작업은 되돌릴 수 없어요.')) return;

    if (raffleStatusRef.current === 'ready' || raffleStatusRef.current === 'completed') {
      transitionRaffle('end-broadcast');
    }
    clearCurrentRound();
    setBroadcastSession(null);
    setPausedBroadcastSession(null);
    setLastCommittedPresentation(null);
    setLastEndedSessionNotice(null);
    setRotorReady(false);
    setParticipants([]);
    onRosterTextChange?.('');
    setPrizes([]);
    setExcludedParticipantIds([]);
    setPoolLimit(0);
    setPoolIds([]);
    setDrawTarget('people');
    setWheelPresentation('spin');
    setDrawLabel('');
    setRewardLabel('');
    setPrizeRecipients([]);
    setPrizeRecipientText('');
    setPrizeRecipientSource('manual');
    setAssignedPrizeRecipientIds([]);
    setPrizeAssignmentResults([]);
    setPrizeAssignmentBatchId(null);
    setRemoveAfterDraw(true);
    setWeightModes({ people: false, prizes: false });
    setWinnerGoals({ people: 1, prizes: 1 });
    setHistory([]);
    setSideTab('participants');
    setToolsOpen(false);
    showToast('모든 데이터를 초기화했어요. 새 추첨을 설계해 주세요.');
    focusPreparationPrimary();
  };

  const beginNextRound = () => {
    if (!transitionRaffle('start-next-round')) return;
    clearCurrentRound(true);
    setToolsOpen(false);
    focusLiveStage();
  };

  const restoreParticipant = (id: string, name: string) => {
    if (isStageLocked) return;
    setExcludedParticipantIds((ids) => ids.filter((excludedId) => excludedId !== id));
    prepareNextRoundSettings();
    showToast(`${name}님을 다시 추첨 명단에 넣었어요.`);
  };

  const resetWinnerState = () => {
    if (isStageLocked) return;
    if (excludedParticipantIds.length === 0) {
      showToast('초기화할 당첨 제외 인원이 없어요.');
      return;
    }
    if (!window.confirm(`당첨 제외 ${excludedParticipantIds.length}명을 다시 명단에 넣을까요? 당첨 기록은 유지됩니다.`)) return;
    setExcludedParticipantIds([]);
    showToast('당첨 제외를 초기화했어요. 이전 결과와 당첨 기록은 그대로예요.');
  };

  const recoverReadyDraw = () => {
    if (drawTarget === 'people') {
      if (participants.length === 0) {
        openParticipantEditor('ready');
        return;
      }
      if (eligibleParticipants.length === 0 && excludedParticipantIds.length > 0) {
        resetWinnerState();
        return;
      }
    }
    finishBroadcast();
  };

  const continueCompletedRound = () => {
    if (drawTarget === 'prizes' && prizeRecipients.length > 0) {
      if (!nextPrizeRecipient) {
        const completedCount = prizeRecipients.length;
        if (finishBroadcast()) showToast(`${completedCount}명의 상품 배정을 마쳤어요.`);
        return;
      }
      if (drawOptions.length > 0) {
        beginNextRound();
        return;
      }
      if (finishBroadcast()) showToast(`${nextPrizeRecipient.name}님부터 이어서 배정할 수 있어요. 상품을 보충해 주세요.`);
      return;
    }

    if (drawOptions.length > 0) {
      beginNextRound();
      return;
    }

    if (drawTarget === 'people' && eligibleParticipants.length === 0 && excludedParticipantIds.length > 0) {
      if (!window.confirm(`당첨 제외 ${excludedParticipantIds.length}명을 다시 명단에 넣고 다음 회차를 시작할까요? 당첨 기록은 유지됩니다.`)) return;
      setExcludedParticipantIds([]);
      beginNextRound();
      showToast('당첨 제외를 초기화하고 다음 회차를 준비했어요.');
      return;
    }

    if (drawTarget === 'people' && participants.length === 0) {
      openParticipantEditor('completed');
      return;
    }

    finishBroadcast();
  };

  const addOneMoreResult = () => {
    const session = broadcastSession;
    if (raffleStatus !== 'completed' || !session) return;
    if (drawOptions.length === 0) {
      showToast(unavailableDrawPrompt);
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient) {
      showToast('받을 사람 전원의 상품 배정이 끝났어요.');
      return;
    }
    const nextGoal = session.goal + 1;
    setBroadcastSession(updateBroadcastSessionGoal(session, nextGoal));
    setWinnerGoals((goals) => ({ ...goals, [session.target]: nextGoal }));
    beginNextRound();
  };
  const applyLinkedPrizeRecipients = (
    linkedRecipients: readonly PrizeRecipient[],
    preserveMatchingProgress: boolean,
  ) => {
    if (linkedRecipients.length === 0) {
      showToast('불러올 공개 당첨자가 없어요. 받을 사람을 직접 입력해 주세요.');
      return 0;
    }

    const retainedAssignedIds = preserveMatchingProgress
      ? retainAssignedPrizeRecipientIds(linkedRecipients, assignedPrizeRecipientIds)
      : [];
    const currentRecipientIds = new Set(prizeRecipients.map((recipient) => recipient.id));
    const sharesCurrentSlot = linkedRecipients.some((recipient) => currentRecipientIds.has(recipient.id));
    setPrizeRecipients([...linkedRecipients]);
    setPrizeRecipientText(linkedRecipients.map((item) => item.name).join('\n'));
    setPrizeRecipientSource('linked');
    setAssignedPrizeRecipientIds(retainedAssignedIds);
    setPrizeAssignmentResults((items) => (
      preserveMatchingProgress ? retainPrizeAssignmentResults(items, linkedRecipients) : []
    ));
    setPrizeAssignmentBatchId((currentBatchId) => (
      preserveMatchingProgress && sharesCurrentSlot && currentBatchId
        ? currentBatchId
        : createId('prize-assignment')
    ));
    prepareNextRoundSettings();
    return retainedAssignedIds.length;
  };

  const updatePrizeRecipientText = (value: string) => {
    if (!isConfigurationEditable) return;
    if (assignedPrizeRecipientCount > 0) {
      showToast('배정이 시작된 명단은 잠겨 있어요. 같은 명단으로 새 배정을 시작한 뒤 편집해 주세요.');
      return;
    }
    const manualRecipients = reconcileManualPrizeRecipients(
      value,
      prizeRecipients,
      createId,
      assignedPrizeRecipientIds,
    );
    const retainedIds = new Set(manualRecipients.map((recipient) => recipient.id));
    const sharesCurrentSlot = prizeRecipients.some((recipient) => retainedIds.has(recipient.id));
    setPrizeRecipientText(value);
    setPrizeRecipients(manualRecipients);
    setPrizeRecipientSource(
      arePrizeRecipientPlansEqual(manualRecipients, recentLinkedPrizeRecipients) ? 'linked' : 'manual',
    );
    setAssignedPrizeRecipientIds((ids) => ids.filter((id) => retainedIds.has(id)));
    setPrizeAssignmentResults((items) => retainPrizeAssignmentResults(items, manualRecipients));
    setPrizeAssignmentBatchId((currentBatchId) => {
      if (manualRecipients.length === 0) return null;
      return sharesCurrentSlot && currentBatchId ? currentBatchId : createId('prize-assignment');
    });
    prepareNextRoundSettings();
  };

  const loadRecentPeopleWinners = () => {
    if (!isConfigurationEditable) return;
    if (assignedPrizeRecipientCount > 0) {
      showToast('배정이 시작된 명단은 잠겨 있어요. 새 배정을 시작한 뒤 이전 당첨자를 불러와 주세요.');
      return;
    }
    if (recentLinkedPrizeRecipients.length === 0) {
      showToast('불러올 공개 당첨자가 없어요. 받을 사람을 직접 입력해 주세요.');
      return;
    }
    if (recentWinnersAlreadyLoaded) {
      showToast('이전 당첨자 명단이 이미 연결되어 있어요. 배정 진행도 그대로 유지됩니다.');
      return;
    }
    if (
      prizeRecipients.length > 0
      && !window.confirm(
        `현재 받을 사람 ${prizeRecipients.length}명을 이전 당첨자 ${recentLinkedPrizeRecipients.length}명으로 교체할까요? 전체 당첨 기록은 유지됩니다.`,
      )
    ) return;

    const retainedCount = applyLinkedPrizeRecipients(recentLinkedPrizeRecipients, true);
    showToast(retainedCount > 0
      ? `이전 당첨자 ${recentLinkedPrizeRecipients.length}명으로 교체했어요. 같은 당첨자 ${retainedCount}명의 배정은 유지했어요.`
      : `이전 당첨자 ${recentLinkedPrizeRecipients.length}명을 받을 사람으로 불러왔어요.`);
  };

  const restartPrizeRecipientAssignments = () => {
    if (!isConfigurationEditable || prizeRecipients.length === 0) return;
    if (
      assignedPrizeRecipientCount > 0
      && !window.confirm(
        `같은 ${prizeRecipients.length}명에게 상품을 새로 배정할까요? 이전 당첨 기록은 유지되고, 이 화면의 배정 진행만 0명부터 다시 시작합니다.`,
      )
    ) return;
    setAssignedPrizeRecipientIds([]);
    setPrizeAssignmentResults([]);
    setPrizeAssignmentBatchId(createId('prize-assignment'));
    showToast(`같은 ${prizeRecipients.length}명에게 새 상품 배정을 시작해요.`);
  };

  const handoffWinnersToPrizeDraw = () => {
    const revealedWinners = [...sessionResults];
    const linkedRecipients = createLinkedPrizeRecipients(revealedWinners);
    if (linkedRecipients.length === 0) {
      showToast('상품 추첨으로 넘길 공개 당첨자가 없어요.');
      return;
    }
    if (
      broadcastSession
      && sessionResults.length < broadcastSession.goal
      && !window.confirm(
        `현재 당첨자 추첨은 ${sessionResults.length}/${broadcastSession.goal}까지 진행했습니다. 이 세션을 종료하고 공개된 당첨자만 상품 추첨으로 넘길까요?`,
      )
    ) return;
    if (
      assignedPrizeRecipientCount > 0
      && !window.confirm(
        `기존 상품 배정 ${assignedPrizeRecipientCount}명을 이번 당첨자 ${linkedRecipients.length}명으로 교체할까요? 이전 당첨 기록은 유지됩니다.`,
      )
    ) return;
    if (!finishBroadcast(false)) return;

    applyLinkedPrizeRecipients(linkedRecipients, false);
    setDrawLabel('');
    setRewardLabel('');
    setDrawTarget('prizes');
    setSideTab('prizes');
    showToast(availablePrizeCount === 0
      ? `당첨자 ${linkedRecipients.length}명을 연결했어요. 상품을 추가해 주세요.`
      : `당첨자 ${linkedRecipients.length}명을 받을 사람으로 연결했어요.`);
  };

  const openPrizeSetup = () => {
    if (broadcastSession?.target === 'people' && sessionResults.length > 0) {
      handoffWinnersToPrizeDraw();
      return;
    }
    if (
      broadcastSession
      && broadcastSession.results.length > 0
      && !window.confirm(
        `현재 상품 추첨 세션(${broadcastSession.results.length}/${broadcastSession.goal})을 종료하고 상품 설정으로 이동할까요? 결과 기록은 유지됩니다.`,
      )
    ) return;
    if (!finishBroadcast(false)) return;
    setDrawTarget('prizes');
    setSideTab('prizes');
  };

  const updateParticipantWeight = (id: string, weight: number) => {
    if (!isConfigurationEditable) return;
    setParticipants((items) => items.map((participant) => (
      participant.id === id
        ? { ...participant, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : participant
    )));
    prepareNextRoundSettings();
  };

  const updatePrize = (id: string, patch: Partial<Prize>) => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => items.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
    prepareNextRoundSettings();
  };

  const updatePrizeWeight = (id: string, weight: number) => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => items.map((prize) => (
      prize.id === id
        ? { ...prize, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : prize
    )));
    prepareNextRoundSettings();
  };

  const addPrize = () => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => [...items, { id: createId('prize'), name: '', quantity: 1, weight: 1 }]);
    prepareNextRoundSettings();
    window.requestAnimationFrame(() => {
      const inputs = rouletteRootRef.current?.querySelectorAll<HTMLInputElement>('.prize-editor__name input');
      if (!inputs) return;
      inputs[inputs.length - 1]?.focus();
    });
  };

  const removePrize = (id: string, name: string) => {
    if (!isConfigurationEditable) return;
    if (!window.confirm(`${name} 상품을 목록에서 지울까요?`)) return;
    setPrizes((items) => items.filter((prize) => prize.id !== id));
    prepareNextRoundSettings();
  };

  const copyParticipantList = async () => {
    if (participants.length === 0 || copyingParticipantList) return;
    const numbered = participants.map((participant, index) => `${index + 1}. ${participant.name}`).join('\n');
    setCopyingParticipantList(true);
    try {
      await navigator.clipboard.writeText(numbered);
      showToast(`${participants.length}명의 참여자 목록을 복사했어요.`);
    } catch {
      showToast('클립보드 권한을 허용한 뒤 다시 시도해 주세요.');
    } finally {
      setCopyingParticipantList(false);
    }
  };

  const exportHistory = () => {
    if (history.length === 0) {
      showToast('저장할 당첨 기록이 없어요.');
      return;
    }
    const csv = createHistoryCsv(history);
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exlab-roulette-winners.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearHistory = () => {
    if (history.length === 0) return;
    if (broadcastSession || pausedBroadcastSession) {
      showToast('현재 추첨 세션을 종료한 뒤 당첨 기록을 비울 수 있어요.');
      return;
    }
    if (!window.confirm('당첨 기록을 모두 비울까요? 이 작업은 되돌릴 수 없어요.')) return;
    setHistory([]);
    showToast('당첨 기록을 비웠어요.');
  };

  const sessionResults = broadcastSession?.results ?? [];
  const pausedSessionResults = pausedBroadcastSession?.results ?? [];
  const pausedSessionLastResult = pausedSessionResults[pausedSessionResults.length - 1] ?? null;
  const pausedSessionCandidateCount = pausedBroadcastSession?.target === drawTarget
    ? drawOptions.length
    : pausedBroadcastSession?.target === 'people'
      ? eligibleParticipants.length
      : createPrizeDrawOptions(prizes).length;
  const sessionGoal = broadcastSession?.goal ?? winnerGoal;
  const sessionProgress = sessionResults.length;
  const sessionPendingCount = Math.max(0, sessionGoal - sessionProgress);
  const sessionGoalReached = sessionProgress >= sessionGoal;
  const canAddOneMoreResult = drawOptions.length > 0 && (
    drawTarget !== 'prizes' || prizeRecipients.length === 0 || Boolean(nextPrizeRecipient)
  );
  const roundTarget = currentRound?.target ?? broadcastSession?.target ?? drawTarget;
  const visibleSessionResults = sessionResults;
  const latestVisibleSessionResult = visibleSessionResults[visibleSessionResults.length - 1] ?? null;
  const resultBoardAnnouncement = latestVisibleSessionResult
    ? latestVisibleSessionResult.target === 'prizes'
      ? latestVisibleSessionResult.recipient
        ? `상품 배정 결과: ${latestVisibleSessionResult.recipient}님에게 ${latestVisibleSessionResult.winner}.`
        : `당첨 상품: ${latestVisibleSessionResult.winner}.`
      : `당첨자: ${latestVisibleSessionResult.winner}.`
    : undefined;
  const committedRoundResult = activePresentation?.lockedResult
    ?? (raffleStatus === 'completed' ? lastCommittedPresentation?.lockedResult : undefined);
  const roundMode = currentRound?.mode ?? committedRoundResult?.mode ?? drawMode;
  const roundWheelPresentation = currentRound?.wheelPresentation
    ?? committedRoundResult?.presentation
    ?? wheelPresentation;
  const roundPresentationOptions = activePresentation?.options ?? drawOptions;
  const roundCandidateCount = roundPresentationOptions.length || currentRound?.candidateCount || 0;
  const roundTotalWeight = totalEffectiveWeight(roundPresentationOptions);
  const roundRemovesWinners = currentRound?.removeAfterDraw
    ?? committedRoundResult?.removeAfterDraw
    ?? removeAfterDraw;
  const roundUsesWeights = currentRound?.useWeights
    ?? committedRoundResult?.useWeights
    ?? useWeights;
  const roundRecipientId = currentRound?.recipientId
    ?? committedRoundResult?.recipientId
    ?? nextPrizeRecipient?.id;
  const roundRecipient = currentRound?.recipient
    ?? committedRoundResult?.recipient
    ?? nextPrizeRecipient?.name;
  const roundRecipientPosition = roundRecipientId
    ? prizeRecipients.findIndex((item) => item.id === roundRecipientId) + 1
    : 0;
  const roundRewardLabel = currentRound?.rewardLabel
    ?? committedRoundResult?.rewardLabel
    ?? (rewardLabel.trim() || undefined);
  const roundUnit = roundTarget === 'people' ? '명' : '개';
  const roundCandidateUnit = roundTarget === 'people' ? '명' : '종';
  const resultUnit = roundTarget === 'prizes' && prizeRecipients.length > 0 ? '명' : roundUnit;
  const defaultStageTitle = roundTarget === 'people'
    ? '참여자 추첨'
    : roundRecipient
      ? `${roundRecipientPosition}/${prizeRecipients.length} · ${roundRecipient}의 상품 추첨`
      : '상품 추첨';
  const roundLabel = currentRound?.label
    ?? committedRoundResult?.roundLabel
    ?? (drawLabel.trim() || undefined);
  const stageTitle = roundTarget === 'prizes' && roundRecipient
    ? [defaultStageTitle, roundLabel].filter(Boolean).join(' · ')
    : roundLabel
      ?? (roundTarget === 'people' && roundRewardLabel ? `${roundRewardLabel} 당첨자 추첨` : defaultStageTitle);
  const resultTitle = roundTarget === 'people'
    ? '전체 당첨자'
    : prizeRecipients.length > 0 ? '이번 세션 상품 배정' : '뽑힌 상품';
  const dynamicFairnessLabel = roundTarget === 'prizes'
    ? `재고 수량 비율 · ${roundCandidateCount}종 · 남은 재고 ${availablePrizeCount}개`
    : roundUsesWeights
      ? `가중치 적용 · 총 ${roundTotalWeight} 추첨권 · ${roundMode === 'wheel' ? '조각 크기는 확률에 비례' : '결과 확률은 가중치에 비례'}`
      : '동일 확률 · 후보마다 한 번씩 표시';
  const fairnessLabel = dynamicFairnessLabel;
  const ruleSummary = [
    roundMode === 'wheel'
      ? roundWheelPresentation === 'dart' ? '다트 복권' : '회전 룰렛'
      : '마블',
    `진행 ${sessionProgress}/${sessionGoal}`,
    `후보 ${roundCandidateCount}${roundCandidateUnit}`,
    roundTarget === 'prizes' ? '수량 비율' : roundUsesWeights ? '가중치' : '동일 확률',
    roundTarget === 'people'
      ? roundRemovesWinners ? '당첨 후 제외' : '중복 허용'
      : '재고 차감',
  ].join(' · ');
  const resultRemovalMessage = roundTarget === 'people'
    ? roundRemovesWinners
      ? excludedParticipantIds.length > 0
        ? `중복 당첨 방지 · 현재 ${excludedParticipantIds.length}명이 다음 추첨 후보에서 제외되어 있습니다.`
        : '중복 당첨 방지 · 당첨 기록은 유지되며 현재는 제외 없이 전원 다시 추첨할 수 있습니다.'
      : '중복 당첨 허용: 이번 회차와 다음 추첨에도 같은 사람이 다시 뽑힐 수 있습니다.'
    : '상품은 재고 단위로 한 개씩 차감됩니다.';
  const isDartRound = roundMode === 'wheel' && roundWheelPresentation === 'dart';
  const statusMeta = RAFFLE_STATUS_META[raffleStatus];
  const upcomingDrawLabel = drawMode === 'wheel' && wheelPresentation === 'dart'
    ? '다트 발사'
    : drawMode === 'wheel'
      ? '룰렛 멈추기'
      : '추첨 시작';
  const noAvailableDrawOptions = drawOptions.length === 0;
  const unavailableDrawLabel = drawTarget === 'people'
    ? participants.length === 0
      ? '참여자 명단을 준비해 주세요'
      : eligibleParticipants.length === 0
        ? '당첨 제외를 초기화해 주세요'
        : useWeights && candidateParticipants.length > 0
          ? '가중치를 조정해 주세요'
          : '추첨 후보를 준비해 주세요'
    : availablePrizeCount === 0
      ? '상품 재고를 추가해 주세요'
      : '상품 목록을 확인해 주세요';
  const unavailableDrawPrompt = drawTarget === 'people'
    ? participants.length === 0
      ? '참여자 명단을 준비하면 바로 추첨을 시작할 수 있습니다.'
      : eligibleParticipants.length === 0
        ? '명단 도구에서 당첨 제외를 초기화하면 새 회차를 시작할 수 있습니다.'
      : useWeights && candidateParticipants.length > 0
          ? '설정 바꾸기에서 가중치를 조정하면 바로 추첨을 시작할 수 있습니다.'
          : '설정 바꾸기에서 추첨 후보를 준비하면 바로 추첨을 시작할 수 있습니다.'
    : availablePrizeCount === 0
      ? '상품 재고를 추가하면 바로 추첨을 시작할 수 있습니다.'
      : '설정 바꾸기에서 상품 이름과 수량을 확인해 주세요.';
  const drawButtonLabel = raffleStatus === 'locking'
    ? '결과 고정 중…'
    : raffleStatus === 'presenting'
      ? '결과 공개 중…'
    : noAvailableDrawOptions
      ? unavailableDrawLabel
      : upcomingDrawLabel;
  const isStageOnly =
    raffleStatus === 'locking' || presentationBeat === 'motion';
  const isPresentationRunning =
    raffleStatus === 'locking' || raffleStatus === 'presenting';
  const showWinnerHeroPanel = (
    presentationBeat === 'hero' || presentationBeat === 'dock'
  ) && winnerHero !== null;
  const showResultsPanel = isStageOnly || (
    visibleSessionResults.length > 0 ||
    raffleStatus === 'completed' ||
    presentationBeat === 'dock'
  );
  const broadcastVisualClassName = [
    'broadcast-focus__visual',
    `reveal-phase--${cinematicRevealPhase}`,
    isDartRound && spinning ? 'is-dart-flying' : '',
    roundMode === 'wheel' && roundWheelPresentation === 'spin' && spinning ? 'is-auto-spinning' : '',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-round-complete' : '',
  ].filter(Boolean).join(' ');
  const cinematicImpactPoint = resolveDartImpactPoint(
    roundWheelPresentation === 'dart' ? activePresentation?.dartShot : undefined,
  );
  const cinematicCameraStyle: CinematicCameraStyle = {
    '--cinematic-impact-x': `${cinematicImpactPoint.xPercent}%`,
    '--cinematic-impact-y': `${cinematicImpactPoint.yPercent}%`,
    '--cinematic-final-x': `${cinematicImpactPoint.finalXPercent}%`,
    '--cinematic-final-y': `${cinematicImpactPoint.finalYPercent}%`,
  };
  const broadcastFocusClassName = [
    'broadcast-focus',
    `reveal-phase--${cinematicRevealPhase}`,
    isStageOnly ? 'is-stage-only' : '',
    showResultsPanel || showWinnerHeroPanel ? 'has-results-panel' : 'has-no-results-panel',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-completed' : '',
  ].filter(Boolean).join(' ');
  const actionNote = raffleStatus === 'locking'
    ? `진행 ${sessionProgress}/${sessionGoal} · 클릭 순간 결과를 고정했습니다.`
    : raffleStatus === 'presenting'
      ? `진행 ${sessionProgress}/${sessionGoal} · 추첨 연출이 끝나면 결과판이 갱신됩니다.`
      : raffleStatus === 'completed'
    ? sessionGoalReached
      ? `진행 ${sessionProgress}/${sessionGoal} · 목표한 결과가 모두 저장되었습니다.`
      : roundTarget === 'prizes' && prizeRecipients.length > 0 && nextPrizeRecipient
        ? `진행 ${sessionProgress}/${sessionGoal} · 다음은 ${nextPrizeRecipient.name}입니다.`
        : `진행 ${sessionProgress}/${sessionGoal} · 다음 결과를 실제 추첨으로 이어가세요.`
    : !rotorReady && raffleStatus === 'ready' && !noAvailableDrawOptions
      ? '원판이 추첨 속도까지 올라가는 중입니다.'
    : noAvailableDrawOptions
        ? unavailableDrawPrompt
        : drawMode === 'wheel' && wheelPresentation === 'dart'
          ? `발사 순간 후보 ${drawOptions.length}${drawTarget === 'people' ? '명' : '종'} 중 한 결과가 고정됩니다.`
          : drawMode === 'wheel'
            ? '멈추기를 누르는 순간 한 결과가 고정되고 원판이 감속합니다.'
            : '시작을 누르는 순간 한 결과가 고정됩니다.';
  const readyRecoveryLabel = drawTarget === 'people'
    ? participants.length === 0
      ? '명단 준비하기'
      : eligibleParticipants.length === 0 && excludedParticipantIds.length > 0
        ? '당첨 제외 초기화'
        : useWeights ? '가중치 조정하기' : '추첨 설정 확인하기'
    : availablePrizeCount === 0 ? '상품 추가하기' : '상품 확인하기';
  const readyPrimaryAction: BroadcastDockAction = {
    id: noAvailableDrawOptions ? 'recover-ready' : 'start-draw',
    label: noAvailableDrawOptions
      ? readyRecoveryLabel
      : rotorReady ? drawButtonLabel : '원판 가속 중…',
    onClick: noAvailableDrawOptions ? recoverReadyDraw : startDraw,
    disabled: toolsOpen || (!noAvailableDrawOptions && !rotorReady),
  };
  const presentingPrimaryAction: BroadcastDockAction = {
    id: 'presentation-running',
    label: raffleStatus === 'locking' ? '결과 고정 중…' : '결과 공개 중…',
    onClick: () => undefined,
    disabled: true,
  };
  const presentingSecondaryActions: BroadcastDockAction[] = [
    {
      id: 'presentation-pause-locked',
      label: '설계로 일시정지',
      onClick: () => undefined,
      disabled: true,
      tone: 'quiet',
      title: '연출이 끝나면 사용할 수 있습니다.',
    },
    {
      id: 'presentation-tools-locked',
      label: '명단 · 기록 잠김',
      onClick: () => undefined,
      disabled: true,
      tone: 'quiet',
      title: '결과 공개 중에는 명단과 기록 도구가 잠깁니다.',
    },
  ];
  const completedPrimaryLabel = noAvailableDrawOptions
      ? drawTarget === 'people'
        ? eligibleParticipants.length === 0 && excludedParticipantIds.length > 0
          ? '당첨 제외 초기화 후 다음 추첨'
          : participants.length === 0 ? '명단 준비하고 다음 추첨' : '규칙 조정하고 다음 추첨'
        : '상품 보충하고 다음 추첨'
      : roundTarget === 'people'
        ? `다음 ${sessionProgress + 1}/${sessionGoal}번째 뽑기`
        : prizeRecipients.length > 0 && nextPrizeRecipient
          ? `다음: ${nextPrizeRecipient.name}의 상품 추첨`
          : `다음 ${sessionProgress + 1}/${sessionGoal}번째 상품 뽑기`;
  const addOneMoreLabel = roundTarget === 'people'
    ? '한 명 추가로 뽑기'
    : '결과 하나 추가하기';
  const completedPrimaryAction: BroadcastDockAction =
    sessionGoalReached && canAddOneMoreResult
      ? {
          id: 'add-one-more',
          label: addOneMoreLabel,
          onClick: addOneMoreResult,
        }
      : {
          id: sessionGoalReached ? 'finish-session' : 'next-round',
          label: sessionGoalReached
            ? '세션 종료 · 설계로'
            : completedPrimaryLabel,
          onClick: sessionGoalReached
            ? finishCompletedBroadcast
            : continueCompletedRound,
        };
  const completedSecondaryActions: BroadcastDockAction[] = [
    ...(sessionGoalReached && canAddOneMoreResult ? [{
      id: 'finish-session',
      label: '세션 종료 · 설계로',
      onClick: finishCompletedBroadcast,
      tone: 'quiet' as const,
      title: '공개된 결과는 당첨 기록에 남기고 현재 세션을 종료합니다.',
    }] : []),
    ...(!sessionGoalReached ? [{
      id: 'pause-draw',
      label: '설계로 일시정지',
      onClick: () => finishBroadcast(),
      tone: 'quiet' as const,
      title: '현재 진행도와 마지막 결과를 유지한 채 설계 화면으로 돌아갑니다.',
    }] : []),
    ...(broadcastSession?.target === 'people' && sessionResults.length > 0 ? [{
      id: 'handoff-prizes',
      label: `당첨자 ${sessionResults.length}명 상품 뽑기`,
      onClick: handoffWinnersToPrizeDraw,
      tone: 'quiet' as const,
      title: '현재 공개된 당첨자를 순서대로 상품 추첨에 연결합니다.',
    }] : []),
  ];
  const stagePrompt = raffleStatus === 'locking'
    ? '방금 누른 버튼의 후보와 결과를 고정했습니다. 곧 방송 연출을 시작합니다.'
    : raffleStatus === 'presenting'
      ? isDartRound
        ? '발사 순간 고정된 결과를 공개하고 있습니다.'
        : '멈추기를 누른 순간 고정된 결과를 공개하고 있습니다.'
        : raffleStatus === 'completed'
          ? '오른쪽 보드에 이번 방송의 전체 당첨자가 남아 있습니다.'
          : noAvailableDrawOptions
            ? unavailableDrawPrompt
            : roundMode === 'wheel' && !rotorReady
              ? '원판이 추첨 속도까지 올라가고 있습니다.'
            : roundTarget === 'prizes' && roundRecipient
              ? `${roundRecipient}님에게 드릴 상품을 뽑아 주세요.`
              : roundMode === 'wheel'
                ? roundWheelPresentation === 'dart'
                  ? '움직이는 조준점과 원판 위치가 클릭 순간 함께 고정되고 다트가 바로 날아갑니다.'
                  : '원판은 이미 고속 회전 중입니다. 결과 고정 버튼을 누르면 그 순간 결과가 정해지고 원판이 감속합니다.'
                : '추첨 시작을 누르는 순간 후보와 결과가 고정되고, 그 다음에 방송 연출이 시작됩니다.';

  const renderDrawVisual = (variant: 'preview' | 'live') => {
    const preview = variant === 'preview';
    const names = preview ? drawOptionNames : displayNames;
    const target = preview ? drawTarget : roundTarget;
    const activeWinnerIndex = preview ? null : winnerIndex;
    const activeSpin = preview ? false : spinning;
    const presentation = preview ? wheelPresentation : roundWheelPresentation;
    const sliceWeights = preview ? drawOptionWeights : displayWeights;

    return (
      <RouletteWheel
        ref={preview ? undefined : liveWheelRef}
        participants={names}
        weights={sliceWeights}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        spinning={activeSpin}
        settled={!preview && raffleStatus === 'completed' && activeWinnerIndex !== null}
        idleSpinning={!preview && (
          raffleStatus === 'ready' ||
          raffleStatus === 'locking' ||
          (raffleStatus === 'presenting' && presentationBeat === 'idle')
        )}
        spinKey={spinKey}
        presentation={presentation}
        revealId={preview ? undefined : activePresentation?.revealId}
        landing={preview ? undefined : activePresentation?.landing}
        spinCommit={preview ? undefined : activePresentation?.spinCommit}
        dartShot={preview ? undefined : activePresentation?.dartShot}
        dartAim={preview ? undefined : dartAimSession ?? undefined}
        dartCommit={preview ? undefined : activePresentation?.dartCommit}
        onRevealPhase={preview ? undefined : handleRouletteRevealPhase}
        onIdleCruise={preview ? undefined : () => setRotorReady(true)}
        onSpinEnd={preview ? () => undefined : completeDraw}
      />
    );
  };

  const roundSetupProps: RoundSetupPanelProps = {
    target: drawTarget,
    wheelPresentation,
    participantTotal: participants.length,
    eligibleParticipants,
    candidateParticipants,
    drawOptionCount: drawOptions.length,
    winnerGoal: setupWinnerGoal,
    maximumWinnerGoal: setupMaximumWinnerGoal,
    excludedCount: participants.length - eligibleParticipants.length,
    poolLimit,
    prizes,
    rewardLabel,
    drawLabel,
    prizeRecipientText,
    prizeRecipientCount: prizeRecipients.length,
    assignedPrizeRecipientCount,
    prizeRecipientSource,
    recentWinnerCount: recentPeopleWinnerResults.length,
    recentWinnersAlreadyLoaded,
    recentWinnerLabel: recentPeopleWinnerResults[0]?.roundLabel || '최근 당첨자 추첨',
    removeAfterDraw,
    useWeights,
    disabled: !isConfigurationEditable,
    onTargetChange: changeTarget,
    onRewardLabelChange: (value) => {
      setRewardLabel(value);
      prepareNextRoundSettings();
    },
    onDrawLabelChange: (value) => {
      setDrawLabel(value);
      prepareNextRoundSettings();
    },
    onPrizeRecipientTextChange: updatePrizeRecipientText,
    onLoadRecentWinners: loadRecentPeopleWinners,
    onRestartPrizeRecipients: restartPrizeRecipientAssignments,
    onPoolLimitChange: (value) => {
      setPoolLimit(Math.max(0, Math.min(eligibleParticipants.length, value)));
      setPoolIds([]);
      prepareNextRoundSettings();
    },
    onWinnerGoalChange: changeWinnerGoal,
    onReshufflePool: reshufflePool,
    onPresentationChange: (choice) => {
      if (!isConfigurationEditable) return;
      changeWheelPresentation(choice);
    },
    onRemoveAfterDrawChange: (value) => {
      setRemoveAfterDraw(value);
      prepareNextRoundSettings();
    },
    onUseWeightsChange: (value) => {
      setUseWeights(value);
      prepareNextRoundSettings();
    },
    onParticipantWeightChange: updateParticipantWeight,
    onEditRoster: requestPreparationRosterEdit,
    onRestoreExcluded: resetWinnerState,
    onAddPrize: addPrize,
    onUpdatePrize: updatePrize,
    onPrizeWeightChange: updatePrizeWeight,
    onRemovePrize: removePrize,
  };

  const renderRoundSettings = () => (
    <RoundSetupPanel {...roundSetupProps} />
  );

  const liveStatusDescription = raffleStatus === 'ready'
    ? '현재 명단과 규칙으로 바로 추첨할 수 있어요.'
    : raffleStatus === 'completed'
      ? '이번 회차 결과는 유지한 채, 다음 행동을 고르세요.'
      : '결과와 규칙이 고정되어 있어 방송 연출이 끝날 때까지 바꿀 수 없어요.';

  const renderProgressTools = () => (
    <aside
      ref={toolsDrawerRef}
      id="broadcast-tools-drawer"
      className="broadcast-tools-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="broadcast-tools-title"
      tabIndex={-1}
    >
      <div className="broadcast-tools-drawer__header">
        <div>
          <p>방송 진행</p>
          <h2 id="broadcast-tools-title">필요할 때만 열어 보세요</h2>
        </div>
        <button ref={toolsCloseRef} type="button" aria-label="진행 도구 닫기" onClick={() => closeTools(true)}>×</button>
      </div>

      <section className="live-session-status" aria-label="현재 추첨 상태">
        <div>
          <p>현재 상태</p>
          <h3>{statusMeta.liveLabel}</h3>
        </div>
        <span>{ruleSummary}</span>
        <p>{liveStatusDescription}</p>
      </section>

      <nav className="live-tabs" aria-label="방송 진행 패널">
        <button type="button" aria-pressed={sideTab === 'participants'} onClick={() => setSideTab('participants')}>참여자 <span>{participants.length}</span></button>
        <button type="button" aria-pressed={sideTab === 'prizes'} onClick={() => setSideTab('prizes')}>상품 <span>{availablePrizeCount}</span></button>
        <button type="button" aria-pressed={sideTab === 'history'} onClick={() => setSideTab('history')}>당첨 기록 <span>{history.length}</span></button>
      </nav>

      {sideTab === 'participants' && (
        <section className="live-panel" aria-labelledby="participant-panel-title">
          <div className="live-panel__heading">
            <div>
              <h2 id="participant-panel-title">현재 참여자</h2>
              <p>추첨 가능 {eligibleParticipants.length}명 · 당첨 제외 {excludedParticipantIds.length}명</p>
            </div>
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={() => openParticipantEditor(raffleStatus === 'completed' ? 'completed' : 'ready')}>편집</button>
          </div>
          <ol className="live-participant-list">
            {participants.map((participant, index) => {
              const excluded = excludedParticipantIdSet.has(participant.id);
              return (
                <li key={participant.id} className={excluded ? 'is-excluded' : ''}>
                  <span>{index + 1}</span>
                  <strong>{participant.name}</strong>
                  {excluded ? <button type="button" disabled={isStageLocked} onClick={() => restoreParticipant(participant.id, participant.name)}>복귀</button> : <em>참여 중</em>}
                </li>
              );
            })}
          </ol>
          <button
            className="panel-wide-button"
            type="button"
            disabled={participants.length === 0}
            aria-disabled={copyingParticipantList || undefined}
            aria-busy={copyingParticipantList || undefined}
            onClick={copyParticipantList}
          >
            {copyingParticipantList ? "명단 복사 중…" : "번호가 붙은 명단 복사"}
          </button>
          <button className="panel-wide-button panel-wide-button--soft" type="button" disabled={isStageLocked || excludedParticipantIds.length === 0} onClick={resetWinnerState}>당첨 제외 상태 초기화</button>
          <button className="panel-wide-button panel-wide-button--soft" type="button" disabled={isStageLocked} onClick={() => openParticipantEditor(raffleStatus === 'completed' ? 'completed' : 'ready')}>명단 교체 · 비우기</button>
        </section>
      )}

      {sideTab === 'prizes' && (
        <section className="live-panel" aria-labelledby="prize-panel-title">
          {broadcastSession?.target === 'people' && sessionResults.length > 0 && (
            <section className="winner-prize-choices" aria-labelledby="winner-prize-choices-title">
              <h3 id="winner-prize-choices-title">당첨자에게 상품 뽑기</h3>
              <p>공개된 순서대로 한 명씩 상품을 배정합니다.</p>
              <div>
                <button type="button" disabled={isStageLocked} onClick={handoffWinnersToPrizeDraw}>
                  당첨자 {sessionResults.length}명 모두 연결
                </button>
              </div>
            </section>
          )}
          <div className="live-panel__heading">
            <div>
              <h2 id="prize-panel-title">상품 수량</h2>
              <p>남은 상품 {availablePrizeCount}개</p>
            </div>
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={openPrizeSetup}>상품 설정</button>
          </div>
          <div className="live-prize-list">
            {prizes.length === 0 && <p className="live-panel__empty">아직 상품이 없어요. 선물을 추가해 주세요.</p>}
            {prizes.map((prize) => (
              <div className="live-prize-row" key={prize.id}>
                <strong>{prize.name}</strong>
                <span>남은 {prize.quantity}개</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {sideTab === 'history' && (
        <section className="live-panel" aria-labelledby="history-panel-title">
          <div className="live-panel__heading">
            <div>
              <h2 id="history-panel-title">당첨 기록</h2>
              <p>최근 {history.length}건</p>
            </div>
            <div className="live-panel__actions">
              <button className="compact-button" type="button" disabled={history.length === 0} onClick={exportHistory}>CSV</button>
              <button
                className="compact-button compact-button--danger"
                type="button"
                disabled={isStageLocked || Boolean(broadcastSession || pausedBroadcastSession) || history.length === 0}
                title={broadcastSession || pausedBroadcastSession ? '현재 추첨 세션을 종료한 뒤 기록을 비울 수 있어요.' : undefined}
                onClick={clearHistory}
              >
                기록 비우기
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="live-panel__empty">아직 당첨 기록이 없어요.</p>
          ) : (
            <ol className="live-history-list">
              {history.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <small>
                    선정 {formatTime(item.createdAt, true)}
                    {item.revealedAt
                      ? ` · 공개 ${formatTime(item.revealedAt, true)}`
                      : ' · 공개 전 확정 복구'}
                    {' · '}{item.target === 'people' ? '사람' : '상품'}
                  </small>
                  {(item.roundLabel || item.rewardLabel) && (
                    <p className="live-history-list__round">
                      {[item.roundLabel, item.rewardLabel ? `선물 ${item.rewardLabel}` : undefined].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <strong>{item.winner}</strong>
                  <span>
                    {item.target === 'prizes' && item.recipient
                      ? `${item.recipient}님에게 전달`
                      : item.mode === 'wheel'
                        ? item.presentation === 'dart' ? '다트 복권' : '자동 룰렛'
                        : '마블'}
                    {item.candidateCount
                      ? ` · 후보 ${item.candidateCount}${item.target === 'people'
                        ? '명'
                        : item.prizeProbabilityModel === 'quantity-ratio' ? '종' : '개'}`
                      : ''}
                    {item.candidateTotalWeight
                      ? item.target === 'prizes' && item.prizeProbabilityModel === 'quantity-ratio'
                        ? ` · 재고 비율 합계 ${item.candidateTotalWeight}`
                        : ` · 총 ${item.candidateTotalWeight}추첨권`
                      : ''}
                    {item.candidateFingerprint ? ` · 검증 ${item.candidateFingerprint}` : ''}
                    {item.target === 'prizes'
                      ? item.prizeProbabilityModel === 'quantity-ratio'
                        ? ' · 수량 비율'
                        : typeof item.useWeights === 'boolean'
                          ? item.useWeights ? ' · 가중치 적용' : ' · 동일 확률'
                          : ''
                      : typeof item.useWeights === 'boolean'
                        ? item.useWeights ? ' · 가중치 적용' : ' · 동일 확률'
                        : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <footer className="broadcast-tools-drawer__reset">
        <button
          className="panel-wide-button panel-wide-button--soft compact-button--danger"
          type="button"
          disabled={isStageLocked}
          onClick={resetEverything}
        >명단·상품·기록 모두 초기화</button>
      </footer>
    </aside>
  );

  if (raffleStatus === 'configuring' || raffleStatus === 'roster') {
    const editorOpen = raffleStatus === 'roster';
    const preparation = derivePreparationReadiness({
      target: drawTarget,
      participantTotal: participants.length,
      duplicateParticipantCount: duplicateParticipantNames.length,
      allowDuplicateNames,
      eligibleParticipantCount: eligibleParticipants.length,
      candidateParticipantCount: candidateParticipants.length,
      excludedParticipantCount: excludedParticipantIds.length,
      poolLimit,
      prizeInventoryCount: availablePrizeCount,
      prizeRecipientCount: prizeRecipients.length,
      assignedPrizeRecipientCount,
      drawOptionCount: drawOptions.length,
      useWeights,
    });
    const preparationReady = preparation.state === 'ready';
    const preparationUnit = drawTarget === 'people' ? '명' : '종';
    const presentationLabel = wheelPresentation === 'dart' ? '다트 복권' : '회전 룰렛';
    const ruleLabel = drawTarget === 'prizes' ? '수량 비율' : useWeights ? '확률 지정' : '동일 확률';
    const duplicateLabel = drawTarget === 'people'
      ? removeAfterDraw ? '당첨 후 제외' : '중복 허용'
      : '재고 차감';
    const previewNames = drawTarget === 'people'
      ? peoplePreviewCycle.active.names
      : drawOptionNames;
    const previewWeights = drawTarget === 'people'
      ? peoplePreviewCycle.active.weights
      : drawOptionWeights;
    const pausedSessionLastLabel = pausedSessionLastResult
      ? pausedSessionLastResult.target === 'prizes' && pausedSessionLastResult.recipient
        ? `${pausedSessionLastResult.recipient} · ${pausedSessionLastResult.winner}`
        : pausedSessionLastResult.winner
      : '아직 결과 없음';
    const pausedSessionHub = pausedBroadcastSession ? (
      <section
        className="roulette-session-hub"
        aria-labelledby="roulette-paused-session-title"
      >
        <div className="roulette-session-hub__heading">
          <p>일시정지한 추첨</p>
          <h2 id="roulette-paused-session-title">
            {pausedBroadcastSession.target === 'people'
              ? '당첨자 추첨'
              : '상품 추첨'} 세션
          </h2>
        </div>
        <dl className="roulette-session-hub__meta">
          <div>
            <dt>진행</dt>
            <dd>
              {pausedSessionResults.length}/{pausedBroadcastSession.goal}
            </dd>
          </div>
          <div>
            <dt>현재 후보</dt>
            <dd>
              {pausedSessionCandidateCount}
              {pausedBroadcastSession.target === 'people' ? '명' : '종'}
            </dd>
          </div>
          <div>
            <dt>마지막 결과</dt>
            <dd title={pausedSessionLastLabel}>
              {pausedSessionLastLabel}
            </dd>
          </div>
        </dl>
        <div
          className="roulette-session-hub__actions"
          role="group"
          aria-label="일시정지한 추첨 동작"
        >
          <button
            className="preparation-preview__primary"
            type="button"
            onClick={resumePausedBroadcast}
          >
            {pausedSessionResults.length > 0
              ? '세션 계속하기'
              : '방송 화면 다시 열기'}
          </button>
          <button
            className="compact-button"
            type="button"
            onClick={startNewBroadcast}
          >
            현재 설정으로 새 세션
          </button>
          <button
            className="compact-button compact-button--danger"
            type="button"
            onClick={discardPausedBroadcast}
          >
            세션 종료
          </button>
        </div>
      </section>
    ) : null;
    const pausedSessionSecondaryActions = pausedBroadcastSession ? (
      <>
        <button
          className="compact-button"
          type="button"
          onClick={startNewBroadcast}
        >
          새 세션
        </button>
        <button
          className="compact-button compact-button--danger"
          type="button"
          onClick={discardPausedBroadcast}
        >
          세션 종료
        </button>
      </>
    ) : undefined;
    const runPreparationAction = () => {
      if (pausedBroadcastSession) {
        resumePausedBroadcast();
        return;
      }
      if (preparation.state === 'ready') {
        startBroadcast();
        return;
      }
      switch (preparation.recovery) {
        case 'open-roster':
          requestPreparationRosterEdit();
          break;
        case 'restore-excluded':
          resetWinnerState();
          break;
        case 'use-whole-roster':
          setPoolLimit(0);
          setPoolIds([]);
          break;
        case 'use-equal-probability':
          setUseWeights(false);
          break;
        case 'add-prize':
          addPrize();
          break;
        case 'restart-prize-recipients':
          restartPrizeRecipientAssignments();
          break;
      }
    };

    if (embedded) {
      return (
        <div ref={rouletteRootRef} className="roulette-game is-embedded">
          <main className="app-shell app-shell--preparation is-embedded">
            <div
              className="roulette-shared-setup"
              inert={editorOpen}
              aria-hidden={editorOpen || undefined}
            >
              <SetupWorkspace
                className="roulette-setup-workspace"
                eyebrow="ROULETTE"
                title={
                  drawTarget === 'people'
                    ? '당첨자 추첨'
                    : '상품 추첨'
                }
                sharedSetup={(
                  <SharedSetupSummary
                    rosterCount={participants.length}
                    allowDuplicateNames={allowDuplicateNames}
                    onRequestRosterEdit={requestPreparationRosterEdit}
                    disabled={editorOpen || !isConfigurationEditable}
                  />
                )}
                essentialSettings={(
                  <RoundSetupPanel
                    {...roundSetupProps}
                    rosterManagedExternally
                    includeAdvancedSettings={false}
                  />
                )}
                essentialSettingsLabel="추첨 설정"
                advancedSettings={(
                  <RoundSetupAdvancedSettings {...roundSetupProps} />
                )}
                advancedSettingsLabel="세부 설정"
                advancedSettingsDescription={
                  describeRoundSetupAdvancedSettings({
                    target: drawTarget,
                    useWeights,
                    removeAfterDraw,
                    poolLimit,
                    rewardLabel,
                  })
                }
                defaultAdvancedSettingsOpen={
                  drawTarget === 'people' && (
                    useWeights ||
                    poolLimit > 0 ||
                    Boolean(rewardLabel.trim())
                  )
                }
                previewHeader={(
                  <div className="roulette-preview-heading">
                    <span>방송 캔버스</span>
                    <strong>{presentationLabel} 미리보기</strong>
                  </div>
                )}
                previewTools={(
                  <span className="roulette-preview-count">
                    {previewNames.length > 0
                      ? `${previewNames.length}${preparationUnit}`
                      : '샘플'}
                  </span>
                )}
                previewStage={(
                  <DrawPreviewDirector
                    enabled={active}
                    names={previewNames}
                    weights={previewWeights}
                    target={drawTarget}
                    mode={drawMode}
                    presentation={wheelPresentation}
                    title={stageTitle}
                    onCycleBoundary={advancePeoplePreviewCycle}
                  />
                )}
                previewFooter={(
                  <div className="roulette-preview-summary">
                    <strong>
                      {preparationReady
                        ? drawTarget === 'people'
                          ? `${drawOptions.length}명 · 목표 ${setupWinnerGoal}명 · 회전당 1명`
                          : `${drawOptions.length}종 · 목표 ${setupWinnerGoal}회 · 재고 ${availablePrizeCount}개`
                        : drawTarget === 'people' && participants.length === 0
                          ? '명단 없음'
                          : drawTarget === 'prizes' && availablePrizeCount === 0
                            ? '상품 없음'
                            : '설정 확인 필요'}
                    </strong>
                    <span>
                      {presentationLabel} · {ruleLabel} · {duplicateLabel}
                    </span>
                  </div>
                )}
                readinessModel={{
                  tone: pausedBroadcastSession
                    ? 'recoverable'
                    : preparationReady
                      ? 'ready'
                      : 'blocked',
                  label: pausedBroadcastSession
                    ? '추첨 세션 일시정지'
                    : lastEndedSessionNotice
                      ? `이전 추첨 세션 종료 · ${preparation.statusLabel}`
                      : preparation.statusLabel,
                  detail: pausedBroadcastSession
                    ? `진행 ${pausedSessionResults.length}/${pausedBroadcastSession.goal} · 후보 ${pausedSessionCandidateCount}${pausedBroadcastSession.target === 'people' ? '명' : '종'} · 최근 ${pausedSessionLastLabel}`
                    : lastEndedSessionNotice
                      ? `${lastEndedSessionNotice} 현재 준비 상태: ${preparationReady ? '방송 화면을 열 수 있습니다.' : preparation.ctaLabel}`
                      : preparationReady
                        ? '방송 화면을 열어 대기 상태로 전환합니다.'
                        : preparation.ctaLabel,
                }}
                secondaryActions={pausedSessionSecondaryActions}
                primaryActionModel={{
                  label: pausedBroadcastSession
                    ? pausedSessionResults.length > 0
                      ? '세션 계속하기'
                      : '방송 화면 다시 열기'
                    : preparationReady
                      ? '방송 화면 열기'
                      : preparation.ctaLabel,
                  disabled: false,
                  busy: false,
                  onPress: runPreparationAction,
                }}
              />
            </div>

            {editorOpen && (
              <div
                className="roster-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="명단 편집"
              >
                <button
                  className="roster-drawer__scrim"
                  type="button"
                  tabIndex={-1}
                  aria-label="명단 편집 닫기"
                  onClick={cancelParticipantEditor}
                />
                <ParticipantSetup
                  key={setupSession}
                  initialParticipants={participants}
                  initialStep={setupStartStep}
                  onClear={
                    participants.length > 0
                      ? clearParticipantRoster
                      : undefined
                  }
                  onCancel={cancelParticipantEditor}
                  onDraftChange={setParticipantPreviewDraft}
                  onDirtyChange={setRosterEditorDirty}
                  allowDuplicateNames={allowDuplicateNames}
                  onStart={saveParticipants}
                />
              </div>
            )}

            {toast && <div className="toast" role="status">{toast}</div>}
          </main>
        </div>
      );
    }

    return (
      <div ref={rouletteRootRef} className={`roulette-game${embedded ? ' is-embedded' : ''}`}>
        <main className={`app-shell app-shell--preparation${embedded ? ' is-embedded' : ''}`}>
          {!embedded && (
            <header className="brand-header">
              <div className="brand brand--static" aria-label="exlab Roulette">
                <strong>exlab · Roulette</strong>
              </div>
              <nav className="preparation-phase" aria-label="추첨 진행">
                <strong aria-current="step">준비</strong>
                <span>방송</span>
                <span>결과</span>
              </nav>
            </header>
          )}

        <section className="preparation-workspace" aria-label="새 추첨 준비" inert={editorOpen} aria-hidden={editorOpen || undefined}>
          <section className="preparation-rail" aria-labelledby="preparation-title">
            <header className="preparation-rail__heading">
              <div>
                <p>새 추첨</p>
                <h1 id="preparation-title">{drawTarget === 'people' ? '당첨자 추첨' : '상품 추첨'}</h1>
              </div>
            </header>
            <div className="preparation-rail__controls">
              {renderRoundSettings()}
            </div>
          </section>

          <section className="preparation-preview" aria-labelledby="preparation-preview-title">
            <header className="preparation-preview__heading">
              <div>
                <p>방송 캔버스</p>
                <h2 id="preparation-preview-title">{presentationLabel} 미리보기</h2>
              </div>
              <span>{previewNames.length > 0 ? `${previewNames.length}${preparationUnit}` : '샘플'}</span>
            </header>

            <div className="preparation-preview__stage">
              <DrawPreviewDirector
                enabled={active}
                names={previewNames}
                weights={previewWeights}
                target={drawTarget}
                mode={drawMode}
                presentation={wheelPresentation}
                title={stageTitle}
                onCycleBoundary={advancePeoplePreviewCycle}
              />
            </div>

            <footer className="preparation-preview__footer">
              {pausedSessionHub ?? (
                <>
                  <div className="preparation-preview__summary">
                    <strong>
                      {preparationReady
                        ? drawTarget === 'people'
                          ? `${drawOptions.length}명 · 목표 ${setupWinnerGoal}명 · 회전당 1명`
                          : `${drawOptions.length}종 · 목표 ${setupWinnerGoal}회 · 재고 ${availablePrizeCount}개`
                        : drawTarget === 'people' && participants.length === 0
                          ? '명단 없음'
                          : drawTarget === 'prizes' && availablePrizeCount === 0
                            ? '상품 없음'
                            : '설정 확인 필요'}
                    </strong>
                    <span>{presentationLabel} · {ruleLabel} · {duplicateLabel}</span>
                  </div>
                  <div
                    className={`preparation-preview__status${preparationReady ? ' is-ready' : ' is-blocked'}`}
                    role="status"
                    title={lastEndedSessionNotice
                      ? `${lastEndedSessionNotice} 현재 준비 상태: ${preparation.statusLabel}${preparationReady ? '' : ` · ${preparation.ctaLabel}`}`
                      : undefined}
                  >
                    <span aria-hidden="true" />
                    <strong>{lastEndedSessionNotice ? `${preparation.statusLabel} · 이전 세션 종료` : preparation.statusLabel}</strong>
                  </div>
                  <button
                    className="preparation-preview__primary"
                    type="button"
                    onClick={runPreparationAction}
                  >
                    {preparationReady ? '방송 화면 열기' : preparation.ctaLabel}
                  </button>
                </>
              )}
            </footer>
          </section>
        </section>

        {editorOpen && (
          <div className="roster-drawer" role="dialog" aria-modal="true" aria-label="명단 편집">
            <button className="roster-drawer__scrim" type="button" tabIndex={-1} aria-label="명단 편집 닫기" onClick={cancelParticipantEditor} />
            <ParticipantSetup
              key={setupSession}
              initialParticipants={participants}
              initialStep={setupStartStep}
              onClear={participants.length > 0 ? clearParticipantRoster : undefined}
              onCancel={cancelParticipantEditor}
              onDraftChange={setParticipantPreviewDraft}
              onDirtyChange={setRosterEditorDirty}
              allowDuplicateNames={allowDuplicateNames}
              onStart={saveParticipants}
            />
          </div>
        )}

          {toast && <div className="toast" role="status">{toast}</div>}
        </main>
      </div>
    );
  }

  return (
    <div ref={rouletteRootRef} className={`roulette-game${embedded ? ' is-embedded' : ''}`}>
      <main className={`app-shell app-shell--live${embedded ? ' is-embedded' : ''}`}>
        {!embedded && (
          <header className="brand-header broadcast-header" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
            <div className="brand brand--static" aria-label="exlab Roulette">
              <strong>exlab · Roulette</strong>
            </div>
            <div className="broadcast-header__actions">
              {isPresentationLocked ? (
                <span className="broadcast-tools-lock" role="status">연출 중 · 도구 잠김</span>
              ) : (
                <button
                  ref={toolsTriggerRef}
                  className="compact-button"
                  type="button"
                  aria-expanded={toolsOpen}
                  aria-controls="broadcast-tools-drawer"
                  onClick={() => {
                    if (toolsOpen) closeTools(true);
                    else setToolsOpen(true);
                  }}
                >명단 · 기록</button>
              )}
            </div>
          </header>
        )}

      <div className="broadcast-phase-bar" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <div className="broadcast-phase-bar__status">
          <span>{statusMeta.liveLabel}</span>
          <strong ref={liveStageTitleRef} id="stage-title" tabIndex={-1}>{stageTitle}</strong>
        </div>
        <p>{ruleSummary}</p>
        {embedded && (
          <div className="broadcast-phase-bar__tools">
            {isPresentationLocked ? (
              <span className="broadcast-tools-lock" role="status">연출 중 · 도구 잠김</span>
            ) : (
              <button
                ref={toolsTriggerRef}
                className="compact-button"
                type="button"
                aria-expanded={toolsOpen}
                aria-controls="broadcast-tools-drawer"
                onClick={() => {
                  if (toolsOpen) closeTools(true);
                  else setToolsOpen(true);
                }}
              >
                명단 · 기록
              </button>
            )}
          </div>
        )}
      </div>

      <p
        className="current-round-winners__announcement roulette-live-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {resultBoardAnnouncement ?? ''}
      </p>

      {toolsOpen && (
        <>
          <button
            className="broadcast-tools-scrim"
            type="button"
            tabIndex={-1}
            aria-label="진행 도구 닫기"
            onClick={() => closeTools(true)}
          />
          {renderProgressTools()}
        </>
      )}

      <section className={broadcastFocusClassName} aria-label="방송 집중 화면" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <BroadcastCandidateRoster
          items={displayNames}
          title={roundTarget === 'people' ? '참여자 명단' : '추첨 상품'}
          unit={roundCandidateUnit}
        />

        <section className="broadcast-focus__stage" aria-labelledby="stage-title">
          <p className="broadcast-focus__fairness">{fairnessLabel}</p>

          <div className={broadcastVisualClassName} style={cinematicCameraStyle}>
            <div className="broadcast-focus__camera">
              {renderDrawVisual('live')}
            </div>
            {showWinnerHeroPanel && winnerHero && (
              <>
                <span className="broadcast-focus__result-anchor" aria-hidden="true" />
                <WinnerHero
                  key={winnerHero.revealId}
                  className="broadcast-focus__winner-hero"
                  winnerName={winnerHero.result.winner}
                  ordinal={winnerHero.result.roundOrder}
                  total={sessionGoal}
                  targetLabel={winnerHero.result.target === 'people' ? '당첨자' : '당첨 상품'}
                  recipient={winnerHero.result.recipient}
                  product={winnerHero.result.target === 'people' ? winnerHero.result.rewardLabel : undefined}
                  announcement=""
                />
              </>
            )}
          </div>

          <p className="broadcast-focus__prompt">{stagePrompt}</p>
        </section>

        {showResultsPanel && (
          <aside className={`broadcast-focus__results${visibleSessionResults.length === 0 ? ' is-empty' : ''}`} aria-label="이 방송의 전체 추첨 결과">
            <CurrentRoundWinners
              winners={visibleSessionResults.map((result) => ({
                id: result.id,
                name: result.target === 'prizes' && result.recipient ? result.recipient : result.winner,
                detail: result.target === 'prizes'
                  ? result.recipient ? `${result.winner} 배정` : undefined
                  : result.rewardLabel ? `${result.rewardLabel} 당첨` : undefined,
              }))}
              pendingCount={sessionPendingCount}
              unit={resultUnit}
              latestWinnerId={latestVisibleSessionResult?.id}
              title={resultTitle}
              announcement=""
              removalMessage={visibleSessionResults.length > 0 ? resultRemovalMessage : undefined}
            />
          </aside>
        )}

        {(raffleStatus === 'ready' || isPresentationRunning || raffleStatus === 'completed') && (
          <div className="broadcast-focus__action">
            {raffleStatus === 'ready' && (
              <BroadcastActionDock
                phase="ready"
                note={actionNote}
                primaryAction={readyPrimaryAction}
                secondaryActions={[
                  {
                    id: 'finish-stage',
                    label: '설계로 일시정지',
                    onClick: () => finishBroadcast(),
                    tone: 'quiet',
                    title: '현재 진행도와 결과를 유지한 채 설계 화면으로 돌아갑니다.',
                  },
                ]}
              />
            )}
            {isPresentationRunning && (
              <BroadcastActionDock
                phase="presenting"
                ariaLabel="추첨 진행 상태"
                note={actionNote}
                primaryAction={presentingPrimaryAction}
                secondaryActions={presentingSecondaryActions}
              />
            )}
            {raffleStatus === 'completed' && (
              <BroadcastActionDock
                phase="completed"
                primaryActionRef={completedPrimaryActionRef}
                note={actionNote}
                primaryAction={completedPrimaryAction}
                secondaryActions={completedSecondaryActions}
              />
            )}
          </div>
        )}
      </section>

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    </div>
  );
}

export default RouletteGame;
