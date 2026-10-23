import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { execFileSync } from "child_process";
import type { ParsedVariable } from "@featurevisor/types";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { generateTypeScriptCodeForProject } from "./typescript";
import { lintProject } from "../linter/lintProject";

function getGeneratedTypeScriptDiagnostics(
  outputPath: string,
  importSdkPath = "@featurevisor/sdk",
  importReactPath = "@featurevisor/react",
): string[] {
  const repositoryPath = path.resolve(__dirname, "../../../..");
  const rootNames = fs
    .readdirSync(outputPath)
    .filter((fileName) => fileName.endsWith(".ts"))
    .map((fileName) => path.join(outputPath, fileName));
  const program = ts.createProgram(rootNames, {
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: {
      [importReactPath]: [path.join(repositoryPath, "packages/react/src/index.ts")],
      [importSdkPath]: [path.join(repositoryPath, "packages/sdk/src/index.ts")],
      "@featurevisor/vue": [path.join(repositoryPath, "packages/vue/src/index.ts")],
      "@featurevisor/types": [path.join(repositoryPath, "packages/types/src/index.d.ts")],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
    verbatimModuleSyntax: true,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

function createTempProjectFromExample1() {
  const fixturePath = path.resolve(__dirname, "../../../../examples/example-1");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-codegen-"));

  fs.cpSync(fixturePath, tempRoot, { recursive: true });

  return tempRoot;
}

describe("generate-code/typescript", () => {
  let tempProjectPath: string;
  let outputPath: string;

  beforeEach(() => {
    tempProjectPath = createTempProjectFromExample1();
    outputPath = path.join(tempProjectPath, "generated");
    fs.mkdirSync(outputPath, { recursive: true });

    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "account.yml"),
      [
        "description: Account",
        "type: object",
        "required:",
        "  - plan",
        "properties:",
        "  plan:",
        "    type: string",
        "    enum:",
        "      - free",
        "      - pro",
        "  locale:",
        "    type: string",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "permissions.yml"),
      [
        "description: Permissions",
        "type: array",
        "items:",
        "  type: string",
        "  enum:",
        "    - read",
        "    - write",
        "    - admin",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it("collapses alias wrappers while borrowing every container through chains and map properties", async () => {
    const variables: Record<string, ParsedVariable> = {
      "policy/eu.current": {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["label"],
              properties: { label: { type: "string" } },
            },
          },
        },
        defaultValue: { items: [{ label: "source" }] },
      },
      flag: { type: "boolean", defaultValue: false },
      count: { type: "integer", defaultValue: 0 },
      ratio: { type: "number", defaultValue: 0.5 },
      label: { type: "string", enum: ["small", "large"], defaultValue: "small" },
      release: { type: "string", defaultValue: "1.0.0" },
      names: { type: "array", items: { type: "string" }, defaultValue: ["source"] },
      decoded: { type: "json", defaultValue: '{"label":"source"}' },
      union: {
        oneOf: [
          { type: "string", const: "compact" },
          { type: "array", items: { type: "integer" } },
          { type: "object", required: ["count"], properties: { count: { type: "integer" } } },
        ],
        defaultValue: "compact",
      },
      map: { compose: { policy: { variable: "policy/eu.current" } } },
      objectAlias: {
        compose: "policy/eu.current",
        overrides: [{ key: "replace", conditions: "*", value: { items: [] } }],
      },
      chain: { compose: "objectAlias" },
      chainTail: { compose: "chain" },
      flagAlias: { compose: "flag" },
      countAlias: { compose: "count" },
      ratioAlias: { compose: "ratio" },
      labelAlias: { compose: "label" },
      releaseAlias: { compose: "release" },
      namesAlias: { compose: "names" },
      jsonAlias: { compose: "decoded" },
      jsonChain: { compose: "jsonAlias" },
      unionAlias: { compose: "union" },
      unionChain: { compose: "unionAlias" },
      mapAlias: { compose: "map" },
      mapChain: { compose: "mapAlias" },
      aliasInMap: { compose: { policy: { variable: "objectAlias" } } },
      mixedMap: {
        compose: {
          direct: { variable: "policy/eu.current" },
          chain: { variable: "chainTail" },
          decoded: { variable: "jsonChain" },
          union: { variable: "unionChain" },
          map: { variable: "mapChain" },
        },
      },
      mixedAlias: { compose: "mixedMap" },
      mixedChain: { compose: "mixedAlias" },
    };
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    jest.spyOn(datasource, "listVariables").mockResolvedValue(Object.keys(variables));
    jest.spyOn(datasource, "readVariable").mockImplementation(async (key) => variables[key]);
    jest.spyOn(datasource, "getRequiredFeaturesChainForVariable").mockResolvedValue(new Set());
    await generateTypeScriptCodeForProject(
      { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
      outputPath,
      { react: true },
    );
    const content = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    const borrowed = "CompositionSource<{ items: { label: string }[] }> | null";
    for (const key of ["objectAlias", "chain", "chainTail"]) {
      expect(content).toContain(`  ${key}: ${borrowed};`);
    }
    expect(content).toContain(`  aliasInMap: { policy: ${borrowed} };`);
    expect(content).toContain("  jsonChain: CompositionSource<unknown> | null;");
    expect(content).toContain(
      '  unionChain: CompositionSource<"compact" | number[] | { count: number }> | null;',
    );
    for (const key of ["mapAlias", "mapChain"]) {
      expect(content).toContain(`  ${key}: { readonly policy: ${borrowed} } | null;`);
    }
    expect(content).not.toContain("CompositionSource<CompositionSource<");
    expect(content).not.toContain("CompositionSource<{ readonly");
    fs.writeFileSync(
      path.join(outputPath, "aliasAssertions.ts"),
      `import type { Variables } from "./variables.js";
import { getVariable } from "./functions.js";
import { useVariable } from "./react.js";
import { useVariable as useVueVariable } from "@featurevisor/vue";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Borrowed = { readonly items: readonly { readonly label: string }[] } | null;
type ObjectAlias = Assert<Equal<Variables["objectAlias"], Borrowed>>;
type Chain = Assert<Equal<Variables["chain"], Borrowed>>;
type ChainTail = Assert<Equal<Variables["chainTail"], Borrowed>>;
type Flag = Assert<Equal<Variables["flagAlias"], boolean | null>>;
type Count = Assert<Equal<Variables["countAlias"], number | null>>;
type Ratio = Assert<Equal<Variables["ratioAlias"], number | null>>;
type Label = Assert<Equal<Variables["labelAlias"], "small" | "large" | null>>;
type Release = Assert<Equal<Variables["releaseAlias"], string | null>>;
type Names = Assert<Equal<Variables["namesAlias"], readonly string[] | null>>;
type Json = Assert<Equal<Variables["jsonAlias"], unknown>>;
type JsonChain = Assert<Equal<Variables["jsonChain"], unknown>>;
type Union = Assert<Equal<Variables["unionAlias"], "compact" | readonly number[] | { readonly count: number } | null>>;
type UnionChain = Assert<Equal<Variables["unionChain"], Variables["unionAlias"]>>;
type MapAlias = Assert<Equal<Variables["mapAlias"], { readonly policy: Borrowed } | null>>;
type MapChain = Assert<Equal<Variables["mapChain"], Variables["mapAlias"]>>;
type InMap = Assert<Equal<Variables["aliasInMap"], { policy: Borrowed }>>;
type MixedMap = Assert<Equal<Variables["mixedMap"], {
  chain: Borrowed;
  decoded: unknown;
  direct: Borrowed;
  map: { readonly policy: Borrowed } | null;
  union: Variables["unionAlias"];
}>>;
type MixedChain = Assert<Equal<Variables["mixedChain"], {
  readonly chain: Borrowed;
  readonly decoded: unknown;
  readonly direct: Borrowed;
  readonly map: { readonly policy: Borrowed } | null;
  readonly union: Variables["unionAlias"];
} | null>>;
const value = getVariable("objectAlias");
const hook = useVariable("objectAlias");
const vue = useVueVariable<Variables["objectAlias"]>("objectAlias");
type Getter = Assert<Equal<typeof value, Borrowed>>;
type Hook = Assert<Equal<typeof hook, Borrowed>>;
type Vue = Assert<Equal<typeof vue, Borrowed>>;
// @ts-expect-error Even the alias root is borrowed.
value!.items = [];
// @ts-expect-error Nested alias arrays are borrowed.
hook!.items.push({ label: "changed" });
// @ts-expect-error Vue retains the same borrowed item type.
vue!.items[0].label = "changed";
const ordinary = getVariable("policy/eu.current");
ordinary!.items[0].label = "ordinary getter remains mutable";
const mapped = getVariable("aliasInMap");
mapped!.policy = null;
const mixed = getVariable("mixedMap");
mixed!.chain = null;
// @ts-expect-error Map properties referencing aliases still borrow nested arrays.
mixed!.direct!.items.push({ label: "changed" });
// @ts-expect-error Map aliases borrow the map root, including through another alias.
getVariable("mixedChain")!.chain = null;
// @ts-expect-error A borrowed map reached through an alias cannot replace a property.
mixed!.map!.policy = null;
// @ts-expect-error Source unions remain conservatively nullable through alias chains.
const nonnullable: NonNullable<Variables["unionChain"]> = getVariable("unionChain");
`,
    );
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("rejects null only composition variation types in lint, then generates a nullable variation union after repair", async () => {
    const sourcePath = path.join(tempProjectPath, "features", "variationSource.yml");
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ description: "Source", tags: ["all"], rules: [] }),
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "variationView.yml"),
      JSON.stringify({
        description: "View",
        tags: ["all"],
        compose: { layout: { feature: "variationSource", variation: true } },
      }),
    );
    const lint = () => {
      const projectConfig = getProjectConfig(tempProjectPath);
      return lintProject(
        {
          rootDirectoryPath: tempProjectPath,
          projectConfig,
          datasource: new Datasource(projectConfig, tempProjectPath),
          options: {},
        } as any,
        { json: true, entityType: "variable", keyPattern: "^variationView$" },
      );
    };
    expect((await lint()).errors).toEqual([
      expect.objectContaining({
        path: ["compose", "layout", "variation"],
        message: expect.stringContaining("has no variations"),
      }),
    ]);
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({
        description: "Source",
        tags: ["all"],
        variations: [{ value: "control", weight: 100 }],
        rules: [],
      }),
    );
    expect((await lint()).errors).toEqual([]);
    const projectConfig = getProjectConfig(tempProjectPath);
    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource: new Datasource(projectConfig, tempProjectPath),
        options: {},
      } as any,
      outputPath,
      { tag: "all" },
    );
    const content = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    expect(content).toContain('"control" | null');
    expect(content).not.toMatch(/layout\??:\s*null\s*[;,]/);
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it.each(["tag", "target"])(
    "infers required composition properties with a %s filter and compiles with tsc",
    async (filter) => {
      fs.writeFileSync(
        path.join(tempProjectPath, "schemas", "compositionPayload.yml"),
        JSON.stringify({
          type: "object",
          required: ["label"],
          properties: { label: { type: "string" }, details: { schema: "compositionDetails" } },
        }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "schemas", "compositionDetails.yml"),
        JSON.stringify({
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                oneOf: [
                  { type: "string", enum: ["compact"] },
                  {
                    type: "object",
                    required: ["count"],
                    properties: { count: { type: "integer" } },
                  },
                ],
              },
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "features", "compositionSource.yml"),
        JSON.stringify({
          description: "Source",
          tags: [],
          bucketBy: "userId",
          variations: [{ value: "control" }, { value: "treatment" }],
          disabledVariationValue: "disabled",
          variablesSchema: {
            payload: { schema: "compositionPayload", defaultValue: { label: "source" } },
            names: { type: "array", items: { type: "string" }, defaultValue: [] },
          },
          rules: [],
        }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "features", "compositionDisabledOnly.yml"),
        JSON.stringify({
          description: "Disabled only",
          tags: [],
          disabledVariationValue: "off",
          rules: [],
        }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "features", "compositionDependency.yml"),
        JSON.stringify({ description: "Nested source prerequisite", tags: [], rules: [] }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "features", "compositionOverrideDependency.yml"),
        JSON.stringify({ description: "Override prerequisite", tags: [], rules: [] }),
      );
      const variables: Record<string, ParsedVariable> = {
        compositionRoot: {
          tags: ["all"],
          compose: {
            enabled: { feature: "compositionSource" },
            layout: { feature: "compositionSource", variation: true as const },
            "button.label": { feature: "compositionSource", variable: "payload" },
            names: { feature: "compositionSource", variable: "names" },
            disabledOnly: { feature: "compositionDisabledOnly", variation: true as const },
            nested: { variable: "compositionAliasChain" },
          },
          overrides: [
            {
              key: "disabled",
              conditions: [
                { feature: "compositionOverrideDependency" },
                {
                  variable: "compositionOverrideGate",
                  operator: "equals",
                  value: true,
                },
              ],

              mutate: { enabled: false },
            },
          ],
        },
        compositionChild: {
          compose: {
            "delivery/policy": { variable: "compositionPayload" },
            json: { variable: "compositionJson" },
          },
        },
        compositionAlias: { compose: "compositionChild" },
        compositionAliasChain: { compose: "compositionAlias" },
        compositionPayload: {
          schema: "compositionPayload",
          defaultValue: { label: "source" },
          conditions: { feature: "compositionDependency" },
        },
        compositionJson: { type: "json", defaultValue: "{}" },
        compositionOverrideGate: { type: "boolean", defaultValue: true },
      };
      const projectConfig = getProjectConfig(tempProjectPath);
      fs.writeFileSync(
        path.join(tempProjectPath, "targets", "composition-code.yml"),
        JSON.stringify({
          description: "Composition only",
          includeVariables: ["compositionRoot"],
          excludeVariables: [
            "compositionAliasChain",
            "compositionAlias",
            "compositionChild",
            "compositionPayload",
            "compositionJson",
          ],
          excludeFeatures: ["*"],
        }),
      );
      const datasource = new Datasource(projectConfig, tempProjectPath);
      for (const [key, variable] of Object.entries(variables)) {
        fs.writeFileSync(
          path.join(tempProjectPath, "variables", `${key}.yml`),
          JSON.stringify(variable),
        );
      }
      jest.spyOn(datasource, "listVariables").mockResolvedValue(Object.keys(variables));
      await generateTypeScriptCodeForProject(
        { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
        outputPath,
        { ...(filter === "tag" ? { tag: "all" } : { target: "composition-code" }), react: true },
      );
      const content = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
      expect(content).toContain('} from "./schemas.js";');
      expect(content).toContain("CompositionPayloadSchema,");
      expect(content).toContain("enabled: boolean;");
      expect(content).toContain('layout: "control" | "treatment" | "disabled" | null;');
      expect(content).toContain(
        '"button.label": CompositionSource<CompositionPayloadSchema> | null;',
      );
      expect(content).toContain("names: CompositionSource<string[]> | null;");
      expect(content).toContain('disabledOnly: "off" | null;');
      expect(content).toContain(
        'nested: { readonly "delivery/policy": CompositionSource<CompositionPayloadSchema> | null; readonly json: CompositionSource<unknown> | null } | null',
      );
      const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
      expect(featuresContent).toContain("compositionSource:");
      expect(featuresContent).toContain("compositionDisabledOnly:");
      expect(featuresContent).toContain("compositionDependency: null;");
      expect(featuresContent).toContain("compositionOverrideDependency: null;");
      expect(content).not.toContain("compositionChild:");
      expect(content).not.toContain("compositionAlias:");
      expect(content).not.toContain("compositionAliasChain:");
      expect(content).not.toContain("compositionPayload:");
      fs.writeFileSync(
        path.join(outputPath, "compositionAssertions.ts"),
        `import type { Variables, VariableKey } from "./variables.js";
import { getVariable } from "./functions.js";
import { useVariable } from "./react.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Root = Variables["compositionRoot"];
type RequiredProperties = Assert<Equal<Root, { [K in keyof Root]-?: Root[K] }>>;
type Flag = Assert<Equal<Root["enabled"], boolean>>;
type Variation = Assert<Equal<Root["layout"], "control" | "treatment" | "disabled" | null>>;
type DisabledOnly = Assert<Equal<Root["disabledOnly"], "off" | null>>;
type SourcePayload = { readonly label: string; readonly details?: { readonly items: readonly ("compact" | { readonly count: number })[] } };
type Payload = Assert<Equal<Root["button.label"], SourcePayload | null>>;
type Names = Assert<Equal<Root["names"], readonly string[] | null>>;
type Nested = Assert<Equal<Root["nested"], { readonly "delivery/policy": SourcePayload | null; readonly json: unknown } | null>>;
type Filtered = Assert<Equal<VariableKey, "compositionRoot">>;
const value = getVariable("compositionRoot");
const hookValue = useVariable("compositionRoot");
type Getter = Assert<Equal<typeof value, Root | null>>;
type Hook = Assert<Equal<typeof hookValue, Root | null>>;
const directPayload = useVariable("compositionSource", "payload");
if (directPayload) directPayload.label = "ordinary source types stay unchanged";
declare const root: Root;
root.enabled = false;
// @ts-expect-error Source objects are borrowed.
root["button.label"]!.label = "changed";
// @ts-expect-error Source arrays are borrowed.
root.names!.push("changed");
// @ts-expect-error Nested arrays retain readonly source ownership through reusable schemas.
root["button.label"]!.details!.items.push("compact");
// @ts-expect-error Nested source compositions are borrowed too.
root.nested!["delivery/policy"] = null;
// @ts-expect-error Every property is required, including nullable properties.
const incomplete: Root = { enabled: true };
`,
      );
      expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
      const repositoryPath = path.resolve(__dirname, "../../../..");
      const configPath = path.join(outputPath, "tsconfig.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            esModuleInterop: true,
            paths: {
              "@featurevisor/sdk": [path.join(repositoryPath, "packages/sdk/src/index.ts")],
              "@featurevisor/react": [path.join(repositoryPath, "packages/react/src/index.ts")],
              "@featurevisor/types": [path.join(repositoryPath, "packages/types/src/index.d.ts")],
            },
          },
          include: ["*.ts"],
        }),
      );
      execFileSync(
        process.execPath,
        [path.join(repositoryPath, "node_modules/typescript/bin/tsc"), "-p", configPath],
        { encoding: "utf8" },
      );
    },
  );

  it.each([
    ["unknown", "Unknown composition variable: unknown"],
    ["compositionRoot", "Circular composition reference: compositionRoot"],
    [{ missing: { variable: "unknown" } }, "Unknown composition variable: unknown"],
    [{ missing: { feature: "unknown" } }, "Unknown composition feature: unknown"],
    [
      { missing: { feature: "showBanner", variable: "unknown" } },
      "Unknown composition feature variable: showBanner.unknown",
    ],
    [{ cycle: { variable: "compositionRoot" } }, "Circular composition reference: compositionRoot"],
  ] as const)("rejects unresolved composition types: %s", async (compose, message) => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    jest.spyOn(datasource, "listVariables").mockResolvedValue(["compositionRoot"]);
    jest.spyOn(datasource, "readVariable").mockResolvedValue({ compose });
    jest.spyOn(datasource, "getRequiredFeaturesChainForVariable").mockResolvedValue(new Set());
    await expect(
      generateTypeScriptCodeForProject(
        { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
        outputPath,
      ),
    ).rejects.toThrow(message);
  });

  it("rejects cycles that mix aliases and map properties", async () => {
    const variables: Record<string, ParsedVariable> = {
      alias: { compose: "map" },
      map: { compose: { policy: { variable: "chain" } } },
      chain: { compose: "alias" },
    };
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    jest.spyOn(datasource, "listVariables").mockResolvedValue(Object.keys(variables));
    jest.spyOn(datasource, "readVariable").mockImplementation(async (key) => variables[key]);
    jest.spyOn(datasource, "getRequiredFeaturesChainForVariable").mockResolvedValue(new Set());
    await expect(
      generateTypeScriptCodeForProject(
        { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
        outputPath,
      ),
    ).rejects.toThrow("Circular composition reference: alias");
  });

  it("generates string types for formatted feature, global and reusable timestamp schemas", async () => {
    const timestamp = "1970-01-01T00:00:00Z";
    const schema = { type: "string", format: "date-time" };
    fs.writeFileSync(
      path.join(tempProjectPath, "schemas", "portableInstant.yml"),
      JSON.stringify(schema),
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "portableTimestamp.yml"),
      JSON.stringify({
        description: "Timestamp",
        ...schema,
        defaultValue: timestamp,
      }),
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "portableTimestampFeature.yml"),
      JSON.stringify({
        description: "Timestamp",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: {
          when: { ...schema, defaultValue: timestamp },
          referenced: { schema: "portableInstant", defaultValue: timestamp },
          dates: { type: "array", items: schema, defaultValue: [timestamp] },
        },
        rules: {
          staging: [{ key: "all", conditions: "*", percentage: 100 }],
          production: [{ key: "all", conditions: "*", percentage: 100 }],
        },
      }),
    );
    // Context values are inputs, so a date-time attribute also accepts a native Date.
    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "signupDate.yml"),
      JSON.stringify({ description: "Signup", ...schema }),
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "membership.yml"),
      JSON.stringify({
        description: "Membership",
        type: "object",
        properties: { since: { schema: "portableInstant" }, tier: { type: "string" } },
      }),
    );
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    await generateTypeScriptCodeForProject(
      { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
      outputPath,
      {},
    );
    const attributes = fs.readFileSync(path.join(outputPath, "attributes.ts"), "utf8");
    expect(attributes).toContain("export type SignupDateAttribute = Date | string;");
    // The named schema type describes outputs, so the context type inlines it.
    expect(attributes).toContain(
      "export type MembershipAttribute = { since?: Date | string; tier?: string };",
    );
    expect(fs.readFileSync(path.join(outputPath, "schemas.ts"), "utf8")).toContain(
      "export type PortableInstantSchema = string;",
    );
    expect(fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8")).toContain(
      "portableTimestamp: string;",
    );
    const features = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    expect(features).toContain("when: string;");
    expect(features).toContain("referenced: PortableInstantSchema;");
    expect(features).toContain("dates: string[];");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it.each(["module", "commonjs"])(
    "compiles and runs generated modules in a NodeNext %s application",
    async (moduleType) => {
      const projectConfig = getProjectConfig(tempProjectPath);
      const datasource = new Datasource(projectConfig, tempProjectPath);
      await generateTypeScriptCodeForProject(
        { rootDirectoryPath: tempProjectPath, projectConfig, datasource, options: {} } as any,
        outputPath,
        { react: true },
      );
      fs.writeFileSync(path.join(outputPath, "package.json"), JSON.stringify({ type: moduleType }));
      const repositoryPath = path.resolve(__dirname, "../../../..");
      fs.symlinkSync(
        path.join(repositoryPath, "node_modules"),
        path.join(outputPath, "node_modules"),
        "junction",
      );
      const rootNames = fs
        .readdirSync(outputPath)
        .filter((file) => file.endsWith(".ts"))
        .map((file) => path.join(outputPath, file));
      const program = ts.createProgram(rootNames, {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        skipLibCheck: true,
        verbatimModuleSyntax: moduleType === "module",
      });
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
      ).toEqual([]);
      expect(program.emit().emitSkipped).toBe(false);
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import assert from 'node:assert/strict';
      import { getInstance, setInstance, isEnabled } from './index.js';
      assert.throws(() => getInstance(), { message: 'Call setInstance() before using generated functions' });
      const f = { isEnabled: () => true };
      setInstance(f);
      assert.equal(getInstance(), f);
      assert.equal(isEnabled('showBanner'), true);
    `,
        ],
        { cwd: outputPath },
      );
    },
  );

  it("generates schema-aware context types for attributes", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      {},
    );

    const attributesContent = fs.readFileSync(path.join(outputPath, "attributes.ts"), "utf8");
    const contextContent = fs.readFileSync(path.join(outputPath, "context.ts"), "utf8");
    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    const functionsContent = fs.readFileSync(path.join(outputPath, "functions.ts"), "utf8");
    const instanceContent = fs.readFileSync(path.join(outputPath, "instance.ts"), "utf8");
    const indexContent = fs.readFileSync(path.join(outputPath, "index.ts"), "utf8");
    const generatedFiles = fs.readdirSync(outputPath).sort();

    expect(attributesContent).toContain(
      'export type AccountAttribute = { plan: "free" | "pro"; locale?: string };',
    );
    expect(attributesContent).toContain(
      'export type PermissionsAttribute = ("read" | "write" | "admin")[];',
    );
    expect(attributesContent).toContain("export type VersionAttribute = string | number;");
    expect(attributesContent).toContain(
      "export type BrowserAttribute = { name?: string; version?: string };",
    );

    expect(contextContent).toContain("import type {");
    expect(contextContent).toContain(
      'import type { AttributeKey, AttributeValue } from "@featurevisor/sdk";',
    );
    expect(instanceContent).toContain('import type { Featurevisor } from "@featurevisor/sdk";');
    expect(contextContent).toContain("AccountAttribute,");
    expect(contextContent).toContain("PermissionsAttribute,");
    expect(contextContent).toContain("VersionAttribute,");
    expect(contextContent).toContain('} from "./attributes.js";');
    expect(contextContent).toContain("account?: AccountAttribute;");
    expect(contextContent).toContain("permissions?: PermissionsAttribute;");
    expect(contextContent).toContain("version?: VersionAttribute;");
    expect(contextContent).toContain("browser?: BrowserAttribute;");

    expect(indexContent).toContain('export * from "./attributes.js";');
    expect(indexContent).toContain('export * from "./features.js";');
    expect(indexContent).toContain('export * from "./functions.js";');
    expect(featuresContent).toContain("export type FeatureKey = keyof Features;");
    expect(featuresContent).not.toContain("export type VariableKey<");
    expect(featuresContent).not.toContain("export type VariableType<");
    expect(variablesContent).toContain("export type Variables = {");
    expect(variablesContent).toContain("export type VariableKey = keyof Variables;");
    expect(variablesContent).toContain(
      "export type VariableType<K extends VariableKey> = Variables[K];",
    );
    expect(variablesContent).not.toContain("GlobalVariable");
    expect(featuresContent).toContain("? Extract<V, string>");
    expect(functionsContent).toContain("export function isEnabled(");
    expect(functionsContent).toContain("export function getVariation<");
    expect(functionsContent).toContain("export function getVariable<");
    expect(functionsContent).toContain("import type { FeatureKey, Variation,");
    expect(functionsContent).toContain("getVariation<Variation<F>>(featureKey, context)");
    expect(functionsContent).toContain("FeatureVariableType<F, V> | null");
    expect(functionsContent).toContain("VariableType<K> | null");
    expect(functionsContent).not.toContain("export function getGlobalVariable");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).toContain("supportEmail: string;");
    expect(functionsContent).not.toContain("as Variation<F> | null");
    expect(functionsContent).not.toContain("as VariableType<F, V> | null");
    expect(generatedFiles.some((fileName) => fileName.endsWith("Feature.ts"))).toEqual(false);
    expect(indexContent).not.toMatch(/Feature";/);
    fs.writeFileSync(
      path.join(outputPath, "consumer.ts"),
      `import type { Variables, VariableKey, VariableType, FeatureVariableKey, FeatureVariableType } from "./index";
import { getVariable } from "./functions";
type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Keys = Assert<Same<VariableKey, keyof Variables>>;
type Email = Assert<Same<VariableType<"supportEmail">, string>>;
const email: string | null = getVariable("supportEmail");
// @ts-expect-error An unknown variable key must not be accepted.
type Missing = VariableType<"doesNotExist">;
// @ts-expect-error Feature variable keys require the explicit feature type.
type OldFeatureKey = VariableKey<"checkout">;
// @ts-expect-error Feature variable values require FeatureVariableType.
type OldFeatureValue = VariableType<"checkout", "label">;
`,
    );
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("generates the union of repeated tags and optional React hooks", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { tag: ["checkout", "ecommerce"], react: true },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    const reactContent = fs.readFileSync(path.join(outputPath, "react.ts"), "utf8");
    const indexContent = fs.readFileSync(path.join(outputPath, "index.ts"), "utf8");
    const generatedFiles = fs.readdirSync(outputPath).sort();

    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).toContain("pricing: {");
    expect(featuresContent).toContain("withComplexSchema: {");
    expect(featuresContent).not.toContain("accountTargeting:");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).not.toContain("supportEmail:");
    expect(generatedFiles).toContain("react.ts");
    expect(generatedFiles.some((fileName) => fileName.endsWith("Feature.ts"))).toEqual(false);
    expect(indexContent).toContain('export * from "./react.js";');
    expect(reactContent).toContain("useVariationOriginal<Variation<F>>(featureKey, context)");
    expect(reactContent).toContain('} from "@featurevisor/react";');
    expect(reactContent).toContain("FeatureVariableType<F, V> | null");
    expect(reactContent).toContain("VariableType<K> | null");
    expect(reactContent).not.toContain("export function useGlobalVariable");
    expect(reactContent).not.toContain("as Variation<F> | null");
    expect(reactContent).not.toContain("as VariableType<F, V> | null");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("generates typed React hooks for several flags at once", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { tag: ["checkout", "ecommerce"], react: true },
    );

    const reactContent = fs.readFileSync(path.join(outputPath, "react.ts"), "utf8");
    for (const hook of ["useFlags", "useEveryFlag", "useSomeFlag"]) {
      expect(reactContent).toContain(`${hook} as ${hook}Original,`);
      expect(reactContent).toContain(
        `export function ${hook}<const K extends readonly FeatureKey[]>(`,
      );
      expect(reactContent).toContain(`return ${hook}Original<K>(featureKeys, context);`);
    }

    fs.writeFileSync(
      path.join(outputPath, "multipleFlagsAssertions.ts"),
      `import { useEveryFlag, useFlags, useSomeFlag } from "./react.js";
import type { FeatureKey } from "./features.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

const flags = useFlags(["discount", "pricing", "withComplexSchema"], { userId: "user-1" });
type Flags = Assert<Equal<typeof flags, readonly [boolean, boolean, boolean]>>;
declare const runtimeKeys: FeatureKey[];
const runtimeFlags = useFlags(runtimeKeys);
type RuntimeFlags = Assert<Equal<typeof runtimeFlags, readonly boolean[]>>;
// @ts-expect-error A misspelt key does not compile.
useFlags(["discount", "pricng"]);
// @ts-expect-error A feature outside the generated tags does not compile.
useFlags(["accountTargeting"]);

const every: boolean = useEveryFlag(["discount", "pricing"]);
const some: boolean = useSomeFlag(runtimeKeys, { userId: "user-1" });
// @ts-expect-error A literal empty list is rejected.
useEveryFlag([]);
// @ts-expect-error A literal empty list is rejected.
useSomeFlag([]);
// @ts-expect-error A misspelt key does not compile.
useSomeFlag(["pricng"]);

export type Checks = [Flags, RuntimeFlags];
export { every, some };
`,
    );
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("includes transitive required features when filtering by tag", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "codegenDependency.yml"),
      [
        "description: Code generation dependency",
        "tags:",
        "  - dependency-only",
        "bucketBy: userId",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "codegenSelected.yml"),
      [
        "description: Selected for code generation",
        "tags:",
        "  - codegen-selected",
        "conditions: { feature: codegenDependency }",
        "bucketBy: userId",
      ].join("\n"),
      "utf8",
    );

    const projectConfig = getProjectConfig(tempProjectPath);
    projectConfig.tags.push("codegen-selected");
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { tag: "codegen-selected" },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    expect(featuresContent).toContain("codegenSelected: null;");
    expect(featuresContent).toContain("codegenDependency: null;");
    expect(featuresContent).not.toContain("discount: null;");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("uses custom import paths and treats the React path as opting into React helpers", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    const importSdkPath = "@company/featurevisor-sdk";
    const importReactPath = "@company/featurevisor-react";

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { importSdkPath, importReactPath },
    );

    const instanceContent = fs.readFileSync(path.join(outputPath, "instance.ts"), "utf8");
    const contextContent = fs.readFileSync(path.join(outputPath, "context.ts"), "utf8");
    const reactContent = fs.readFileSync(path.join(outputPath, "react.ts"), "utf8");
    const generatedContent = [instanceContent, contextContent, reactContent].join("\n");

    expect(instanceContent).toContain(`from "${importSdkPath}";`);
    expect(contextContent).toContain(`from "${importSdkPath}";`);
    expect(reactContent).toContain(`from "${importReactPath}";`);
    expect(generatedContent).not.toContain('from "@featurevisor/sdk";');
    expect(generatedContent).not.toContain('from "@featurevisor/react";');
    expect(getGeneratedTypeScriptDiagnostics(outputPath, importSdkPath, importReactPath)).toEqual(
      [],
    );
  });

  it("falls back to default import paths when empty overrides are provided", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { react: true, importSdkPath: "", importReactPath: "" },
    );

    expect(fs.readFileSync(path.join(outputPath, "instance.ts"), "utf8")).toContain(
      'from "@featurevisor/sdk";',
    );
    expect(fs.readFileSync(path.join(outputPath, "context.ts"), "utf8")).toContain(
      'from "@featurevisor/sdk";',
    );
    expect(fs.readFileSync(path.join(outputPath, "react.ts"), "utf8")).toContain(
      'from "@featurevisor/react";',
    );
  });

  it("generates the union of repeated targets using their full selectors", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "targets", "ecommerce-code.yml"),
      [
        "description: Ecommerce code",
        "tags:",
        "  and:",
        "    - all",
        "    - ecommerce",
        "includeFeatures:",
        "  - with*",
        "excludeFeatures:",
        "  - withMutations",
      ].join("\n"),
      "utf8",
    );
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { target: ["checkout", "ecommerce-code"] },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");

    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).toContain("pricing: {");
    expect(featuresContent).toContain("withComplexSchema: {");
    expect(featuresContent).not.toContain("withMutations:");
    expect(featuresContent).not.toContain("accountTargeting:");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).not.toContain("headerMessage:");
    expect(variablesContent).not.toContain("supportEmail:");
  });

  it("includes transitive required features when filtering by target", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "targetDependency.yml"),
      ["description: Target dependency", "tags:", "  - dependency-only", "bucketBy: userId"].join(
        "\n",
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "targetSelected.yml"),
      [
        "description: Selected through target",
        "tags:",
        "  - target-selected",
        "conditions: { feature: targetDependency }",
        "bucketBy: userId",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "targets", "dependency-code.yml"),
      [
        "description: Dependency code",
        "includeFeatures:",
        "  - targetSelected",
        "includeVariables: []",
      ].join("\n"),
      "utf8",
    );

    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { target: "dependency-code" },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    expect(featuresContent).toContain("targetSelected: null;");
    expect(featuresContent).toContain("targetDependency: null;");
    expect(featuresContent).not.toContain("discount: null;");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("combines tags and targets as a union and rejects unknown selectors", async () => {
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);
    const deps = {
      rootDirectoryPath: tempProjectPath,
      projectConfig,
      datasource,
      options: {},
    } as any;

    await generateTypeScriptCodeForProject(deps, outputPath, {
      tag: "sign-in",
      target: "checkout",
    });

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    expect(featuresContent).toContain("foo: {");
    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).not.toContain("accountTargeting:");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).not.toContain("headerMessage:");
    expect(variablesContent).not.toContain("supportEmail:");

    await expect(
      generateTypeScriptCodeForProject(deps, outputPath, { tag: "missing" }),
    ).rejects.toThrow('Unknown tag "missing"');
    await expect(
      generateTypeScriptCodeForProject(deps, outputPath, { target: "missing" }),
    ).rejects.toThrow('Unknown target "missing"');
  });

  it("unions repeated tags and targets for features and global variables", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "signInMessage.yml"),
      [
        "description: Sign-in message",
        "tags:",
        "  - sign-in",
        "type: string",
        "defaultValue: Welcome back",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "targets", "ecommerce-code.yml"),
      [
        "description: Ecommerce code",
        "tags:",
        "  and:",
        "    - all",
        "    - ecommerce",
        "includeFeatures:",
        "  - with*",
        "includeVariables:",
        "  - checkout*",
      ].join("\n"),
      "utf8",
    );
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      {
        tag: ["sign-in", "ecommerce"],
        target: ["checkout", "ecommerce-code"],
      },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");

    expect(featuresContent).toContain("foo: {");
    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).toContain("withComplexSchema: {");
    expect(featuresContent).not.toContain("accountTargeting:");
    expect(variablesContent).toContain("signInMessage: string;");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).not.toContain("supportEmail:");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });

  it("uses variable patterns from a target without requiring tags", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "targets", "support-code.yml"),
      [
        "description: Support code",
        "includeFeatures:",
        "  - account*",
        "includeVariables:",
        "  - support*",
        "excludeVariables:",
        "  - supportInternal*",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "supportInternalNote.yml"),
      ["description: Internal note", "type: string", "defaultValue: Internal"].join("\n"),
      "utf8",
    );
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { target: "support-code" },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    expect(featuresContent).toContain("accountTargeting:");
    expect(featuresContent).not.toContain("discount:");
    expect(variablesContent).toContain("supportEmail: string;");
    expect(variablesContent).not.toContain("supportInternalNote:");
  });

  it("includes feature dependency chains required by selected global variables", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "targets", "header-variable-only.yml"),
      [
        "description: Header variable only",
        "includeFeatures:",
        "  - does-not-match-*",
        "includeVariables:",
        "  - headerMessage",
      ].join("\n"),
      "utf8",
    );
    const projectConfig = getProjectConfig(tempProjectPath);
    const datasource = new Datasource(projectConfig, tempProjectPath);

    await generateTypeScriptCodeForProject(
      {
        rootDirectoryPath: tempProjectPath,
        projectConfig,
        datasource,
        options: {},
      } as any,
      outputPath,
      { target: "header-variable-only" },
    );

    const featuresContent = fs.readFileSync(path.join(outputPath, "features.ts"), "utf8");
    const variablesContent = fs.readFileSync(path.join(outputPath, "variables.ts"), "utf8");
    expect(variablesContent).toContain("headerMessage: string;");
    expect(featuresContent).toContain("showHeader: null;");
    expect(featuresContent).not.toContain("discount:");
    expect(getGeneratedTypeScriptDiagnostics(outputPath)).toEqual([]);
  });
});
