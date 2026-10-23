import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = [
  {
    directory: "sdk",
    name: "@featurevisor/sdk",
    runtimeExports: {
      createFeaturevisor: "function",
      MAX_BUCKETED_NUMBER: "number",
    },
  },
  {
    directory: "react",
    name: "@featurevisor/react",
    runtimeExports: {
      FeaturevisorProvider: "function",
      useFlag: "function",
      useFlags: "function",
      useEveryFlag: "function",
      useSomeFlag: "function",
      useRevision: "function",
      onFeaturesChange: "function",
    },
  },
  {
    directory: "openfeature-provider-core",
    name: "@featurevisor/openfeature-provider-core",
    runtimeExports: {
      FeaturevisorProvider: "function",
    },
  },
  {
    directory: "openfeature-provider-node",
    name: "@featurevisor/openfeature-provider-node",
    runtimeExports: {
      FeaturevisorOpenFeatureProvider: "function",
    },
    exposesFeaturevisor: true,
  },
  {
    directory: "openfeature-provider-web",
    name: "@featurevisor/openfeature-provider-web",
    runtimeExports: {
      FeaturevisorOpenFeatureProvider: "function",
    },
    exposesFeaturevisor: true,
  },
];

function assertFileExists(packageDirectory, target, description) {
  if (typeof target !== "string") {
    throw new Error(`${description} is not configured`);
  }

  statSync(join(packageDirectory, target));
}

function assertRuntimeExports(packageDetails, module, moduleType) {
  for (const [exportName, expectedType] of Object.entries(packageDetails.runtimeExports)) {
    if (typeof module[exportName] !== expectedType) {
      throw new Error(
        `${packageDetails.name} does not expose ${exportName} as a ${expectedType} via ${moduleType}`,
      );
    }
  }
}

// TypeScript 4 cannot parse const type parameters, which TypeScript 5.0 added, and
// reports that even with skipLibCheck. A union with [] infers the same tuples.
const TYPESCRIPT_5_TYPE_PARAMETER = /<\s*const\s+[A-Za-z_$]/;

function declarationFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) return declarationFiles(target);
    return entry.name.endsWith(".d.ts") ? [target] : [];
  });
}

function assertDeclarationsParseInTypeScript4(directory) {
  for (const output of ["cjs", "esm", "node-esm", "lib", "dist"]) {
    const outputDirectory = join(rootDirectory, "packages", directory, output);
    if (!existsSync(outputDirectory)) continue;
    for (const file of declarationFiles(outputDirectory)) {
      if (TYPESCRIPT_5_TYPE_PARAMETER.test(readFileSync(file, "utf8"))) {
        throw new Error(`${file} has a const type parameter, which TypeScript 4 cannot parse`);
      }
    }
  }
}

async function main() {
  for (const directory of ["types", "sdk", "react", "vue"]) {
    assertDeclarationsParseInTypeScript4(directory);
  }
  for (const entry of readdirSync(join(rootDirectory, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    const manifest = JSON.parse(
      readFileSync(join(rootDirectory, "packages", directory, "package.json"), "utf8"),
    );
    if (manifest.repository?.directory !== `packages/${directory}`) {
      throw new Error(`${manifest.name} must link to its repository package directory`);
    }
    if (["sdk", "react", "vue", "types"].includes(directory) && manifest.sideEffects !== false) {
      throw new Error(`${manifest.name} must retain its reviewed sideEffects declaration`);
    }
  }
  for (const packageDetails of packages) {
    const packageDirectory = join(rootDirectory, "packages", packageDetails.directory);
    const packageJson = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
    const rootExports = packageJson.exports?.["."];

    for (const field of ["main", "module", "types"]) {
      assertFileExists(packageDirectory, packageJson[field], `${packageDetails.name} ${field}`);
    }

    for (const condition of ["types", "require", "import"]) {
      assertFileExists(
        packageDirectory,
        rootExports?.[condition],
        `${packageDetails.name} exports["."].${condition}`,
      );
    }

    assertFileExists(
      packageDirectory,
      packageJson.exports?.["./package.json"],
      `${packageDetails.name} package.json export`,
    );

    assertRuntimeExports(packageDetails, require(packageDetails.name), "require()");
    assertRuntimeExports(packageDetails, await import(packageDetails.name), "import");

    if (packageDetails.exposesFeaturevisor) {
      const declarations = readFileSync(join(packageDirectory, rootExports.types), "utf8");
      if (!declarations.includes("readonly featurevisor: Featurevisor;")) {
        throw new Error(`${packageDetails.name} does not expose a typed Featurevisor instance`);
      }
      if (declarations.includes("readonly featurevisor: any;")) {
        throw new Error(`${packageDetails.name} exposes its Featurevisor instance as any`);
      }
    }
  }

  console.log("Package CommonJS, ESM, declaration, and export-map artifacts are valid.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
