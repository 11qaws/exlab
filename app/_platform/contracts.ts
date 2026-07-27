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
  editing: ["generating"],
  generating: ["waiting", "editing"],
  waiting: ["active", "editing"],
  active: ["settling", "failed"],
  settling: ["result"],
  result: ["generating", "editing"],
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
 * Minimum adapter contract between the common shell and a game engine.
 *
 * `onActivityChange(true)` means leaving this game would discard or interrupt a
 * prepared/running/result session, so the common game switcher must be locked.
 */
export type EmbeddedGameProps = {
  embedded?: boolean;
  active?: boolean;
  rosterText: string;
  onRosterTextChange: (nextRosterText: string) => void;
  allowDuplicateNames: boolean;
  onAllowDuplicateNamesChange: (allow: boolean) => void;
  onRequestRosterEdit: () => void;
  onActivityChange: (active: boolean) => void;
};

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
