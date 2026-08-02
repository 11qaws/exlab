"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  SetupChoiceControl,
  SetupOptionGroup,
  SetupOptionRow,
  SetupWorkspace,
} from "../../_platform/components/SetupWorkspace";
import { SharedSetupSummary } from "../../_platform/components/SharedSetupSummary";
import {
  INITIAL_GAME_HOST_STATE,
  isGameSwitchLocked,
  type EmbeddedGameProps,
  type GameHostState,
} from "../../_platform/contracts";
import { DEFAULT_ROSTER_TEXT } from "../../_platform/defaultRoster";
import { sharedRosterSnapshotText } from "../../_platform/sharedRosterSnapshot";
import {
  readPlatformPreferences,
  writeSharedRoster,
} from "../../_platform/storage";
import {
  advancePreviewCycle,
  createPreviewCycleBuffer,
  DEFAULT_PREVIEW_ROSTER_NAMES,
} from "../../_platform/previewRoster";
import {
  DEFAULT_STREAMER_THEME_ID,
  getStreamerTheme,
} from "../../_platform/theme";
import {
  createResultPresentationState,
  resultPresentationToken,
  type ResultPresentationToken,
} from "../../_platform/presentation";
import {
  assignParticipantThemes,
  buildRacePlan,
  createRaceSlotAssignment,
  createSeed,
  maximumGroupCount,
  MAX_GROUP_SIZE,
  minimumGroupCount,
  parseRoster,
  PARTICIPANT_THEMES,
  shortName,
  splitCandidatesIntoGroups,
} from "./core";
import {
  countdownStepDuration,
  nextCountdownStep,
  type CountdownStep,
} from "./countdown";
import {
} from "./course";
import {
  CHASE_ASSIST_TARGET_GAP,
  FRAME_RATE,
  MINIMUM_RESULT_FINISHERS,
  START_MAX_HORIZONTAL_JITTER,
  simulateRace,
  simulateRacePreview,
} from "./simulation";
import {
  findFinalSectionOvertakes,
  findStableLeadChanges,
  formatFinishTime,
  isCloseRace,
  isFinalApproach,
  isPhotoFinish,
  resolveArrivalDelta,
  resolveCourseProgress,
  resolveFinishRecords,
  resolveRaceElapsedMs,
  type FinishRecord,
} from "./race-presentation";
import {
  advanceRacePlayback,
  createRacePlaybackClock,
  FINAL_OVERTAKE_DURATION_MS,
  FINAL_OVERTAKE_PLAYBACK_RATE,
  RESULT_HOLD_DURATION_MS,
  resolveFinalOvertakeTriggerFrame,
  type RacePlaybackClock,
} from "./race-playback";
import {
  DEFAULT_RACE_MAP_MODE,
  RACE_OBSTACLE_ROLE_COLORS,
  showdownWallColor,
  type RaceMapMode,
} from "./race-theme";
import {
  readStoredRaceHistory,
  shouldPersistRaceHistoryCheckpoint,
  upsertRaceHistory,
  writeStoredRaceHistory,
  type RaceHistoryCheckpoint,
} from "./race-history";
import type {
  Candidate,
  RacePlan,
  StoredRaceResult,
} from "./types";
import {
  RaceCanvas,
  type RaceCanvasPlan,
} from "./RaceCanvas";
import {
  RESULT_DOCK_DURATION_MS,
  RESULT_HERO_HOLD_MS,
  candidateForSlot,
  createShowdownResultProjection,
  showdownResultPresentationReducer,
  type ShowdownResultPresentationEvent,
  type ShowdownResultPresentationState,
} from "./resultPresentation";
import "./showdown-game.css";

const PREVIEW_DURATION_MS = 10_000;
const MAX_PRESENTATION_DELTA_MS = 100;
const AUDIO_RESUME_TIMEOUT_MS = 350;

type Phase =
  | "ready"
  | "generating"
  | "waiting"
  | "countdown"
  | "running"
  | "result"
  | "error";

export type ShowdownGameProps = EmbeddedGameProps;

type FinalOvertakeCue = {
  fromSlotId: string;
  toSlotId: string;
  progress: number;
  hasOvertaken: boolean;
};


type ParticipantStyle = CSSProperties & {
  "--participant-primary": string;
  "--participant-on-primary": string;
  "--participant-surface": string;
  "--participant-on-surface": string;
  "--participant-border": string;
};

function participantStyle(candidate: Candidate): ParticipantStyle {
  return {
    "--participant-primary": candidate.theme.primary,
    "--participant-on-primary": candidate.theme.onPrimary,
    "--participant-surface": candidate.theme.surface,
    "--participant-on-surface": candidate.theme.onSurface,
    "--participant-border": candidate.theme.border,
  };
}

export const LEADERBOARD_SWAP_DURATION_MS = 200;

type LiveLeaderboardRow = {
  slotId: string;
  candidate: Candidate;
};


type StandingsRow = LiveLeaderboardRow | null;

type LiveLeaderboardProps = {
  rows: StandingsRow[];
  finishedSlotIds: ReadonlySet<string>;
  activeLeaderSlotId?: string;
  finishRecords: ReadonlyMap<string, FinishRecord>;
  reducedMotion: boolean;
  resultMode?: boolean;
  winnerCount?: number;
};

type LeaderboardPositionSnapshot = ReadonlyMap<
  string,
  { left: number; top: number }
>;

function sameLeaderboardOrder(
  previousRows: readonly StandingsRow[],
  nextRows: readonly StandingsRow[],
): boolean {
  return (
    previousRows.length === nextRows.length &&
    previousRows.every(
      (row, index) =>
        (row?.slotId ?? `pending-${index}`) ===
        (nextRows[index]?.slotId ?? `pending-${index}`),
    )
  );
}

class LiveLeaderboard extends Component<LiveLeaderboardProps> {
  private readonly rowElements = new Map<string, HTMLLIElement>();
  private readonly rowRefCallbacks = new Map<
    string,
    (element: HTMLLIElement | null) => void
  >();
  private readonly rankAnimations = new Map<string, Animation>();
  private readonly rankAnimationTimers = new Map<string, number>();

  private rowRef(slotId: string) {
    const existing = this.rowRefCallbacks.get(slotId);
    if (existing) return existing;
    const callback = (element: HTMLLIElement | null) => {
      if (element) {
        this.rowElements.set(slotId, element);
      } else {
        this.rowElements.delete(slotId);
      }
    };
    this.rowRefCallbacks.set(slotId, callback);
    return callback;
  }

  private cancelRankAnimation(slotId: string) {
    const animation = this.rankAnimations.get(slotId);
    this.rankAnimations.delete(slotId);
    animation?.cancel();

    const timer = this.rankAnimationTimers.get(slotId);
    if (timer !== undefined) window.clearTimeout(timer);
    this.rankAnimationTimers.delete(slotId);

    const element = this.rowElements.get(slotId);
    if (!element) return;
    delete element.dataset.rankAnimating;
    element.style.removeProperty("transform");
    element.style.removeProperty("transition");
  }

  private cancelRankAnimations() {
    const slotIds = new Set([
      ...this.rankAnimations.keys(),
      ...this.rankAnimationTimers.keys(),
    ]);
    slotIds.forEach((slotId) => this.cancelRankAnimation(slotId));
  }

  getSnapshotBeforeUpdate(
    previousProps: Readonly<LiveLeaderboardProps>,
  ): LeaderboardPositionSnapshot | null {
    if (
      this.props.reducedMotion ||
      sameLeaderboardOrder(previousProps.rows, this.props.rows)
    ) {
      return null;
    }

    return new Map(
      previousProps.rows.flatMap((row) => {
        if (!row) return [];
        const element = this.rowElements.get(row.slotId);
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        return [[row.slotId, { left: rect.left, top: rect.top }] as const];
      }),
    );
  }

