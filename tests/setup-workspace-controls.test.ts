import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SETUP_CHOICE_CONTROL_VARIANTS,
  SETUP_OPTION_GROUP_KINDS,
  SETUP_READINESS_TONES,
  SetupChoiceControl,
  SetupOptionGroup,
  SetupOptionRow,
  SetupPrimaryActionButton,
  SetupReadinessStatus,
} from "../app/_platform/components/SetupControls";
import type {
  SetupWorkspaceProps,
} from "../app/_platform/components/SetupWorkspace";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const workspaceSource = read(
  "../app/_platform/components/SetupWorkspace.tsx",
);
const workspaceCss = read(
  "../app/_platform/components/SetupWorkspace.css",
);

test("structured setup readiness exposes every shared tone", () => {
  assert.deepEqual(SETUP_READINESS_TONES, [
    "ready",
    "blocked",
    "busy",
    "recoverable",
  ]);

  const html = renderToStaticMarkup(
    createElement(SetupReadinessStatus, {
      tone: "recoverable",
      label: "이전 세션을 이어갈 수 있습니다.",
      detail: "복구하거나 새 세션으로 시작하세요.",
    }),
  );

  assert.match(html, /data-tone="recoverable"/);
  assert.match(html, /이전 세션을 이어갈 수 있습니다/);
  assert.match(html, /복구하거나 새 세션으로 시작하세요/);
  assert.match(html, /aria-hidden="true"/);
});

test("structured primary action prevents duplicate busy presses", () => {
  const html = renderToStaticMarkup(
    createElement(SetupPrimaryActionButton, {
      label: "방송 화면 준비 중",
      disabled: false,
      busy: true,
      onPress: () => undefined,
    }),
  );

  assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-busy="true"/);
});

test("workspace accepts structured and legacy action-bar contracts", () => {
  const shared = {
    title: "설정",
    sharedSetup: "명단",
    essentialSettings: "옵션",
    previewHeader: "미리보기",
    previewStage: "화면",
  } as const;

  const structured: SetupWorkspaceProps = {
    ...shared,
    readinessModel: {
      tone: "ready",
      label: "시작할 수 있습니다.",
    },
    primaryActionModel: {
      label: "방송 화면 열기",
      disabled: false,
      busy: false,
      onPress: () => undefined,
    },
  };
  const legacy: SetupWorkspaceProps = {
    ...shared,
    readiness: "시작할 수 있습니다.",
    primaryAction: "기존 버튼",
  };

  assert.equal(structured.readinessModel.tone, "ready");
  assert.equal(legacy.readiness, "시작할 수 있습니다.");
  assert.match(
    workspaceSource,
    /readinessModel\?\.tone === "busy"/,
  );
  assert.match(
    workspaceSource,
    /primaryActionModel\?\.busy/,
  );
  assert.match(
    workspaceSource,
    /aria-busy=\{resolvedBusy \|\| undefined\}/,
  );
});

test("option groups use one alignment contract per input type", () => {
  assert.deepEqual(SETUP_OPTION_GROUP_KINDS, [
    "text",
    "choice",
    "number",
    "toggle",
  ]);

  const html = renderToStaticMarkup(
    createElement(
      SetupOptionGroup,
      {
        kind: "number",
        label: "인원 설정",
      },
      createElement(
        SetupOptionRow,
        { label: "당첨 인원" },
        createElement("button", { type: "button" }, "감소"),
        createElement("output", null, "3"),
        createElement("button", { type: "button" }, "증가"),
      ),
    ),
  );

  assert.match(html, /<fieldset[^>]+data-option-kind="number"/);
  assert.match(html, /exlab-setup-option-row__control/);
  assert.match(
    workspaceCss,
    /grid-template-columns:\s*40px minmax\(64px, 1fr\) 40px/,
  );
  assert.match(
    workspaceCss,
    /\.exlab-setup-option-group\s*\+\s*\.exlab-setup-option-group[\s\S]*?border-block-start/,
  );
  assert.doesNotMatch(
    workspaceCss,
    /\.exlab-setup-option-group\s*\{[^}]*background:/,
  );
});

test("choice controls share height across segmented and scroll variants", () => {
  assert.deepEqual(SETUP_CHOICE_CONTROL_VARIANTS, [
    "segmented",
    "scroll-strip",
  ]);

  const html = renderToStaticMarkup(
    createElement(
      SetupChoiceControl,
      {
        variant: "segmented",
        ariaLabel: "추첨 방식",
      },
      createElement("button", { type: "button" }, "룰렛"),
      createElement("button", { type: "button" }, "다트"),
    ),
  );

  assert.match(html, /data-choice-variant="segmented"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="추첨 방식"/);
  assert.match(
    workspaceCss,
    /--exlab-setup-choice-height:\s*40px/,
  );
  assert.match(
    workspaceCss,
    /data-choice-variant="scroll-strip"[\s\S]*?overflow-x:\s*auto/,
  );
});

test("shared controls keep theme feedback and reduced-motion behavior", () => {
  assert.match(
    workspaceCss,
    /\.exlab-setup-primary-action-button[\s\S]*?var\(--exlab-accent/,
  );
  assert.match(
    workspaceCss,
    /\.exlab-setup-primary-action-button\[data-busy="true"\][\s\S]*?cursor: wait/,
  );
  assert.match(
    workspaceCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?exlab-setup-readiness-status\[data-tone="busy"\][\s\S]*?animation: none/,
  );
});
