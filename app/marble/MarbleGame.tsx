"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildRacePlan,
  createSeed,
  MAX_PARTICIPANTS,
  parseRoster,
  shortName,
} from "./core";
import {
  COURSE_CURVES,
  COURSE_PINS,
  COURSE_RECTS,
  FINISH_LINE_WIDTH,
  FINISH_LINE_X,
  FINISH_Y,
  ROTATING_BARS,
  WORLD_HEIGHT,
} from "./course";
import { FRAME_RATE, simulateRace } from "./simulation";
import type {
  Candidate,
  RacePlan,
  ResultMode,
  StoredRaceResult,
} from "./types";
import { RaceCanvas } from "./RaceCanvas";

const DEFAULT_ROSTER = [
  "아모레또",
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
  participantCount,
  layoutSeed,
}: {
  participantCount: number;
  layoutSeed: string;
}) {
  const shift = ((layoutSeed.length * 17) % 17) - 8;
  const previewScaleY = 468 / WORLD_HEIGHT;
  const previewY = (worldY: number) => 42 + worldY * previewScaleY;
  const activeCount = Math.max(2, participantCount);
  const marbleSpan = Math.min(650, Math.max(220, (activeCount - 1) * 72));
  const marbleStart = 450 - marbleSpan / 2 + shift * 2;
  return (
    <div className="map-preview" aria-label="레또 드롭 경기장 미리보기">
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
            fill="#e84f83"
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
  const [title, setTitle] = useState("오늘의 마블 경기");
  const [rosterText, setRosterText] = useState(DEFAULT_ROSTER);
  const [isEditingRoster, setIsEditingRoster] = useState(false);
  const [resultMode, setResultMode] =
    useState<ResultMode>("preselected");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(() => createSeed("layout"));
  const [phase, setPhase] = useState<Phase>("ready");
  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [errorMessage, setErrorMessage] = useState("");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<StoredRaceResult[]>([]);
  const [isReplay, setIsReplay] = useState(false);
  const generationKey = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const resultSavedFor = useRef<string | null>(null);
  const reducedMotion = useReducedMotion();
  const validation = useMemo(() => parseRoster(rosterText), [rosterText]);

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
    if (countdown <= 0) {
      const timer = window.setTimeout(() => {
        setFrameIndex(0);
        setPhase("running");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    playTone(countdown === 1 ? 680 : 520, 0.1);
    const timer = window.setTimeout(
      () => setCountdown((value) => value - 1),
      reducedMotion ? 450 : 760,
    );
    return () => window.clearTimeout(timer);
    // playTone intentionally reads the latest sound preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, phase, reducedMotion]);

  useEffect(() => {
    if (phase !== "running" || !plan) return;
    const startedAt = performance.now();
    let animationFrame = 0;

    const animate = (now: number) => {
      const nextFrame = Math.min(
        plan.simulation.frames.length - 1,
        Math.floor(((now - startedAt) / 1000) * FRAME_RATE),
      );
      setFrameIndex(nextFrame);
      if (nextFrame >= plan.simulation.frames.length - 1) {
        playTone(880, 0.42);
        setPhase("result");
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
    // playTone intentionally reads the latest sound preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan]);

  useEffect(() => {
    if (phase !== "result" || !plan || isReplay) return;
    if (resultSavedFor.current === plan.runId) return;
    resultSavedFor.current = plan.runId;
    const winner = plan.candidates.find(
      (candidate) => candidate.id === plan.winnerId,
    );
    const rankedNames = plan.rankedCandidateIds.map(
      (candidateId) =>
        plan.candidates.find((candidate) => candidate.id === candidateId)
          ?.name ?? "알 수 없음",
    );
    const stored: StoredRaceResult = {
      runId: plan.runId,
      title: plan.title,
      resultMode: plan.resultMode,
      raceSeed: plan.raceSeed,
      layoutSeed: plan.layoutSeed,
      createdAt: plan.createdAt,
      winnerName: winner?.name ?? "알 수 없음",
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
  }, [phase, plan, isReplay]);

  const handleStart = async () => {
    if (!validation.isValid || phase !== "ready") return;
    const currentGeneration = generationKey.current + 1;
    generationKey.current = currentGeneration;
    setPhase("generating");
    setErrorMessage("");
    setIsReplay(false);
    await audioContext.current?.resume();

    window.setTimeout(() => {
      try {
        const raceSeed = createSeed("race");
        const resultSeed = createSeed("result");
        const simulation = simulateRace(
          validation.candidates.length,
          raceSeed,
          layoutSeed,
        );
        if (generationKey.current !== currentGeneration) return;
        const nextPlan = buildRacePlan(
          title,
          validation.candidates,
          resultMode,
          simulation,
          { raceSeed, resultSeed, layoutSeed },
        );
        setPlan(nextPlan);
        setCountdown(3);
        setPhase("countdown");
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
    setLayoutSeed(createSeed("layout"));
  };

  if (
    plan &&
    (phase === "countdown" || phase === "running" || phase === "result")
  ) {
    const currentFrame =
      plan.simulation.frames[
        Math.min(frameIndex, plan.simulation.frames.length - 1)
      ];
    const ranking =
      phase === "result"
        ? plan.rankedCandidateIds
            .map((candidateId) =>
              plan.candidates.find(
                (candidate) => candidate.id === candidateId,
              ),
            )
            .filter((candidate): candidate is Candidate => Boolean(candidate))
        : currentFrame.rankedSlotIds
            .map((slotId) => candidateForSlot(plan, slotId))
            .filter((candidate): candidate is Candidate => Boolean(candidate));
    const winner = plan.candidates.find(
      (candidate) => candidate.id === plan.winnerId,
    );
    const isFinishing =
      phase === "running" &&
      frameIndex >= plan.simulation.winnerFrameIndex;

    if (phase === "result") {
      return (
        <main className="result-screen">
          <div className="result-glow" aria-hidden="true" />
          <header className="result-header">
            <p className="eyebrow">RACE COMPLETE</p>
            <span>
              {plan.resultMode === "preselected"
                ? "결과 선확정 · 물리 연출"
                : "물리 결과형"}
            </span>
          </header>
          <section className="winner-reveal" aria-labelledby="winner-title">
            <div
              className="winner-marble"
              style={{ background: winner?.color }}
              aria-hidden="true"
            >
              {winner?.number}
            </div>
            <p>레또 드롭 우승자</p>
            <h1 id="winner-title">{winner?.name}</h1>
            <span>{plan.candidates.length}명 중 1위</span>
          </section>
          <section className="result-ranking" aria-labelledby="ranking-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FINAL ORDER</p>
                <h2 id="ranking-title">전체 순위</h2>
              </div>
              <span>보정 없는 물리 궤적</span>
            </div>
            <ol>
              {ranking.map((candidate, index) => (
                <li key={candidate.id}>
                  <strong>{index + 1}</strong>
                  <i style={{ background: candidate.color }} />
                  <span title={candidate.name}>
                    {shortName(candidate.name)}
                  </span>
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
                <dt>물리 완주</dt>
                <dd>
                  {plan.simulation.physicallyFinishedCount}/
                  {plan.candidates.length}
                  {plan.simulation.timedOut ? " · 제한 시간 순위 적용" : ""}
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
            <p className="eyebrow">MARBLE SHOWDOWN</p>
            <h1>{plan.title}</h1>
          </div>
          <div className="race-status" aria-live="polite">
            <span>
              {isFinishing
                ? "결승 통과"
                : phase === "countdown"
                  ? "출발 준비"
                  : "경기 진행 중"}
            </span>
            <strong>
              {currentFrame.finishedSlotIds.length} / {plan.candidates.length} 완주
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
            {phase === "countdown" && (
              <div className="countdown" aria-live="assertive">
                <span>{countdown > 0 ? countdown : "GO"}</span>
                <p>모든 게이트가 동시에 열립니다</p>
              </div>
            )}
            {isFinishing && (
              <div className="finish-banner" aria-live="assertive">
                결승선 통과!
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
                  className={index === 0 ? "is-leading" : ""}
                >
                  <strong>{index + 1}</strong>
                  <i style={{ background: candidate.color }} />
                  <span title={candidate.name}>
                    {shortName(candidate.name)}
                  </span>
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
        <a className="brand" href="#" aria-label="마블 쇼다운 처음으로">
          <span aria-hidden="true">●</span>
          MARBLE SHOWDOWN
        </a>
        <span className="prototype-badge">FUNCTIONAL TEST</span>
      </header>

      <section className="intro">
        <p className="eyebrow">RETTO LABS · GAME 01</p>
        <h1>
          열 명의 이름이
          <br />
          하나의 경기로 바뀝니다.
        </h1>
        <p>
          명단을 확인하고 시작하세요. 추첨 결과와 물리 경기의 관계를
          직접 비교할 수 있는 독립 테스트 버전입니다.
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

          <div className="roster-heading">
            <div>
              <span>참가자</span>
              <strong>
                {validation.candidates.length} / {MAX_PARTICIPANTS}
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
                  validation.overflowNames.length ? "error-text" : "help-text"
                }
              >
                {validation.overflowNames.length
                  ? `초과 항목: ${validation.overflowNames.join(", ")}`
                  : "동명이인은 서로 다른 번호로 참가합니다."}
              </p>
            </div>
          ) : (
            <ol className="roster-grid">
              {validation.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <strong>{candidate.number}</strong>
                  <i style={{ background: candidate.color }} />
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
                  <small>실제 마블의 첫 도착이 결과를 결정</small>
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
            <h2 id="venue-title">레또 드롭</h2>
            <p>
              좌·우 사이클로이드와 수축·확장 구간, 결승 회전 관문을
              포함한 4개의 360° 회전 바를 통과하는 약 20초 코스
            </p>
          </div>
          <StartPreview
            participantCount={validation.candidates.length}
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
              ? `${validation.candidates.length}명이 레또 드롭에서 출발합니다.`
              : validation.message}
          </strong>
        </div>
        <button
          className="primary-button"
          disabled={!validation.isValid || phase === "generating"}
          onClick={handleStart}
        >
          {phase === "generating" ? "물리 경기 생성 중…" : "경기 시작"}
        </button>
      </footer>

      {history.length > 0 && (
        <details className="history-panel">
          <summary>최근 경기 {history.length}개</summary>
          <ol>
            {history.slice(0, 5).map((item) => (
              <li key={item.runId}>
                <span>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</span>
                <strong>{item.winnerName}</strong>
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
