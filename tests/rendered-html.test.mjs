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
  assert.match(html, /<title>Ex Lab — Race<\/title>/i);
  assert.match(html, /Ex Lab/);
  assert.match(html, /경기 준비/);
  assert.match(html, />Race</);
  assert.match(html, /RACE · VERSION (?:<!-- -->)?1\.2\.1/);
  assert.match(html, /방송 화면 열기/);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("exposes grouping, physics-based results, map themes, and obstacle roles", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /전체 (?:<!-- -->)?8(?:<!-- -->)?명/);
  assert.match(html, /조당 최대 (?:<!-- -->)?10(?:<!-- -->)?명/);
  assert.match(html, /동일 이름/);
  assert.match(html, /미허용/);
  assert.match(html, /당첨 인원/);
  assert.doesNotMatch(html, /결과 선확정/);
  assert.doesNotMatch(html, /물리 결과형/);
  assert.match(html, /라이트/);
  assert.match(html, /다크/);
  assert.match(html, /고탄성 범퍼/);
  assert.match(html, /탄성 벽/);
  assert.match(html, /회전막대/);
  assert.match(html, /자동 배치 다시 만들기/);
});
