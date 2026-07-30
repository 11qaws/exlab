import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const appDirUrl = new URL("../app/", import.meta.url);
const shellCssUrl = new URL("globals.css", appDirUrl);

const TYPE_STEPS = [
  "--exlab-text-2xs",
  "--exlab-text-xs",
  "--exlab-text-sm",
  "--exlab-text-md",
  "--exlab-text-lg",
  "--exlab-text-xl",
  "--exlab-text-2xl",
  "--exlab-text-display",
] as const;

const SPACE_STEPS = [
  "--exlab-space-3xs",
  "--exlab-space-2xs",
  "--exlab-space-xs",
  "--exlab-space-sm",
  "--exlab-space-md",
  "--exlab-space-lg",
  "--exlab-space-xl",
  "--exlab-space-2xl",
  "--exlab-space-3xl",
] as const;

const RADIUS_STEPS = [
  "--exlab-radius-sm",
  "--exlab-radius-md",
  "--exlab-radius-lg",
  "--exlab-radius-pill",
] as const;

const CONTROL_STEPS = [
  "--exlab-control-xs",
  "--exlab-control-sm",
  "--exlab-control-md",
  "--exlab-control-lg",
] as const;

async function readShellCss(): Promise<string> {
  return readFile(shellCssUrl, "utf8");
}

/** Every stylesheet under app/, so a new game cannot quietly opt out. */
async function readAppStylesheets(): Promise<
  { name: string; source: string }[]
> {
  const entries = await readdir(appDirUrl, {
    recursive: true,
    withFileTypes: true,
  });
  const sheets: { name: string; source: string }[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
    if (entry.name === "globals.css") continue;
    sheets.push({
      name: entry.name,
      source: await readFile(join(entry.parentPath, entry.name), "utf8"),
    });
  }

  assert.ok(sheets.length > 0, "expected stylesheets under app/");
  return sheets;
}

/** The `:root` block owns every step. Everything after it consumes them. */
function splitScaleFromUsage(css: string): { scale: string; usage: string } {
  const rootStart = css.indexOf(":root {");
  assert.ok(rootStart >= 0, "the shell must declare a :root scale block");
  const rootEnd = css.indexOf("\n}", rootStart);
  assert.ok(rootEnd > rootStart, ":root block must be closed");
  return { scale: css.slice(rootStart, rootEnd), usage: css.slice(rootEnd) };
}

test("the shell declares one ruler for type, space, radius and controls", async () => {
  const { scale } = splitScaleFromUsage(await readShellCss());

  for (const step of [
    ...TYPE_STEPS,
    ...SPACE_STEPS,
    ...RADIUS_STEPS,
    ...CONTROL_STEPS,
  ]) {
    assert.ok(
      scale.includes(`${step}:`),
      `${step} must be declared in the shell scale`,
    );
  }
});

test("shell rules pick a type step instead of a raw px font size", async () => {
  const { usage } = splitScaleFromUsage(await readShellCss());

  assert.deepEqual(
    usage.match(/font-size:\s*[0-9.]+px/g) ?? [],
    [],
    "font sizes outside the scale block must use --exlab-text-* steps",
  );
});

test("shell rules pick a radius step instead of a raw px radius", async () => {
  const { usage } = splitScaleFromUsage(await readShellCss());

  assert.deepEqual(
    usage.match(/border-radius:\s*[0-9.]+px/g) ?? [],
    [],
    "radii outside the scale block must use --exlab-radius-* steps",
  );
});

test("the header owns its height and full-height surfaces derive from it", async () => {
  const css = await readShellCss();
  const { scale, usage } = splitScaleFromUsage(css);

  assert.ok(
    scale.includes("--exlab-header-height:"),
    "the header height must be declared once in the scale block",
  );
  assert.match(
    scale,
    /--exlab-stage-min-height:\s*calc\(100svh - var\(--exlab-header-height\)\)/,
  );
  assert.match(
    scale,
    /--exlab-stage-height-dynamic:\s*calc\(100dvh - var\(--exlab-header-height\)\)/,
  );

  // Re-deriving the stage height per surface is what let setup screens drift
  // between releases. Exactly one place may own each subtraction.
  assert.equal(
    (css.match(/100svh\s*-\s*var\(--exlab-header-height\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (css.match(/100dvh\s*-\s*var\(--exlab-header-height\)/g) ?? []).length,
    1,
  );
  assert.ok(
    (usage.match(/var\(--exlab-stage-min-height\)/g) ?? []).length >= 1,
    "full-height surfaces must consume --exlab-stage-min-height",
  );
});

test("no stylesheet outside the shell subtracts the header height itself", async () => {
  const offenders: string[] = [];

  for (const { name, source } of await readAppStylesheets()) {
    if (/var\(\s*--exlab-header-height/.test(source)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    "consume --exlab-stage-min-height / --exlab-stage-height-dynamic instead "
      + "of re-deriving the stage height",
  );
});

test("the shell keeps three radius shapes plus the pill", async () => {
  const { scale } = splitScaleFromUsage(await readShellCss());

  assert.equal(
    (scale.match(/--exlab-radius-[a-z]+:/g) ?? []).length,
    RADIUS_STEPS.length,
    "a fourth radius shape means two of the existing ones should merge",
  );
});
