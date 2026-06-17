import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { minify as minifyWithTerser } from "terser";
import { build } from "vite";

const rootDir = process.cwd();

const packages = [
  {
    name: "@featurevisor/sdk",
    entry: path.join(rootDir, "packages/sdk/src/index.ts"),
    fileName: "featurevisor-sdk",
    external: [],
  },
  {
    name: "@featurevisor/react",
    entry: path.join(rootDir, "packages/react/src/index.ts"),
    fileName: "featurevisor-react",
    external: ["react", "react-dom", "@featurevisor/sdk"],
  },
  {
    name: "@featurevisor/vue",
    entry: path.join(rootDir, "packages/vue/src/index.ts"),
    fileName: "featurevisor-vue",
    external: ["vue", "@featurevisor/sdk"],
  },
];

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(2)} kB`;
}

function pad(text, width) {
  const value = String(text);

  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

async function bundlePackage(packageConfig, minify) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "featurevisor-bundle-sizes-"));
  const outDir = path.join(tempDir, minify ? "minified" : "original");

  try {
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: packageConfig.entry,
          formats: ["es"],
          fileName: () => `${packageConfig.fileName}.js`,
        },
        minify,
        sourcemap: false,
        reportCompressedSize: false,
        target: "es2018",
        rollupOptions: {
          external: packageConfig.external,
        },
      },
    });

    return readFile(path.join(outDir, `${packageConfig.fileName}.js`));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function getSizes(content) {
  return {
    bytes: content.byteLength,
    gzippedBytes: gzipSync(content).byteLength,
  };
}

async function minifyPackageWithTerser(content) {
  const result = await minifyWithTerser(content.toString(), {
    module: true,
    compress: {
      passes: 2,
    },
  });

  if (!result.code) {
    throw new Error("Terser did not produce a bundle");
  }

  return Buffer.from(result.code);
}

async function main() {
  const rows = [];

  for (const packageConfig of packages) {
    const originalContent = await bundlePackage(packageConfig, false);
    const original = getSizes(originalContent);
    const esbuild = getSizes(await bundlePackage(packageConfig, "esbuild"));
    const terser = getSizes(await minifyPackageWithTerser(originalContent));

    rows.push({
      packageName: packageConfig.name,
      original: formatBytes(original.bytes),
      esbuild: formatBytes(esbuild.bytes),
      esbuildGzip: formatBytes(esbuild.gzippedBytes),
      terser: formatBytes(terser.bytes),
      terserGzip: formatBytes(terser.gzippedBytes),
    });
  }

  const widths = {
    packageName: Math.max("Package".length, ...rows.map((row) => row.packageName.length)),
    original: Math.max("Original".length, ...rows.map((row) => row.original.length)),
    esbuild: Math.max("esbuild".length, ...rows.map((row) => row.esbuild.length)),
    esbuildGzip: Math.max("esbuild + gzip".length, ...rows.map((row) => row.esbuildGzip.length)),
    terser: Math.max("Terser".length, ...rows.map((row) => row.terser.length)),
    terserGzip: Math.max("Terser + gzip".length, ...rows.map((row) => row.terserGzip.length)),
  };

  const header = [
    pad("Package", widths.packageName),
    pad("Original", widths.original),
    pad("esbuild", widths.esbuild),
    pad("esbuild + gzip", widths.esbuildGzip),
    pad("Terser", widths.terser),
    pad("Terser + gzip", widths.terserGzip),
  ].join("  ");

  const separator = [
    "-".repeat(widths.packageName),
    "-".repeat(widths.original),
    "-".repeat(widths.esbuild),
    "-".repeat(widths.esbuildGzip),
    "-".repeat(widths.terser),
    "-".repeat(widths.terserGzip),
  ].join("  ");

  console.log("Featurevisor bundle sizes");
  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      [
        pad(row.packageName, widths.packageName),
        pad(row.original, widths.original),
        pad(row.esbuild, widths.esbuild),
        pad(row.esbuildGzip, widths.esbuildGzip),
        pad(row.terser, widths.terser),
        pad(row.terserGzip, widths.terserGzip),
      ].join("  "),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
