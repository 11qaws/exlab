import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fromRepositoryRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * GitHub Pages is a client-only mirror of the primary Vinext application.
 * Keep its output isolated from the Sites/Cloudflare Worker build.
 */
export default defineConfig({
  base: "/exlab/",
  root: fromRepositoryRoot("./pages-static"),
  publicDir: fromRepositoryRoot("./public"),
  plugins: [react()],
  build: {
    emptyOutDir: true,
    manifest: true,
    outDir: fromRepositoryRoot("./dist-pages"),
  },
});
