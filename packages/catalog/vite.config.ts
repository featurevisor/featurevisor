import * as path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const publicDir = process.env.CATALOG_PUBLIC_DIR || "public";

/**
 * `npm run dev` re-exports into the public directory on every project change. Publishing a
 * new manifest is the end of an export, so reload the page then, as the CLI's watch mode does.
 */
function reloadOnCatalogExport(): Plugin {
  return {
    name: "featurevisor-catalog-reload",
    apply: "serve",
    configureServer(server) {
      const manifestPath = path.resolve(server.config.root, publicDir, "data", "manifest.json");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reload = (file: string) => {
        if (path.resolve(file) !== manifestPath) return;
        // The manifest is replaced by a rename, which can arrive as several events.
        clearTimeout(timer);
        timer = setTimeout(() => server.ws.send({ type: "full-reload" }), 50);
      };
      server.watcher.add(manifestPath);
      server.watcher.on("add", reload);
      server.watcher.on("change", reload);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), reloadOnCatalogExport()],
  publicDir,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
