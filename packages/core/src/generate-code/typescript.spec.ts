import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { generateTypeScriptCodeForProject } from "./typescript";

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
    expect(contextContent).toContain('} from "./attributes";');
    expect(contextContent).toContain("account?: AccountAttribute;");
    expect(contextContent).toContain("permissions?: PermissionsAttribute;");
    expect(contextContent).toContain("version?: VersionAttribute;");
    expect(contextContent).toContain("browser?: BrowserAttribute;");

    expect(indexContent).toContain('export * from "./attributes";');
    expect(indexContent).toContain('export * from "./features";');
    expect(indexContent).toContain('export * from "./functions";');
    expect(featuresContent).toContain("export type FeatureKey = keyof Features;");
    expect(featuresContent).toContain("? Extract<V, string>");
    expect(functionsContent).toContain("export function isEnabled(");
    expect(functionsContent).toContain("export function getVariation<");
    expect(functionsContent).toContain("export function getVariable<");
    expect(functionsContent).toContain("import type { FeatureKey, Variation,");
    expect(functionsContent).toContain("getVariation<Variation<F>>(featureKey, context)");
    expect(functionsContent).toContain("FeatureVariableType<F, V> | null");
    expect(functionsContent).toContain("GlobalVariableType<K> | null");
    expect(functionsContent).not.toContain("export function getGlobalVariable");
    expect(variablesContent).toContain("checkoutSettings: {");
    expect(variablesContent).toContain("supportEmail: string;");
    expect(functionsContent).not.toContain("as Variation<F> | null");
    expect(functionsContent).not.toContain("as VariableType<F, V> | null");
    expect(generatedFiles.some((fileName) => fileName.endsWith("Feature.ts"))).toEqual(false);
    expect(indexContent).not.toMatch(/Feature";/);
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
    expect(indexContent).toContain('export * from "./react";');
    expect(reactContent).toContain("useVariationOriginal<Variation<F>>(featureKey, context)");
    expect(reactContent).toContain('} from "@featurevisor/react";');
    expect(reactContent).toContain("FeatureVariableType<F, V> | null");
    expect(reactContent).toContain("GlobalVariableType<K> | null");
    expect(reactContent).not.toContain("export function useGlobalVariable");
    expect(reactContent).not.toContain("as Variation<F> | null");
    expect(reactContent).not.toContain("as VariableType<F, V> | null");
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
