import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * This suite renders the built worker, so it needs `npm run build` first and
 * only runs under `npm run test:ci`. `npm test` covers the source-level tests
 * without paying for a build.
 */
async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  if (!existsSync(new URL("../dist/server/index.js", import.meta.url))) {
    throw new Error(
      "dist/server/index.js is missing. Run `npm run test:ci` (or `npm run build`) "
        + "before running this suite.",
    );
  }
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the practical exlab shell while preferences load", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>exlab<\/title>/i);
  assert.match(html, /exlab/i);
  assert.match(html, />Showdown</);
  assert.match(html, />Roulette</);
  assert.match(html, /게임 선택/);
  assert.match(html, /설정 불러오는 중/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /RACE · VERSION/);
  assert.doesNotMatch(html, /경기 준비/);
  assert.doesNotMatch(html, /방송 화면 열기/);
  assert.doesNotMatch(html, /모든 이름이 조별 Race로 이어집니다/);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
  const portraitPreloads = [...html.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter(
      (tag) =>
        /\brel="preload"/.test(tag)
        && /\bas="image"/.test(tag)
        && /\bhref="\/themes\/streamers\/[^"]+\.webp"/.test(tag),
    );
  assert.equal(portraitPreloads.length, 4);
  assert.equal(
    new Set(
      portraitPreloads.map(
        (tag) => tag.match(/\bhref="([^"]+)"/)?.[1],
      ),
    ).size,
    4,
  );
});

test("pins the integrated package and both game catalog entries to 1.3.37", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const [catalogSource, showdownSource, readmeSource] = await Promise.all([
    readFile(new URL("../app/_platform/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/games/showdown/ShowdownGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.equal(packageJson.version, "1.3.37");
  assert.match(catalogSource, /id:\s*"roulette"[\s\S]*?version:\s*"1\.3\.37"/);
  assert.match(
    catalogSource,
    /id:\s*"showdown"[\s\S]*?version:\s*"1\.3\.37"/,
  );
  assert.match(showdownSource, /SHOWDOWN · VERSION 1\.3\.37/);
  assert.match(readmeSource, /현재 버전은 `1\.3\.37`/);
});
