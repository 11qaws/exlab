import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { STREAMER_THEME_PORTRAIT_ASSETS } from "./app/_platform/theme/streamerThemes";

const fromRepositoryRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

function streamerThemePortraitPreloads(): Plugin {
  let resolvedBase = "/";

  return {
    name: "exlab-streamer-theme-portrait-preloads",
    configResolved(config) {
      resolvedBase = config.base;
    },
    transformIndexHtml() {
      return Object.values(STREAMER_THEME_PORTRAIT_ASSETS).map((asset) => ({
        tag: "link",
        attrs: {
          as: "image",
          fetchpriority: "high",
          href: `${resolvedBase}${asset.path}`,
          rel: "preload",
          type: asset.mimeType,
        },
        injectTo: "head",
      }));
    },
  };
}

/**
 * GitHub Pages is a client-only mirror of the primary Vinext application.
 * Keep its output isolated from the Sites/Cloudflare Worker build.
 */
export default defineConfig({
  base: "/exlab/",
  root: fromRepositoryRoot("./pages-static"),
  publicDir: fromRepositoryRoot("./public"),
  plugins: [streamerThemePortraitPreloads(), react()],
  build: {
    emptyOutDir: true,
    manifest: true,
    outDir: fromRepositoryRoot("./dist-pages"),
  },
});
