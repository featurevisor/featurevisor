import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { lintPlugin, lintProject } from "./lintProject";

describe("composition warning lint integration", () => {
  let root: string;
  function write(directory: string, key: string, value: unknown) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, `${key}.yml`), JSON.stringify(value));
  }
  function deps() {
    const projectConfig = getProjectConfig(root);
    return {
      rootDirectoryPath: root,
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      options: {},
    };
  }
  function view(extra = {}, value: unknown = "control") {
    return {
      description: "View",
      compose: {
        assignment: { feature: "experiment", variation: true },
        policy: { variable: "policy" },
      },
      overrides: [
        {
          key: "regional",
          conditions: "*",
          mutate: { assignment: value, "policy.limit": 90 },
          ...extra,
        },
      ],
    };
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-warnings-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
    write("attributes", "userId", { description: "User", type: "string" });
    write("features", "experiment", {
      description: "Experiment",
      bucketBy: "userId",
      variations: [
        { value: "control", weight: 50 },
        { value: "treatment", weight: 50 },
      ],
      rules: [{ key: "all", conditions: "*", percentage: 100 }],
    });
    write("variables", "policy", {
      description: "Policy",
      type: "object",
      properties: { limit: { type: "integer" } },
      defaultValue: { limit: 10 },
      conditions: { feature: "experiment" },
    });
    write("variables", "view", view());
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("returns nonblocking warnings with real file and indexed mutation paths", async () => {
    const result = await lintProject(deps() as any, {
      json: true,
      entityType: "variable",
      keyPattern: "^view$",
    });
    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "composition_experiment_override",
        entityType: "variable",
        key: "view",
        filePath: path.relative(process.cwd(), path.join(root, "variables", "view.yml")),
        path: ["overrides", 0, "mutate", "assignment"],
      }),
      expect.objectContaining({
        code: "composition_nullable_mutation",
        path: ["overrides", 0, "mutate", "policy.limit"],
      }),
    ]);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    expect(
      await lintPlugin.handler({
        ...deps(),
        parsed: { json: true, entityType: "variable", keyPattern: "^view$" },
      } as any),
    ).not.toBe(false);
    const output = JSON.parse(log.mock.calls[log.mock.calls.length - 1][0]);
    expect(output.warnings).toEqual(result.warnings);
    expect(output.errors).toEqual([]);
  });
  it("prints human warnings and still succeeds, without changing definition files", async () => {
    const file = path.join(root, "variables", "view.yml");
    const original = fs.readFileSync(file, "utf8");
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await lintProject(deps() as any, {
      entityType: "variable",
      keyPattern: "^view$",
    });
    expect(result.hasError).toBe(false);
    expect(log.mock.calls.flat().join("\n")).toContain("Warning:");
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Source assignment and exposure callbacks run before composed overrides",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
  it("removes only the nullable warning when an authored notNull guard is added", async () => {
    write("variables", "view", view({ conditions: { variable: "policy", operator: "notNull" } }));
    const result = await lintProject(deps() as any, { json: true });
    expect(result.hasError).toBe(false);
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "composition_experiment_override",
    ]);
  });
  it("does not add speculative warnings to structurally invalid overrides", async () => {
    write("variables", "view", view({}, "not-a-variation"));
    const result = await lintProject(deps() as any, { json: true });
    expect(result.hasError).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "variable",
          key: "view",
          path: ["overrides", 0, "mutate", "assignment"],
        }),
      ]),
    );
    expect(result.warnings).toBeUndefined();
  });
});