  componentDidUpdate(
    _previousProps: Readonly<LiveLeaderboardProps>,
    _previousState: Readonly<Record<string, never>>,
    snapshot: LeaderboardPositionSnapshot | null,
  ) {
    if (this.props.reducedMotion) {
      this.cancelRankAnimations();
      return;
    }
    if (!snapshot) return;

    this.props.rows.forEach((row) => {
      if (!row) return;
      const element = this.rowElements.get(row.slotId);
      const previousPosition = snapshot.get(row.slotId);
      if (!element || !previousPosition) return;

      this.cancelRankAnimation(row.slotId);
      const nextRect = element.getBoundingClientRect();
      if (nextRect.width === 0 || nextRect.height === 0) {
        this.rankAnimations.delete(row.slotId);
        return;
      }
      const offsetX = previousPosition.left - nextRect.left;
      const offsetY = previousPosition.top - nextRect.top;
      if (
        Math.abs(offsetX) < 0.5 &&
        Math.abs(offsetY) < 0.5
      ) {
        this.rankAnimations.delete(row.slotId);
        return;
      }

      element.dataset.rankAnimating = "true";
      const startTransform = `translate(${offsetX}px, ${offsetY}px)`;
      if (typeof element.animate !== "function") {
        element.style.transition = "none";
        element.style.transform = startTransform;
        void element.offsetWidth;
        element.style.transition = `transform ${LEADERBOARD_SWAP_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), background 180ms ease-out`;
        element.style.transform = "translate(0, 0)";
        const timer = window.setTimeout(() => {
          if (this.rankAnimationTimers.get(row.slotId) !== timer) return;
          this.rankAnimationTimers.delete(row.slotId);
          delete element.dataset.rankAnimating;
          element.style.removeProperty("transform");
          element.style.removeProperty("transition");
        }, LEADERBOARD_SWAP_DURATION_MS + 34);
        this.rankAnimationTimers.set(row.slotId, timer);
        return;
      }

      const animation = element.animate(
        [
          { transform: startTransform },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: LEADERBOARD_SWAP_DURATION_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
      this.rankAnimations.set(row.slotId, animation);
      const releaseAnimation = () => {
        if (this.rankAnimations.get(row.slotId) === animation) {
          this.rankAnimations.delete(row.slotId);
          delete element.dataset.rankAnimating;
        }
      };
      animation.onfinish = releaseAnimation;
      animation.oncancel = releaseAnimation;
    });
  }

  componentWillUnmount() {
    this.cancelRankAnimations();
  }

  render() {
    const {
      rows,
      finishedSlotIds,
      activeLeaderSlotId,
      finishRecords,
      resultMode = false,
      winnerCount = 0,
    } = this.props;

    return (
      <ol>
        {rows.map((row, index) => {
          if (!row) {
            return (
              <li
                key={`pending-${index}`}
                className="is-result-row is-pending"
                aria-label={`${index + 1}위 도착 대기`}
              >
                <strong aria-hidden="true">{index + 1}</strong>
                <i aria-hidden="true" />
                <span aria-hidden="true">{"\u00a0"}</span>
                <time
                  className="leaderboard-time is-pending"
                  aria-hidden="true"
                >
                  —
                </time>
              </li>
            );
          }
          const { slotId, candidate } = row;
          const finished = finishedSlotIds.has(slotId);
          const finishRecord = finished
            ? finishRecords.get(slotId)
            : undefined;
          const finishTime = finishRecord
            ? formatFinishTime(finishRecord.elapsedMs)
            : "—";

          return (
            <li
              key={slotId}
              ref={this.rowRef(slotId)}
              data-rank-slot-id={slotId}
              data-live-rank={index + 1}
              className={[
                !resultMode && index === 0 ? "is-leading" : "",
                finished ? "is-qualified" : "",
                resultMode ? "is-result-row" : "",
                resultMode && index < winnerCount ? "is-winner" : "",
                slotId === activeLeaderSlotId
                  ? "is-active-contender"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={participantStyle(candidate)}
              aria-label={`${index + 1}위 ${candidate.name}${
                resultMode && index < winnerCount ? ", 당첨" : ""
              }, ${finishRecord ? `골인 ${finishTime}` : "경기 중"}`}
            >
              <strong aria-hidden="true">{index + 1}</strong>
              <i aria-hidden="true" />
              <span title={candidate.name} aria-hidden="true">
                {shortName(candidate.name)}
              </span>
              <span className="leaderboard-result-meta" aria-hidden="true">
                {resultMode && index < winnerCount && <em>당첨</em>}
                <time
                  className={[
                    "leaderboard-time",
                    finishRecord ? "is-finished" : "is-pending",
                  ].join(" ")}
                  dateTime={
                    finishRecord
                      ? `PT${(finishRecord.elapsedMs / 1000).toFixed(3)}S`
                      : undefined
                  }
                  title={finishRecord ? "골인 시간" : "골인 전"}
                >
                  {finishTime}
                </time>
              </span>
            </li>
          );
        })}
      </ol>
    );
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function MapThemeToggle({
  mode,
  onChange,
  compact = false,
}: {
  mode: RaceMapMode;
  onChange: (mode: RaceMapMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`map-theme-toggle ${compact ? "is-compact" : ""}`}
      role="group"
      aria-label="맵 색상 테마"
    >
      {(["light", "dark"] as const).map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
        >
          {option === "light" ? "라이트" : "다크"}
        </button>
      ))}
    </div>
  );
}

function CourseLegend() {
  const labels: Record<keyof typeof RACE_OBSTACLE_ROLE_COLORS, string> = {
    bumper: "고탄성 범퍼",
    pin: "핀",
    guide: "유도 레일",
    "elastic-wall": "탄성 벽",
    spinner: "회전막대",
  };
  return (
    <ul className="course-legend" aria-label="장애물 색상 범례">
      {Object.entries(RACE_OBSTACLE_ROLE_COLORS).map(([role, color]) => (
        <li key={role}>
          <i style={{ background: color.value }} aria-hidden="true" />
          {labels[role as keyof typeof labels]}
        </li>
      ))}
    </ul>
  );
}

function LiveRacePreview({
  candidates,
  layoutSeed,
  reducedMotion,
  mapMode,
  wallColor,
  active,
}: {
  candidates: Candidate[];
  layoutSeed: string;
  reducedMotion: boolean;
  mapMode: RaceMapMode;
  wallColor: string;
  active: boolean;
}) {
  const defaultPreviewCandidates = useMemo<Candidate[]>(
    () => assignParticipantThemes(
      DEFAULT_PREVIEW_ROSTER_NAMES.map((name, index) => ({
        id: `preview-default-${index + 1}`,
        name,
        number: index + 1,
        theme: PARTICIPANT_THEMES[index],
      })),
      "showdown:default-preview",
    ),
    [],
  );
  const resolvePreviewCandidates = useCallback(
    (nextCandidates: readonly Candidate[]) => (
      nextCandidates.length >= 2
        ? [...nextCandidates]
        : defaultPreviewCandidates
    ),
    [defaultPreviewCandidates],
  );
  const requestedCandidatesRef = useRef(candidates);
  useEffect(() => {
    requestedCandidatesRef.current = candidates;
  }, [candidates]);
  const [candidateCycle, setCandidateCycle] = useState(() => (
    createPreviewCycleBuffer(
      defaultPreviewCandidates,
      resolvePreviewCandidates(candidates),
    )
  ));
  const [previewCycle, setPreviewCycle] = useState(0);
  const [previewPlan, setPreviewPlan] =
    useState<RaceCanvasPlan | null>(null);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(10);

  useEffect(() => {
    if (!active) return undefined;
    let retryTimer = 0;
    const timer = window.setTimeout(() => {
      setPreviewFrameIndex(0);
      setRemainingSeconds(10);
      const previewCandidates = candidateCycle.active;
      const raceSeed = createSeed(`preview-race-${previewCycle + 1}`);
      const previewLayoutSeed = createSeed(
        `${layoutSeed}-preview-layout-${previewCycle + 1}`,
      );
      try {
        const slotToCandidateId = createRaceSlotAssignment(
          previewCandidates,
          raceSeed,
        );
        const simulation = simulateRacePreview(
          slotToCandidateId,
          raceSeed,
          previewLayoutSeed,
          PREVIEW_DURATION_MS,
        );
        setPreviewPlan({
          runId: `preview:${raceSeed}`,
          candidates: previewCandidates,
          slotToCandidateId,
          simulation,
        });
      } catch {
        setPreviewPlan(null);
        retryTimer = window.setTimeout(
          () => setPreviewCycle((value) => value + 1),
          750,
        );
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [active, candidateCycle.active, layoutSeed, previewCycle]);

  useEffect(() => {
    if (!active || !previewPlan) return;
    const startedAt = performance.now();
    let animationFrame = 0;
    const animate = (now: number) => {
      const elapsedMs = now - startedAt;
      const nextFrame = Math.min(
        Math.max(0, previewPlan.simulation.frames.length - 1),
        Math.floor((elapsedMs / 1000) * FRAME_RATE),
      );
      setPreviewFrameIndex(nextFrame);
      setRemainingSeconds(
        Math.max(0, Math.ceil((PREVIEW_DURATION_MS - elapsedMs) / 1000)),
      );
      if (elapsedMs >= PREVIEW_DURATION_MS) {
        setCandidateCycle((state) => (
          advancePreviewCycle(
            state,
            resolvePreviewCandidates(requestedCandidatesRef.current),
          )
        ));
        setPreviewCycle((value) => value + 1);
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [active, previewPlan, resolvePreviewCandidates]);

  if (!previewPlan) {
    return (
      <div
        className="map-preview live-preview preview-loading"
        data-map-mode={mapMode}
        role="status"
        aria-busy="true"
        aria-label="Showdown 경기 미리보기 준비 중"
      >
        <span aria-hidden="true" />
        <strong>경기장 준비 중</strong>
      </div>
    );
  }

  return (
    <div
      className="map-preview live-preview"
      data-map-mode={mapMode}
      aria-label="10초 Showdown 경기 미리보기"
    >
      <RaceCanvas
        plan={previewPlan}
        frameIndex={previewFrameIndex}
        reducedMotion={reducedMotion}
        mapMode={mapMode}
        wallColor={wallColor}
      />
      <div className="preview-hud">
        <div>
          <span>10S LIVE PREVIEW</span>
          <strong>{remainingSeconds}초 후 새 시드</strong>
        </div>
        <small>
          {previewPlan.simulation.dynamics.fingerprint} · 배치{" "}
          {previewPlan.simulation.layoutShift >= 0 ? "+" : ""}
          {previewPlan.simulation.layoutShift}px
        </small>
      </div>
      <div
        className="preview-progress"
        aria-hidden="true"
        style={{
          transform: `scaleX(${Math.max(
            0,
            Math.min(
              1,
              1 -
                previewFrameIndex /
                  Math.max(1, (PREVIEW_DURATION_MS / 1000) * FRAME_RATE),
            ),
          )})`,
        }}
      />
    </div>
  );
}

export function ShowdownGame({
  embedded = false,
  visible,
  active = visible ?? true,
  streamerThemeId = DEFAULT_STREAMER_THEME_ID,
  roster,
  rosterText: controlledRosterText,
  onRosterTextChange,
  allowDuplicateNames: controlledAllowDuplicateNames,
  onAllowDuplicateNamesChange,
  onRequestRosterEdit,
  onHostStateChange,
  onActivityChange,
}: ShowdownGameProps = {}) {
  const [title, setTitle] = useState("오늘의 Showdown");
  const [internalRosterText, setInternalRosterText] =
    useState(DEFAULT_ROSTER_TEXT);
  const [isEditingRoster, setIsEditingRoster] = useState(false);
  const [mapMode, setMapMode] = useState<RaceMapMode>(
    DEFAULT_RACE_MAP_MODE,
  );
  const wallColor = showdownWallColor(
    getStreamerTheme(streamerThemeId).palette,
    mapMode,
  );
  const [internalAllowDuplicateNames, setInternalAllowDuplicateNames] =
    useState(false);
  const [groupCount, setGroupCount] = useState(1);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [winnerCount, setWinnerCount] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [raceStartPending, setRaceStartPending] = useState(false);
  const [layoutSeed, setLayoutSeed] = useState(() => createSeed("layout"));
  const [phase, setPhase] = useState<Phase>("ready");
  const [resultPresentation, dispatchResultPresentationState] =
    useReducer(
      showdownResultPresentationReducer,
      undefined,
      () => createResultPresentationState("showdown:idle:0"),
    );
  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [renderFrameIndex, setRenderFrameIndex] = useState(0);
  const [countdown, setCountdown] = useState<CountdownStep>(3);
  const [errorMessage, setErrorMessage] = useState("");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<StoredRaceResult[]>([]);
  const [isReplay, setIsReplay] = useState(false);
  const [playbackEpoch, setPlaybackEpoch] = useState(0);
  const [finalOvertakeCue, setFinalOvertakeCue] =
    useState<FinalOvertakeCue | null>(null);
  const [resultHoldRemainingMs, setResultHoldRemainingMs] = useState(
    RESULT_HOLD_DURATION_MS,
  );
  const generationKey = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const raceStartPendingRef = useRef(false);
  const raceStartRequestRef = useRef(0);
  const resultPresentationRef =
    useRef<ShowdownResultPresentationState>(resultPresentation);
  const resultHeroTimerRef = useRef<number | null>(null);
  const resultDockTimerRef = useRef<number | null>(null);
  const historyRef = useRef<StoredRaceResult[]>([]);
  const resultHistoryCheckpoint = useRef<RaceHistoryCheckpoint | null>(
    null,
  );
  const playbackClock = useRef<RacePlaybackClock>(
    createRacePlaybackClock(),
  );
  const lastPlaybackTimestamp = useRef<number | null>(null);
  const activityChangeRef = useRef(onActivityChange);
  const hostStateChangeRef = useRef(onHostStateChange);
  const dispatchResultPresentation = useCallback(
    (event: ShowdownResultPresentationEvent) => {
      resultPresentationRef.current =
        showdownResultPresentationReducer(
          resultPresentationRef.current,
          event,
        );
      dispatchResultPresentationState(event);
    },
    [],
  );
  const cancelResultPresentationTimers = useCallback(() => {
    if (resultHeroTimerRef.current !== null) {
      window.clearTimeout(resultHeroTimerRef.current);
      resultHeroTimerRef.current = null;
    }
    if (resultDockTimerRef.current !== null) {
      window.clearTimeout(resultDockTimerRef.current);
      resultDockTimerRef.current = null;
    }
  }, []);
  const reducedMotion = useReducedMotion();
  const hasControlledRoster =
    roster !== undefined || controlledRosterText !== undefined;
  const rosterText = roster
    ? sharedRosterSnapshotText(roster)
    : controlledRosterText ?? internalRosterText;
  const allowDuplicateNames =
    roster?.allowDuplicateNames
    ?? controlledAllowDuplicateNames
    ?? internalAllowDuplicateNames;
  const stableLeadChanges = useMemo(
    () =>
      plan
        ? findStableLeadChanges(plan.simulation.frames, {
            targetFinishCount: plan.simulation.resultGateCount,
          })
        : [],
    [plan],
  );
  const finalOvertakeEvents = useMemo(
    () =>
      plan
        ? findFinalSectionOvertakes(
            plan.simulation.frames,
          ).map((overtake) => ({
            ...overtake,
            triggerFrameIndex: resolveFinalOvertakeTriggerFrame(
              overtake.overtakeFrameIndex,
              FRAME_RATE,
              reducedMotion
                ? 1
                : FINAL_OVERTAKE_PLAYBACK_RATE,
            ),
          }))
        : [],
    [plan, reducedMotion],
  );
  const photoFinish = useMemo(
    () => (plan ? isPhotoFinish(plan.simulation.frames) : false),
    [plan],
  );
  const finishRecords = useMemo(
    () =>
      plan
        ? resolveFinishRecords(plan.simulation.frames)
        : new Map<string, FinishRecord>(),
    [plan],
  );
  const validation = useMemo(
    () =>
      parseRoster(rosterText, {
        allowDuplicateNames,
        participantIds: roster?.participants.map(
          (participant) => participant.id,
        ),
      }),
    [allowDuplicateNames, roster, rosterText],
  );
  const minimumGroups = minimumGroupCount(validation.candidates.length);
  const maximumGroups = maximumGroupCount(validation.candidates.length);
  const effectiveGroupCount = Math.min(
    maximumGroups,
    Math.max(minimumGroups, groupCount),
  );
  const groups = useMemo(
    () => {
      const nextGroups = splitCandidatesIntoGroups(
        validation.candidates,
        effectiveGroupCount,
      );
      return nextGroups.map((group) => ({
        ...group,
        candidates: assignParticipantThemes(
          group.candidates,
          `showdown:${group.candidates
            .map((candidate) => candidate.id)
            .join("|")}`,
        ),
      }));
    },
    [effectiveGroupCount, validation.candidates],
  );
  const selectedGroupIndex = Math.min(
    activeGroupIndex,
    Math.max(0, groups.length - 1),
  );
  const activeGroup = groups[selectedGroupIndex] ?? groups[0];
  const activeCandidates = activeGroup?.candidates ?? [];
  const effectiveWinnerCount = Math.min(
    winnerCount,
    Math.max(1, activeCandidates.length),
  );

  useEffect(() => {
    activityChangeRef.current = onActivityChange;
  }, [onActivityChange]);

  useEffect(() => {
    hostStateChangeRef.current = onHostStateChange;
  }, [onHostStateChange]);

  const hostState = useMemo<GameHostState>(() => {
    if (phase === "generating") {
      return { lifecycle: "generating", statusLabel: "경기장 준비 중" };
    }
    if (phase === "waiting") {
      return {
        lifecycle: "waiting",
        statusLabel: "방송 대기 중",
        runId: plan?.runId,
      };
    }
    if (phase === "countdown" || phase === "running") {
      return {
        lifecycle: "active",
        statusLabel: phase === "countdown" ? "경기 시작 중" : "경기 진행 중",
        runId: plan?.runId,
      };
    }
    if (phase === "result") {
      const settled = resultPresentation.phase === "settled";
      return {
        lifecycle: settled ? "result" : "settling",
        statusLabel: settled ? "경기 결과" : "결과 정리 중",
        runId: plan?.runId,
      };
    }
    if (phase === "error") {
      return { lifecycle: "failed", statusLabel: "복구 필요" };
    }
    return INITIAL_GAME_HOST_STATE;
  }, [phase, plan?.runId, resultPresentation.phase]);

  useEffect(() => {
    onHostStateChange?.(hostState);
    onActivityChange?.(isGameSwitchLocked(hostState.lifecycle));
  }, [hostState, onActivityChange, onHostStateChange]);

  useEffect(
    () => () => {
      cancelResultPresentationTimers();
      hostStateChangeRef.current?.(INITIAL_GAME_HOST_STATE);
      activityChangeRef.current?.(false);
    },
    [cancelResultPresentationTimers],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedHistory = readStoredRaceHistory(localStorage);
        if (!hasControlledRoster) {
          const preferences = readPlatformPreferences(localStorage);
          setInternalRosterText(
            sharedRosterSnapshotText(preferences.roster),
          );
        }
        if (storedHistory.length > 0) {
          historyRef.current = storedHistory;
          setHistory(storedHistory);
        }
      } catch {
        setToast("저장된 명단을 불러오지 못해 기본 명단을 사용합니다.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasControlledRoster]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const resetPlaybackTimestamp = () => {
      lastPlaybackTimestamp.current = null;
    };
    document.addEventListener(
      "visibilitychange",
      resetPlaybackTimestamp,
    );
    return () =>
      document.removeEventListener(
        "visibilitychange",
        resetPlaybackTimestamp,
      );
  }, []);

  const playTone = (frequency: number, duration = 0.11) => {
    if (!soundEnabled) return;
    try {
      const context =
        audioContext.current ??
        new AudioContext({ latencyHint: "interactive" });
      audioContext.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.13,
        context.currentTime + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + duration,
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      audioContext.current = null;
    }
  };

  useEffect(() => {
    if (phase !== "countdown") return;
    playTone(
      countdown === "GO" ? 760 : countdown === 1 ? 680 : 520,
      countdown === "GO" ? 0.14 : 0.1,
    );
    const timer = window.setTimeout(
      () => {
        const next = nextCountdownStep(countdown);
        if (next === null) {
          setFrameIndex(0);
          setRenderFrameIndex(0);
          playbackClock.current = createRacePlaybackClock();
          lastPlaybackTimestamp.current = null;
          setFinalOvertakeCue(null);
          setResultHoldRemainingMs(RESULT_HOLD_DURATION_MS);
          setPhase("running");
          return;
        }
        setCountdown(next);
      },
      countdownStepDuration(countdown, reducedMotion),
    );
    return () => window.clearTimeout(timer);
    // playTone intentionally reads the latest sound preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, phase, reducedMotion]);

  useEffect(() => {
    if (
      (phase !== "running" && phase !== "result") ||
      !plan
    ) {
      return;
    }
    let animationFrame = 0;
    const lastFrameIndex = plan.simulation.frames.length - 1;

    const animate = (now: number) => {
      if (document.visibilityState === "hidden") {
        lastPlaybackTimestamp.current = null;
        animationFrame = requestAnimationFrame(animate);
        return;
      }
      const previousTimestamp = lastPlaybackTimestamp.current;
      lastPlaybackTimestamp.current = now;
      const deltaMs =
        previousTimestamp === null
          ? 0
          : Math.min(
              MAX_PRESENTATION_DELTA_MS,
              Math.max(0, now - previousTimestamp),
            );
      const nextClock = advanceRacePlayback(
        playbackClock.current,
        deltaMs,
        finalOvertakeEvents,
        {
          frameRate: FRAME_RATE,
          slowMotionEnabled: !reducedMotion,
          resultGateFrameIndex:
            plan.simulation.resultGateFrameIndex,
        },
      );
      playbackClock.current = nextClock;
      const renderSourceFrame = Math.min(
        lastFrameIndex,
        nextClock.sourceFrame,
      );
      const nextFrame = Math.floor(renderSourceFrame);
      const activeOvertake =
        nextClock.activeEventIndex === null
          ? null
          : finalOvertakeEvents[nextClock.activeEventIndex];
      setFrameIndex(nextFrame);
      setRenderFrameIndex(
        activeOvertake && !reducedMotion
          ? renderSourceFrame
          : nextFrame,
      );
      setFinalOvertakeCue(
        activeOvertake
          ? {
              fromSlotId: activeOvertake.fromSlotId,
              toSlotId: activeOvertake.toSlotId,
              progress: Math.min(
                1,
                nextClock.effectElapsedMs /
                  FINAL_OVERTAKE_DURATION_MS,
              ),
              hasOvertaken:
                nextClock.sourceFrame >=
                activeOvertake.overtakeFrameIndex,
            }
          : null,
      );
      setResultHoldRemainingMs(
        nextClock.resultGateReached
          ? Math.max(
              0,
              RESULT_HOLD_DURATION_MS -
                nextClock.resultHoldElapsedMs,
            )
          : RESULT_HOLD_DURATION_MS,
      );
      const winnerThresholdReached =
        nextClock.sourceFrame >=
        plan.simulation.awardFrameIndex;
      if (
        phase === "running" &&
        nextClock.resultGateReached &&
        nextClock.resultHoldElapsedMs >=
          RESULT_HOLD_DURATION_MS &&
        winnerThresholdReached
      ) {
        cancelResultPresentationTimers();
        const projection = createShowdownResultProjection(
          plan,
          nextFrame,
          playbackEpoch,
        );
        const presentationToken: ResultPresentationToken = {
          runId: projection.runId,
          presentationId: projection.presentationId,
        };
        const currentPresentation = resultPresentationRef.current;

        if (
          currentPresentation.phase === "settled" &&
          currentPresentation.runId === projection.runId
        ) {
          const currentToken =
            resultPresentationToken(currentPresentation);
          if (currentToken) {
            dispatchResultPresentation({
              type: "presentation-restarted",
              token: currentToken,
              projection,
            });
          }
        } else {
          if (currentPresentation.runId !== projection.runId) {
            dispatchResultPresentation({
              type: "run-started",
              previousRunId: currentPresentation.runId,
              runId: projection.runId,
            });
          }
          dispatchResultPresentation({
            type: "result-committed",
            projection,
          });
        }

        dispatchResultPresentation({
          type: "evidence-complete",
          token: presentationToken,
        });
        resultHeroTimerRef.current = window.setTimeout(() => {
          resultHeroTimerRef.current = null;
          dispatchResultPresentation({
            type: "hero-complete",
            token: presentationToken,
          });
          resultDockTimerRef.current = window.setTimeout(() => {
            resultDockTimerRef.current = null;
            dispatchResultPresentation({
              type: "docking-complete",
              token: presentationToken,
            });
          }, RESULT_DOCK_DURATION_MS);
        }, RESULT_HERO_HOLD_MS);
        playTone(880, 0.42);
        setPhase("result");
        return;
      }
      if (
        phase === "result" &&
        nextClock.sourceFrame >= lastFrameIndex
      ) {
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
    // playTone intentionally reads the latest sound preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cancelResultPresentationTimers,
    dispatchResultPresentation,
    finalOvertakeEvents,
    phase,
    plan,
    playbackEpoch,
    reducedMotion,
  ]);

  useEffect(() => {
    if (phase !== "result" || !plan || isReplay) return;
    const currentFrame =
      plan.simulation.frames[
        Math.min(frameIndex, plan.simulation.frames.length - 1)
      ];
    const arrivedCount = currentFrame.finishedSlotIds.length;
    if (
      !shouldPersistRaceHistoryCheckpoint(
        resultHistoryCheckpoint.current,
        plan.runId,
        arrivedCount,
      )
    ) {
      return;
    }
    resultHistoryCheckpoint.current = {
      runId: plan.runId,
      arrivedCount,
    };
    const winnerNames = plan.winnerIds.map(
      (candidateId) =>
        plan.candidates.find((candidate) => candidate.id === candidateId)
          ?.name ?? "알 수 없음",
    );
    const rankedNames = currentFrame.finishedSlotIds.map(
      (slotId) =>
        plan.candidates.find(
          (candidate) =>
            candidate.id === plan.slotToCandidateId[slotId],
        )?.name ?? "알 수 없음",
    );
    const stored: StoredRaceResult = {
      runId: plan.runId,
      title: plan.title,
      raceSeed: plan.raceSeed,
      layoutSeed: plan.layoutSeed,
      createdAt: plan.createdAt,
      winnerNames,
      rankedNames,
    };
    const nextHistory = upsertRaceHistory(historyRef.current, stored);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    try {
      writeStoredRaceHistory(localStorage, nextHistory);
      if (!hasControlledRoster) {
        writeSharedRoster(localStorage, rosterText);
      }
    } catch {
      window.setTimeout(
        () => setToast("결과는 표시했지만 이 기기에 저장하지 못했어요."),
        0,
      );
    }
  }, [
    phase,
    plan,
    isReplay,
    frameIndex,
    rosterText,
    hasControlledRoster,
  ]);

  const handleOpenBroadcast = () => {
    if (
      !validation.isValid ||
      activeCandidates.length < 2 ||
      phase !== "ready"
    ) {
      return;
    }
    const currentGeneration = generationKey.current + 1;
    generationKey.current = currentGeneration;
    cancelResultPresentationTimers();
    setPhase("generating");
    setErrorMessage("");
    setIsReplay(false);
    playbackClock.current = createRacePlaybackClock();
    lastPlaybackTimestamp.current = null;
    setFinalOvertakeCue(null);
    setResultHoldRemainingMs(RESULT_HOLD_DURATION_MS);
    window.setTimeout(() => {
      try {
        const raceSeed = createSeed("race");
        const slotToCandidateId = createRaceSlotAssignment(
          activeCandidates,
          raceSeed,
        );
        const simulation = simulateRace(
          slotToCandidateId,
          raceSeed,
          layoutSeed,
          effectiveWinnerCount,
        );
        if (generationKey.current !== currentGeneration) return;
        const nextPlan = buildRacePlan(
          title,
          activeCandidates,
          simulation,
          { raceSeed, layoutSeed },
          effectiveWinnerCount,
        );
        const previousRunId = resultPresentationRef.current.runId;
        dispatchResultPresentation({
          type: "run-started",
          previousRunId,
          runId: `showdown:${nextPlan.runId}`,
        });
        setPlan(nextPlan);
        setFrameIndex(0);
        setRenderFrameIndex(0);
        setPhase("waiting");
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "경기장을 준비하지 못했습니다.",
        );
        setPhase("error");
      }
    }, 60);
  };

  const handleRecoverFromError = () => {
    if (phase !== "error") return;
    generationKey.current += 1;
    setErrorMessage("");
    setPhase("ready");
  };

  const handleRaceStart = async () => {
    if (!plan || phase !== "waiting" || raceStartPendingRef.current) return;
    const startRequest = raceStartRequestRef.current + 1;
    const startGeneration = generationKey.current;
    raceStartRequestRef.current = startRequest;
    raceStartPendingRef.current = true;
    setRaceStartPending(true);
    try {
      let audioReady = true;
      if (audioContext.current) {
        audioReady = await Promise.race([
          audioContext.current.resume().then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((resolve) => {
            window.setTimeout(
              () => resolve(false),
              AUDIO_RESUME_TIMEOUT_MS,
            );
          }),
        ]);
      }
      if (
        startRequest !== raceStartRequestRef.current
        || startGeneration !== generationKey.current
      ) return;
      if (!audioReady) setSoundEnabled(false);
      setCountdown(3);
      setFrameIndex(0);
      setRenderFrameIndex(0);
      playbackClock.current = createRacePlaybackClock();
      lastPlaybackTimestamp.current = null;
      setFinalOvertakeCue(null);
      setResultHoldRemainingMs(RESULT_HOLD_DURATION_MS);
      setPlaybackEpoch((value) => value + 1);
      setPhase("countdown");
    } finally {
      if (startRequest === raceStartRequestRef.current) {
        raceStartPendingRef.current = false;
        setRaceStartPending(false);
      }
    }
  };

  const handleRegenerateLayout = () => {
    setLayoutSeed(createSeed("layout"));
    setToast("출발 배치를 새로 만들었어요.");
  };

  const handleReplay = () => {
    if (!plan) return;
    cancelResultPresentationTimers();
    setIsReplay(true);
    setFrameIndex(0);
    setRenderFrameIndex(0);
    playbackClock.current = createRacePlaybackClock();
    lastPlaybackTimestamp.current = null;
    setFinalOvertakeCue(null);
    setResultHoldRemainingMs(RESULT_HOLD_DURATION_MS);
    setPlaybackEpoch((value) => value + 1);
    setCountdown(3);
    setPhase("countdown");
  };

  const handleNewRace = () => {
    generationKey.current += 1;
    raceStartRequestRef.current += 1;
    raceStartPendingRef.current = false;
    setRaceStartPending(false);
    cancelResultPresentationTimers();
    const previousRunId = resultPresentationRef.current.runId;
    dispatchResultPresentation({
      type: "run-started",
      previousRunId,
      runId: `showdown:idle:${generationKey.current}`,
    });
    setPlan(null);
    setFrameIndex(0);
    setRenderFrameIndex(0);
    setPhase("ready");
    setIsReplay(false);
    playbackClock.current = createRacePlaybackClock();
    lastPlaybackTimestamp.current = null;
    setFinalOvertakeCue(null);
    setResultHoldRemainingMs(RESULT_HOLD_DURATION_MS);
    setLayoutSeed(createSeed("layout"));
  };

  if (
    plan &&
    (phase === "waiting" ||
      phase === "countdown" ||
      phase === "running" ||
      phase === "result")
  ) {
    const currentFrame =
      plan.simulation.frames[
        Math.min(frameIndex, plan.simulation.frames.length - 1)
      ];
    const arrivedRows = currentFrame.finishedSlotIds.flatMap((slotId) => {
      const candidate = candidateForSlot(plan, slotId);
      return candidate ? [{ slotId, candidate }] : [];
    });
    const rankingRows = currentFrame.rankedSlotIds.flatMap((slotId) => {
      const candidate = candidateForSlot(plan, slotId);
      return candidate ? [{ slotId, candidate }] : [];
    });
    const resultRows = Array.from(
      { length: plan.candidates.length },
      (_, index) => arrivedRows[index],
    );
    const winnerRows = arrivedRows.slice(0, plan.winnerCount);
    const finishedSlotIds = new Set(currentFrame.finishedSlotIds);
    const raceElapsedMs = resolveRaceElapsedMs(
      renderFrameIndex,
      FRAME_RATE,
    );
    const raceElapsedTime = formatFinishTime(raceElapsedMs);
    const confirmedWinnerCount = Math.min(
      currentFrame.finishedSlotIds.length,
      plan.winnerCount,
    );
    const podiumFinishCount = Math.min(
      MINIMUM_RESULT_FINISHERS,
      plan.candidates.length,
    );
    const podiumReached =
      currentFrame.finishedSlotIds.length >= podiumFinishCount;
    const resultGateReached =
      currentFrame.finishedSlotIds.length >=
      plan.simulation.resultGateCount;
    const resultHoldSeconds = Math.max(
      0,
      Math.ceil(resultHoldRemainingMs / 1000),
    );
    const isFinishing =
      phase === "running" &&
      frameIndex >= plan.simulation.firstFinishFrameIndex;
    const activeRankedSlotIds = currentFrame.rankedSlotIds.filter(
      (slotId) => !currentFrame.finishedSlotIds.includes(slotId),
    );
    const activeLeaderSlotId = activeRankedSlotIds[0];
    const presentationFrame =
      currentFrame.finishedSlotIds.length <
        plan.simulation.resultGateCount &&
      activeRankedSlotIds.length > 0
        ? {
            ...currentFrame,
            rankedSlotIds: activeRankedSlotIds,
            finishedSlotIds: [],
          }
        : currentFrame;
    const courseProgress = resolveCourseProgress(presentationFrame);
    const closeRace = isCloseRace(presentationFrame);
    const finalApproach = isFinalApproach(presentationFrame);
    const latestLeadChange = stableLeadChanges
      .filter((change) => change.frameIndex <= frameIndex)
      .at(-1);
    const leadChangeActive =
      latestLeadChange !== undefined &&
      frameIndex <= latestLeadChange.frameIndex + FRAME_RATE;
    const leadChangeCandidate = leadChangeActive
      ? candidateForSlot(plan, latestLeadChange.toSlotId)
      : undefined;
    const finalOvertakeCandidate = finalOvertakeCue
      ? candidateForSlot(plan, finalOvertakeCue.toSlotId)
      : undefined;
    const leaderPose = currentFrame.poses.find(
      (pose) => pose.slotId === presentationFrame.rankedSlotIds[0],
    );
    const runnerUpPose = currentFrame.poses.find(
      (pose) => pose.slotId === presentationFrame.rankedSlotIds[1],
    );
    const leaderGap =
      leaderPose && runnerUpPose
        ? Math.max(0, Math.round(leaderPose.y - runnerUpPose.y))
        : null;
    const arrivalDelta =
      currentFrame.finishedSlotIds.length >= 2
        ? resolveArrivalDelta(
            plan.simulation.frames.slice(0, frameIndex + 1),
          )
        : null;
    const physicalMoment = finalOvertakeCandidate
      ? finalOvertakeCue?.hasOvertaken
        ? `${shortName(finalOvertakeCandidate.name, 7)} FINAL OVERTAKE`
        : `${shortName(finalOvertakeCandidate.name, 7)} 추월 임박`
      : finalApproach
        ? "FINAL APPROACH"
        : leadChangeCandidate
        ? `${shortName(leadChangeCandidate.name, 7)} 선두 교체`
        : closeRace
          ? "초접전"
          : courseProgress?.section.label ?? "경기 진행 중";
    const showResultHero =
      phase === "result" &&
      (resultPresentation.phase === "hero" ||
        resultPresentation.phase === "docking");
    const resultPresentationSettled =
      phase === "result" &&
      resultPresentation.phase === "settled";
    const latestArrivedRow = arrivedRows[arrivedRows.length - 1];
    const latestArrivalRecord = latestArrivedRow
      ? finishRecords.get(latestArrivedRow.slotId)
      : undefined;
    const resultArrivalAnnouncement =
      phase === "result" && latestArrivedRow
        ? `${arrivedRows.length}위 ${latestArrivedRow.candidate.name}${
            arrivedRows.length <= plan.winnerCount ? ", 당첨" : ""
          }, 골인 ${
            latestArrivalRecord
              ? formatFinishTime(latestArrivalRecord.elapsedMs)
              : ""
          }`
        : "";

    return (
      <main
        className={`showdown-game race-screen${
          phase === "result" ? " is-results" : ""
        }${
          resultPresentation.phase === "docking"
            ? " is-result-docking"
            : ""
        }${
          embedded ? " is-embedded" : ""
        }`}
      >
        <header className="race-header">
          <div>
            <p className="eyebrow">exlab · SHOWDOWN</p>
            <h1>{plan.title}</h1>
          </div>
          <div className="race-header-actions">
            <MapThemeToggle
              mode={mapMode}
              onChange={setMapMode}
              compact
            />
            <div className="race-status" aria-label="경기 진행 상태">
              <span>
                {phase === "result"
                  ? "결과 공개"
                  : phase === "waiting"
                  ? "방송 대기"
                  : phase === "countdown"
                    ? "출발 준비"
                    : resultGateReached
                      ? "결과 발표 대기"
                      : confirmedWinnerCount >= plan.winnerCount
                        ? `${podiumFinishCount}위 도착 대기`
                      : physicalMoment}
              </span>
              <strong>
                {phase === "result"
                  ? `도착 ${arrivedRows.length}/${plan.candidates.length} · 미도착 순위는 공란`
                  : phase === "waiting"
                  ? `${plan.candidates.length}명 · ${plan.winnerCount}명 당첨`
                  : resultGateReached
                    ? `${plan.simulation.resultGateCount}위 도착 · 결과까지 ${resultHoldSeconds}초`
                    : confirmedWinnerCount > 0
                    ? `${confirmedWinnerCount} / ${plan.winnerCount} 당첨 확정`
                    : `${Math.round((courseProgress?.overall ?? 0) * 100)}% · 선두 간격 ${
                        leaderGap ?? "—"
                      }px`}
              </strong>
            </div>
          </div>
        </header>
        <div className="race-layout">
          <section className="race-stage">
            <RaceCanvas
              plan={plan}
              frameIndex={renderFrameIndex}
              reducedMotion={reducedMotion}
              mapMode={mapMode}
              wallColor={wallColor}
              playbackEpoch={playbackEpoch}
              finalOvertake={finalOvertakeCue}
            />
            {finalOvertakeCue && finalOvertakeCandidate && (
              <div className="final-overtake-cue" aria-hidden="true">
                <span>
                  {finalOvertakeCue.hasOvertaken
                    ? "FINAL OVERTAKE"
                    : "FINAL DUEL"}
                </span>
                <strong>
                  {shortName(finalOvertakeCandidate.name, 9)}{" "}
                  {finalOvertakeCue.hasOvertaken
                    ? "선두 교체"
                    : "추월 임박"}
                </strong>
              </div>
            )}
            {phase === "waiting" && (
              <div
                className="broadcast-waiting"
                role="dialog"
                aria-labelledby="broadcast-waiting-title"
              >
                <p className="eyebrow">BROADCAST READY</p>
                <h2 id="broadcast-waiting-title">
                  방송 화면이 준비됐습니다.
                </h2>
                <span>
                  시작 버튼을 누르기 전에는 카운트다운과 경기가 진행되지
                  않습니다.
                </span>
                <div>
                  <button
                    className="secondary-button"
                    onClick={handleNewRace}
                    disabled={raceStartPending}
                  >
                    설정으로 돌아가기
                  </button>
                  <button
                    className="primary-button"
                    onClick={handleRaceStart}
                    disabled={raceStartPending}
                    aria-busy={raceStartPending || undefined}
                    autoFocus
                  >
                    {raceStartPending ? "경기 시작 준비 중…" : "경기 시작"}
                  </button>
                </div>
              </div>
            )}
            {phase === "countdown" && (
              <div className="countdown" aria-live="assertive">
                <span>{countdown}</span>
                <p>
                  {countdown === "GO"
                    ? "경기 시작"
                    : "물리 조건을 확정했습니다"}
                </p>
              </div>
            )}
            {isFinishing && (
              <div className="finish-banner" aria-live="assertive">
                {resultGateReached
                  ? `${plan.simulation.resultGateCount}위 도착 · 결과 발표까지 ${resultHoldSeconds}초`
                  : podiumReached &&
                      confirmedWinnerCount < plan.winnerCount
                    ? `${podiumFinishCount}위 도착 · ${
                        plan.winnerCount - confirmedWinnerCount
                      }명 당첨 확정 대기`
                    : confirmedWinnerCount >= plan.winnerCount
                      ? `${plan.winnerCount}명 당첨 확정 · ${podiumFinishCount}위 도착 대기`
                      : photoFinish && arrivalDelta
                  ? `PHOTO FINISH · ${arrivalDelta.deltaSeconds.toFixed(2)}초 차`
                        : `${confirmedWinnerCount}번째 당첨 확정 · ${
                            plan.winnerCount - confirmedWinnerCount
                          }명 남음`}
                </div>
              )}
            {showResultHero && winnerRows[0] && (
              <section
                className={`showdown-result-hero${
                  resultPresentation.phase === "docking"
                    ? " is-docking"
                    : ""
                }`}
                aria-labelledby="showdown-result-winner"
                aria-live="polite"
                aria-atomic="true"
                style={participantStyle(winnerRows[0].candidate)}
              >
                <div className="showdown-result-marble" aria-hidden="true">
                  {winnerRows[0].candidate.number}
                </div>
                <div>
                  <p>SHOWDOWN WINNER</p>
                  <h2 id="showdown-result-winner">
                    {shortName(winnerRows[0].candidate.name, 12)}
                  </h2>
                  <time
                    className="showdown-result-time"
                    dateTime={
                      finishRecords.get(winnerRows[0].slotId)
                        ? `PT${(
                            finishRecords.get(winnerRows[0].slotId)!
                              .elapsedMs / 1000
                          ).toFixed(3)}S`
                        : undefined
                    }
                  >
                    골인{" "}
                    {finishRecords.get(winnerRows[0].slotId)
                      ? formatFinishTime(
                          finishRecords.get(winnerRows[0].slotId)!.elapsedMs,
                        )
                      : "—"}
                  </time>
                  {winnerRows.length > 1 && (
                    <small>
                      외 {winnerRows.length - 1}명 당첨 · 결과 순위에서 확인
                    </small>
                  )}
                </div>
              </section>
            )}
          </section>
          <aside
            className={`leaderboard${
              phase === "result" ? " is-results" : ""
            }`}
            aria-label={
              phase === "result" ? "실시간 도착 결과" : "실시간 전체 순위"
            }
          >
            <div className="leaderboard-heading">
              <div className="leaderboard-title">
                <span>
                  {phase === "result" ? "ARRIVAL RESULTS" : "LIVE ORDER"}
                </span>
                <time
                  className="race-clock"
                  dateTime={`PT${(raceElapsedMs / 1000).toFixed(3)}S`}
                  aria-label={`현재 경기 시간 ${raceElapsedTime}`}
                >
                  <small aria-hidden="true">TIME</small>
                  <span aria-hidden="true">{raceElapsedTime}</span>
                </time>
              </div>
              <button
                className="icon-button"
                onClick={() => setSoundEnabled((value) => !value)}
                aria-label={soundEnabled ? "음소거" : "소리 켜기"}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? "소리 켜짐" : "음소거"}
              </button>
            </div>
            <LiveLeaderboard
              key={`${plan.runId}:${playbackEpoch}`}
              rows={phase === "result" ? resultRows : rankingRows}
              finishedSlotIds={finishedSlotIds}
              activeLeaderSlotId={activeLeaderSlotId}
              finishRecords={finishRecords}
              reducedMotion={reducedMotion}
              resultMode={phase === "result"}
              winnerCount={plan.winnerCount}
            />
            <p className="camera-note">
              {phase === "result"
                ? arrivedRows.length === plan.candidates.length
                  ? "전원 도착"
                  : `${plan.candidates.length - arrivedRows.length}명 경기 중 · 순위 실시간 반영`
                : `${courseProgress?.section.label ?? "START"} · ${
                    closeRace
                      ? "선두권 초접전"
                      : `선두 간격 ${leaderGap ?? "—"}px`
                  }`}
            </p>
            {resultPresentationSettled && (
              <>
                <div className="result-actions">
                  <button
                    className="secondary-button"
                    onClick={handleReplay}
                  >
                    같은 경기 다시 보기
                  </button>
                  <button className="primary-button" onClick={handleNewRace}>
                    새 경기 준비
                  </button>
                </div>
                <details className="result-run-details">
                  <summary>실행 정보</summary>
                  <dl>
                    <div>
                      <dt>경기 시드</dt>
                      <dd>{plan.raceSeed}</dd>
                    </div>
                    <div>
                      <dt>출발 배치</dt>
                      <dd>
                        중심 {plan.simulation.layoutShift}px · 슬롯 지터 ±
                        {START_MAX_HORIZONTAL_JITTER}px
                      </dd>
                    </div>
                    <div>
                      <dt>물리 변형</dt>
                      <dd>{plan.simulation.dynamics.fingerprint}</dd>
                    </div>
                    <div>
                      <dt>추격 보정</dt>
                      <dd>
                        거리·순위 기반 · {CHASE_ASSIST_TARGET_GAP}px 목표
                      </dd>
                    </div>
                    <div>
                      <dt>결과 전환</dt>
                      <dd>최소 {podiumFinishCount}위 표시 후 3초</dd>
                    </div>
                    <div>
                      <dt>물리 완주</dt>
                      <dd>
                        {arrivedRows.length}/{plan.candidates.length}
                        {frameIndex >=
                          plan.simulation.frames.length - 1 &&
                        plan.simulation.timedOut
                          ? " · 미도착 순위 공란 유지"
                          : ""}
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            )}
            <p className="visually-hidden" aria-live="polite">
              {resultArrivalAnnouncement ||
              (finalOvertakeCandidate &&
              finalOvertakeCue?.hasOvertaken
                ? `${finalOvertakeCandidate.name} 마지막 구간 선두 교체`
                : leadChangeCandidate
                  ? `${leadChangeCandidate.name} 선두 교체`
                  : "")}
            </p>
          </aside>
        </div>
      </main>
    );
  }

  if (embedded) {
    const requestSharedRosterEdit =
      onRequestRosterEdit ?? (() => setIsEditingRoster(true));

    return (
      <main className="showdown-game preparation-screen is-embedded">
        <SetupWorkspace
          className="showdown-setup-workspace"
          eyebrow="SHOWDOWN"
          title="경기 준비"
          sharedSetup={(
            <SharedSetupSummary
              rosterCount={validation.candidates.length}
              allowDuplicateNames={allowDuplicateNames}
              onRequestRosterEdit={requestSharedRosterEdit}
              disabled={phase !== "ready"}
            />
          )}
          essentialSettings={(
            <div className="showdown-setup-fields">
              <SetupOptionGroup
                kind="text"
                label="표시"
              >
                <SetupOptionRow
                  label="경기 제목"
                  htmlFor="race-title"
                >
                  <input
                    id="race-title"
                    className="title-input"
                    value={title}
                    maxLength={50}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </SetupOptionRow>
              </SetupOptionGroup>

              <SetupOptionGroup
                kind="choice"
                label="경기 조"
              >
                <SetupOptionRow label="준비할 조">
                  <SetupChoiceControl
                    variant="scroll-strip"
                    ariaLabel="경기 조 선택"
                    className="group-tabs"
                  >
                    {groups.map((group) => (
                      <button
                        type="button"
                        key={group.id}
                        className={
                          group.index === selectedGroupIndex
                            ? "is-active"
                            : ""
                        }
                        onClick={() => setActiveGroupIndex(group.index)}
                        aria-pressed={group.index === selectedGroupIndex}
                      >
                        {group.index + 1}조
                        <small>{group.candidates.length}명</small>
                      </button>
                    ))}
                  </SetupChoiceControl>
                </SetupOptionRow>
              </SetupOptionGroup>

              <SetupOptionGroup
                kind="number"
                label="조 편성"
                description={`전체 ${validation.candidates.length}명 · 조당 최대 ${MAX_GROUP_SIZE}명`}
              >
                <SetupOptionRow
                  label="조 개수"
                >
                  <button
                    type="button"
                    className="setup-stepper-button"
                    aria-label="조 개수 줄이기"
                    disabled={
                      validation.candidates.length < 2
                      || effectiveGroupCount <= minimumGroups
                    }
                    onClick={() => {
                      setGroupCount((current) =>
                        Math.max(minimumGroups, current - 1),
                      );
                      setActiveGroupIndex(0);
                    }}
                  >
                    −
                  </button>
                  <span className="setup-stepper-value">
                    <input
                      type="number"
                      min={minimumGroups}
                      max={maximumGroups}
                      value={effectiveGroupCount}
                      disabled={validation.candidates.length < 2}
                      aria-label="조 개수"
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        const nextCount = Number.isFinite(parsed)
                          ? Math.min(
                              maximumGroups,
                              Math.max(minimumGroups, Math.floor(parsed)),
                            )
                          : minimumGroups;
                        setGroupCount(nextCount);
                        setActiveGroupIndex(0);
                      }}
                    />
                    <span aria-hidden="true">조</span>
                  </span>
                  <button
                    type="button"
                    className="setup-stepper-button"
                    aria-label="조 개수 늘리기"
                    disabled={
                      validation.candidates.length < 2
                      || effectiveGroupCount >= maximumGroups
                    }
                    onClick={() => {
                      setGroupCount((current) =>
                        Math.min(maximumGroups, current + 1),
                      );
                      setActiveGroupIndex(0);
                    }}
                  >
                    +
                  </button>
                </SetupOptionRow>
              </SetupOptionGroup>

              <div className="roster-heading">
                <div>
                  <span>{selectedGroupIndex + 1}조 참가자</span>
                  <strong>
                    {activeCandidates.length} / {MAX_GROUP_SIZE}
                  </strong>
                </div>
              </div>
              <ol className="roster-grid">
                {activeCandidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    style={participantStyle(candidate)}
                  >
                    <strong>{candidate.number}</strong>
                    <i />
                    <span title={candidate.name}>
                      {shortName(candidate.name)}
                    </span>
                  </li>
                ))}
                {validation.candidates.length === 0 && (
                  <li className="empty-roster">
                    공통 명단에서 참가자를 추가하세요.
                  </li>
                )}
              </ol>
            </div>
          )}
          advancedSettings={(
            <div className="showdown-advanced-settings">
              <SetupOptionGroup
                kind="number"
                label="결과 설정"
              >
                <SetupOptionRow
                  label="당첨 인원"
                  description="이 인원이 결승선을 통과할 때까지 경기"
                >
                  <button
                    type="button"
                    className="setup-stepper-button"
                    aria-label="당첨 인원 줄이기"
                    disabled={
                      phase === "generating"
                      || effectiveWinnerCount <= 1
                    }
                    onClick={() =>
                      setWinnerCount((current) =>
                        Math.max(1, current - 1),
                      )
                    }
                  >
                    −
                  </button>
                  <output
                    className="setup-stepper-value"
                    aria-live="polite"
                  >
                    {effectiveWinnerCount}명
                  </output>
                  <button
                    type="button"
                    className="setup-stepper-button"
                    aria-label="당첨 인원 늘리기"
                    disabled={
                      phase === "generating"
                      || effectiveWinnerCount >=
                        Math.max(1, activeCandidates.length)
                    }
                    onClick={() =>
                      setWinnerCount((current) =>
                        Math.min(
                          Math.max(1, activeCandidates.length),
                          current + 1,
                        ),
                      )
                    }
                  >
                    +
                  </button>
                </SetupOptionRow>
              </SetupOptionGroup>

              <SetupOptionGroup
                kind="toggle"
                label="재생 옵션"
              >
                <SetupOptionRow
                  label="효과음"
                  description="카운트다운과 결승 신호만 재생"
                >
                  <button
                    type="button"
                    className="toggle-button"
                    onClick={() => setSoundEnabled((value) => !value)}
                    aria-pressed={soundEnabled}
                  >
                    {soundEnabled ? "켜짐" : "꺼짐"}
                  </button>
                </SetupOptionRow>
              </SetupOptionGroup>
              {history.length > 0 && (
                <details className="history-panel embedded-history-panel">
                  <summary>최근 경기 {history.length}개</summary>
                  <ol>
                    {history.slice(0, 5).map((item) => (
                      <li key={item.runId}>
                        <span>
                          {new Date(item.createdAt).toLocaleDateString("ko-KR")}
                        </span>
                        <strong>
                          {(item.winnerNames
                            ?? [item.winnerName ?? "알 수 없음"]
                          ).join(", ")}
                        </strong>
                        <small>{item.rankedNames.length}명 경기</small>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
          advancedSettingsLabel="경기 방식"
          advancedSettingsDescription="당첨 인원과 효과음을 설정합니다."
          previewHeader={(
            <div className="showdown-preview-heading">
              <span>10초 자동 미리보기</span>
              <strong>Showdown</strong>
            </div>
          )}
          previewTools={(
            <MapThemeToggle mode={mapMode} onChange={setMapMode} />
          )}
          previewStage={(
            <LiveRacePreview
              active={active}
              candidates={activeCandidates}
              layoutSeed={layoutSeed}
              reducedMotion={reducedMotion}
              mapMode={mapMode}
              wallColor={wallColor}
            />
          )}
          previewFooter={(
            <div className="showdown-preview-footer">
              <div>
                <span>출발 방식</span>
                <strong>불규칙 간격 · 동일 높이 동시 개방</strong>
              </div>
              <details className="course-legend-details">
                <summary>장애물 범례</summary>
                <CourseLegend />
              </details>
            </div>
          )}
          readinessModel={{
            tone:
              phase === "error"
                ? "recoverable"
                : phase === "generating"
                ? "busy"
                : validation.isValid
                  ? "ready"
                  : "blocked",
            label:
              phase === "error"
                ? "경기장 준비 실패"
                : validation.isValid
                  ? "경기 준비 완료"
                  : "명단 확인 필요",
            detail:
              phase === "error"
                ? errorMessage || "준비 화면으로 돌아가 다시 시도해 주세요."
                : validation.isValid
                  ? `${activeCandidates.length}명 출발 · ${effectiveWinnerCount}명 당첨`
                  : validation.message,
          }}
          primaryActionModel={{
            label:
              phase === "error"
                ? "준비로 돌아가기"
                : phase === "generating"
                ? "방송 화면 준비 중…"
                : "방송 화면 열기",
            disabled:
              phase === "generating"
              || (phase !== "error" && !validation.isValid),
            busy: phase === "generating",
            onPress:
              phase === "error"
                ? handleRecoverFromError
                : handleOpenBroadcast,
          }}
          busy={phase === "generating"}
        />

        {phase === "error" && (
          <div className="error-banner" role="alert">
            <div>
              <strong>경기장을 준비하지 못했어요.</strong>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      className={`showdown-game preparation-screen${embedded ? " is-embedded" : ""}`}
    >
      {!embedded && (
        <header className="product-header">
          <span className="brand" aria-label="exlab">
            <span aria-hidden="true">●</span>
            exlab
          </span>
          <div className="product-header-actions">
            <span className="prototype-badge">SHOWDOWN · VERSION 1.3.35</span>
          </div>
        </header>
      )}

      <div className="preparation-grid">
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SHOWDOWN SETUP</p>
              <h2 id="setup-title">경기 준비</h2>
            </div>
            <span
              className={
                validation.isValid ? "status-ready" : "status-warning"
              }
            >
              {validation.message}
            </span>
          </div>

          <label className="field-label" htmlFor="race-title">
            경기 제목
          </label>
          <input
            id="race-title"
            className="title-input"
            value={title}
            maxLength={50}
            onChange={(event) => setTitle(event.target.value)}
          />

          <section className="group-planner" aria-labelledby="group-plan-title">
            <div className="group-planner-heading">
              <div>
                <span id="group-plan-title">조 편성</span>
                <strong>전체 {validation.candidates.length}명</strong>
              </div>
              <label htmlFor="group-count">
                조 개수
                <select
                  id="group-count"
                  value={effectiveGroupCount}
                  onChange={(event) => {
                    setGroupCount(Number(event.target.value));
                    setActiveGroupIndex(0);
                  }}
                  disabled={validation.candidates.length < 2}
                >
                  {Array.from(
                    { length: maximumGroups - minimumGroups + 1 },
                    (_, index) => minimumGroups + index,
                  ).map((count) => (
                    <option value={count} key={count}>
                      {count}조
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="group-tabs" aria-label="경기 조 선택">
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={
                    group.index === selectedGroupIndex ? "is-active" : ""
                  }
                  onClick={() => setActiveGroupIndex(group.index)}
                  aria-pressed={group.index === selectedGroupIndex}
                >
                  {group.index + 1}조
                  <small>{group.candidates.length}명</small>
                </button>
              ))}
            </div>
            <p>
              조당 최대 {MAX_GROUP_SIZE}명 · 현재 {selectedGroupIndex + 1}조를
              방송 화면에 준비합니다.
            </p>
          </section>

          <div className="roster-heading">
            <div>
              <span>{selectedGroupIndex + 1}조 참가자</span>
              <strong>
                {activeCandidates.length} / {MAX_GROUP_SIZE}
              </strong>
            </div>
            <button
              className="text-button"
              onClick={() => setIsEditingRoster((value) => !value)}
              aria-expanded={isEditingRoster}
            >
              {isEditingRoster ? "편집 닫기" : "명단 편집"}
            </button>
          </div>

          {isEditingRoster ? (
            <div className="roster-editor">
              <label htmlFor="roster-input">
                한 줄에 한 명씩 입력하세요. 쉼표도 사용할 수 있습니다.
              </label>
              <textarea
                id="roster-input"
                value={rosterText}
                onChange={(event) => {
                  const nextRosterText = event.target.value;
                  if (!hasControlledRoster) {
                    setInternalRosterText(nextRosterText);
                  }
                  onRosterTextChange?.(nextRosterText);
                }}
                aria-invalid={!validation.isValid}
                aria-describedby="roster-help"
              />
              <p
                id="roster-help"
                className={
                  validation.overflowNames.length ||
                  (validation.duplicateNames.length && !allowDuplicateNames)
                    ? "error-text"
                    : "help-text"
                }
              >
                {validation.overflowNames.length
                  ? `초과 항목: ${validation.overflowNames.join(", ")}`
                  : validation.duplicateNames.length && !allowDuplicateNames
                    ? `동일 이름: ${validation.duplicateNames.join(", ")}`
                    : allowDuplicateNames
                      ? "동명이인은 서로 다른 번호로 참가합니다."
                      : "동일 이름은 기본적으로 허용하지 않습니다."}
              </p>
            </div>
          ) : (
            <ol className="roster-grid">
              {activeCandidates.map((candidate) => (
                <li key={candidate.id} style={participantStyle(candidate)}>
                  <strong>{candidate.number}</strong>
                  <i />
                  <span title={candidate.name}>
                    {shortName(candidate.name)}
                  </span>
                </li>
              ))}
              {validation.candidates.length === 0 && (
                <li className="empty-roster">명단 편집에서 참가자를 추가하세요.</li>
              )}
            </ol>
          )}

          <details className="advanced-settings">
            <summary>경기 방식과 세부 설정</summary>
            <div className="setting-row">
              <span>
                <strong>동일 이름</strong>
                <small>기본은 미허용 · 켜면 같은 이름도 별도 번호로 참가</small>
              </span>
              <button
                className="toggle-button"
                onClick={() => {
                  const nextValue = !allowDuplicateNames;
                  if (controlledAllowDuplicateNames === undefined) {
                    setInternalAllowDuplicateNames(nextValue);
                  }
                  onAllowDuplicateNamesChange?.(nextValue);
                }}
                aria-pressed={allowDuplicateNames}
              >
                {allowDuplicateNames ? "허용" : "미허용"}
              </button>
            </div>
            <div className="setting-row">
              <span>
                <strong>당첨 인원</strong>
                <small>이 인원이 결승선을 통과할 때까지 경기를 유지</small>
              </span>
              <label className="select-setting" htmlFor="winner-count">
                <select
                  id="winner-count"
                  value={effectiveWinnerCount}
                  onChange={(event) =>
                    setWinnerCount(Number(event.target.value))
                  }
                >
                  {Array.from(
                    { length: Math.max(1, activeCandidates.length) },
                    (_, index) => index + 1,
                  ).map((count) => (
                    <option value={count} key={count}>
                      {count}명
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="setting-row">
              <span>
                <strong>효과음</strong>
                <small>카운트다운과 결승 신호만 재생</small>
              </span>
              <button
                className="toggle-button"
                onClick={() => setSoundEnabled((value) => !value)}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? "켜짐" : "꺼짐"}
              </button>
            </div>
          </details>
        </section>

        <section className="venue-panel" aria-labelledby="venue-title">
          <div className="venue-copy">
            <div className="venue-copy-heading">
              <h2 id="venue-title">Showdown</h2>
              <MapThemeToggle mode={mapMode} onChange={setMapMode} />
            </div>
            <details className="course-legend-details">
              <summary>장애물 범례</summary>
              <CourseLegend />
            </details>
          </div>
          <LiveRacePreview
            active={active}
            candidates={activeCandidates}
            layoutSeed={layoutSeed}
            reducedMotion={reducedMotion}
            mapMode={mapMode}
            wallColor={wallColor}
          />
          <div className="venue-meta">
            <div>
              <span>출발 방식</span>
              <strong>불규칙 간격 · 동일 높이 동시 개방</strong>
            </div>
            <button className="secondary-button" onClick={handleRegenerateLayout}>
              자동 배치 다시 만들기
            </button>
          </div>
        </section>
      </div>

      <footer className="start-bar">
        <div>
          <span>{validation.isValid ? "경기 준비 완료" : "명단 확인 필요"}</span>
          <strong>
            {validation.isValid
              ? `${activeCandidates.length}명이 ${selectedGroupIndex + 1}조에서 출발하고 ${effectiveWinnerCount}명이 당첨됩니다.`
              : validation.message}
          </strong>
        </div>
        <button
          className="primary-button"
          disabled={!validation.isValid || phase === "generating"}
          onClick={handleOpenBroadcast}
        >
          {phase === "generating" ? "방송 화면 준비 중…" : "방송 화면 열기"}
        </button>
      </footer>

      {history.length > 0 && (
        <details className="history-panel">
          <summary>최근 경기 {history.length}개</summary>
          <ol>
            {history.slice(0, 5).map((item) => (
              <li key={item.runId}>
                <span>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</span>
                <strong>
                  {(item.winnerNames ?? [item.winnerName ?? "알 수 없음"]).join(
                    ", ",
                  )}
                </strong>
                <small>{item.rankedNames.length}명 경기</small>
              </li>
            ))}
          </ol>
        </details>
      )}

      {phase === "error" && (
        <div className="error-banner" role="alert">
          <div>
            <strong>경기장을 준비하지 못했어요.</strong>
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setPhase("ready")}>준비로 돌아가기</button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
