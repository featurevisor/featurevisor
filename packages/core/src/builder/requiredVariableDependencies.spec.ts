import path from "node:path";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildTargetDatafile } from "./buildProject";
import { getCustomDatafile } from "./buildDatafile";

describe("required variable dependency builds", () => {
  it("includes array membership feature, variable and segment dependencies for a restricted selection", async () => {
    const root = path.resolve(__dirname, "../../../../examples/example-1");
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const result = await getCustomDatafile({
      projectConfig,
      datasource,
      environment: "staging",
      revision: "array-membership",
      includeFeatures: ["unrelated.*"],
      includeVariables: ["permissionNotice"],
    });
    expect(Object.keys(result.features)).toEqual(["permissionMembership"]);
    expect(Object.keys(result.variables || {}).sort()).toEqual([
      "permissionNotice",
      "permissionPolicy",
    ]);
    expect(Object.keys(result.segments).sort()).toEqual([
      "readOnlyPermissions",
      "writePermissions",
    ]);
    const requirement = result.variables?.permissionNotice.overrides?.[0].conditions;
    expect(requirement).toBeDefined();
  });
  it("includes the complete mixed closure for the variable-requirements Target", async () => {
    const root = path.resolve(__dirname, "../../../../examples/example-1");
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const target = await datasource.readTarget("variable-requirements");
    const result = await buildTargetDatafile({
      projectConfig,
      datasource,
      target,
      environment: "production",
      existingState: await datasource.readState("production"),
      revision: "required-variables",
    });

    expect(Object.keys(result.features).sort()).toEqual([
      "variablePolicySource",
      "variableRequirementsExample",
    ]);
    expect(Object.keys(result.variables || {}).sort()).toEqual(["runtimeMessage", "runtimePolicy"]);
    expect(JSON.parse(result.features.variableRequirementsExample.conditions as string)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: "runtimePolicy", path: ["routing", "enabled"] }),
        expect.objectContaining({
          feature: "variablePolicySource",
          variable: "config.policy",
          path: ["retries"],
        }),
      ]),
    );
  });

  it("includes variables required by unfiltered features when variables are restricted", async () => {
    const root = path.resolve(__dirname, "../../../../examples/example-1");
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const result = await getCustomDatafile({
      projectConfig,
      datasource,
      environment: "production",
      revision: "variable-filter",
      includeVariables: ["runtimeMessage"],
    });

    expect(result.features.variableRequirementsExample).toBeDefined();
    expect(result.variables?.runtimeMessage).toBeDefined();
    expect(result.variables?.runtimePolicy).toBeDefined();
  });
});
