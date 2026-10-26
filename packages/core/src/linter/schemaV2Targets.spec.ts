import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildProject, buildTargetDatafile } from "../builder/buildProject";
import { SchemaV2ConversionError } from "../builder/schemaV2";
import { getCatalogTargetMemberships } from "../catalog";
import { lintProject } from "./lintProject";

const example = path.resolve(__dirname, "../../../../examples/example-schema-v2");

async function buildAsSchema4(
  projectConfig: any,
  datasource: Datasource,
  target: any,
  environment: string,
) {
  return buildTargetDatafile({
    projectConfig,
    datasource,
    target,
    environment,
    existingState: await datasource.readState(environment),
    revision: "catalog",
  });
}

describe("schemaVersion 2 targets", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-schema-v2-"));
    fs.cpSync(example, root, {
      recursive: true,
      filter: (source) =>
        !/node_modules|datafiles|\.featurevisor/.test(path.relative(example, source)),
    });
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const write = (file: string, content: string) => fs.writeFileSync(path.join(root, file), content);
  const deps = () => {
    const projectConfig = getProjectConfig(root);
    return {
      rootDirectoryPath: root,
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      options: {},
    };
  };
  const lint = (options: Record<string, unknown> = {}) =>
    lintProject(deps() as any, { json: true, ...options });
  const schemaErrors = (result: Awaited<ReturnType<typeof lint>>) =>
    result.errors.filter((error) => error.code === "schema_v2_unsupported");

  it("accepts v4 only definitions that no schema 2 target carries", async () => {
    const result = await lint();
    expect(result.errors).toEqual([]);
  });

  it("reports a definition on its own file, naming the targets and environments", async () => {
    // Tagging newOnboarding android brings it, writers and maintenanceMode into the
    // schema 2 datafile that older Android releases load.
    const feature = fs.readFileSync(path.join(root, "features/newOnboarding.yml"), "utf8");
    write(
      "features/newOnboarding.yml",
      feature.replace("  - ios-v4\n", "  - ios-v4\n  - android\n"),
    );

    const errors = schemaErrors(await lint());
    expect(errors.map((error) => [error.entityType, error.key, error.path.join(".")])).toEqual(
      expect.arrayContaining([
        ["feature", "newOnboarding", "conditions"],
        ["segment", "writers", "conditions"],
      ]),
    );
    const gate = errors.find((error) => error.key === "newOnboarding")!;
    expect(gate.filePath).toBe(
      path.relative(process.cwd(), path.join(root, "features/newOnboarding.yml")),
    );
    expect(gate.message).toBe(
      'The root gate reads variable "maintenanceMode", and schema "2" has no variable conditions. Target "android" sets schemaVersion "2" in environments staging, production, so keep this feature out of it or write it in a form schema "2" supports.',
    );
    expect(gate.value).toEqual({
      targets: ["android"],
      environments: ["staging", "production"],
    });
    const segment = errors.find((error) => error.key === "writers")!;
    expect(segment.message).toContain('uses operator "includesAny"');
    expect(segment.message).toContain("in environments staging, production,");
  });

  it("names every schema 2 target that carries the definition", async () => {
    const feature = fs.readFileSync(path.join(root, "features/newOnboarding.yml"), "utf8");
    write(
      "features/newOnboarding.yml",
      feature.replace("  - ios-v4\n", "  - ios-v4\n  - ios\n  - android\n"),
    );

    const gate = schemaErrors(await lint()).find((error) => error.key === "newOnboarding")!;
    expect(gate.message).toContain('Targets "android" and "ios" set schemaVersion "2"');
    expect(gate.message).toContain("keep this feature out of them");
  });

  it("follows the entity type and key filters", async () => {
    const feature = fs.readFileSync(path.join(root, "features/newOnboarding.yml"), "utf8");
    write(
      "features/newOnboarding.yml",
      feature.replace("  - ios-v4\n", "  - ios-v4\n  - android\n"),
    );

    const features = schemaErrors(await lint({ entityType: "feature" }));
    expect(new Set(features.map((error) => error.entityType))).toEqual(new Set(["feature"]));
    expect(schemaErrors(await lint({ entityType: "segment" })).map((error) => error.key)).toEqual([
      "writers",
    ]);
    expect(schemaErrors(await lint({ keyPattern: "^writers$" })).map((error) => error.key)).toEqual(
      ["writers"],
    );
    // By target, the pattern picks targets and every issue they carry is shown.
    expect(schemaErrors(await lint({ entityType: "target", keyPattern: "^ios$" }))).toEqual([]);
    expect(
      schemaErrors(await lint({ entityType: "target", keyPattern: "^android$" })).length,
    ).toBeGreaterThan(1);
    expect(schemaErrors(await lint({ entityType: "attribute" }))).toEqual([]);
  });

  it("builds nothing extra for a project without schema 2 targets", async () => {
    fs.rmSync(path.join(root, "targets/ios.yml"));
    fs.rmSync(path.join(root, "targets/android.yml"));
    fs.rmSync(path.join(root, "tests"), { recursive: true });
    const project = deps();
    // Only a build reads state, so lint must never touch it here.
    const readState = jest.spyOn(project.datasource, "readState");
    const result = await lintProject(project as any, { json: true });
    expect(result.errors).toEqual([]);
    expect(readState).not.toHaveBeenCalled();
  });

  it("builds only the schema 2 targets when linting", async () => {
    const project = deps();
    const readState = jest.spyOn(project.datasource, "readState");
    const readTarget = jest.spyOn(project.datasource, "readTarget");
    await lintProject(project as any, { json: true });
    // Once per environment for both schema 2 targets together, never for web or ios-v4.
    expect(readState).toHaveBeenCalledTimes(2);
    // Each target file is read once, by linting targets.
    expect(readTarget.mock.calls.map(([key]) => key).sort()).toEqual([
      "android",
      "ios",
      "ios-v4",
      "web",
    ]);
  });

  it("rejects a schemaVersion that is not the string 2 or 4", async () => {
    const target = fs.readFileSync(path.join(root, "targets/ios.yml"), "utf8");
    write("targets/ios.yml", target.replace('schemaVersion: "2"', "schemaVersion: 2"));
    const errors = (await lint({ entityType: "target" })).errors;
    expect(errors).toEqual([
      expect.objectContaining({
        entityType: "target",
        key: "ios",
        message: expect.stringContaining('schemaVersion must be the string "2" or "4"'),
      }),
    ]);
  });

  it("fails the build only for the schema 2 target that cannot be converted", async () => {
    const feature = fs.readFileSync(path.join(root, "features/newOnboarding.yml"), "utf8");
    write(
      "features/newOnboarding.yml",
      feature.replace("  - ios-v4\n", "  - ios-v4\n  - android\n"),
    );

    await expect(buildProject(deps() as any, { target: "web" })).resolves.toBeUndefined();
    await expect(buildProject(deps() as any, { target: "ios" })).resolves.toBeUndefined();
    const failure = buildProject(deps() as any, { target: "android" });
    await expect(failure).rejects.toBeInstanceOf(SchemaV2ConversionError);
    await expect(failure).rejects.toThrow(
      /Target "android" in environment "staging" sets schemaVersion "2"[\s\S]*feature "newOnboarding", the root gate: reads variable "maintenanceMode"/,
    );
  });

  it("gives Catalog the selection, not the converted encoding, and survives a failing target", async () => {
    const feature = fs.readFileSync(path.join(root, "features/newOnboarding.yml"), "utf8");
    write(
      "features/newOnboarding.yml",
      feature.replace("  - ios-v4\n", "  - ios-v4\n  - android\n"),
    );
    const { projectConfig, datasource } = deps();
    const memberships = await getCatalogTargetMemberships(projectConfig, datasource);

    const legacy = memberships["ios"];
    expect(legacy.features).toEqual([
      "buyButton",
      "chatFileUpload",
      "checkout",
      "liveChat",
      "pricing",
    ]);
    expect(legacy.segments).toEqual([
      "dutchPayingAccounts",
      "germany",
      "netherlands",
      "payingAccounts",
      "recentApps",
    ]);
    // The schema "2" file is measured as served, with its synthesized segment.
    const v4 = { ...(await datasource.readTarget("ios")), schemaVersion: undefined };
    expect(legacy.datafiles[1].bytes).not.toBe(
      Buffer.from(JSON.stringify(await buildAsSchema4(projectConfig, datasource, v4, "production")))
        .byteLength,
    );
    // The target that cannot be converted still lists its members.
    expect(memberships["android"].features).toContain("newOnboarding");
  });

  it("prints a converted datafile with build --json", async () => {
    const output: string[] = [];
    (console.log as jest.Mock).mockImplementation((line: string) => output.push(line));
    await buildProject(deps() as any, {
      json: true,
      target: "ios",
      environment: "production",
    });
    const datafile = JSON.parse(output.join(""));
    expect(datafile.schemaVersion).toBe("2");
    expect(datafile.features.chatFileUpload.requiredFeatures).toEqual(["liveChat"]);
    expect(datafile.features.newOnboarding).toBeUndefined();
  });
});
