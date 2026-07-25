import assert from "node:assert/strict";
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

test("server-renders the marble game preparation experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>Marble Showdown — 기능 테스트<\/title>/i);
  assert.match(html, /MARBLE SHOWDOWN/);
  assert.match(html, /경기 준비/);
  assert.match(html, /레또 드롭/);
  assert.match(html, /경기 시작/);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("exposes the ten-person limit and both result modes", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /8명이 레또 드롭에서 출발합니다/);
  assert.match(html, /결과 선확정/);
  assert.match(html, /물리 결과형/);
  assert.match(html, /자동 배치 다시 만들기/);
});
