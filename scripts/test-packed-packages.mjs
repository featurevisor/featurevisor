/* global process */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "featurevisor-packages-"));
const packageDirectories = [
  "types",
  "sdk",
  "react",
  "vue",
  "catalog",
  "parsers",
  "core",
  "cli",
  "openfeature-provider-core",
  "openfeature-provider-node",
  "openfeature-provider-web",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      npm_config_cache: join(temporaryDirectory, "npm-cache"),
    },
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.stderr ? `\n${result.stderr}` : ""}`,
    );
  }

  return result.stdout || "";
}

try {
  const tarballs = [];

  for (const directory of packageDirectories) {
    const packageDirectory = join(rootDirectory, "packages", directory);
    const output = run("npm", ["pack", "--json", "--pack-destination", temporaryDirectory], {
      cwd: packageDirectory,
      capture: true,
    });
    const [{ filename }] = JSON.parse(output);
    const tarball = join(temporaryDirectory, filename);
    tarballs.push(tarball);

    const entries = run("tar", ["-tf", tarball], { capture: true }).trim().split("\n");
    const forbidden = entries.filter(
      (entry) =>
        /\.spec\.[cm]?[jt]sx?(?:\.map)?$/.test(entry) ||
        /\/(?:jest\.config\.[cm]?js|tsconfig(?:\.[^/]+)?\.json)$/.test(entry) ||
        entry.includes("instance.test-fixtures") ||
        (["core", "parsers", "catalog"].includes(directory) && entry.startsWith("package/src/")),
    );
    if (forbidden.length > 0) {
      throw new Error(
        `@featurevisor/${directory} contains non-runtime files:\n${forbidden.join("\n")}`,
      );
    }
  }

  const consumerDirectory = join(temporaryDirectory, "consumer");
  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );

  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballs],
    { cwd: consumerDirectory },
  );

  writeFileSync(
    join(consumerDirectory, "consumer.cjs"),
    `
const sdk = require("@featurevisor/sdk");
const react = require("@featurevisor/react");
const vue = require("@featurevisor/vue");
const core = require("@featurevisor/core");
const nodeProvider = require("@featurevisor/openfeature-provider-node");

for (const [name, value] of Object.entries({
  createFeaturevisor: sdk.createFeaturevisor,
  FeaturevisorProvider: react.FeaturevisorProvider,
  setupApp: vue.setupApp,
  buildDatafile: core.buildDatafile,
  FeaturevisorOpenFeatureProvider: nodeProvider.FeaturevisorOpenFeatureProvider,
})) {
  if (typeof value !== "function") throw new Error(name + " is not callable");
}
`,
  );
  run(process.execPath, ["consumer.cjs"], { cwd: consumerDirectory });

  writeFileSync(
    join(consumerDirectory, "consumer.mjs"),
    `
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorProvider } from "@featurevisor/react";
import { setupApp } from "@featurevisor/vue";
import { FeaturevisorOpenFeatureProvider } from "@featurevisor/openfeature-provider-web";

for (const [name, value] of Object.entries({
  createFeaturevisor,
  FeaturevisorProvider,
  setupApp,
  FeaturevisorOpenFeatureProvider,
})) {
  if (typeof value !== "function") throw new Error(name + " is not callable");
}
`,
  );
  run(process.execPath, ["consumer.mjs"], { cwd: consumerDirectory });

  writeFileSync(
    join(consumerDirectory, "consumer.ts"),
    `
import {
  createFeaturevisor,
  type Featurevisor,
  type FeaturevisorOptions,
  type ObjectValue,
  type VariableValue,
  type VariationValue,
} from "@featurevisor/sdk";
import {
  FeaturevisorProvider,
  useFeaturevisor,
  useVariable as useReactVariable,
  useVariation as useReactVariation,
} from "@featurevisor/react";
import {
  setupApp,
  useVariable as useVueVariable,
  useVariation as useVueVariation,
} from "@featurevisor/vue";
import { FeaturevisorOpenFeatureProvider } from "@featurevisor/openfeature-provider-web";

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExact<TActual, TExpected> = IsAny<TActual> extends true
  ? IsAny<TExpected>
  : IsAny<TExpected> extends true
    ? false
    : [TActual] extends [TExpected]
      ? [TExpected] extends [TActual]
        ? true
        : false
      : false;
type Assert<T extends true> = T;

interface CheckoutConfig {
  title: string;
  maxItems: number;
}

const options: FeaturevisorOptions = {};
const featurevisor: Featurevisor = createFeaturevisor(options);
const variation = featurevisor.getVariation("checkout");
const typedVariation = featurevisor.getVariation<"control" | "treatment">("checkout");
const variable = featurevisor.getVariable("checkout", "config");
const typedVariable = featurevisor.getVariable<CheckoutConfig>("checkout", "config");
const arrayVariable = featurevisor.getVariableArray("checkout", "items");
const typedArrayVariable = featurevisor.getVariableArray<number>("checkout", "items");
const objectVariable = featurevisor.getVariableObject("checkout", "config");
const typedObjectVariable = featurevisor.getVariableObject<CheckoutConfig>("checkout", "config");
const jsonVariable = featurevisor.getVariableJSON("checkout", "config");
const typedJsonVariable = featurevisor.getVariableJSON<CheckoutConfig>("checkout", "config");

type _Variation = Assert<IsExact<typeof variation, VariationValue | null>>;
type _TypedVariation = Assert<
  IsExact<typeof typedVariation, "control" | "treatment" | null>
