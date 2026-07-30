import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(repositoryRoot, "dist-pages");
const pagesBase = "/exlab/";
const streamerPortraitAssets = JSON.parse(
  await readFile(
    resolve(
      repositoryRoot,
      "app/_platform/theme/streamerPortraitAssets.json",
    ),
    "utf8",
  ),
);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`GitHub Pages verification failed: ${message}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(path, prefix = "") {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(resolve(path, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

const indexPath = resolve(outputRoot, "index.html");
invariant(await exists(indexPath), "dist-pages/index.html is missing.");
invariant(
  await exists(resolve(outputRoot, ".nojekyll")),
  "dist-pages/.nojekyll is missing.",
);

const indexHtml = await readFile(indexPath, "utf8");
const localAssetReferences = [
  ...indexHtml.matchAll(
    /<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"[^>]*>/g,
  ),
]
  .map((match) => match[1])
  .filter((reference) => !/^(?:https?:|data:|#)/.test(reference));

invariant(
  localAssetReferences.some((reference) =>
    reference.startsWith(`${pagesBase}assets/`),
  ),
  "index.html does not reference the bundled /exlab/assets/ output.",
);
invariant(
  localAssetReferences.every((reference) => reference.startsWith(pagesBase)),
  `a local index asset is missing the ${pagesBase} base path.`,
);

for (const reference of localAssetReferences) {
  const relativePath = reference.slice(pagesBase.length).split(/[?#]/, 1)[0];
  invariant(
    await exists(resolve(outputRoot, relativePath)),
    `referenced asset ${reference} is missing from dist-pages.`,
  );
}

const manifestPath = resolve(outputRoot, ".vite", "manifest.json");
invariant(await exists(manifestPath), "Vite manifest is missing.");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const dynamicEntries = Object.entries(manifest).filter(
  ([, entry]) => entry.isDynamicEntry === true,
);

for (const expectedModule of [
  "app/games/roulette/RouletteGame.tsx",
  "app/games/showdown/ShowdownGame.tsx",
]) {
  const dynamicEntry = dynamicEntries.find(([source]) =>
    source.replaceAll("\\", "/").endsWith(expectedModule),
  );
  invariant(
    dynamicEntry !== undefined,
    `${expectedModule} is not emitted as a lazy chunk.`,
  );
  invariant(
    await exists(resolve(outputRoot, dynamicEntry[1].file)),
    `lazy chunk ${dynamicEntry[1].file} is missing.`,
  );
}

const streamerPortraitPaths = Object.values(
  streamerPortraitAssets,
).map(({ path }) => path);
const portraitPreloadReferences = [
  ...indexHtml.matchAll(/<link\b[^>]*>/g),
]
  .map((match) => match[0])
  .filter(
    (tag) =>
      /\brel="preload"/.test(tag)
      && /\bas="image"/.test(tag)
      && /\bhref="[^"]*\/themes\/streamers\//.test(tag),
  )
  .map((tag) => tag.match(/\bhref="([^"]+)"/)?.[1])
  .filter(Boolean);

invariant(
  portraitPreloadReferences.length === streamerPortraitPaths.length,
  `expected ${streamerPortraitPaths.length} portrait preloads, found ${portraitPreloadReferences.length}.`,
);
invariant(
  new Set(portraitPreloadReferences).size === streamerPortraitPaths.length,
  "streamer portrait preloads are duplicated.",
);
for (const imagePath of streamerPortraitPaths) {
  invariant(
    portraitPreloadReferences.includes(`${pagesBase}${imagePath}`),
    `streamer portrait preload ${pagesBase}${imagePath} is missing.`,
  );
}

for (const imagePath of ["og.png", ...streamerPortraitPaths]) {
  invariant(
    await exists(resolve(outputRoot, imagePath)),
    `public image ${imagePath} is missing.`,
  );
}

const outputFiles = await listFiles(outputRoot);
const bundleFiles = outputFiles.filter(
  (file) => file.endsWith(".js") || file.endsWith(".css"),
);
invariant(bundleFiles.length > 0, "no JavaScript or CSS bundles were emitted.");

const legacyStreamerPortraitPaths = [
  "themes/streamers/amoretto.jpg",
  "themes/streamers/eureka.png",
  "themes/streamers/sena.jpg",
  "themes/streamers/torori.webp",
  "themes/streamers/mangjing.jpg",
];

for (const bundleFile of bundleFiles) {
  const contents = await readFile(resolve(outputRoot, bundleFile), "utf8");
  invariant(
    !/[("'`]\/(?:themes|fonts|images)\//.test(contents),
    `${bundleFile} contains a domain-root public asset reference.`,
  );
  for (const legacyPath of legacyStreamerPortraitPaths) {
    invariant(
      !contents.includes(legacyPath),
      `${bundleFile} still references legacy portrait ${legacyPath}.`,
    );
  }
}

console.log(
  `GitHub Pages output verified: ${outputFiles.length} files, `
    + `${dynamicEntries.length} lazy chunks, base ${pagesBase}.`,
);
