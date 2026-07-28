import {
  DEFAULT_STREAMER_THEME_ID,
  type StreamerThemeId,
} from "./streamerThemes";

export const THEME_CONFIRM_TRANSITION_MS = 420;
export const THEME_CONFIRM_BLINK_MS = 500;
export const THEME_CONFIRM_HOLD_MS = 2_000;

export type ThemeSelectionPhase =
  | "closed"
  | "choosing"
  | "confirming";

export type ThemeSelectionState = Readonly<{
  committedId: StreamerThemeId;
  draftId: StreamerThemeId;
  phase: ThemeSelectionPhase;
  required: boolean;
  confirmationToken: number;
}>;

export type ThemeSelectionEvent =
  | Readonly<{
      type: "hydrate";
      themeId: StreamerThemeId;
      required: boolean;
    }>
  | Readonly<{ type: "open" }>
  | Readonly<{ type: "preview"; themeId: StreamerThemeId }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "confirm" }>
  | Readonly<{ type: "confirmation-finished"; token: number }>;

export function createThemeSelectionState(
  themeId: StreamerThemeId = DEFAULT_STREAMER_THEME_ID,
): ThemeSelectionState {
  return {
    committedId: themeId,
    draftId: themeId,
    phase: "closed",
    required: false,
    confirmationToken: 0,
  };
}

export function effectiveStreamerThemeId(
  state: ThemeSelectionState,
): StreamerThemeId {
  return state.phase === "choosing"
    ? state.draftId
    : state.committedId;
}

export function themeSelectionReducer(
  state: ThemeSelectionState,
  event: ThemeSelectionEvent,
): ThemeSelectionState {
  switch (event.type) {
    case "hydrate":
      return {
        committedId: event.themeId,
        draftId: event.themeId,
        phase: event.required ? "choosing" : "closed",
        required: event.required,
        confirmationToken: state.confirmationToken,
      };

    case "open":
      if (state.phase !== "closed") return state;
      return {
        ...state,
        draftId: state.committedId,
        phase: "choosing",
        required: false,
      };

    case "preview":
      if (state.phase !== "choosing") return state;
      return state.draftId === event.themeId
        ? state
        : { ...state, draftId: event.themeId };

    case "cancel":
      if (state.phase !== "choosing" || state.required) return state;
      return {
        ...state,
        draftId: state.committedId,
        phase: "closed",
      };

    case "confirm":
      if (state.phase !== "choosing") return state;
      return {
        ...state,
        committedId: state.draftId,
        phase: "confirming",
        confirmationToken: state.confirmationToken + 1,
      };

    case "confirmation-finished":
      if (
        state.phase !== "confirming"
        || state.confirmationToken !== event.token
      ) {
        return state;
      }
      return {
        ...state,
        draftId: state.committedId,
        phase: "closed",
        required: false,
      };

    default:
      return state;
  }
}