>;
type _Variable = Assert<IsExact<typeof variable, VariableValue | null>>;
type _TypedVariable = Assert<IsExact<typeof typedVariable, CheckoutConfig | null>>;
type _ArrayVariable = Assert<IsExact<typeof arrayVariable, string[] | null>>;
type _TypedArrayVariable = Assert<IsExact<typeof typedArrayVariable, number[] | null>>;
type _ObjectVariable = Assert<IsExact<typeof objectVariable, ObjectValue | null>>;
type _TypedObjectVariable = Assert<
  IsExact<typeof typedObjectVariable, CheckoutConfig | null>
>;
type _JsonVariable = Assert<IsExact<typeof jsonVariable, VariableValue | null>>;
type _TypedJsonVariable = Assert<IsExact<typeof typedJsonVariable, CheckoutConfig | null>>;

const child = featurevisor.spawn();
const childBroadVariation = child.getVariation("checkout");
const childVariation = child.getVariation<"control" | "treatment">("checkout");
const childBroadVariable = child.getVariable("checkout", "config");
const childVariable = child.getVariable<CheckoutConfig>("checkout", "config");
type _ChildBroadVariation = Assert<
  IsExact<typeof childBroadVariation, VariationValue | null>
>;
type _ChildVariation = Assert<
  IsExact<typeof childVariation, "control" | "treatment" | null>
>;
type _ChildBroadVariable = Assert<IsExact<typeof childBroadVariable, VariableValue | null>>;
type _ChildVariable = Assert<IsExact<typeof childVariable, CheckoutConfig | null>>;

const oldVariationMethod: (featureKey: string) => VariationValue | null =
  featurevisor.getVariation.bind(featurevisor);
const oldVariableMethod: (featureKey: string, variableKey: string) => VariableValue | null =
  featurevisor.getVariable.bind(featurevisor);

const variationMock: Featurevisor["getVariation"] = <
  TVariation extends VariationValue = VariationValue,
>(): TVariation | null => "control" as TVariation;
const variableMock: Featurevisor["getVariable"] = <TValue = VariableValue>(): TValue | null =>
  ({ title: "Checkout", maxItems: 5 }) as TValue;

function checkFrameworkTypes() {
  const broadReactVariation = useReactVariation("checkout");
  const reactVariation = useReactVariation<"control" | "treatment">("checkout");
  const broadReactVariable = useReactVariable("checkout", "config");
  const reactVariable = useReactVariable<CheckoutConfig>("checkout", "config");
  const broadVueVariation = useVueVariation("checkout");
  const vueVariation = useVueVariation<"control" | "treatment">("checkout");
  const broadVueVariable = useVueVariable("checkout", "config");
  const vueVariable = useVueVariable<CheckoutConfig>("checkout", "config");

  type _BroadReactVariation = Assert<
    IsExact<typeof broadReactVariation, VariationValue | null>
  >;
  type _ReactVariation = Assert<
    IsExact<typeof reactVariation, "control" | "treatment" | null>
  >;
  type _BroadReactVariable = Assert<
    IsExact<typeof broadReactVariable, VariableValue | null>
  >;
  type _ReactVariable = Assert<IsExact<typeof reactVariable, CheckoutConfig | null>>;
  type _BroadVueVariation = Assert<
    IsExact<typeof broadVueVariation, VariationValue | null>
  >;
  type _VueVariation = Assert<
    IsExact<typeof vueVariation, "control" | "treatment" | null>
  >;
  type _BroadVueVariable = Assert<IsExact<typeof broadVueVariable, VariableValue | null>>;
  type _VueVariable = Assert<IsExact<typeof vueVariable, CheckoutConfig | null>>;

  return [
    broadReactVariation,
    reactVariation,
    broadReactVariable,
    reactVariable,
    broadVueVariation,
    vueVariation,
    broadVueVariable,
    vueVariable,
  ];
}

function checkUseFeaturevisorTypes(api: ReturnType<typeof useFeaturevisor>) {
  const broadHookVariation = api.getVariation("checkout");
  const hookVariation = api.getVariation<"control" | "treatment">("checkout");
  const broadHookVariable = api.getVariable("checkout", "config");
  const hookVariable = api.getVariable<CheckoutConfig>("checkout", "config");

  type _BroadHookVariation = Assert<
    IsExact<typeof broadHookVariation, VariationValue | null>
  >;
  type _HookVariation = Assert<
    IsExact<typeof hookVariation, "control" | "treatment" | null>
  >;
  type _BroadHookVariable = Assert<IsExact<typeof broadHookVariable, VariableValue | null>>;
  type _HookVariable = Assert<IsExact<typeof hookVariable, CheckoutConfig | null>>;

  return [broadHookVariation, hookVariation, broadHookVariable, hookVariable];
}

// @ts-expect-error Variation types must remain strings.
featurevisor.getVariation<number>("checkout");

void FeaturevisorProvider;
void setupApp;
void oldVariationMethod;
void oldVariableMethod;
void variationMock;
void variableMock;
void checkFrameworkTypes;
void checkUseFeaturevisorTypes;
void new FeaturevisorOpenFeatureProvider({ featurevisor });
`,
  );
  run(
    join(rootDirectory, "node_modules", ".bin", "tsc"),
    [
      "--strict",
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ES2020",
      "--module",
      "Node16",
      "--moduleResolution",
      "Node16",
      "consumer.ts",
    ],
    { cwd: consumerDirectory },
  );

  console.log(
    `Packed package contents and clean CommonJS, ESM, and TypeScript consumers are valid for ${tarballs
      .map((tarball) => basename(tarball))
      .join(", ")}.`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
