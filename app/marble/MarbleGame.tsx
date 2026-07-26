"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  buildRacePlan,
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
  COURSE_BUMPERS,
  COURSE_CURVES,
  COURSE_PINS,
  COURSE_RECTS,
  COURSE_SECTIONS,
  FINISH_LINE_WIDTH,
  FINISH_LINE_X,
  FINISH_Y,
  ROTATING_BARS,
  WORLD_HEIGHT,
} from "./course";
import {
  FRAME_RATE,
  RESULT_REVEAL_DELAY_FRAMES,
  simulateRace,
} from "./simulation";
import type {
  Candidate,
  RacePlan,
  ResultMode,
  StoredRaceResult,
} from "./types";
import { RaceCanvas } from "./RaceCanvas";

const DEFAULT_ROSTER = [
  "아모",
  "유레카",
  "세나",
  "코코",
  "망징이",
  "로티",
  "토리",
  "마루",
].join("\n");

const ROSTER_KEY = "marble-game:roster";
const HISTORY_KEY = "marble-game:history";

type Phase =
  | "ready"
  | "generating"
  | "waiting"
  | "countdown"
  | "running"
  | "result"
  | "error";

function candidateForSlot(
  plan: RacePlan,
  slotId: string,
): Candidate | undefined {
  const candidateId = plan.slotToCandidateId[slotId];
  return plan.candidates.find((candidate) => candidate.id === candidateId);
}

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

