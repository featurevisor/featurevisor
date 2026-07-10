import type { ParsedFeature } from "@featurevisor/types";

import { formatDatafileSize, listEntities, listProject } from "./index";

function createFeatureFixture(overrides: Partial<ParsedFeature> = {}): ParsedFeature {
  return {
    key: "untagged",
    description: "Untagged feature",
    bucketBy: "userId",
    rules: {
      staging: [{ key: "everyone", segments: "*", percentage: 100 }],
      production: [{ key: "everyone", segments: "*", percentage: 100 }],
    },
    ...overrides,
  };
}

describe("core: list", function () {
  test("excludes features with missing tags when tag filter is provided", async function () {
    const datasource = {
      listFeatures: async () => ["untagged"],
      readFeature: async () => createFeatureFixture(),
    };

    const result = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: {
          tag: "all",
        },
      },
      "feature",
    );

    expect(result).toEqual([]);
  });

  test("lists generated datafiles", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    const datasource = {
      listDatafiles: async () => [
        { path: "production/featurevisor-all.json", size: 42, gzipSize: 62 },
      ],
    };

    await listProject({
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: { datafiles: true, json: true },
    });

    expect(log).toHaveBeenCalledWith(
      '[{"path":"production/featurevisor-all.json","size":42,"gzipSize":62}]',
    );
    log.mockRestore();
  });

  test("formats datafile sizes with colored units", function () {
    expect(formatDatafileSize(42)).toBe("42.00 \u001b[33mB\u001b[0m");
    expect(formatDatafileSize(1024)).toBe("1.00 \u001b[36mkB\u001b[0m");
    expect(formatDatafileSize(1024 * 1024)).toBe("1.00 \u001b[32mmB\u001b[0m");
  });

  test("prints datafiles in aligned columns", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    const datasource = {
      listDatafiles: async () => [
        { path: "production/featurevisor-all.json", size: 1024 * 1024, gzipSize: 1024 },
        { path: "staging/featurevisor-checkout.json", size: 42, gzipSize: 24 },
        { path: "development/featurevisor-all.json", size: 1024, gzipSize: 512 },
      ],
    };

    await listProject({
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: { datafiles: true },
    });

    const output = log.mock.calls.map(([message]) => message).join("\n");
    const uncoloredOutput = output.replace(/\u001b\[[0-9;]*m/g, "");

    expect(uncoloredOutput).toContain("Datafile");
    expect(uncoloredOutput).toContain("Size");
    expect(uncoloredOutput).toContain("Gzip");
    expect(uncoloredOutput).toContain("production/featurevisor-all.json");
    expect(uncoloredOutput).toContain("staging/featurevisor-checkout.json");
    expect(uncoloredOutput.indexOf("development/featurevisor-all.json")).toBeLessThan(
      uncoloredOutput.indexOf("staging/featurevisor-checkout.json"),
    );
    expect(uncoloredOutput.indexOf("staging/featurevisor-checkout.json")).toBeLessThan(
      uncoloredOutput.indexOf("production/featurevisor-all.json"),
    );
    expect(uncoloredOutput).toMatch(/development\/featurevisor-all\.json\s+1\.00 kB/);
    expect(uncoloredOutput).toMatch(/development\/featurevisor-all\.json\s+1\.00 kB\s+512\.00  B/);
    expect(uncoloredOutput).toMatch(/staging\/featurevisor-checkout\.json\s+42\.00  B/);
    expect(uncoloredOutput).toMatch(/production\/featurevisor-all\.json\s+1\.00 mB/);
    expect(uncoloredOutput).toContain("512.00  B\n\n  staging/");
    expect(uncoloredOutput).toContain("24.00  B\n\n  production/");
    expect(output).toContain("\u001b[36mkB\u001b[0m");
    expect(output).toContain("\u001b[33mB\u001b[0m");
    expect(output).toContain("\u001b[32mmB\u001b[0m");
    log.mockRestore();
  });
});
