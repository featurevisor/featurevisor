import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { generateTypeScriptCodeForProject } from "./typescript";

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
    const functionsContent = fs.readFileSync(path.join(outputPath, "functions.ts"), "utf8");
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
    expect(functionsContent).toContain("export function isEnabled(");
    expect(functionsContent).toContain("export function getVariation<");
    expect(functionsContent).toContain("export function getVariable<");
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
    const indexContent = fs.readFileSync(path.join(outputPath, "index.ts"), "utf8");
    const generatedFiles = fs.readdirSync(outputPath).sort();

    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).toContain("pricing: {");
    expect(featuresContent).toContain("withComplexSchema: {");
    expect(featuresContent).not.toContain("accountTargeting:");
    expect(generatedFiles).toContain("react.ts");
    expect(generatedFiles.some((fileName) => fileName.endsWith("Feature.ts"))).toEqual(false);
    expect(indexContent).toContain('export * from "./react";');
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

    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).toContain("pricing: {");
    expect(featuresContent).toContain("withComplexSchema: {");
    expect(featuresContent).not.toContain("withMutations:");
    expect(featuresContent).not.toContain("accountTargeting:");
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
    expect(featuresContent).toContain("foo: {");
    expect(featuresContent).toContain("discount: null;");
    expect(featuresContent).not.toContain("accountTargeting:");

    await expect(
      generateTypeScriptCodeForProject(deps, outputPath, { tag: "missing" }),
    ).rejects.toThrow('Unknown tag "missing"');
    await expect(
      generateTypeScriptCodeForProject(deps, outputPath, { target: "missing" }),
    ).rejects.toThrow('Unknown target "missing"');
  });
});
