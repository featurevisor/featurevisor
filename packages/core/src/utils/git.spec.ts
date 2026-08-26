import * as path from "path";

import { getCommit } from "./git";

describe("utils/git", () => {
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
        groupsDirectoryPath: path.join(rootDirectoryPath, "groups"),
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
});
