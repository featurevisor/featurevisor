import * as path from "path";

import { getCommit, getHistoryEntity } from "./git";
import type { ProjectConfig } from "../config";

const rootDirectoryPath = path.join(path.sep, "project");
const projectConfig = {
  attributesDirectoryPath: path.join(rootDirectoryPath, "attributes"),
  segmentsDirectoryPath: path.join(rootDirectoryPath, "segments"),
  featuresDirectoryPath: path.join(rootDirectoryPath, "features"),
  schemasDirectoryPath: path.join(rootDirectoryPath, "schemas"),
  variablesDirectoryPath: path.join(rootDirectoryPath, "variables"),
  targetsDirectoryPath: path.join(rootDirectoryPath, "targets"),
  testsDirectoryPath: path.join(rootDirectoryPath, "tests"),
  parser: { extension: "yml" },
} as ProjectConfig;

function diffOutput(file: string, lines: string[]) {
  return [
    "commit abc123",
    "Author: Test Author",
    "Date: 2026-09-13T12:00:00.000Z",
    "",
    "    Update spec",
    "",
    `diff --git a/${file} b/${file}`,
    ...lines,
  ].join("\n");
}

describe("utils/git", () => {
  it.each([
    ["attributes", "attribute"],
    ["segments", "segment"],
    ["features", "feature"],
    ["schemas", "schema"],
    ["variables", "variable"],
    ["targets", "target"],
    ["tests", "test"],
  ])("preserves nested %s keys with the requested namespace", (directory, type) => {
    const options = { rootDirectoryPath, projectConfig };
    expect(getHistoryEntity(`${directory}/nested/example.yml`, options)).toEqual({
      type,
      key: "nested/example",
    });
    expect(getHistoryEntity(`${directory}/nested/example.yml`, options, ".")).toEqual({
      type,
      key: "nested.example",
    });
    expect(getHistoryEntity(`${directory}/nested/example.txt`, options)).toBeUndefined();
    expect(getHistoryEntity(`${directory}-unrelated/example.yml`, options)).toBeUndefined();
  });

  it("uses contents from the affected revisions for both sides of a kind change", () => {
    const readTestSpec = jest.fn((revision: string) =>
      revision.endsWith("^") ? { checks: [] } : { feature: "example", assertions: [] },
    );
    const commit = getCommit(
      diffOutput("tests/workflows/ready.spec.yml", [
        "--- a/tests/workflows/ready.spec.yml",
        "+++ b/tests/workflows/ready.spec.yml",
        "@@ -1 +1 @@",
        "-checks: []",
        "+feature: example",
      ]),
      { rootDirectoryPath, projectConfig, readTestSpec },
    );
    expect(readTestSpec.mock.calls).toEqual([
      ["abc123^", "tests/workflows/ready.spec.yml"],
      ["abc123", "tests/workflows/ready.spec.yml"],
    ]);
    expect(commit.entities).toEqual([
      expect.objectContaining({ type: "scenario", key: "workflows/ready", deleted: true }),
      expect.objectContaining({ type: "test", key: "workflows/ready", created: true }),
    ]);
  });

  it("classifies a deleted scenario using only its parent revision", () => {
    const readTestSpec = jest.fn(() => ({ checks: [] }));
    const commit = getCommit(
      diffOutput("tests/nested/ready.spec.yml", [
        "deleted file mode 100644",
        "--- a/tests/nested/ready.spec.yml",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-checks: []",
      ]),
      { rootDirectoryPath, projectConfig, readTestSpec },
    );
    expect(readTestSpec).toHaveBeenCalledTimes(1);
    expect(readTestSpec).toHaveBeenCalledWith("abc123^", "tests/nested/ready.spec.yml");
    expect(commit.entities).toEqual([
      expect.objectContaining({ type: "scenario", key: "nested/ready", deleted: true }),
    ]);
  });

  it("retains both source and destination paths for rename diffs", () => {
    const readTestSpec = jest.fn(() => ({ checks: [] }));
    const commit = getCommit(
      diffOutput("tests/old.spec.yml", [
        "similarity index 100%",
        "rename from tests/old.spec.yml",
        "rename to tests/workflows/new.spec.yml",
      ]),
      { rootDirectoryPath, projectConfig, readTestSpec },
    );
    expect(readTestSpec.mock.calls).toEqual([
      ["abc123^", "tests/old.spec.yml"],
      ["abc123", "tests/workflows/new.spec.yml"],
    ]);
    expect(commit.entities).toEqual([
      expect.objectContaining({ type: "scenario", key: "old", deleted: true }),
      expect.objectContaining({ type: "scenario", key: "workflows/new", created: true }),
    ]);
  });

  it("retains unreadable historical specs as generic test changes", () => {
    const commit = getCommit(
      diffOutput("tests/scenarios/malformed.spec.yml", ["deleted file mode 100644"]),
      {
        rootDirectoryPath,
        projectConfig,
        readTestSpec: () => {
          throw new Error("Invalid document");
        },
      },
    );
    expect(commit.entities).toEqual([
      expect.objectContaining({ type: "test", key: "scenarios/malformed", deleted: true }),
    ]);
  });

  it("preserves nested keys for global variable history entries", () => {
    const rootDirectoryPath = path.join(path.sep, "project");
    const variablesDirectoryPath = path.join(rootDirectoryPath, "variables");
    const output = [
      "commit abc123",
      "Author: Test Author",
      "Date: 2026-08-26T12:00:00.000Z",
      "",
      "    Update variable",
      "",
      "diff --git a/variables/checkout/supportEmail.yml b/variables/checkout/supportEmail.yml",
      "index 1111111..2222222 100644",
      "--- a/variables/checkout/supportEmail.yml",
      "+++ b/variables/checkout/supportEmail.yml",
      "@@ -1 +1 @@",
      "-defaultValue: old@example.com",
      "+defaultValue: new@example.com",
    ].join("\n");

    const commit = getCommit(output, {
      rootDirectoryPath,
      projectConfig: {
        attributesDirectoryPath: path.join(rootDirectoryPath, "attributes"),
        segmentsDirectoryPath: path.join(rootDirectoryPath, "segments"),
        featuresDirectoryPath: path.join(rootDirectoryPath, "features"),
        schemasDirectoryPath: path.join(rootDirectoryPath, "schemas"),
        variablesDirectoryPath,
        targetsDirectoryPath: path.join(rootDirectoryPath, "targets"),
        testsDirectoryPath: path.join(rootDirectoryPath, "tests"),
        parser: { extension: "yml" },
      } as any,
    });

    expect(commit.entities).toEqual([
      expect.objectContaining({
        type: "variable",
        key: "checkout/supportEmail",
        updated: true,
      }),
    ]);
  });

  it("preserves nested test paths without inferring a kind from the directory", () => {
    const rootDirectoryPath = path.join(path.sep, "project");
    const output = [
      "commit abc123",
      "Author: Test Author",
      "Date: 2026-09-13T12:00:00.000Z",
      "",
      "    Update scenario",
      "",
      "diff --git a/tests/scenarios/checkout/readiness.spec.yml b/tests/scenarios/checkout/readiness.spec.yml",
      "index 1111111..2222222 100644",
      "--- a/tests/scenarios/checkout/readiness.spec.yml",
      "+++ b/tests/scenarios/checkout/readiness.spec.yml",
      "@@ -1 +1 @@",
      "-description: Old",
      "+description: New",
    ].join("\n");

    const commit = getCommit(output, {
      rootDirectoryPath,
      projectConfig: {
        attributesDirectoryPath: path.join(rootDirectoryPath, "attributes"),
        segmentsDirectoryPath: path.join(rootDirectoryPath, "segments"),
        featuresDirectoryPath: path.join(rootDirectoryPath, "features"),
        schemasDirectoryPath: path.join(rootDirectoryPath, "schemas"),
        variablesDirectoryPath: path.join(rootDirectoryPath, "variables"),
        targetsDirectoryPath: path.join(rootDirectoryPath, "targets"),
        testsDirectoryPath: path.join(rootDirectoryPath, "tests"),
        parser: { extension: "yml" },
      } as any,
    });

    expect(commit.entities).toEqual([
      expect.objectContaining({
        type: "test",
        key: "scenarios/checkout/readiness.spec",
        updated: true,
      }),
    ]);
  });
});
