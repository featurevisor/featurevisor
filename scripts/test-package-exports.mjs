import { readFileSync, statSync } from "node:fs";
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

async function main() {
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
