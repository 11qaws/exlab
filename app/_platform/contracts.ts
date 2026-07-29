import type { SharedRosterSnapshot } from "./sharedRosterSnapshot";
import type { StreamerThemeId } from "./theme/streamerThemes";

/**
 * Shared lifecycle vocabulary for every exlab game.
 *
 * Game engines may have more detailed internal phases. They map those phases to
 * this small platform lifecycle so the host can protect cross-game actions
 * without learning engine-specific state.
 */
export const GAME_LIFECYCLE_STATES = [
  "editing",
  "generating",
  "waiting",
  "active",
  "settling",
  "result",
  "failed",
] as const;

export type GameLifecycleState = (typeof GAME_LIFECYCLE_STATES)[number];

export const GAME_LIFECYCLE_TRANSITIONS = {
  editing: ["generating", "waiting"],
  generating: ["waiting", "editing", "failed"],
  waiting: ["active", "editing"],
  active: ["settling", "failed"],
  settling: ["result", "failed"],
  result: ["generating", "waiting", "active", "editing"],
  failed: ["editing"],
} as const satisfies Readonly<
  Record<GameLifecycleState, readonly GameLifecycleState[]>
>;

export const GAME_SWITCH_LOCKING_STATES = [
  "generating",
  "waiting",
  "active",
  "settling",
  "result",
  "failed",
] as const satisfies readonly GameLifecycleState[];

export function isGameSwitchLocked(state: GameLifecycleState): boolean {
  return (GAME_SWITCH_LOCKING_STATES as readonly GameLifecycleState[]).includes(
    state,
  );
}

/**
 * Runtime projection reported by a game adapter to the common shell.
 *
 * `lifecycle` is the single source of truth for navigation locking. Labels are
 * presentation-only and must never be used to infer lifecycle transitions.
 */
export type GameHostState = {
  lifecycle: GameLifecycleState;
  statusLabel?: string;
  sessionId?: string;
  runId?: string;
};

export const INITIAL_GAME_HOST_STATE: GameHostState = {
  lifecycle: "editing",
};

export type GameCapabilities = {
  grouping: false | "optional" | "required";
  configurableWinnerCount: boolean;
  replay: boolean;
  maxParticipantsPerRun: number | null;
};

/**
 * Data-only catalog entry. Do not add components, callbacks, or browser objects:
 * the same catalog must remain serializable for menus, history, and future APIs.
 */
export type GameCatalogEntry<TId extends string = string> = {
  id: TId;
  label: string;
  slug: string;
  version: string;
  capabilities: GameCapabilities;
};

/**
 * Required adapter contract for a game mounted by the Ex Lab shell.
 *
 * Standalone wrappers may make these values optional and provide local state,
 * but the embedded surface receives one stable roster snapshot and reports an
 * explicit lifecycle instead of a lossy activity boolean.
 */
export type EmbeddedGameHostProps = {
  embedded: true;
  visible: boolean;
  streamerThemeId: StreamerThemeId;
  roster: SharedRosterSnapshot;
  onRequestRosterEdit: () => void;
  onHostStateChange: (state: GameHostState) => void;
};

/**
 * One-release compatibility bridge for the two former standalone engines.
 * New shell integrations must use `EmbeddedGameHostProps`.
 */
export type LegacyEmbeddedGameProps = {
  /** @deprecated Use `visible`. */
  active?: boolean;
  /** @deprecated Read names and ids from `roster`. */
  rosterText?: string;
  /** @deprecated The policy is part of `roster`. */
  allowDuplicateNames?: boolean;
  /** @deprecated Embedded games request the shared editor instead. */
  onRosterTextChange?: (nextRosterText: string) => void;
  /** @deprecated Embedded games request the shared editor instead. */
  onAllowDuplicateNamesChange?: (allow: boolean) => void;
  /** @deprecated Report `onHostStateChange` with a lifecycle. */
  onActivityChange?: (active: boolean) => void;
};

type StandaloneGameProps =
  & Omit<Partial<EmbeddedGameHostProps>, "embedded">
  & { embedded?: false | undefined }
  & LegacyEmbeddedGameProps;

export type EmbeddedGameProps =
  | (EmbeddedGameHostProps & LegacyEmbeddedGameProps)
  | StandaloneGameProps;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RosterEntry = {
  id: string;
  name: string;
  number: number;
  themeKey: string;
};

/**
 * Common result envelope for history and future full-package aggregation.
 * Engine-only details stay under `payload` and never drive another game.
 */
export type GameResultEnvelope<
  TPayload extends JsonValue = JsonValue,
> = {
  schemaVersion: 1;
  gameId: string;
  sessionId: string;
  runId: string;
  committedAt: string;
  revealedAt?: string;
  participantSnapshot: RosterEntry[];
  winnerIds: string[];
  rankedParticipantIds?: string[];
  metrics?: Record<string, string | number>;
  payload: TPayload;
};
