import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
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
});

test("pins the integrated package and both game catalog entries to 1.3.2", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const catalogSource = await readFile(
    new URL("../app/_platform/catalog.ts", import.meta.url),
    "utf8",
  );

  assert.equal(packageJson.version, "1.3.2");
  assert.match(catalogSource, /id:\s*"roulette"[\s\S]*?version:\s*"1\.3\.2"/);
  assert.match(
    catalogSource,
    /id:\s*"showdown"[\s\S]*?version:\s*"1\.3\.2"/,
  );
});
