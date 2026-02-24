import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config";
import { Datasource } from "./datasource";

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createSplitProject(configBody: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fs-adapter-"));
  writeFile(path.join(root, "featurevisor.config.js"), configBody);

  return root;
}

describe("core: filesystemAdapter (splitByEnvironment)", () => {
  it("merges environment files into readFeature output", async () => {
    const root = createSplitProject(
      "module.exports = { environments: ['staging', 'production'], splitByEnvironment: true };",
    );

    writeFile(
      path.join(root, "features", "checkout.yml"),
      [
        "key: checkout",
        "description: Checkout feature",
        "tags:",
        "  - all",
        "bucketBy: userId",
      ].join("\n"),
    );

    writeFile(
      path.join(root, "environments", "staging", "checkout.yml"),
      ["rules:", "  - key: everyone", "    segments: '*'", "    percentage: 100"].join("\n"),
    );

    writeFile(
      path.join(root, "environments", "production", "checkout.yml"),
      [
        "rules:",
        "  - key: everyone",
        "    segments: '*'",
        "    percentage: 0",
        "expose: false",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);
    const feature = await datasource.readFeature("checkout");
    const rulesByEnvironment = feature.rules as Record<string, any[]>;
    const exposeByEnvironment = feature.expose as Record<string, unknown>;

    expect(rulesByEnvironment?.staging?.[0]?.percentage).toBe(100);
    expect(rulesByEnvironment?.production?.[0]?.percentage).toBe(0);
    expect(exposeByEnvironment?.production).toBe(false);
  });

  it("throws when any environment feature file is missing", async () => {
    const root = createSplitProject(
      "module.exports = { environments: ['staging', 'production'], splitByEnvironment: true };",
    );

    writeFile(
      path.join(root, "features", "myFeature.yml"),
      ["key: myFeature", "description: My feature", "tags:", "  - all", "bucketBy: userId"].join(
        "\n",
      ),
    );

    writeFile(
      path.join(root, "environments", "staging", "myFeature.yml"),
      ["rules:", "  - key: everyone", "    segments: '*'", "    percentage: 100"].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.readFeature("myFeature")).rejects.toMatchObject({
      featurevisorFilePath: expect.stringContaining(
        path.join("environments", "production", "myFeature.yml"),
      ),
    });
  });

  it("throws when base feature file still defines rules in split mode", async () => {
    const root = createSplitProject(
      "module.exports = { environments: ['staging'], splitByEnvironment: true };",
    );

    writeFile(
      path.join(root, "features", "foo.yml"),
      [
        "key: foo",
        "description: Foo",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
      ].join("\n"),
    );

    writeFile(
      path.join(root, "environments", "staging", "foo.yml"),
      ["rules:", "  - key: everyone", "    segments: '*'", "    percentage: 100"].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.readFeature("foo")).rejects.toThrow(
      "base file must not define rules, force, or expose when splitByEnvironment=true",
    );
  });

  it("throws when environment file has unknown keys", async () => {
    const root = createSplitProject(
      "module.exports = { environments: ['staging'], splitByEnvironment: true };",
    );

    writeFile(
      path.join(root, "features", "foo.yml"),
      ["key: foo", "description: Foo", "tags:", "  - all", "bucketBy: userId"].join("\n"),
    );

    writeFile(
      path.join(root, "environments", "staging", "foo.yml"),
      [
        "rules:",
        "  - key: everyone",
        "    segments: '*'",
        "    percentage: 100",
        "extraKey: not allowed",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.readFeature("foo")).rejects.toThrow(
      "Unknown key(s) in environment feature file: extraKey",
    );
  });
});
