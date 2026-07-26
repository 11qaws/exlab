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
} from "./_platform/storage";
import {
  parseSharedRosterNames,
  validateSharedRosterDraft,
} from "./_platform/roster";

const GAME_SURFACES = {
  roulette: lazy(async () => {
    const game = await import("./games/roulette/RouletteGame");
    return { default: game.RouletteGame };
  }),
  showdown: lazy(async () => {
    const game = await import("./marble/MarbleGame");
    return { default: game.MarbleGame };
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

        <label htmlFor="exlab-roster-input">
          한 줄에 한 명
        </label>
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
            <small>기본값은 미허용이며, 허용 시 서로 다른 참가 번호를 사용합니다.</small>
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

export function ExLabApp() {
  const [gameId, setGameId] = useState<GameId>(DEFAULT_GAME_ID);
  const [rosterText, setRosterText] = useState(DEFAULT_SHARED_ROSTER);
  const [allowDuplicateNames, setAllowDuplicateNames] = useState(false);
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
  const rosterTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const preferences = readPlatformPreferences(window.localStorage);
        setGameId(preferences.gameId);
        setRosterText(preferences.rosterText);
        setAllowDuplicateNames(preferences.allowDuplicateNames);
        setVisitedGameIds(new Set([preferences.gameId]));
      } catch {
        // Keep the safe defaults when browser storage cannot be read.
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
      // Storage can be unavailable in hardened/private browser contexts. The
      // controlled roster remains valid for this tab.
    }
  }, [preferencesReady, rosterText]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      writeLastGame(window.localStorage, gameId);
    } catch {
      // A storage failure must not block a game that is already usable.
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

  const selectedGame = useMemo(() => gameCatalogEntry(gameId), [gameId]);
  const gameActive = activityByGame[gameId];
  const navigationLocked = gameActive || rosterEditorOpen;
  const sharedRosterCount = useMemo(
    () => parseSharedRosterNames(rosterText).length,
    [rosterText],
  );
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
    document.title = `${selectedGame.label} · Ex Lab`;
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
    window.requestAnimationFrame(() => rosterTriggerRef.current?.focus());
  }, []);

  return (
    <div className="exlab-shell">
      <header
        className="exlab-header"
        inert={rosterEditorOpen}
        aria-hidden={rosterEditorOpen || undefined}
      >
        <span className="exlab-wordmark" aria-label="Ex Lab">
          Ex Lab
        </span>

        <div className="exlab-toolbar">
          <label className="exlab-select-field">
            <span className="exlab-field-caption">게임</span>
            <select
              value={gameId}
              onChange={handleGameChange}
              disabled={navigationLocked || !preferencesReady}
              aria-label="게임 선택"
              aria-describedby={navigationLocked ? "game-switch-lock" : undefined}
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

          <button
            ref={rosterTriggerRef}
            className="exlab-roster-trigger"
            type="button"
            disabled={gameActive || !preferencesReady}
            aria-haspopup="dialog"
            onClick={() => setRosterEditorOpen(true)}
          >
            참가자 <strong>{sharedRosterCount}명</strong>
          </button>

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
          GAME_CATALOG.filter((game) => visitedGameIds.has(game.id)).map((game) => {
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
