import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  getProjectConfig,
  getProjectConfigForSet,
  ENVIRONMENTS_DIRECTORY_NAME,
  SETS_DIRECTORY_NAME,
} from "./projectConfig";

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
    expect(config.sets).toBe(false);
    expect(config.setsDirectoryPath).toBe(path.join(root, SETS_DIRECTORY_NAME));
    expect(config.environmentsDirectoryPath).toBe(path.join(root, ENVIRONMENTS_DIRECTORY_NAME));
  });

  it("throws when sets is not boolean", () => {
    const root = createTempProject("module.exports = { sets: 'yes' };");

    expect(() => getProjectConfig(root)).toThrow("Invalid sets: yes. It must be a boolean.");
  });

  it("remaps project config paths for a set", () => {
    const root = createTempProject("module.exports = { sets: true };");
    const config = getProjectConfig(root);
    const setConfig = getProjectConfigForSet(config, "staging");
    const setRoot = path.join(root, "sets", "staging");

    expect(setConfig.featuresDirectoryPath).toBe(path.join(setRoot, "features"));
    expect(setConfig.environmentsDirectoryPath).toBe(path.join(setRoot, "environments"));
    expect(setConfig.segmentsDirectoryPath).toBe(path.join(setRoot, "segments"));
    expect(setConfig.attributesDirectoryPath).toBe(path.join(setRoot, "attributes"));
    expect(setConfig.groupsDirectoryPath).toBe(path.join(setRoot, "groups"));
    expect(setConfig.schemasDirectoryPath).toBe(path.join(setRoot, "schemas"));
    expect(setConfig.testsDirectoryPath).toBe(path.join(setRoot, "tests"));
    expect(setConfig.stateDirectoryPath).toBe(path.join(root, ".featurevisor", "sets", "staging"));
    expect(setConfig.datafilesDirectoryPath).toBe(path.join(root, "datafiles", "staging"));
  });

  it("throws when splitByEnvironment=true and environments=false", () => {
    const root = createTempProject(
      "module.exports = { splitByEnvironment: true, environments: false };",
    );

    expect(() => getProjectConfig(root)).toThrow(
      "Invalid configuration: splitByEnvironment=true requires environments to be an array",
    );
  });
});
