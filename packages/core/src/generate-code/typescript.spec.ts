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
        "  metadata:",
        "    type: object",
        "    additionalProperties:",
        "      type: string",
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

    const contextContent = fs.readFileSync(path.join(outputPath, "context.ts"), "utf8");

    expect(contextContent).toContain('account?: { plan: "free" | "pro"; metadata?: Record<string, string> };');
    expect(contextContent).toContain('permissions?: ("read" | "write" | "admin")[];');
    expect(contextContent).toContain("browser?: { name?: string; version?: string };");
  });
});