function StartPreview({
  candidates,
  layoutSeed,
}: {
  candidates: Candidate[];
  layoutSeed: string;
}) {
  const shift = ((layoutSeed.length * 17) % 17) - 8;
  const previewScaleY = 468 / WORLD_HEIGHT;
  const previewY = (worldY: number) => 42 + worldY * previewScaleY;
  const activeCount = Math.max(2, candidates.length);
  const marbleSpan = Math.min(650, Math.max(220, (activeCount - 1) * 72));
  const marbleStart = 450 - marbleSpan / 2 + shift * 2;
  return (
    <div className="map-preview" aria-label="Race 경기장 미리보기">
      <svg
        className="preview-course"
        viewBox="0 0 900 540"
        role="img"
        aria-label="폭이 좁아지고 넓어지며 좌우로 이동하는 비대칭 마블 레이스 코스"
      >
        <defs>
          <pattern
            id="preview-checker"
            width="24"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <rect width="12" height="12" fill="#fff8ef" />
            <rect x="12" width="12" height="12" fill="#e84f83" />
          </pattern>
        </defs>
        {COURSE_SECTIONS.map((section, index) => (
          <rect
            key={`section-band-${section.id}`}
            x="70"
            y={previewY(section.startY)}
            width="760"
            height={(section.endY - section.startY) * previewScaleY}
            fill={
              [
                "rgba(255, 111, 159, 0.04)",
                "rgba(255, 173, 74, 0.05)",
                "rgba(89, 201, 179, 0.045)",
                "rgba(165, 119, 255, 0.045)",
              ][index]
            }
          />
        ))}
        {COURSE_SECTIONS.slice(1).map((section, index) => {
          const y = previewY(section.startY);
          return (
            <g key={`section-marker-${section.id}`}>
              <line
                x1="86"
                x2="814"
                y1={y}
                y2={y}
                stroke="rgba(255, 248, 239, 0.46)"
                strokeWidth="2"
                strokeDasharray="8 8"
              />
              <text
                x="96"
                y={y - 5}
                textAnchor="start"
                fill="rgba(255, 248, 239, 0.8)"
              >
                {(index + 1) * 25}% · {section.label}
              </text>
            </g>
          );
        })}
        {COURSE_RECTS.filter((shape) => shape.y < WORLD_HEIGHT).map(
          (shape, index) => {
          const y = previewY(shape.y);
          const isVerticalBoundary =
            shape.role === "wall" && shape.width <= 30;
          const previewWidth = isVerticalBoundary ? 8 : shape.width;
          const previewHeight =
            shape.role === "wall"
              ? Math.max(4, shape.height * previewScaleY)
              : shape.role === "gate"
                ? 10
                : 7;
          const visualAngle = ((shape.angle ?? 0) * 180 * 0.42) / Math.PI;
          return (
            <rect
              key={`rail-${index}`}
              x={shape.x - previewWidth / 2}
              y={y - previewHeight / 2}
              width={previewWidth}
              height={previewHeight}
              rx="4"
              fill={
                shape.role === "wall"
                  ? "#4f2c39"
                  : shape.role === "gate"
                    ? "#754557"
                    : "#684050"
              }
              transform={`rotate(${visualAngle} ${shape.x} ${y})`}
            />
          );
          },
        )}
        {COURSE_CURVES.map((curve) => (
          <polyline
            key={curve.id}
            points={curve.points
              .map((point) => `${point.x},${previewY(point.y)}`)
              .join(" ")}
            fill="none"
            stroke="#4f2c39"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {COURSE_PINS.map((pin, index) => (
          <circle
            key={`pin-${index}`}
            cx={pin.x}
            cy={previewY(pin.y)}
            r={pin.radius > 25 ? 8 : 5}
            fill="#845165"
          />
        ))}
        {COURSE_BUMPERS.map((bumper, index) => (
          <g key={`bumper-${index}`}>
            <circle
              cx={bumper.x}
              cy={previewY(bumper.y)}
              r={bumper.kind === "finish-launch" ? 10 : 8}
              fill={
                bumper.kind === "finish-launch" ? "#ffad4a" : "#e84f83"
              }
              stroke="#fff8ef"
              strokeWidth="2"
            />
            <circle
              cx={bumper.x}
              cy={previewY(bumper.y)}
              r={bumper.kind === "finish-launch" ? 3.5 : 3}
              fill={
                bumper.kind === "finish-launch" ? "#fff0c7" : "#ffd0df"
              }
            />
          </g>
        ))}
        {ROTATING_BARS.map((bar, index) => {
          const y = previewY(bar.y);
          return (
            <rect
              key={`spinner-${index}`}
              x={bar.x - bar.width / 2}
              y={y - 5}
              width={bar.width}
              height="10"
              rx="5"
              fill="#f1b3c6"
              transform={`rotate(${index % 2 === 0 ? -7 : 8} ${bar.x} ${y})`}
            />
          );
        })}
        <text x="450" y="19" textAnchor="middle">
          START
        </text>
        {Array.from({ length: activeCount }, (_, index) => (
          <circle
            key={`marble-${index}`}
            cx={
              marbleStart +
              (activeCount === 1 ? 0 : (marbleSpan / (activeCount - 1)) * index)
            }
            cy="31"
            r="7"
            fill={
              candidates[index]?.theme.primary ??
              PARTICIPANT_THEMES[index].primary
            }
            stroke="#fff8ef"
            strokeWidth="2"
          />
        ))}
        <rect
          x={FINISH_LINE_X}
          y={previewY(FINISH_Y)}
          width={FINISH_LINE_WIDTH}
          height="9"
          fill="url(#preview-checker)"
        />
        <text
          x="450"
          y={previewY(FINISH_Y) - 7}
          textAnchor="middle"
        >
          FINISH
        </text>
      </svg>
    </div>
  );
}

export function MarbleGame() {
  const [title, setTitle] = useState("오늘의 Race");
  const [rosterText, setRosterText] = useState(DEFAULT_ROSTER);
  const [isEditingRoster, setIsEditingRoster] = useState(false);
  const [resultMode, setResultMode] =
    useState<ResultMode>("preselected");
  const [allowDuplicateNames, setAllowDuplicateNames] = useState(false);
  const [groupCount, setGroupCount] = useState(1);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [winnerCount, setWinnerCount] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(() => createSeed("layout"));
  const [phase, setPhase] = useState<Phase>("ready");
  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [countdown, setCountdown] = useState<CountdownStep>(3);
  const [errorMessage, setErrorMessage] = useState("");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<StoredRaceResult[]>([]);
  const [isReplay, setIsReplay] = useState(false);
  const generationKey = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const resultSavedFor = useRef<string | null>(null);
  const raceStartedAt = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const validation = useMemo(
    () => parseRoster(rosterText, { allowDuplicateNames }),
    [allowDuplicateNames, rosterText],
  );
  const minimumGroups = minimumGroupCount(validation.candidates.length);
  const maximumGroups = maximumGroupCount(validation.candidates.length);
  const effectiveGroupCount = Math.min(
    maximumGroups,
    Math.max(minimumGroups, groupCount),
  );
  const groups = useMemo(
    () =>
      splitCandidatesIntoGroups(
        validation.candidates,
        effectiveGroupCount,
      ),
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
    const timer = window.setTimeout(() => {
      try {
        const storedRoster = localStorage.getItem(ROSTER_KEY);
        const storedHistory = localStorage.getItem(HISTORY_KEY);
        if (storedRoster) setRosterText(storedRoster);
        if (storedHistory) setHistory(JSON.parse(storedHistory));
      } catch {
        setToast("저장된 명단을 불러오지 못해 기본 명단을 사용합니다.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
          raceStartedAt.current = performance.now();
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
      !plan ||
      raceStartedAt.current === null
    ) {
      return;
    }
    let animationFrame = 0;
    const lastFrameIndex = plan.simulation.frames.length - 1;
    const resultRevealFrame = Math.min(
      lastFrameIndex,
      plan.simulation.awardFrameIndex + RESULT_REVEAL_DELAY_FRAMES,
    );

    const animate = (now: number) => {
      const nextFrame = Math.min(
        lastFrameIndex,
        Math.floor(
          ((now - raceStartedAt.current!) / 1000) * FRAME_RATE,
        ),
      );
      setFrameIndex(nextFrame);
      if (phase === "running" && nextFrame >= resultRevealFrame) {
        playTone(880, 0.42);
        setPhase("result");
        return;
      }
      if (nextFrame >= lastFrameIndex) return;
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
    // playTone intentionally reads the latest sound preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan]);

  useEffect(() => {
    if (phase !== "result" || !plan || isReplay) return;
    if (frameIndex < plan.simulation.frames.length - 1) return;
    if (resultSavedFor.current === plan.runId) return;
    resultSavedFor.current = plan.runId;
    const winnerNames = plan.winnerIds.map(
      (candidateId) =>
        plan.candidates.find((candidate) => candidate.id === candidateId)
          ?.name ?? "알 수 없음",
    );
    const rankedNames = plan.simulation.frames
      .at(-1)!
      .finishedSlotIds.map(
        (slotId) =>
          plan.candidates.find(
            (candidate) =>
              candidate.id === plan.slotToCandidateId[slotId],
          )?.name ?? "알 수 없음",
      );
    const stored: StoredRaceResult = {
      runId: plan.runId,
      title: plan.title,
      resultMode: plan.resultMode,
      raceSeed: plan.raceSeed,
      layoutSeed: plan.layoutSeed,
      createdAt: plan.createdAt,
      winnerNames,
      rankedNames,
    };
    const nextHistory = [stored, ...history].slice(0, 20);
    setHistory(nextHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      localStorage.setItem(ROSTER_KEY, rosterText);
    } catch {
      window.setTimeout(
        () => setToast("결과는 표시했지만 이 기기에 저장하지 못했어요."),
        0,
      );
    }
    // History is intentionally snapshotted at result time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan, isReplay, frameIndex]);

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
    setPhase("generating");
    setErrorMessage("");
    setIsReplay(false);
    raceStartedAt.current = null;
    window.setTimeout(() => {
      try {
        const raceSeed = createSeed("race");
        const resultSeed = createSeed("result");
        const simulation = simulateRace(
          activeCandidates.length,
          raceSeed,
          layoutSeed,
          effectiveWinnerCount,
        );
        if (generationKey.current !== currentGeneration) return;
        const nextPlan = buildRacePlan(
          title,
          activeCandidates,
          resultMode,
          simulation,
          { raceSeed, resultSeed, layoutSeed },
          effectiveWinnerCount,
        );
        setPlan(nextPlan);
        setFrameIndex(0);
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

  const handleRaceStart = async () => {
    if (!plan || phase !== "waiting") return;
    await audioContext.current?.resume();
    setCountdown(3);
    setFrameIndex(0);
    setPhase("countdown");
  };

  const handleRegenerateLayout = () => {
    setLayoutSeed(createSeed("layout"));
    setToast("출발 배치를 새로 만들었어요.");
  };

  const handleReplay = () => {
    if (!plan) return;
    setIsReplay(true);
    setFrameIndex(0);
    setCountdown(3);
    setPhase("countdown");
  };

  const handleNewRace = () => {
    generationKey.current += 1;
    setPlan(null);
    setFrameIndex(0);
    setPhase("ready");
    setIsReplay(false);
    raceStartedAt.current = null;
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
    const arrivedRanking = currentFrame.finishedSlotIds
      .map((slotId) => candidateForSlot(plan, slotId))
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    const ranking = currentFrame.rankedSlotIds
      .map((slotId) => candidateForSlot(plan, slotId))
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    const resultRows = Array.from(
      { length: plan.candidates.length },
      (_, index) => arrivedRanking[index],
    );
    const winners = plan.winnerIds
      .map((candidateId) =>
        plan.candidates.find((candidate) => candidate.id === candidateId),
      )
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    const finishedCandidateIds = new Set(
      currentFrame.finishedSlotIds
        .map((slotId) => plan.slotToCandidateId[slotId])
        .filter(Boolean),
    );
    const confirmedWinnerCount = Math.min(
      currentFrame.finishedSlotIds.length,
      plan.winnerCount,
    );
    const isFinishing =
      phase === "running" &&
      frameIndex >= plan.simulation.firstFinishFrameIndex;

    if (phase === "result") {
      return (
        <main className="result-screen">
          <div className="result-glow" aria-hidden="true" />
          <header className="result-header">
            <p className="eyebrow">RACE RESULTS</p>
            <span>
              도착 {arrivedRanking.length}/{plan.candidates.length} ·
              미도착 순위는 공란
            </span>
          </header>
          <section
            className={`winner-reveal ${
              winners.length > 1 ? "is-multiple" : ""
            }`}
            aria-labelledby="winner-title"
          >
            <p id="winner-title">
              Race 당첨자 {plan.winnerCount}명
            </p>
            <div className="winner-list">
              {winners.map((candidate, index) => (
                <article
                  className="winner-card"
                  key={candidate.id}
                  style={participantStyle(candidate)}
                >
                  <div className="winner-marble" aria-hidden="true">
                    {candidate.number}
                  </div>
                  <span>{index + 1}위</span>
                  <h1>{shortName(candidate.name, 10)}</h1>
                </article>
              ))}
            </div>
            <span>
              {plan.candidates.length}명 중 {plan.winnerCount}명 당첨
            </span>
          </section>
          <section className="result-ranking" aria-labelledby="ranking-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ARRIVAL ORDER</p>
                <h2 id="ranking-title">실시간 도착 순위</h2>
              </div>
              <span aria-live="polite">
                {arrivedRanking.length === plan.candidates.length
                  ? "전원 도착"
                  : `${plan.candidates.length - arrivedRanking.length}명 경기 중`}
              </span>
            </div>
            <ol>
              {resultRows.map((candidate, index) => (
                <li
                  key={candidate?.id ?? `pending-${index}`}
                  className={[
                    candidate && index < plan.winnerCount
                      ? "is-winner"
                      : "",
                    candidate ? "" : "is-pending",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={candidate ? participantStyle(candidate) : undefined}
                  aria-label={
                    candidate
                      ? `${index + 1}위 ${candidate.name}`
                      : `${index + 1}위 도착 대기`
                  }
                >
                  <strong>{index + 1}</strong>
                  <i />
                  <span title={candidate?.name} aria-hidden={!candidate}>
                    {candidate ? shortName(candidate.name) : "\u00a0"}
                  </span>
                  {candidate && index < plan.winnerCount && <em>당첨</em>}
                </li>
              ))}
            </ol>
          </section>
          <div className="result-actions">
            <button className="secondary-button" onClick={handleReplay}>
              같은 경기 다시 보기
            </button>
            <button className="primary-button" onClick={handleNewRace}>
              새 경기 준비
            </button>
          </div>
          <details className="run-details">
            <summary>실행 정보</summary>
            <dl>
              <div>
                <dt>경기 시드</dt>
                <dd>{plan.raceSeed}</dd>
              </div>
              <div>
                <dt>출발 이동</dt>
                <dd>{plan.simulation.layoutShift}px</dd>
              </div>
              <div>
                <dt>물리 변형</dt>
                <dd>{plan.simulation.dynamics.fingerprint}</dd>
              </div>
              <div>
                <dt>물리 완주</dt>
                <dd>
                  {arrivedRanking.length}/{plan.candidates.length}
                  {frameIndex >= plan.simulation.frames.length - 1 &&
                  plan.simulation.timedOut
                    ? " · 미도착 순위 공란 유지"
                    : ""}
                </dd>
              </div>
            </dl>
          </details>
        </main>
      );
    }

    return (
      <main className="race-screen">
        <header className="race-header">
          <div>
            <p className="eyebrow">EX LAB · RACE</p>
            <h1>{plan.title}</h1>
          </div>
          <div className="race-status" aria-live="polite">
            <span>
              {phase === "waiting"
                ? "방송 대기"
                : phase === "countdown"
                  ? "출발 준비"
                  : confirmedWinnerCount >= plan.winnerCount
                    ? "당첨 인원 도착 완료"
                    : confirmedWinnerCount > 0
                      ? "다음 당첨자 대기"
                      : "경기 진행 중"}
            </span>
            <strong>
              {phase === "waiting"
                ? `${plan.candidates.length}명 · ${plan.winnerCount}명 당첨`
                : `${confirmedWinnerCount} / ${plan.winnerCount} 당첨 확정`}
            </strong>
          </div>
        </header>
        <div className="race-layout">
          <section className="race-stage">
            <RaceCanvas
              plan={plan}
              frameIndex={frameIndex}
              reducedMotion={reducedMotion}
            />
            {phase === "waiting" && (
              <div className="broadcast-waiting" role="dialog" aria-modal="true">
                <p className="eyebrow">BROADCAST READY</p>
                <h2>방송 화면이 준비됐습니다.</h2>
                <span>
                  시작 버튼을 누르기 전에는 카운트다운과 경기가 진행되지
                  않습니다.
                </span>
                <div>
                  <button
                    className="secondary-button"
                    onClick={handleNewRace}
                  >
                    설정으로 돌아가기
                  </button>
                  <button
                    className="primary-button"
                    onClick={handleRaceStart}
                  >
                    경기 시작
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
                {confirmedWinnerCount >= plan.winnerCount
                  ? `${plan.winnerCount}명 당첨 확정!`
                  : `${confirmedWinnerCount}번째 당첨 확정 · ${
                      plan.winnerCount - confirmedWinnerCount
                    }명 남음`}
              </div>
            )}
          </section>
          <aside className="leaderboard" aria-label="실시간 전체 순위">
            <div className="leaderboard-heading">
              <span>LIVE ORDER</span>
              <button
                className="icon-button"
                onClick={() => setSoundEnabled((value) => !value)}
                aria-label={soundEnabled ? "음소거" : "소리 켜기"}
              >
                {soundEnabled ? "소리 켜짐" : "음소거"}
              </button>
            </div>
            <ol>
              {ranking.map((candidate, index) => (
                <li
                  key={candidate.id}
                  className={[
                    index === 0 ? "is-leading" : "",
                    finishedCandidateIds.has(candidate.id)
                      ? "is-qualified"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={participantStyle(candidate)}
                >
                  <strong>{index + 1}</strong>
                  <i />
                  <span title={candidate.name}>
                    {shortName(candidate.name)}
                  </span>
                  {finishedCandidateIds.has(candidate.id) && <em>당첨</em>}
                </li>
              ))}
            </ol>
            <p className="camera-note">
              {reducedMotion
                ? "선두 추적 · 이동 모션 축소"
                : "관성 카메라 · 선두 변경 0.5초"}
            </p>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="preparation-screen">
      <header className="product-header">
        <a className="brand" href="#" aria-label="Ex Lab 처음으로">
          <span aria-hidden="true">●</span>
          Ex Lab
        </a>
        <span className="prototype-badge">RACE · VERSION 1.1.1</span>
      </header>

      <section className="intro">
        <p className="eyebrow">EX LAB · RACE</p>
        <h1>
          모든 이름이
          <br />
          조별 Race로 이어집니다.
        </h1>
        <p>
          전체 명단을 편성하고 방송 화면을 여세요. 각 조는 운영자가
          시작할 때까지 대기합니다.
        </p>
      </section>

      <div className="preparation-grid">
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RACE SETUP</p>
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
                onChange={(event) => setRosterText(event.target.value)}
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
                onClick={() => setAllowDuplicateNames((value) => !value)}
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
            <fieldset>
              <legend>결과 방식</legend>
              <label>
                <input
                  type="radio"
                  name="result-mode"
                  value="preselected"
                  checked={resultMode === "preselected"}
                  onChange={() => setResultMode("preselected")}
                />
                <span>
                  <strong>결과 선확정</strong>
                  <small>
                    결과를 먼저 잠그고 익명 물리 경기의 완주 슬롯에 배정
                  </small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="result-mode"
                  value="physical"
                  checked={resultMode === "physical"}
                  onChange={() => setResultMode("physical")}
                />
                <span>
                  <strong>물리 결과형</strong>
                  <small>실제 마블의 도착 순서로 당첨 인원을 결정</small>
                </span>
              </label>
            </fieldset>
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
            <p className="eyebrow">COURSE 01</p>
            <h2 id="venue-title">Race</h2>
            <p>
              좌·우 사이클로이드와 수축·확장 구간, 네 가지 구간 패턴,
              능동 범퍼와 결승 회전 관문을 통과하는 약 30초 코스
            </p>
          </div>
          <StartPreview
            candidates={activeCandidates}
            layoutSeed={layoutSeed}
          />
          <div className="venue-meta">
            <div>
              <span>출발 방식</span>
              <strong>동일 높이 · 동시 개방</strong>
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
