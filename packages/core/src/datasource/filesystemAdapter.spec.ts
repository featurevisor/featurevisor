import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config";
import { Datasource } from "./datasource";

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createProject(configBody: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fs-adapter-"));
  writeFile(path.join(root, "featurevisor.config.js"), configBody);

  return root;
}

describe("core: filesystemAdapter", () => {
  it("lists nested entity paths with dot namespace character by default", async () => {
    const root = createProject("module.exports = {};");

    writeFile(
      path.join(root, "features", "checkout", "page.yml"),
      [
        "description: Checkout page",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
      ].join("\n"),
    );
    writeFile(
      path.join(root, "segments", "countries", "germany.yml"),
      [
        "description: Germany",
        "conditions:",
        "  - attribute: country",
        "    operator: equals",
        "    value: de",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listFeatures()).resolves.toEqual(["checkout.page"]);
    await expect(datasource.listSegments()).resolves.toEqual(["countries.germany"]);
    await expect(datasource.readFeature("checkout.page")).resolves.toMatchObject({
      description: "Checkout page",
    });
  });

  it("keeps slash-separated keys when namespaceCharacter is slash", async () => {
    const root = createProject('module.exports = { namespaceCharacter: "/" };');

    writeFile(
      path.join(root, "features", "checkout", "page.yml"),
      [
        "description: Checkout page",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listFeatures()).resolves.toEqual(["checkout/page"]);
    await expect(datasource.readFeature("checkout/page")).resolves.toMatchObject({
      description: "Checkout page",
    });
  });

  it("lists sets and reads entities from selected set", async () => {
    const root = createProject("module.exports = { sets: true };");

    writeFile(
      path.join(root, "sets", "storefront", "features", "banner.yml"),
      [
        "key: banner",
        "description: Storefront banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 100",
      ].join("\n"),
    );

    writeFile(
      path.join(root, "sets", "admin", "features", "banner.yml"),
      [
        "key: banner",
        "description: Admin banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 0",
        "  production:",
        "    - key: everyone",
        "      segments: '*'",
        "      percentage: 0",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listSets()).resolves.toEqual(["admin", "storefront"]);

    const storefrontDatasource = datasource.forSet("storefront");
    const feature = await storefrontDatasource.readFeature("banner");

    expect(feature.description).toBe("Storefront banner");
    expect(storefrontDatasource.getSet()).toBe("storefront");
    expect(storefrontDatasource.getConfig().featuresDirectoryPath).toBe(
      path.join(root, "sets", "storefront", "features"),
    );
  });
});
