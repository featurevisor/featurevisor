import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

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

    const content = await readFile(path.join(outDir, `${packageConfig.fileName}.js`));

    return {
      bytes: content.byteLength,
      gzippedBytes: gzipSync(content).byteLength,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const rows = [];

  for (const packageConfig of packages) {
    const original = await bundlePackage(packageConfig, false);
    const minified = await bundlePackage(packageConfig, "esbuild");

    rows.push({
      packageName: packageConfig.name,
      original: formatBytes(original.bytes),
      minified: formatBytes(minified.bytes),
      gzipped: formatBytes(minified.gzippedBytes),
    });
  }

  const widths = {
    packageName: Math.max("Package".length, ...rows.map((row) => row.packageName.length)),
    original: Math.max("Original".length, ...rows.map((row) => row.original.length)),
    minified: Math.max("Minified".length, ...rows.map((row) => row.minified.length)),
    gzipped: Math.max("Minified + gzip".length, ...rows.map((row) => row.gzipped.length)),
  };

  const header = [
    pad("Package", widths.packageName),
    pad("Original", widths.original),
    pad("Minified", widths.minified),
    pad("Minified + gzip", widths.gzipped),
  ].join("  ");

  const separator = [
    "-".repeat(widths.packageName),
    "-".repeat(widths.original),
    "-".repeat(widths.minified),
    "-".repeat(widths.gzipped),
  ].join("  ");

  console.log("Featurevisor bundle sizes");
  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      [
        pad(row.packageName, widths.packageName),
        pad(row.original, widths.original),
        pad(row.minified, widths.minified),
        pad(row.gzipped, widths.gzipped),
      ].join("  "),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
