import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig, ENVIRONMENTS_DIRECTORY_NAME } from "./projectConfig";

function createTempProject(configBody: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-project-config-"));
  fs.writeFileSync(path.join(tempRoot, "featurevisor.config.js"), configBody, "utf8");
  return tempRoot;
}

describe("core: projectConfig", () => {
  it("sets splitByEnvironment=false and environmentsDirectoryPath by default", () => {
    const root = createTempProject("module.exports = {};");
    const config = getProjectConfig(root);

    expect(config.splitByEnvironment).toBe(false);
    expect(config.environmentsDirectoryPath).toBe(
      path.join(root, ENVIRONMENTS_DIRECTORY_NAME),
    );
  });

  it("throws when splitByEnvironment=true and environments=false", () => {
    const root = createTempProject(
      'module.exports = { splitByEnvironment: true, environments: false };',
    );

    expect(() => getProjectConfig(root)).toThrow(
      "Invalid configuration: splitByEnvironment=true requires environments to be an array",
    );
  });
});
