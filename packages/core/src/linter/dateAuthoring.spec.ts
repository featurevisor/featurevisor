import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { lintProject } from "./lintProject";

describe("date authoring project integration", () => {
  let root: string;
  const write = (file: string, value: unknown) => {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(value));
  };
  const deps = () => {
    const projectConfig = getProjectConfig(root);
    return {
      projectConfig,
      rootDirectoryPath: root,
      datasource: new Datasource(projectConfig, root),
    };
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-date-authoring-"));
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      'module.exports = { parser: "json" };',
    );
    write("attributes/now.json", {
      description: "Current instant",
      type: "string",
      format: "date-time",
    });
    write("attributes/userId.json", { description: "User", type: "string" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test.each([
    "segment",
    "force",
    "feature override",
    "variable override",
    "nested variable override",
  ])("rejects a prohibited date operator in %s with one diagnostic", async (location) => {
    const condition = { attribute: "now", operator: "matches", value: "[" };
    const feature = {
      description: "Checkout",
      bucketBy: "userId",
      rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
    };
    if (location === "segment")
      write("segments/launch.json", { description: "Launch", conditions: condition });
    if (location === "force")
      write("features/checkout.json", {
        ...feature,
        force: [{ conditions: condition, enabled: true }],
      });
    if (location === "feature override")
      write("features/checkout.json", {
        ...feature,
        variablesSchema: { title: { type: "string", defaultValue: "Checkout" } },
        variations: [
          {
            value: "standard",
            weight: 100,
            variableOverrides: {
              title: [{ key: "timed", conditions: condition, value: "Launch" }],
            },
          },
        ],
      });
    if (location.includes("variable override"))
      write("variables/title.json", {
        description: "Title",
        type: "string",
        defaultValue: "Checkout",
        overrides:
          location === "variable override"
            ? [{ key: "timed", conditions: condition, value: "Launch" }]
            : [
                {
                  key: "parent",
                  conditions: "*",
                  value: "Parent",
                  overrides: [{ key: "timed", conditions: condition, value: "Launch" }],
                },
              ],
      });
    const result = await lintProject(deps() as any, { json: true });
    expect(result.hasError).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('date-time attribute "now"');
    const issuePath = result.errors[0].path;
    expect(issuePath[issuePath.length - 1]).toBe("operator");
  });

  test("keeps authored operand validation in lint rather than datafile construction", async () => {
    write("segments/launch.json", {
      description: "Launch",
      conditions: { attribute: "now", operator: "after", value: "2026-01-01" },
    });
    write("features/checkout.json", {
      description: "Checkout",
      bucketBy: "userId",
      rules: [{ key: "launch", conditions: "launch", percentage: 100 }],
    });
    const dependencies = deps();
    const result = await lintProject(dependencies as any, { json: true });
    expect(result.hasError).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("ISO 8601");
    const files = await buildRuntimeDatafiles(dependencies as any, {
      environment: false,
      revision: "test",
    });
    expect(JSON.stringify(files[0].datafile.segments.launch)).toContain("2026-01-01");
    expect(fs.existsSync(path.join(root, "state"))).toBe(false);
    expect(fs.existsSync(path.join(root, "datafiles"))).toBe(false);
  });
});
