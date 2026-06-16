import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: process.env.CATALOG_PUBLIC_DIR || "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
