import { showProjectInfo } from "./index";

describe("core: project info", function () {
  test("includes all top level definition counts", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    const datasource = {
      readRevision: async () => "42",
      listAttributes: async () => ["country"],
      listSegments: async () => ["nl"],
      listFeatures: async () => ["checkout"],
      readFeature: async () => ({ variablesSchema: { colour: { type: "string" } } }),
      listGroups: async () => ["experiments"],
      listSchemas: async () => ["colour"],
      listTargets: async () => ["web"],
      listVariables: async () => ["supportEmail"],
      listTests: async () => [],
    };

    await showProjectInfo({
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    });

    const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const output = log.mock.calls
      .map(([message]) => message)
      .join("\n")
      .replace(ansiPattern, "");
    expect(output).toContain("Total attributes");
    expect(output).toContain("Total segments");
    expect(output).toContain("Total features");
    expect(output).toContain("Total variables:               1");
    expect(output).toContain("Total variables (in features): 1");
    expect(output.indexOf("Total variables:")).toBeLessThan(
      output.indexOf("Total variables (in features):"),
    );
    expect(output).toContain("Total groups");
    expect(output).toContain("Total schemas");
    expect(output).toContain("Total targets");
    expect(output).toContain("Total test specs");
  });
});
