import { readFile, writeFile } from "node:fs/promises";

const text = (...lines) => lines.join("\n");

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`${label}: target text was not found`);
  const second = source.indexOf(search, first + search.length);
  if (second >= 0) throw new Error(`${label}: target text was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceAllChecked(source, search, replacement, label, minimum = 1) {
  const count = source.split(search).length - 1;
  if (count < minimum) {
    throw new Error(`${label}: expected at least ${minimum} matches, found ${count}`);
  }
  return source.split(search).join(replacement);
}

function appendInsideFinalScope(source, addition, label) {
  const closing = source.lastIndexOf("\n}");
  if (closing < 0 || source.slice(closing).trim() !== "}") {
    throw new Error(`${label}: final @scope closing brace was not found`);
  }
  return `${source.slice(0, closing)}\n\n${addition.trim()}\n${source.slice(closing)}`;
}

async function patchFile(path, transform) {
  const source = await readFile(path, "utf8");
  const next = transform(source);
  if (next === source) throw new Error(`${path}: patch produced no changes`);
  await writeFile(path, next, "utf8");
}

await patchFile("app/games/roulette/RouletteGame.tsx", (source) => {
  let next = source;

  next = replaceOnce(
    next,
    text(
      "  const isStageOnly =",
      "    raffleStatus === 'locking' || presentationBeat === 'motion';",
      "  const showWinnerHeroPanel = (",
      "    presentationBeat === 'hero' || presentationBeat === 'dock'",
      "  ) && winnerHero !== null;",
      "  const showResultsPanel = !isStageOnly && (",
      "    visibleSessionResults.length > 0 ||",
      "    raffleStatus === 'completed' ||",
      "    presentationBeat === 'dock'",
      "  );",
    ),
    text(
      "  const isStageOnly =",
      "    raffleStatus === 'locking' || presentationBeat === 'motion';",
      "  const isPresentationRunning =",
      "    raffleStatus === 'locking' || raffleStatus === 'presenting';",
      "  const showWinnerHeroPanel = (",
      "    presentationBeat === 'hero' || presentationBeat === 'dock'",
      "  ) && winnerHero !== null;",
      "  const showResultsPanel = isStageOnly || (",
      "    visibleSessionResults.length > 0 ||",
      "    raffleStatus === 'completed' ||",
      "    presentationBeat === 'dock'",
      "  );",
    ),
    "keep live rails mounted during presentation",
  );

  next = replaceOnce(
    next,
    "  const actionNote = raffleStatus === 'completed'\n",
    text(
      "  const actionNote = raffleStatus === 'locking'",
      "    ? `진행 ${sessionProgress}/${sessionGoal} · 클릭 순간 결과를 고정했습니다.`",
      "    : raffleStatus === 'presenting'",
      "      ? `진행 ${sessionProgress}/${sessionGoal} · 추첨 연출이 끝나면 결과판이 갱신됩니다.`",
      "      : raffleStatus === 'completed'",
    ) + "\n",
    "presentation action note",
  );

  next = replaceOnce(
    next,
    "  const completedPrimaryLabel = noAvailableDrawOptions\n",
    text(
      "  const presentingPrimaryAction: BroadcastDockAction = {",
      "    id: 'presentation-running',",
      "    label: raffleStatus === 'locking' ? '결과 고정 중…' : '결과 공개 중…',",
      "    onClick: () => undefined,",
      "    disabled: true,",
      "  };",
      "  const presentingSecondaryActions: BroadcastDockAction[] = [",
      "    {",
      "      id: 'presentation-pause-locked',",
      "      label: '설계로 일시정지',",
      "      onClick: () => undefined,",
      "      disabled: true,",
      "      tone: 'quiet',",
      "      title: '연출이 끝나면 사용할 수 있습니다.',",
      "    },",
      "    {",
      "      id: 'presentation-tools-locked',",
      "      label: '명단 · 기록 잠김',",
      "      onClick: () => undefined,",
      "      disabled: true,",
      "      tone: 'quiet',",
      "      title: '결과 공개 중에는 명단과 기록 도구가 잠깁니다.',",
      "    },",
      "  ];",
      "  const completedPrimaryLabel = noAvailableDrawOptions",
    ) + "\n",
    "presentation dock actions",
  );

  next = replaceOnce(
    next,
    "        {(raffleStatus === 'ready' || raffleStatus === 'completed') && (",
    "        {(raffleStatus === 'ready' || isPresentationRunning || raffleStatus === 'completed') && (",
    "mount action dock during presentation",
  );

  next = replaceOnce(
    next,
    text(
      "            {raffleStatus === 'completed' && (",
      "              <BroadcastActionDock",
    ),
    text(
      "            {isPresentationRunning && (",
      "              <BroadcastActionDock",
      "                phase=\"presenting\"",
      "                ariaLabel=\"추첨 진행 상태\"",
      "                note={actionNote}",
      "                primaryAction={presentingPrimaryAction}",
      "                secondaryActions={presentingSecondaryActions}",
      "              />",
      "            )}",
      "            {raffleStatus === 'completed' && (",
      "              <BroadcastActionDock",
    ),
    "render presentation dock",
  );

  return next;
});

await patchFile(
  "app/games/roulette/components/BroadcastActionDock.tsx",
  (source) => replaceOnce(
    source,
    "export type BroadcastActionDockPhase = 'ready' | 'completed';",
    "export type BroadcastActionDockPhase = 'ready' | 'presenting' | 'completed';",
    "presentation dock phase type",
  ),
);

await patchFile("app/games/roulette/styles/roulette-viewport.css", (source) => {
  const oldSelector = text(
    "  :scope .app-shell--live :is(",
    "    .broadcast-action-dock--ready,",
    "    .broadcast-action-dock--completed",
    "  )",
  );
  const newSelector = text(
    "  :scope .app-shell--live :is(",
    "    .broadcast-action-dock--ready,",
    "    .broadcast-action-dock--presenting,",
    "    .broadcast-action-dock--completed",
    "  )",
  );
  return replaceAllChecked(
    source,
    oldSelector,
    newSelector,
    "viewport phase-aware dock selectors",
    6,
  );
});

await patchFile("app/games/roulette/styles/roulette-live-info.css", (source) => appendInsideFinalScope(
  source,
  text(
    "/* Roomy broadcast canvases keep the same operational frame while the",
    "   wheel is moving. The compact desktop and mobile contracts below 1181px",
    "   remain unchanged so the wheel never fights the controls for space. */",
    "@media (min-width: 1181px) and (min-height: 720px) {",
    "  :scope .app-shell--live .broadcast-focus.is-stage-only {",
    "    grid-template-areas:",
    "      'roster stage results'",
    "      'action action results';",
    "    grid-template-columns:",
    "      clamp(10rem, 11vw, 13.5rem)",
    "      minmax(0, 1fr)",
    "      clamp(19rem, 23vw, 29rem);",
    "    grid-template-rows: minmax(0, 1fr) auto;",
    "  }",
    "",
    "  :scope .app-shell--live .broadcast-focus.is-stage-only",
    "    > .broadcast-focus__results {",
    "    display: grid;",
    "    visibility: visible;",
    "    opacity: 1;",
    "    pointer-events: none;",
    "    transition: none;",
    "  }",
    "",
    "  :scope .app-shell--live .broadcast-focus.is-stage-only",
    "    > .broadcast-focus__action {",
    "    display: grid;",
    "    visibility: visible;",
    "    opacity: 1;",
    "    pointer-events: none;",
    "    transition: none;",
    "  }",
    "",
    "  :scope .app-shell--live .broadcast-action-dock--presenting",
    "    .broadcast-action-dock__button:disabled {",
    "    cursor: progress;",
    "    opacity: 0.78;",
    "  }",
    "}",
  ),
  "large live-frame rules",
));

await patchFile("app/games/roulette/styles/roulette-embed.css", (source) => appendInsideFinalScope(
  source,
  text(
    "/* Above the 1440px design baseline, enlarge the complete live shell rather",
    "   than growing only the wheel. Inverse dimensions keep the zoomed shell",
    "   inside the shared Ex Lab stage; smaller windows continue through the",
    "   existing responsive breakpoints without any scale transform. */",
    "@supports (zoom: 1) {",
    "  @media (min-width: 1600px) and (min-height: 850px) {",
    "    :scope > .app-shell.app-shell--live.is-embedded {",
    "      width: 94.3396%;",
    "      height: 94.3396% !important;",
    "      zoom: 1.06;",
    "    }",
    "  }",
    "",
    "  @media (min-width: 1920px) and (min-height: 900px) {",
    "    :scope > .app-shell.app-shell--live.is-embedded {",
    "      width: 89.2857%;",
    "      height: 89.2857% !important;",
    "      zoom: 1.12;",
    "    }",
    "  }",
    "",
    "  @media (min-width: 2400px) and (min-height: 1080px) {",
    "    :scope > .app-shell.app-shell--live.is-embedded {",
    "      width: 84.7458%;",
    "      height: 84.7458% !important;",
    "      zoom: 1.18;",
    "    }",
    "  }",
    "",
    "  @media (min-width: 2880px) and (min-height: 1200px) {",
    "    :scope > .app-shell.app-shell--live.is-embedded {",
    "      width: 80.6452%;",
    "      height: 80.6452% !important;",
    "      zoom: 1.24;",
    "    }",
    "  }",
    "}",
  ),
  "large embedded scale rules",
));

const testSource = text(
  'import assert from "node:assert/strict";',
  'import { readFile } from "node:fs/promises";',
  'import test from "node:test";',
  '',
  'const rouletteSourceUrl = new URL("../app/games/roulette/RouletteGame.tsx", import.meta.url);',
  'const dockSourceUrl = new URL("../app/games/roulette/components/BroadcastActionDock.tsx", import.meta.url);',
  'const viewportCssUrl = new URL("../app/games/roulette/styles/roulette-viewport.css", import.meta.url);',
  'const liveInfoCssUrl = new URL("../app/games/roulette/styles/roulette-live-info.css", import.meta.url);',
  'const embedCssUrl = new URL("../app/games/roulette/styles/roulette-embed.css", import.meta.url);',
  '',
  'test("Roulette keeps the result board and action dock mounted while a result is presented", async () => {',
  '  const source = await readFile(rouletteSourceUrl, "utf8");',
  '',
  '  assert.ok(source.includes("const showResultsPanel = isStageOnly || ("));',
  '  assert.ok(source.includes("raffleStatus === \'ready\' || isPresentationRunning || raffleStatus === \'completed\'"));',
  '  assert.ok(source.includes("phase=\\\"presenting\\\""));',
  '  assert.ok(source.includes("primaryAction={presentingPrimaryAction}"));',
  '  assert.ok(source.includes("secondaryActions={presentingSecondaryActions}"));',
  '});',
  '',
  'test("the action dock exposes a distinct non-interactive presentation phase", async () => {',
  '  const source = await readFile(dockSourceUrl, "utf8");',
  '  assert.ok(source.includes("\'ready\' | \'presenting\' | \'completed\'"));',
  '});',
  '',
  'test("roomy motion frames retain roster, stage, results and action grid areas", async () => {',
  '  const css = await readFile(liveInfoCssUrl, "utf8");',
  '',
  '  assert.ok(css.includes("@media (min-width: 1181px) and (min-height: 720px)"));',
  '  assert.ok(css.includes("\'roster stage results\'"));',
  '  assert.ok(css.includes("\'action action results\'"));',
  '  assert.match(css, /is-stage-only[\\s\\S]*> \\.broadcast-focus__results[\\s\\S]*display: grid;/);',
  '  assert.match(css, /is-stage-only[\\s\\S]*> \\.broadcast-focus__action[\\s\\S]*visibility: visible;/);',
  '});',
  '',
  'test("every desktop action-dock geometry rule also recognizes presenting", async () => {',
  '  const css = await readFile(viewportCssUrl, "utf8");',
  '  const phaseGroups = css.match(/\\.broadcast-action-dock--ready,[\\s\\S]*?\\.broadcast-action-dock--completed/g) ?? [];',
  '  assert.ok(phaseGroups.length >= 6);',
  '  assert.ok(phaseGroups.every((group) => group.includes(".broadcast-action-dock--presenting")));',
  '});',
  '',
  'test("large embedded screens scale the whole live shell and stop below the desktop threshold", async () => {',
  '  const css = await readFile(embedCssUrl, "utf8");',
  '',
  '  assert.ok(css.includes("@supports (zoom: 1)"));',
  '  assert.match(css, /min-width: 1600px[\\s\\S]*zoom: 1\\.06/);',
  '  assert.match(css, /min-width: 1920px[\\s\\S]*zoom: 1\\.12/);',
  '  assert.match(css, /min-width: 2880px[\\s\\S]*zoom: 1\\.24/);',
  '  assert.ok(css.includes("@media (max-width: 620px), (max-height: 599px)"));',
  '});',
  '',
) + "\n";
await writeFile("tests/roulette-large-live-layout.test.ts", testSource, "utf8");

await patchFile("DEVELOPMENT_LOG.md", (source) => replaceOnce(
  source,
  "# Development Log\n\n",
  text(
    "# Development Log",
    "",
    "## 2026-08-06 Roulette 대형 라이브 프레임 유지",
    "",
    "- 추첨 결과를 고정하고 공개하는 동안에도 대형 화면에서는 참여자 명단, 실제 누적 결과판과 비활성 진행 도크를 DOM과 그리드에 유지한다. 룰렛만 남기던 stage-only 구성은 1180px 이하 또는 낮은 화면에서만 사용해 작은 화면의 판독 공간을 보존한다.",
    "- 1600×850부터 embedded 라이브 셸 전체를 단계적으로 확대하고 역비율 폭·높이를 적용해 원판, 레일, 결과판, 버튼과 글자가 같은 비율로 커지도록 했다. 1440px 이하의 기존 반응형 구간과 모바일 순서는 변경하지 않았다.",
    "- presentation 전용 도크 상태와 대형 화면 그리드·확대 임계값을 고정하는 회귀 테스트를 추가했다.",
    "",
  ),
  "development log entry",
));

console.log("Roulette large-live-layout patch applied.");
