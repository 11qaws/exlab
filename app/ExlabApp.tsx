"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type ChangeEvent,
} from "react";
import {
  DEFAULT_GAME_ID,
  GAME_CATALOG,
  gameCatalogEntry,
  isGameId,
  type GameId,
} from "./_platform/catalog";
import { extractNaverCafeCommentAuthors } from "./_platform/cafeCommentParser";
import {
  INITIAL_GAME_HOST_STATE,
  isGameSwitchLocked,
  type GameHostState,
} from "./_platform/contracts";
import {
  createSharedRosterSnapshot,
  reconcileSharedRosterSnapshot,
  sharedRosterSnapshotText,
} from "./_platform/sharedRosterSnapshot";
import {
  DEFAULT_SHARED_ROSTER,
  hasStoredStreamerThemeChoice,
  readPlatformPreferences,
  writeLastGame,
  writeSharedRosterSnapshot,
  writeStreamerTheme,
  writeStreamerThemeChoice,
} from "./_platform/storage";
import { validateSharedRosterDraft } from "./_platform/roster";
import {
  DEFAULT_STREAMER_THEME_ID,
  THEME_CONFIRM_BLINK_MS,
  THEME_CONFIRM_HOLD_MS,
  THEME_CONFIRM_TRANSITION_MS,
  createThemeSelectionState,
  effectiveStreamerThemeId,
  getStreamerTheme,
  preloadStreamerThemePortraits,
  StreamerThemeCurrent,
  StreamerThemePicker,
  streamerThemeCssVariables,
  themeSelectionReducer,
  type ThemeSelectionPhase,
  type StreamerThemePortraitPreloadStatus,
  type StreamerThemeId,
} from "./_platform/theme";

const GAME_SURFACES = {
  roulette: lazy(async () => {
    const game = await import("./games/roulette/RouletteGame");
    return { default: game.RouletteGame };
  }),
  showdown: lazy(async () => {
    const game = await import("./marble/ShowdownGame");
    return { default: game.ShowdownGame };
  }),
} as const;

type GameHostStateByGame = Record<GameId, GameHostState>;
type GameHostStateHandlers = Record<
  GameId,
  (state: GameHostState) => void
>;
type LegacyActivityHandlers = Record<
  GameId,
  (active: boolean) => void
>;

function createInitialGameHostStateByGame(): GameHostStateByGame {
  return GAME_CATALOG.reduce((states, game) => {
    states[game.id] = { ...INITIAL_GAME_HOST_STATE };
    return states;
  }, {} as GameHostStateByGame);
}

function gameHostStatesEqual(
  first: GameHostState,
  second: GameHostState,
): boolean {
  return (
    first.lifecycle === second.lifecycle &&
    first.statusLabel === second.statusLabel &&
    first.sessionId === second.sessionId &&
    first.runId === second.runId
  );
}

type SharedRosterDialogProps = {
  rosterText: string;
  allowDuplicateNames: boolean;
  onCancel: () => void;
  onSave: (rosterText: string, allowDuplicateNames: boolean) => void;
};

type StreamerThemeWelcomeProps = {
  value: StreamerThemeId;
  onChange: (themeId: StreamerThemeId) => void;
  onConfirm: () => void;
  onConfirmationComplete: (token: number) => void;
  phase: Exclude<ThemeSelectionPhase, "closed">;
  confirmationToken: number;
  required: boolean;
  onCancel?: () => void;
};

type StreamerThemeWelcomeStyle = CSSProperties & {
  "--exlab-theme-confirm-blink-duration": string;
  "--exlab-theme-confirm-transition-duration": string;
};

