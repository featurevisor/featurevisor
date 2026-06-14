import type { ProjectConfig } from "../config";
import { getTargetZodSchema } from "./targetSchema";

function minimalProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    groupsDirectoryPath: "",
    schemasDirectoryPath: "",
    targetsDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    siteExportDirectoryPath: "",
    setsDirectoryPath: "",
    environments: ["staging", "production"],
    sets: false,
    namespaceCharacter: ".",
    tags: ["all", "web", "mobile"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
    ...overrides,
  };
}

function parseTarget(input: unknown) {
  return getTargetZodSchema(minimalProjectConfig()).safeParse(input);
}

describe("targetSchema.ts :: getTargetZodSchema", () => {
  it("accepts a valid target", () => {
    const result = parseTarget({
      description: "Web target",
      tags: { and: ["all", "web"] },
      context: { device: "desktop" },
      promotable: true,
    });

    expect(result.success).toBe(true);
  });

  it("requires description", () => {
    const result = parseTarget({ tags: ["all"] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain("Required");
    }
  });

  it("rejects unknown tags", () => {
    const result = parseTarget({ description: "Unknown tag", tags: ["unknown"] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain(
        'Unknown tag "unknown"',
      );
    }
  });

  it("rejects invalid tag shapes", () => {
    const result = parseTarget({ description: "Invalid tags", tags: { xor: ["web"] } });

    expect(result.success).toBe(false);
  });

  it("rejects non-boolean promotable", () => {
    const result = parseTarget({ description: "Bad promotable", promotable: "no" });

    expect(result.success).toBe(false);
  });
});
