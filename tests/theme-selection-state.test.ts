import assert from "node:assert/strict";
import test from "node:test";
import {
  createThemeSelectionState,
  effectiveStreamerThemeId,
  themeSelectionReducer,
} from "../app/_platform/theme/themeSelectionState";

test("a required first visit opens with the stored theme as its draft", () => {
  const state = themeSelectionReducer(
    createThemeSelectionState(),
    { type: "hydrate", themeId: "eureka", required: true },
  );

  assert.deepEqual(state, {
    committedId: "eureka",
    draftId: "eureka",
    phase: "choosing",
    required: true,
    confirmationToken: 0,
  });
});

test("a returning visit hydrates into the closed state", () => {
  const state = themeSelectionReducer(
    createThemeSelectionState(),
    { type: "hydrate", themeId: "sena", required: false },
  );

  assert.equal(state.phase, "closed");
  assert.equal(state.committedId, "sena");
  assert.equal(state.draftId, "sena");
});

test("opening always resets a stale draft to the committed theme", () => {
  const initial = {
    ...createThemeSelectionState("torori"),
    draftId: "mangjing" as const,
  };
  const state = themeSelectionReducer(initial, { type: "open" });

  assert.equal(state.phase, "choosing");
  assert.equal(state.draftId, "torori");
});

test("preview changes only the effective theme", () => {
  const opened = themeSelectionReducer(
    createThemeSelectionState("amoretto"),
    { type: "open" },
  );
  const previewed = themeSelectionReducer(opened, {
    type: "preview",
    themeId: "mangjing",
  });

  assert.equal(previewed.committedId, "amoretto");
  assert.equal(previewed.draftId, "mangjing");
  assert.equal(effectiveStreamerThemeId(previewed), "mangjing");
});

test("cancel restores the committed theme and closes", () => {
  const opened = themeSelectionReducer(
    createThemeSelectionState("amoretto"),
    { type: "open" },
  );
  const previewed = themeSelectionReducer(opened, {
    type: "preview",
    themeId: "eureka",
  });
  const cancelled = themeSelectionReducer(previewed, {
    type: "cancel",
  });

  assert.equal(cancelled.phase, "closed");
  assert.equal(cancelled.committedId, "amoretto");
  assert.equal(cancelled.draftId, "amoretto");
  assert.equal(effectiveStreamerThemeId(cancelled), "amoretto");
});

test("required selection refuses cancellation", () => {
  const required = themeSelectionReducer(
    createThemeSelectionState(),
    { type: "hydrate", themeId: "amoretto", required: true },
  );

  assert.equal(
    themeSelectionReducer(required, { type: "cancel" }),
    required,
  );
});

test("confirm commits once and enters the presentation phase", () => {
  const opened = themeSelectionReducer(
    createThemeSelectionState("amoretto"),
    { type: "open" },
  );
  const previewed = themeSelectionReducer(opened, {
    type: "preview",
    themeId: "sena",
  });
  const confirming = themeSelectionReducer(previewed, {
    type: "confirm",
  });

  assert.equal(confirming.phase, "confirming");
  assert.equal(confirming.committedId, "sena");
  assert.equal(confirming.confirmationToken, 1);
  assert.equal(
    themeSelectionReducer(confirming, { type: "confirm" }),
    confirming,
  );
});

test("a required first visit stays non-cancellable until its presentation closes", () => {
  const required = themeSelectionReducer(
    createThemeSelectionState(),
    { type: "hydrate", themeId: "eureka", required: true },
  );
  const confirming = themeSelectionReducer(required, {
    type: "confirm",
  });
  const finished = themeSelectionReducer(confirming, {
    type: "confirmation-finished",
    token: confirming.confirmationToken,
  });

  assert.equal(confirming.phase, "confirming");
  assert.equal(confirming.required, true);
  assert.equal(finished.phase, "closed");
  assert.equal(finished.required, false);
});

test("confirming blocks preview, cancellation, and reopening", () => {
  const confirming = themeSelectionReducer(
    themeSelectionReducer(
      themeSelectionReducer(createThemeSelectionState(), {
        type: "open",
      }),
      { type: "preview", themeId: "torori" },
    ),
    { type: "confirm" },
  );

  assert.equal(
    themeSelectionReducer(confirming, {
      type: "preview",
      themeId: "eureka",
    }),
    confirming,
  );
  assert.equal(
    themeSelectionReducer(confirming, { type: "cancel" }),
    confirming,
  );
  assert.equal(
    themeSelectionReducer(confirming, { type: "open" }),
    confirming,
  );
});

test("only the matching confirmation token closes the dialog", () => {
  const confirming = themeSelectionReducer(
    themeSelectionReducer(createThemeSelectionState(), {
      type: "open",
    }),
    { type: "confirm" },
  );
  const stale = themeSelectionReducer(confirming, {
    type: "confirmation-finished",
    token: confirming.confirmationToken - 1,
  });
  const finished = themeSelectionReducer(confirming, {
    type: "confirmation-finished",
    token: confirming.confirmationToken,
  });

  assert.equal(stale, confirming);
  assert.equal(finished.phase, "closed");
  assert.equal(finished.draftId, finished.committedId);
});

test("a completed confirmation reopens as five-choice selection state", () => {
  const opened = themeSelectionReducer(
    createThemeSelectionState("eureka"),
    { type: "open" },
  );
  const previewed = themeSelectionReducer(opened, {
    type: "preview",
    themeId: "mangjing",
  });
  const confirming = themeSelectionReducer(previewed, {
    type: "confirm",
  });
  const finished = themeSelectionReducer(confirming, {
    type: "confirmation-finished",
    token: confirming.confirmationToken,
  });
  const reopened = themeSelectionReducer(finished, { type: "open" });

  assert.equal(reopened.phase, "choosing");
  assert.equal(reopened.committedId, "mangjing");
  assert.equal(reopened.draftId, "mangjing");
  assert.equal(reopened.required, false);
});