function StreamerThemeWelcome({
  value,
  onChange,
  onConfirm,
  onConfirmationComplete,
  phase,
  confirmationToken,
  required,
  onCancel,
}: StreamerThemeWelcomeProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const confirmationStartedRef = useRef(false);
  const [pickerScrollEdges, setPickerScrollEdges] = useState({
    up: false,
    down: false,
  });
  const selectedTheme = getStreamerTheme(value);
  const confirming = phase === "confirming";
  const timingStyle: StreamerThemeWelcomeStyle = {
    "--exlab-theme-confirm-blink-duration":
      `${THEME_CONFIRM_BLINK_MS}ms`,
    "--exlab-theme-confirm-transition-duration":
      `${THEME_CONFIRM_TRANSITION_MS}ms`,
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!confirming) {
      dialogRef.current
        ?.querySelector<HTMLInputElement>(
          'input[type="radio"]:checked:not(:disabled)',
        )
        ?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (required || confirming) {
          event.preventDefault();
        } else {
          onCancel?.();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input[type="radio"]:checked:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirming, onCancel, required]);

  useEffect(() => {
    if (!confirming) {
      confirmationStartedRef.current = false;
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const closeDelay =
      (reduceMotion ? 0 : THEME_CONFIRM_TRANSITION_MS)
      + THEME_CONFIRM_HOLD_MS;
    const timer = window.setTimeout(
      () => onConfirmationComplete(confirmationToken),
      closeDelay,
    );

    return () => window.clearTimeout(timer);
  }, [
    confirmationToken,
    confirming,
    onConfirmationComplete,
  ]);

  useEffect(() => {
    const picker =
      dialogRef.current?.querySelector<HTMLElement>(
        ".exlab-onboarding-theme-picker",
      );
    if (!picker) return;

    const updateScrollEdges = () => {
      const next = {
        up: picker.scrollTop > 2,
        down:
          picker.scrollTop + picker.clientHeight
          < picker.scrollHeight - 2,
      };
      setPickerScrollEdges((current) =>
        current.up === next.up && current.down === next.down
          ? current
          : next,
      );
    };

    updateScrollEdges();
    picker.addEventListener("scroll", updateScrollEdges, {
      passive: true,
    });
    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(picker);
    const list = picker.querySelector(".exlab-streamer-theme-list");
    if (list) resizeObserver.observe(list);

    return () => {
      picker.removeEventListener("scroll", updateScrollEdges);
      resizeObserver.disconnect();
    };
  }, [confirming, value]);

  const startConfirmation = () => {
    if (confirming || confirmationStartedRef.current) return;
    confirmationStartedRef.current = true;
    dialogRef.current
      ?.querySelector<HTMLInputElement>(
        'input[type="radio"]:checked',
      )
      ?.closest<HTMLElement>(".exlab-theme-card-option")
      ?.scrollIntoView({ behavior: "auto", block: "center" });
    onConfirm();
  };

  return (
    <div className="exlab-theme-welcome-layer">
      <div className="exlab-theme-welcome-scrim" aria-hidden="true" />
      <section
        ref={dialogRef}
        className={`exlab-theme-welcome${
          confirming ? " is-confirming" : ""
        }`}
        style={timingStyle}
        data-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exlab-theme-welcome-title"
        aria-describedby="exlab-theme-welcome-description"
      >
        <header>
          <span className="exlab-wordmark" aria-hidden="true">
            exlab
          </span>
          <div>
            <p>{required ? "첫 화면 설정" : "테마 교환"}</p>
            <h1 id="exlab-theme-welcome-title">화면 테마 선택</h1>
            <p id="exlab-theme-welcome-description">
              게임 UI와 Showdown 경기 프레임에 적용할 스트리머를
              선택합니다.
            </p>
          </div>
        </header>

        <div
          className={[
            "exlab-onboarding-theme-frame",
            pickerScrollEdges.up ? "can-scroll-up" : "",
            pickerScrollEdges.down ? "can-scroll-down" : "",
            confirming ? "is-confirming" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <StreamerThemePicker
            className="exlab-onboarding-theme-picker"
            value={value}
            onChange={onChange}
            legend="스트리머"
            description=""
            disabled={confirming}
            presentationState={phase}
          />
          <span
            aria-hidden="true"
            className="exlab-theme-scroll-cue is-top"
          />
          <span
            aria-hidden="true"
            className="exlab-theme-scroll-cue is-bottom"
          />
        </div>

        <footer>
          <span
            className="exlab-theme-welcome-status"
            role="status"
            aria-live="polite"
          >
            {confirming
              ? `${selectedTheme.name} 테마를 적용하고 있습니다.`
              : ""}
          </span>
          <div className="exlab-theme-welcome-actions">
            {!required && (
              <button
                aria-disabled={confirming || undefined}
                className="is-secondary"
                type="button"
                onClick={confirming ? undefined : onCancel}
                tabIndex={confirming ? -1 : undefined}
              >
                취소
              </button>
            )}
            <button
              className="is-primary"
              type="button"
              aria-disabled={confirming || undefined}
              onClick={startConfirmation}
            >
              {confirming
                ? "테마 적용 중"
                : required
                  ? "이 테마로 시작"
                  : "이 테마로 결정"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SharedRosterDialog({
  rosterText,
  allowDuplicateNames,
  onCancel,
  onSave,
}: SharedRosterDialogProps) {
  const [draft, setDraft] = useState(rosterText);
  const [duplicateDraft, setDuplicateDraft] =
    useState(allowDuplicateNames);
  const [cafeImportOpen, setCafeImportOpen] = useState(false);
  const [cafePage, setCafePage] = useState("");
  const [cafeImportMessage, setCafeImportMessage] = useState("");
  const [cafeImportError, setCafeImportError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const richCafeClipboard = useRef("");
  const validation = useMemo(
    () => validateSharedRosterDraft(draft, duplicateDraft),
    [draft, duplicateDraft],
  );
  const dirty =
    draft !== rosterText || duplicateDraft !== allowDuplicateNames;

  const requestCancel = useCallback(() => {
    if (
      dirty
      && !window.confirm("저장하지 않은 명단 변경을 버릴까요?")
    ) {
      return;
    }
    onCancel();
  }, [dirty, onCancel]);

  const handleCafePaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    event.preventDefault();
    const text =
      event.clipboardData.getData("text/plain")
      || event.clipboardData.getData("text");
    richCafeClipboard.current =
      event.clipboardData.getData("text/html");
    setCafePage(text);
    setCafeImportMessage("");
    setCafeImportError("");
  };

  const importCafeCommenters = () => {
    const source = richCafeClipboard.current || cafePage;
    if (!source.trim()) {
      setCafeImportError(
        "카페 페이지에서 복사한 내용을 먼저 붙여넣어 주세요.",
      );
      setCafeImportMessage("");
      return;
    }

    const candidates = extractNaverCafeCommentAuthors(source);
    const commenters = candidates.filter((candidate) => !candidate.reply);
    if (commenters.length === 0) {
      setCafeImportError(
        "댓글 작성자를 찾지 못했어요. 붙여넣은 원문을 확인해 주세요.",
      );
      setCafeImportMessage("");
      return;
    }

    setDraft(commenters.map((candidate) => candidate.nick).join("\n"));
    setCafeImportError("");
    setCafeImportMessage(
      `${commenters.length}명을 명단에 가져왔어요. 저장 전에 아래에서 확인할 수 있습니다.`,
    );
    setCafeImportOpen(false);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [requestCancel]);

  return (
    <div className="exlab-roster-dialog-layer">
      <button
        className="exlab-roster-dialog-scrim"
        type="button"
        tabIndex={-1}
        aria-label="참가자 명단 닫기"
        onClick={requestCancel}
      />
      <section
        ref={dialogRef}
        className="exlab-roster-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exlab-roster-title"
      >
        <header>
          <div>
            <p>공통 명단</p>
            <h2 id="exlab-roster-title">참가자 편집</h2>
          </div>
          <strong>{validation.names.length}명</strong>
        </header>

        <details
          className="exlab-roster-import"
          open={cafeImportOpen}
          onToggle={(event) =>
            setCafeImportOpen(event.currentTarget.open)
          }
        >
          <summary>
            <span>
              <strong>카페 댓글에서 가져오기</strong>
              <small>필요할 때 카페 글 원문에서 작성자만 추출합니다.</small>
            </span>
          </summary>
          <div className="exlab-roster-import__body">
            <p>
              카페 글에서 <strong>Ctrl+A → Ctrl+C</strong> 후 아래에
              붙여넣으세요.
            </p>
            <textarea
              value={cafePage}
              onChange={(event) => {
                richCafeClipboard.current = "";
                setCafePage(event.target.value);
                setCafeImportMessage("");
                setCafeImportError("");
              }}
              onPaste={handleCafePaste}
              placeholder="카페 글 전체 붙여넣기"
              aria-label="카페 페이지 내용"
              aria-invalid={Boolean(cafeImportError)}
              aria-describedby="exlab-cafe-import-status"
            />
            <div className="exlab-roster-import__action">
              <p
                id="exlab-cafe-import-status"
                role={cafeImportError ? "alert" : "status"}
                aria-live="polite"
              >
                {cafeImportError
                  || "붙여넣은 내용은 브라우저 안에서만 처리됩니다."}
              </p>
              <button type="button" onClick={importCafeCommenters}>
                댓글 작성자 가져오기
              </button>
            </div>
          </div>
        </details>

        {cafeImportMessage && (
          <p className="exlab-roster-import-result" role="status">
            {cafeImportMessage}
          </p>
        )}

        <label htmlFor="exlab-roster-input">한 줄에 한 명</label>
        <textarea
          id="exlab-roster-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={Boolean(validation.error)}
          aria-describedby="exlab-roster-help"
          autoFocus
        />
        <p
          id="exlab-roster-help"
          className={validation.error ? "is-error" : undefined}
          role={validation.error ? "alert" : undefined}
          aria-live="polite"
        >
          {validation.error
            ?? "이 명단은 Roulette와 Showdown에 함께 반영됩니다."}
        </p>

        <label className="exlab-roster-duplicate-policy">
          <input
            type="checkbox"
            checked={duplicateDraft}
            onChange={(event) => setDuplicateDraft(event.target.checked)}
          />
          <span>
            <strong>동일 이름 허용</strong>
            <small>
              기본값은 미허용이며, 허용 시 서로 다른 참가 번호를
              사용합니다.
            </small>
          </span>
        </label>

        <footer>
          <button type="button" onClick={requestCancel}>
            취소
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={Boolean(validation.error)}
            onClick={() =>
              onSave(validation.names.join("\n"), duplicateDraft)
            }
          >
            명단 저장
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ExlabApp() {
  const [gameId, setGameId] = useState<GameId>(DEFAULT_GAME_ID);
  const [roster, setRoster] = useState(() =>
    createSharedRosterSnapshot(DEFAULT_SHARED_ROSTER, false)
  );
  const [themeSelection, dispatchThemeSelection] = useReducer(
    themeSelectionReducer,
    undefined,
    () => createThemeSelectionState(),
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [themePortraitLoadStatus, setThemePortraitLoadStatus] =
    useState<"loading" | StreamerThemePortraitPreloadStatus>(
      "loading",
    );
  const [rosterEditorOpen, setRosterEditorOpen] = useState(false);
  const [visitedGameIds, setVisitedGameIds] = useState<Set<GameId>>(
    () => new Set(),
  );
  const [hostStateByGame, setHostStateByGame] =
    useState<GameHostStateByGame>(createInitialGameHostStateByGame);
  const rosterText = useMemo(
    () => sharedRosterSnapshotText(roster),
    [roster],
  );
  const allowDuplicateNames = roster.allowDuplicateNames;
  const streamerThemeDraftId = themeSelection.draftId;
  const activeStreamerThemeId =
    effectiveStreamerThemeId(themeSelection);
  const themePickerOpen = themeSelection.phase !== "closed";
  const themeSelectionRequired = themeSelection.required;
  const rosterTriggerRef = useRef<HTMLElement | null>(null);
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themeReturnFocusRef = useRef<HTMLElement | null>(null);
  const themeDialogWasOpenRef = useRef(false);
  const gameSurfaceRef = useRef<HTMLDivElement | null>(null);
  const themePickerReady =
    preferencesReady && themePortraitLoadStatus !== "loading";
  const appReady =
    preferencesReady
    && (
      !themeSelectionRequired
      || themePortraitLoadStatus !== "loading"
    );

  useEffect(() => {
    let active = true;
    void preloadStreamerThemePortraits(".").then(({ status }) => {
      if (active) setThemePortraitLoadStatus(status);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const hasThemeChoice = hasStoredStreamerThemeChoice(
          window.localStorage,
        );
        const preferences = readPlatformPreferences(window.localStorage);
        setGameId(preferences.gameId);
        setRoster(preferences.roster);
        dispatchThemeSelection({
          type: "hydrate",
          themeId: preferences.streamerThemeId,
          required: !hasThemeChoice,
        });
        setVisitedGameIds(new Set([preferences.gameId]));
      } catch {
        setVisitedGameIds(new Set([DEFAULT_GAME_ID]));
        dispatchThemeSelection({
          type: "hydrate",
          themeId: DEFAULT_STREAMER_THEME_ID,
          required: true,
        });
      } finally {
        setPreferencesReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeSharedRosterSnapshot(window.localStorage, roster);
    } catch {
      // The controlled roster remains valid for this tab.
    }
  }, [preferencesReady, roster]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeLastGame(window.localStorage, gameId);
    } catch {
      // A storage failure must not block a usable game.
    }
  }, [gameId, preferencesReady]);

  const selectedGame = useMemo(() => gameCatalogEntry(gameId), [gameId]);
  const selectedHostState =
    hostStateByGame[gameId] ?? INITIAL_GAME_HOST_STATE;
  const navigationLocked =
    isGameSwitchLocked(selectedHostState.lifecycle) || rosterEditorOpen;
  const hostStateHandlers = useMemo<GameHostStateHandlers>(
    () =>
      GAME_CATALOG.reduce((handlers, game) => {
        handlers[game.id] = (nextState) => {
          setHostStateByGame((current) => {
            const previous =
              current[game.id] ?? INITIAL_GAME_HOST_STATE;
            if (gameHostStatesEqual(previous, nextState)) return current;
            return {
              ...current,
              [game.id]: nextState,
            };
          });
        };
        return handlers;
      }, {} as GameHostStateHandlers),
    [],
  );
  const legacyActivityHandlers = useMemo<LegacyActivityHandlers>(
    () =>
      GAME_CATALOG.reduce((handlers, game) => {
        handlers[game.id] = (active) => {
          setHostStateByGame((current) => {
            const previous =
              current[game.id] ?? INITIAL_GAME_HOST_STATE;
            if (
              isGameSwitchLocked(previous.lifecycle) === active
            ) {
              return current;
            }
            return {
              ...current,
              [game.id]: active
                ? {
                    lifecycle: "active",
                    statusLabel: "진행 중",
                  }
                : INITIAL_GAME_HOST_STATE,
            };
          });
        };
        return handlers;
      }, {} as LegacyActivityHandlers),
    [],
  );

  useEffect(() => {
    if (rosterEditorOpen) return;
    const trigger = rosterTriggerRef.current;
    if (!trigger?.isConnected) return;

    trigger.focus();
    rosterTriggerRef.current = null;
  }, [rosterEditorOpen]);

  useEffect(() => {
    if (themePickerOpen) {
      themeDialogWasOpenRef.current = true;
      return;
    }
    if (!themeDialogWasOpenRef.current) return;

    themeDialogWasOpenRef.current = false;
    const trigger = themeReturnFocusRef.current;
    themeReturnFocusRef.current = null;
    if (
      trigger?.isConnected
      && !trigger.matches(":disabled")
      && !trigger.closest("[inert]")
    ) {
      trigger.focus({ preventScroll: true });
      if (document.activeElement === trigger) return;
    }
    gameSurfaceRef.current?.focus({ preventScroll: true });
  }, [themePickerOpen]);

  useEffect(() => {
    document.title = `${selectedGame.label} · exlab`;
  }, [selectedGame.label]);

  const handleGameChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (navigationLocked || !isGameId(event.target.value)) return;
    const nextGameId = event.target.value;
    setVisitedGameIds((current) => {
      if (current.has(nextGameId)) return current;
      const next = new Set(current);
      next.add(nextGameId);
      return next;
    });
    setGameId(nextGameId);
  };
  const closeRosterEditor = useCallback(() => {
    setRosterEditorOpen(false);
  }, []);
  const openRosterEditor = useCallback(() => {
    if (navigationLocked) return;
    rosterTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRosterEditorOpen(true);
  }, [navigationLocked]);
  const openStreamerThemePicker = useCallback(() => {
    if (navigationLocked || !themePickerReady) return;
    themeReturnFocusRef.current = themeTriggerRef.current;
    dispatchThemeSelection({ type: "open" });
  }, [navigationLocked, themePickerReady]);
  const closeStreamerThemePicker = useCallback(() => {
    dispatchThemeSelection({ type: "cancel" });
  }, []);
  const confirmStreamerTheme = useCallback(() => {
    if (themeSelection.phase !== "choosing") return;
    const confirmedThemeId = themeSelection.draftId;
    dispatchThemeSelection({ type: "confirm" });
    try {
      writeStreamerTheme(window.localStorage, confirmedThemeId);
      writeStreamerThemeChoice(window.localStorage);
    } catch {
      // Keep the confirmed choice for this tab even when storage is blocked.
    }
  }, [themeSelection.draftId, themeSelection.phase]);
  const completeStreamerThemeConfirmation = useCallback(
    (token: number) => {
      dispatchThemeSelection({
        type: "confirmation-finished",
        token,
      });
    },
    [],
  );

  const modalOpen =
    rosterEditorOpen || (themePickerReady && themePickerOpen);

  return (
    <div
      className="exlab-shell"
      data-streamer-theme={activeStreamerThemeId}
      style={streamerThemeCssVariables(activeStreamerThemeId, "light")}
    >
      <header
        className="exlab-header"
        inert={modalOpen}
        aria-hidden={modalOpen || undefined}
      >
        <span className="exlab-wordmark" aria-label="exlab">
          exlab
        </span>

        <div className="exlab-toolbar">
          <div className="exlab-theme-field">
            <span className="exlab-field-caption" aria-hidden="true">
              테마
            </span>
            <StreamerThemeCurrent
              loadImage={preferencesReady}
              value={activeStreamerThemeId}
            />
            <button
              ref={themeTriggerRef}
              className="exlab-theme-change-button"
              type="button"
              disabled={navigationLocked || !themePickerReady}
              onClick={openStreamerThemePicker}
            >
              {themePickerReady ? "테마 교환" : "테마 준비 중"}
            </button>
          </div>

          <label className="exlab-select-field">
            <span className="exlab-field-caption">게임</span>
            <select
              value={gameId}
              onChange={handleGameChange}
              disabled={navigationLocked || !preferencesReady}
              aria-label="게임 선택"
              aria-describedby={
                navigationLocked ? "game-switch-lock" : undefined
              }
            >
              {GAME_CATALOG.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.label}
                </option>
              ))}
            </select>
          </label>

          {navigationLocked && (
            <span
              className="exlab-session-status"
              id="game-switch-lock"
              role="status"
            >
              {rosterEditorOpen
                ? "명단 편집 중"
                : selectedHostState.statusLabel ?? "진행 중"}
            </span>
          )}
        </div>
      </header>

      <div
        ref={gameSurfaceRef}
        className="exlab-game-surface"
        tabIndex={-1}
        aria-label={`${selectedGame.label} 운영 화면`}
        aria-busy={!appReady}
        inert={modalOpen}
        aria-hidden={modalOpen || undefined}
      >
        {appReady ? (
          GAME_CATALOG.filter((game) =>
            visitedGameIds.has(game.id)
          ).map((game) => {
            const GameSurface = GAME_SURFACES[game.id];
            const isActiveGame = game.id === gameId;
            return (
              <div
                className="exlab-game-instance"
                key={game.id}
                hidden={!isActiveGame}
                aria-hidden={!isActiveGame || undefined}
              >
                <Suspense
                  fallback={
                    <div className="exlab-loading" role="status">
                      {game.label} 불러오는 중…
                    </div>
                  }
                >
                  <GameSurface
                    embedded
                    visible={isActiveGame}
                    active={isActiveGame}
                    streamerThemeId={activeStreamerThemeId}
                    roster={roster}
                    rosterText={rosterText}
                    onRosterTextChange={(nextRosterText) =>
                      setRoster((current) =>
                        reconcileSharedRosterSnapshot(
                          current,
                          nextRosterText,
                          current.allowDuplicateNames,
                        )
                      )
                    }
                    allowDuplicateNames={allowDuplicateNames}
                    onAllowDuplicateNamesChange={(allow) =>
                      setRoster((current) =>
                        reconcileSharedRosterSnapshot(
                          current,
                          sharedRosterSnapshotText(current),
                          allow,
                        )
                      )
                    }
                    onRequestRosterEdit={openRosterEditor}
                    onHostStateChange={hostStateHandlers[game.id]}
                    onActivityChange={legacyActivityHandlers[game.id]}
                  />
                </Suspense>
              </div>
            );
          })
        ) : (
          <div className="exlab-loading" role="status">
            {preferencesReady
              ? "테마 이미지 준비 중…"
              : "설정 불러오는 중…"}
          </div>
        )}
      </div>

      {rosterEditorOpen && (
        <SharedRosterDialog
          rosterText={rosterText}
          allowDuplicateNames={allowDuplicateNames}
          onCancel={closeRosterEditor}
          onSave={(nextRosterText, nextDuplicatePolicy) => {
            setRoster((current) =>
              reconcileSharedRosterSnapshot(
                current,
                nextRosterText,
                nextDuplicatePolicy,
              )
            );
            closeRosterEditor();
          }}
        />
      )}
      {themePickerReady && themePickerOpen && (
        <StreamerThemeWelcome
          value={streamerThemeDraftId}
          onChange={(themeId) =>
            dispatchThemeSelection({ type: "preview", themeId })
          }
          onConfirm={confirmStreamerTheme}
          onConfirmationComplete={completeStreamerThemeConfirmation}
          phase={themeSelection.phase}
          confirmationToken={themeSelection.confirmationToken}
          required={themeSelectionRequired}
          onCancel={
            themeSelectionRequired
              ? undefined
              : closeStreamerThemePicker
          }
        />
      )}
    </div>
  );
}
