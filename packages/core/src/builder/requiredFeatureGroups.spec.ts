import path from "node:path";
import { createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getCustomDatafile } from "./buildDatafile";

describe("grouped requirements from authoring through targeted datafiles", () => {
  test.each([true, false])(
    "preserves inherited groups with accumulation=%s",
    async (accumulation) => {
      const root = path.resolve(__dirname, "../../../../examples/example-1");
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      if (!accumulation) {
        const read = datasource.readVariable.bind(datasource);
        jest.spyOn(datasource, "readVariable").mockImplementation(async (key) => {
          const variable = await read(key);
          if (
            key === "groupedMessage" &&
            variable.overrides &&
            !Array.isArray(variable.overrides)
          ) {
            delete variable.overrides.production[0].continue;
          }
          return variable;
        });
      }
      const result = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        revision: "groups",
        includeFeatures: ["groupedRequirements"],
        includeVariables: ["groupedMessage"],
      });
      expect(Object.keys(result.features)).toEqual(
        expect.arrayContaining(["groupedRequirements", "redesign", "sidebar", "pricing"]),
      );
      expect(JSON.parse(result.features.groupedRequirements.conditions as string)).toEqual({
        or: [{ feature: "redesign" }, { feature: "sidebar" }],
      });
      expect(result.variables!.groupedMessage.overrideProgram !== undefined).toBe(accumulation);
      const f = createFeaturevisor({
        datafile: result,
        stickyFeatures: {
          redesign: { enabled: true },
          sidebar: { enabled: true },
          pricing: { enabled: false },
        },
      });
      expect(f.getVariable("groupedMessage")).toBe("Redesigned sidebar message");
      f.setStickyFeatures({ redesign: { enabled: false }, sidebar: { enabled: true } }, true);
      expect(f.getVariable("groupedMessage")).toBe("Sidebar message");
      f.setStickyFeatures({ redesign: { enabled: false }, sidebar: { enabled: false } }, true);
      expect(f.getVariable("groupedMessage")).toBe("Unavailable");
    },
  );
});
