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
      listSchemas: async () => ["colour"],
      listTargets: async () => ["web"],
      listVariables: async () => ["supportEmail", "composition", "alias"],
      readVariable: jest.fn(() => {
        throw new Error("Info must count compositions without reading defaults");
      }),
      listTests: async () => [],
      listScenarios: async () => [],
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
    expect(output).toContain("Total Variables:               3");
    expect(datasource.readVariable).not.toHaveBeenCalled();
    expect(output).toContain("Total Variables (in features): 1");
    expect(output.indexOf("Total Variables:")).toBeLessThan(
      output.indexOf("Total Variables (in features):"),
    );
    expect(output).not.toContain("Total groups");
    expect(output).toContain("Total schemas");
    expect(output).toContain("Total targets");
    expect(output).toContain("Total test specs");
    expect(output).toContain("Total scenario specs");
    expect(output).toContain("Total scenario cases");
  });

  test("reports raw scenario specs and expanded matrix cases separately", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    log.mockClear();
    const datasource = {
      readRevision: async () => "42",
      listAttributes: async () => [],
      listSegments: async () => [],
      listFeatures: async () => [],
      listSchemas: async () => [],
      listTargets: async () => [],
      listVariables: async () => [],
      listTests: async () => [],
      listScenarios: async () => ["checkout"],
      readScenario: async () => ({
        matrix: { country: ["nl", "de"] },
        checks: [
          {
            variable: "supportEmail",
            operator: "notEquals",
            value: "",
          },
        ],
      }),
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
    expect(output).toContain("Total test specs:              0");
    expect(output).toContain("Total assertions:              0");
    expect(output).toContain("Total scenario specs:          1");
    expect(output).toContain("Total scenario cases:          2");
  });
});
