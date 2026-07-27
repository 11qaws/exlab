"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  DEFAULT_GAME_ID,
  GAME_CATALOG,
  gameCatalogEntry,
  isGameId,
  type GameId,
} from "./_platform/catalog";
import {
  DEFAULT_SHARED_ROSTER,
  readPlatformPreferences,
  writeDuplicateNamePolicy,
  writeLastGame,
  writeSharedRoster,
  writeStreamerTheme,
} from "./_platform/storage";
import { validateSharedRosterDraft } from "./_platform/roster";
import {
  DEFAULT_STREAMER_THEME_ID,
  StreamerThemePicker,
  streamerThemeCssVariables,
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

type SharedRosterDialogProps = {
  rosterText: string;
  allowDuplicateNames: boolean;
  onCancel: () => void;
  onSave: (rosterText: string, allowDuplicateNames: boolean) => void;
};

function SharedRosterDialog({
  rosterText,
  allowDuplicateNames,
  onCancel,
  onSave,
}: SharedRosterDialogProps) {
  const [draft, setDraft] = useState(rosterText);
  const [duplicateDraft, setDuplicateDraft] =
    useState(allowDuplicateNames);
  const dialogRef = useRef<HTMLElement>(null);
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
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
  const [rosterText, setRosterText] = useState(DEFAULT_SHARED_ROSTER);
  const [allowDuplicateNames, setAllowDuplicateNames] = useState(false);
  const [streamerThemeId, setStreamerThemeId] =
    useState<StreamerThemeId>(DEFAULT_STREAMER_THEME_ID);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [rosterEditorOpen, setRosterEditorOpen] = useState(false);
  const [visitedGameIds, setVisitedGameIds] = useState<Set<GameId>>(
    () => new Set(),
  );
  const [activityByGame, setActivityByGame] = useState<
    Record<GameId, boolean>
  >({
    roulette: false,
    showdown: false,
  });
  const rosterTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const preferences = readPlatformPreferences(window.localStorage);
        setGameId(preferences.gameId);
        setRosterText(preferences.rosterText);
        setAllowDuplicateNames(preferences.allowDuplicateNames);
        setStreamerThemeId(preferences.streamerThemeId);
        setVisitedGameIds(new Set([preferences.gameId]));
      } catch {
        setVisitedGameIds(new Set([DEFAULT_GAME_ID]));
      } finally {
        setPreferencesReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeSharedRoster(window.localStorage, rosterText);
    } catch {
      // The controlled roster remains valid for this tab.
    }
  }, [preferencesReady, rosterText]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeLastGame(window.localStorage, gameId);
    } catch {
      // A storage failure must not block a usable game.
    }
  }, [gameId, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeDuplicateNamePolicy(
        window.localStorage,
        allowDuplicateNames,
      );
    } catch {
      // The in-memory policy still applies for this tab.
    }
  }, [allowDuplicateNames, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeStreamerTheme(window.localStorage, streamerThemeId);
    } catch {
      // The selected visual identity still applies for this tab.
    }
  }, [preferencesReady, streamerThemeId]);

  const selectedGame = useMemo(() => gameCatalogEntry(gameId), [gameId]);
  const gameActive = activityByGame[gameId];
  const navigationLocked = gameActive || rosterEditorOpen;
  const activityHandlers = useMemo<
    Record<GameId, (active: boolean) => void>
  >(
    () => ({
      roulette: (active) =>
        setActivityByGame((current) =>
          current.roulette === active
            ? current
            : { ...current, roulette: active },
        ),
      showdown: (active) =>
        setActivityByGame((current) =>
          current.showdown === active
            ? current
            : { ...current, showdown: active },
        ),
    }),
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
    rosterTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRosterEditorOpen(true);
  }, []);

  return (
    <div
      className="exlab-shell"
      data-streamer-theme={streamerThemeId}
      style={streamerThemeCssVariables(streamerThemeId, "light")}
    >
      <header
        className="exlab-header"
        inert={rosterEditorOpen}
        aria-hidden={rosterEditorOpen || undefined}
      >
        <span className="exlab-wordmark" aria-label="exlab">
          exlab
        </span>

        <div className="exlab-toolbar">
          <div className="exlab-theme-field">
            <span className="exlab-field-caption" aria-hidden="true">
              테마
            </span>
            <StreamerThemePicker
              className="exlab-toolbar-theme-picker"
              value={streamerThemeId}
              onChange={setStreamerThemeId}
              disabled={navigationLocked || !preferencesReady}
              legend="스트리머 테마"
              description=""
            />
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
              {rosterEditorOpen ? "명단 편집 중" : "진행 중"}
            </span>
          )}
        </div>
      </header>

      <div
        className="exlab-game-surface"
        aria-label={`${selectedGame.label} 운영 화면`}
        aria-busy={!preferencesReady}
        inert={rosterEditorOpen}
        aria-hidden={rosterEditorOpen || undefined}
      >
        {preferencesReady ? (
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
                    active={isActiveGame}
                    rosterText={rosterText}
                    onRosterTextChange={setRosterText}
                    allowDuplicateNames={allowDuplicateNames}
                    onAllowDuplicateNamesChange={setAllowDuplicateNames}
                    onRequestRosterEdit={openRosterEditor}
                    onActivityChange={activityHandlers[game.id]}
                  />
                </Suspense>
              </div>
            );
          })
        ) : (
          <div className="exlab-loading" role="status">
            설정 불러오는 중…
          </div>
        )}
      </div>

      {rosterEditorOpen && (
        <SharedRosterDialog
          rosterText={rosterText}
          allowDuplicateNames={allowDuplicateNames}
          onCancel={closeRosterEditor}
          onSave={(nextRosterText, nextDuplicatePolicy) => {
            setRosterText(nextRosterText);
            setAllowDuplicateNames(nextDuplicatePolicy);
            closeRosterEditor();
          }}
        />
      )}
    </div>
  );
}
