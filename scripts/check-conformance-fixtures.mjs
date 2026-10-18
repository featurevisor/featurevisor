import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = dirname(root);
const canonicalDirectory = join(root, "conformance");

const fixtures = [
  { name: "semver.json", required: true },
  { name: "sdk-v3.json", required: true },
  { name: "sdk-v4-cases.json", required: true },
  { name: "test-checks.json", required: true },
  { name: "sdk-stateful.json", required: true },
  { name: "sdk-diagnostics.json", required: true },
  { name: "sdk-conditions.json", required: true },
  { name: "sdk-composition.json", required: true },
  { name: "openfeature-provider.json", required: true },
];

const nativeSdks = [
  { name: "Go SDK", directory: "featurevisor-go", fixtureDirectories: ["conformance"] },
  {
    name: "Swift SDK",
    directory: "featurevisor-swift2",
    fixtureDirectories: ["conformance"],
  },
  { name: "Java SDK", directory: "featurevisor-java", fixtureDirectories: ["conformance"] },
  { name: "Ruby SDK", directory: "featurevisor-ruby", fixtureDirectories: ["conformance"] },
  {
    name: "Python SDK",
    directory: "featurevisor-python",
    fixtureDirectories: ["conformance"],
  },
  { name: "PHP SDK", directory: "featurevisor-php", fixtureDirectories: ["conformance"] },
  { name: "Rust SDK", directory: "featurevisor-rust", fixtureDirectories: ["conformance"] },
  {
    name: "Elixir SDK",
    directory: "featurevisor-elixir",
    fixtureDirectories: ["conformance"],
  },
  {
    name: "Dart SDK",
    directory: "featurevisor-dart",
    fixtureDirectories: ["conformance", "packages/featurevisor/conformance"],
  },
  { name: ".NET SDK", directory: "featurevisor-dotnet", fixtureDirectories: ["conformance"] },
];

const providerPackageCopies = [
  ["Go provider", "featurevisor-go/openfeature/conformance"],
  ["Rust provider", "featurevisor-rust/openfeature/conformance"],
  ["Java provider tests", "featurevisor-java/featurevisor-openfeature/src/test/resources"],
  ["Elixir provider", "featurevisor-elixir/openfeature/conformance"],
  [".NET provider tests", "featurevisor-dotnet/tests/Featurevisor.OpenFeature.Tests/Fixtures"],
  ["Swift provider tests", "featurevisor-swift2/Tests/FeaturevisorOpenFeatureTests/Fixtures"],
  [
    "Dart server provider",
    "featurevisor-dart/packages/featurevisor_openfeature_server/conformance",
  ],
  [
    "Dart client provider",
    "featurevisor-dart/packages/featurevisor_openfeature_client/conformance",
  ],
];

function displayPath(filePath) {
  const relativePath = relative(workspace, filePath);
  return relativePath.startsWith("..") ? filePath : relativePath;
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

const errors = [];
const canonicalContents = new Map();
const checksByFixture = new Map(fixtures.map(({ name }) => [name, 0]));

for (const fixture of fixtures) {
  const canonicalPath = join(canonicalDirectory, fixture.name);
  if (!existsSync(canonicalPath)) {
    if (fixture.required) {
      errors.push(`Canonical fixture missing: ${displayPath(canonicalPath)}`);
    }
    continue;
  }
  canonicalContents.set(fixture.name, readFileSync(canonicalPath));
}

for (const sdk of nativeSdks) {
  const repositoryPath = join(workspace, sdk.directory);
  if (!existsSync(repositoryPath)) {
    errors.push(`${sdk.name} repository missing: ${displayPath(repositoryPath)}`);
    continue;
  }

  for (const fixtureDirectory of sdk.fixtureDirectories) {
    const copyLabel =
      sdk.fixtureDirectories.length === 1 ? sdk.name : `${sdk.name} (${fixtureDirectory})`;

    for (const fixture of fixtures) {
      const canonicalContent = canonicalContents.get(fixture.name);
      if (!canonicalContent) continue;

      const copyPath = join(repositoryPath, fixtureDirectory, fixture.name);
      if (!existsSync(copyPath)) {
        if (fixture.required) {
          errors.push(`${copyLabel} missing ${fixture.name}: ${displayPath(copyPath)}`);
        }
        continue;
      }

      const copyContent = readFileSync(copyPath);
      checksByFixture.set(fixture.name, checksByFixture.get(fixture.name) + 1);
      if (!canonicalContent.equals(copyContent)) {
        errors.push(
          `${copyLabel} ${fixture.name} differs from the canonical fixture ` +
            `(canonical ${digest(canonicalContent)}, copy ${digest(copyContent)}): ` +
            displayPath(copyPath),
        );
      }
    }
  }
}

const providerFixture = canonicalContents.get("openfeature-provider.json");
if (providerFixture) {
  for (const [name, directory] of providerPackageCopies) {
    const path = join(workspace, directory, "openfeature-provider.json");
    if (!existsSync(path)) {
      errors.push(`${name} missing openfeature-provider.json: ${displayPath(path)}`);
      continue;
    }
    checksByFixture.set(
      "openfeature-provider.json",
      checksByFixture.get("openfeature-provider.json") + 1,
    );
    if (!providerFixture.equals(readFileSync(path))) {
      errors.push(`${name} openfeature-provider.json differs from canonical: ${displayPath(path)}`);
    }
  }

  const dartClientFixture = join(
    workspace,
    "featurevisor-dart/packages/featurevisor_openfeature_client/test/fixtures/openfeature_provider_fixture.dart",
  );
  if (!existsSync(dartClientFixture)) {
    errors.push(`Dart client embedded provider fixture missing: ${displayPath(dartClientFixture)}`);
  } else {
    const source = readFileSync(dartClientFixture, "utf8");
    const embedded = source.match(
      /const String openFeatureProviderFixtureJson = r'''([\s\S]*?)''';/,
    );
    checksByFixture.set(
      "openfeature-provider.json",
      checksByFixture.get("openfeature-provider.json") + 1,
    );
    if (!embedded || !providerFixture.equals(Buffer.from(embedded[1], "utf8"))) {
      errors.push(
        `Dart client embedded provider fixture differs from canonical: ${displayPath(dartClientFixture)}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(
    `Conformance fixture copy guard failed with ${errors.length} ${errors.length === 1 ? "issue" : "issues"}:`,
  );
  errors.forEach((error) => console.error(`  - ${error}`));
  console.error(
    `Canonical fixtures are in ${displayPath(canonicalDirectory)}. Copy their original bytes to preserve numeric spellings. This guard never writes files.`,
  );
  process.exitCode = 1;
} else {
  const requiredCount = fixtures
    .filter((fixture) => fixture.required)
    .reduce((count, fixture) => count + checksByFixture.get(fixture.name), 0);
  const optional = fixtures
    .filter((fixture) => !fixture.required)
    .map((fixture) => `${fixture.name}: ${checksByFixture.get(fixture.name)} copies`)
    .join(", ");
  console.log(
    `Conformance fixture copies match the canonical contract across ${nativeSdks.length} native SDKs ` +
      `(${requiredCount} required checks${optional ? `; optional ${optional}` : ""}).`,
  );
}
