import assert from "node:assert/strict";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const outputDir = "/tmp/exlab-roulette-large-live";
const siteRoot = "/tmp/exlab-pages-site";
const pageUrl = "http://127.0.0.1:4173/exlab/";

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate?.includes("/")) return candidate;
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("No Chromium-compatible browser was found on the runner");
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError ?? "no response"}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
    });
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Chrome DevTools WebSocket failed to open"));
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
      };
      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return response.result?.value;
}

async function waitForEvaluation(client, expression, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(client, expression);
      if (lastValue) return lastValue;
    } catch {
      // The app may still be replacing its suspense boundary.
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

await rm(outputDir, { recursive: true, force: true });
await rm(siteRoot, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(`${siteRoot}/exlab`, { recursive: true });
await cp("dist-pages", `${siteRoot}/exlab`, { recursive: true });

const server = spawn(
  "python3",
  ["-m", "http.server", "4173", "--bind", "127.0.0.1", "--directory", siteRoot],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const browserPath = findBrowser();
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--remote-debugging-port=9222",
    `--user-data-dir=/tmp/exlab-chrome-${process.pid}`,
    "--window-size=2048,944",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

try {
  await waitForHttp(pageUrl);
  await waitForHttp("http://127.0.0.1:9222/json/version");
  const targetResponse = await fetch(
    `http://127.0.0.1:9222/json/new?${encodeURIComponent(pageUrl)}`,
    { method: "PUT" },
  );
  assert.equal(targetResponse.ok, true, "Chrome must create a validation tab");
  const target = await targetResponse.json();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 2048,
      height: 944,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: pageUrl });

    await waitForEvaluation(
      client,
      "document.readyState === 'complete' && Boolean(document.querySelector('.exlab-shell'))",
      "the Ex Lab shell",
    );

    const themeDialogVisible = await evaluate(
      client,
      "Boolean(document.querySelector('.exlab-theme-welcome'))",
    );
    if (themeDialogVisible) {
      await evaluate(
        client,
        "document.querySelector('.exlab-theme-welcome-actions .is-primary')?.click(); true",
      );
      await waitForEvaluation(
        client,
        "!document.querySelector('.exlab-theme-welcome')",
        "theme confirmation",
      );
    }

    await waitForEvaluation(
      client,
      "Boolean(document.querySelector('select[aria-label=\\"게임 선택\\"]'))",
      "the game selector",
    );
    await evaluate(
      client,
      `(() => {
        const select = document.querySelector('select[aria-label="게임 선택"]');
        if (!(select instanceof HTMLSelectElement)) return false;
        if (select.value !== 'roulette') {
          select.value = 'roulette';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      })()`,
    );

    await waitForEvaluation(
      client,
      "Boolean(document.querySelector('.roulette-game .exlab-setup-workspace__primary-action button'))",
      "Roulette setup action",
    );
    await waitForEvaluation(
      client,
      `(() => {
        const button = document.querySelector('.roulette-game .exlab-setup-workspace__primary-action button');
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`,
      "enabled Roulette setup action",
    );
    await evaluate(
      client,
      "document.querySelector('.roulette-game .exlab-setup-workspace__primary-action button')?.click(); true",
    );

    await waitForEvaluation(
      client,
      "Boolean(document.querySelector('.roulette-game .app-shell--live'))",
      "Roulette live shell",
    );
    await waitForEvaluation(
      client,
      `(() => {
        const button = document.querySelector('.roulette-game [data-action-id="start-draw"]');
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`,
      "ready Roulette draw action",
      30_000,
    );
    await evaluate(
      client,
      "document.querySelector('.roulette-game [data-action-id=\\"start-draw\\"]')?.click(); true",
    );

    await waitForEvaluation(
      client,
      `(() => {
        const focus = document.querySelector('.roulette-game .broadcast-focus.is-stage-only');
        return Boolean(
          focus
          && focus.querySelector(':scope > .broadcast-focus__results')
          && focus.querySelector(':scope > .broadcast-focus__action')
        );
      })()`,
      "the persistent motion frame",
    );
    await delay(180);

    const geometry = await evaluate(
      client,
      `(() => {
        const read = (selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
          };
        };
        const shell = document.querySelector('.roulette-game > .app-shell.app-shell--live.is-embedded');
        const focus = document.querySelector('.roulette-game .broadcast-focus.is-stage-only');
        const focusStyle = focus ? getComputedStyle(focus) : null;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          zoom: shell ? Number(getComputedStyle(shell).zoom || 1) : 0,
          gridTemplateAreas: focusStyle?.gridTemplateAreas ?? '',
          shell: read('.roulette-game > .app-shell.app-shell--live.is-embedded'),
          focus: read('.roulette-game .broadcast-focus.is-stage-only'),
          roster: read('.roulette-game .broadcast-focus.is-stage-only > .broadcast-candidate-roster'),
          stage: read('.roulette-game .broadcast-focus.is-stage-only > .broadcast-focus__stage'),
          results: read('.roulette-game .broadcast-focus.is-stage-only > .broadcast-focus__results'),
          action: read('.roulette-game .broadcast-focus.is-stage-only > .broadcast-focus__action'),
          wheel: read('.roulette-game .broadcast-focus.is-stage-only .roulette-wheel__rim'),
          documentSize: {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          },
        };
      })()`,
    );

    assert.equal(geometry.viewport.width, 2048);
    assert.equal(geometry.viewport.height, 944);
    assert.ok(geometry.zoom >= 1.119 && geometry.zoom <= 1.121, `expected 1.12 zoom, got ${geometry.zoom}`);
    assert.match(geometry.gridTemplateAreas, /roster stage results/);
    assert.match(geometry.gridTemplateAreas, /action action results/);
    assert.ok(geometry.roster && geometry.roster.width >= 150, "participant rail must stay visible");
    assert.ok(geometry.results && geometry.results.width >= 320, "result rail must stay visible");
    assert.equal(geometry.results.display, "grid");
    assert.equal(geometry.results.visibility, "visible");
    assert.ok(geometry.results.opacity >= 0.99);
    assert.ok(geometry.action && geometry.action.height >= 44, "action dock must stay visible");
    assert.equal(geometry.action.display, "grid");
    assert.equal(geometry.action.visibility, "visible");
    assert.ok(geometry.stage && geometry.results.x > geometry.stage.right - 2);
    assert.ok(geometry.roster.right <= geometry.stage.x + 2);
    assert.ok(geometry.action.y >= geometry.stage.y);
    assert.ok(geometry.wheel && geometry.wheel.width >= 480, "large-screen wheel must fill the stage");
    assert.ok(geometry.documentSize.width <= 2050, "large layout must not overflow horizontally");

    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    await writeFile(`${outputDir}/roulette-large-spin.png`, screenshot.data, "base64");
    await writeFile(
      `${outputDir}/roulette-large-spin-geometry.json`,
      `${JSON.stringify(geometry, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(geometry, null, 2));
  } finally {
    client.close();
  }
} finally {
  server.kill("SIGTERM");
  browser.kill("SIGTERM");
  await Promise.allSettled([once(server, "exit"), once(browser, "exit")]);
}
