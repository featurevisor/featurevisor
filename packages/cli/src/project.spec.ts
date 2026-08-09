import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  findProjectRootDirectoryPath,
  getCLICommand,
  getRootDirectoryPathArgument,
} from "./project";

describe("cli: project discovery", function () {
  test("reads camel case and dashed root directory arguments", function () {
    expect(getRootDirectoryPathArgument(["build", "--rootDirectoryPath=../project"])).toBe(
      "../project",
    );
    expect(getRootDirectoryPathArgument(["build", "--root-directory-path", "../project"])).toBe(
      "../project",
    );
  });

  test("finds the command while skipping a separated root directory value", function () {
    expect(getCLICommand(["--rootDirectoryPath", "../project", "build"])).toBe("build");
  });

  test("discovers a project from a nested directory", function () {
    const projectDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-cli-"));
    const nestedDirectoryPath = path.join(projectDirectoryPath, "features", "checkout");

    try {
      fs.mkdirSync(nestedDirectoryPath, { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectoryPath, "featurevisor.config.js"),
        "module.exports = {};",
      );

      expect(findProjectRootDirectoryPath(nestedDirectoryPath)).toBe(projectDirectoryPath);
    } finally {
      fs.rmSync(projectDirectoryPath, { recursive: true, force: true });
    }
  });
});
