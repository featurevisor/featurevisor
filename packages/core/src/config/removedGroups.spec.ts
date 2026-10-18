import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectConfig, getProjectConfigForSet } from "./projectConfig";
import { assertNoLegacyDatasourceGroups } from "./removedGroups";

describe("removed Groups authoring safeguards", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-removed-groups-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("rejects the removed configuration even if no definitions exist", () => {
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      "module.exports = { groupsDirectoryPath: 'legacy' };",
    );
    expect(() => getProjectConfig(root)).toThrow("Remove groupsDirectoryPath");
  });

  it.each(["groups/old.yml", "groups/nested/old.json"])(
    "rejects legacy definitions at %s",
    (file) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "{}");
      expect(() => getProjectConfig(root)).toThrow("Groups were removed in v4");
    },
  );

  it("allows empty directories but rejects definitions in a selected Set", () => {
    fs.mkdirSync(path.join(root, "groups"));
    const config = getProjectConfig(root);
    fs.mkdirSync(path.join(root, "sets/staging/groups"), { recursive: true });
    expect(() => getProjectConfigForSet(config, "staging")).not.toThrow();
    fs.writeFileSync(path.join(root, "sets/staging/groups/old.yml"), "{}");
    expect(() => getProjectConfigForSet(config, "staging")).toThrow("Groups were removed in v4");
  });

  it("rejects legacy custom datasource entities without requiring the API on new adapters", async () => {
    await expect(assertNoLegacyDatasourceGroups({})).resolves.toBeUndefined();
    await expect(
      assertNoLegacyDatasourceGroups({ listGroups: async () => [] }),
    ).resolves.toBeUndefined();
    await expect(
      assertNoLegacyDatasourceGroups({ listGroups: async () => ["old"] }),
    ).rejects.toThrow("Groups were removed in v4");
  });
});
