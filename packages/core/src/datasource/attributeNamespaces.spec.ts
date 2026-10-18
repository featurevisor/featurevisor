import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parsers } from "@featurevisor/parsers";
import { createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { lintProject } from "../linter/lintProject";
import { buildDatafile } from "../builder/buildDatafile";
import { Datasource } from "./datasource";
import { FilesystemAdapter } from "./filesystemAdapter";
import { AttributeNamespaceError } from "./attributeNamespaces";

describe("flat attribute definitions", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-flat-attributes-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function fixture(namespace = ".", extension = "json", directory = "attributes") {
    const projectConfig = getProjectConfig(root);
    projectConfig.namespaceCharacter = namespace;
    projectConfig.parser = extension === "yml" ? parsers.yml : { ...parsers.json, extension };
    projectConfig.attributesDirectoryPath = path.join(root, directory);
    const datasource = new Datasource(projectConfig, root);
    const write = (relative: string, value: unknown) => {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value));
      return file;
    };
    const deps = { projectConfig, datasource, rootDirectoryPath: root, options: {} };
    return { ...deps, deps, write };
  }

  test.each([".", "/", "::"])(
    "reports every nested source with separator %s",
    async (namespace) => {
      const { datasource, deps, write } = fixture(namespace);
      write("attributes/country.json", { description: "Country", type: "string" });
      const nested = write("attributes/geo/country.json", { type: "string" });
      const deep = write("attributes/account/team/size.json", { type: "integer", archived: true });
      await expect(datasource.listAttributes()).rejects.toMatchObject({
        name: "AttributeNamespaceError",
        validKeys: ["country"],
        invalidAttributes: expect.arrayContaining([
          { key: ["geo", "country"].join(namespace), filePath: nested },
          { key: ["account", "team", "size"].join(namespace), filePath: deep },
        ]),
      });
      const report = await lintProject(deps, { json: true });
      expect(report.hasError).toBe(true);
      expect(report.errors).toHaveLength(2);
      expect(report.errors).toEqual(
        expect.arrayContaining(
          [nested, deep].map((file) =>
            expect.objectContaining({
              entityType: "attribute",
              filePath: path.relative(process.cwd(), file),
              code: "invalid_attribute_namespace",
              message: expect.stringContaining("cannot be namespaced"),
            }),
          ),
        ),
      );
    },
  );

  test.each(["json", "yml", "definition"])(
    "checks physical nesting with extension %s",
    async (extension) => {
      const { datasource, projectConfig, write } = fixture("/", extension, "context/input");
      write(`context/input/country.${extension}`, { type: "string" });
      write(`context/input/geo/country.${extension}`, { type: "string" });
      // The physical check does not depend on parsing a nested definition.
      fs.writeFileSync(
        path.join(root, "context/input/geo/country." + extension),
        "invalid content",
      );
      projectConfig.attributesDirectoryPath += path.sep;
      const adapter = new FilesystemAdapter(projectConfig, root);
      await expect(adapter.listEntities("attribute")).rejects.toBeInstanceOf(
        AttributeNamespaceError,
      );
      await expect(datasource.listAttributes()).rejects.toBeInstanceOf(AttributeNamespaceError);
    },
  );

  test.each(
    [".", "/", "::"].flatMap((namespace) =>
      ["json", "yml", "definition", "config.json"].map((extension) => ({ namespace, extension })),
    ),
  )(
    "rejects dots only in attribute basenames with $namespace and .$extension",
    async ({ namespace, extension }) => {
      const { datasource, deps, write } = fixture(namespace, extension, "context/input");
      write(`context/input/user_id.${extension}`, {
        description: "User identifier",
        type: "string",
      });
      const dotted = write(`context/input/user.id.${extension}`, {
        description: "Invalid dotted identifier",
        type: "string",
      });
      await expect(datasource.listAttributes()).rejects.toMatchObject({
        invalidAttributes: [{ key: "user.id", filePath: dotted }],
        validKeys: ["user_id"],
      });
      const report = await lintProject(deps, { json: true });
      expect(report.errors).toEqual([
        expect.objectContaining({
          key: "user.id",
          entityType: "attribute",
          code: "invalid_attribute_namespace",
          filePath: path.relative(process.cwd(), dotted),
          message: expect.stringContaining("attribute names cannot contain dots"),
        }),
      ]);
      const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        const textReport = await lintProject(deps);
        expect(textReport.errors).toHaveLength(1);
        const output = consoleLog.mock.calls.flat().join(" ");
        expect(output).toContain(dotted);
        expect(output).not.toContain(path.join(root, "context/input/user/id." + extension));
      } finally {
        consoleLog.mockRestore();
      }
      await expect(
        buildDatafile(
          deps.projectConfig,
          datasource,
          { revision: "test", environment: false },
          { features: {} },
        ),
      ).rejects.toThrow(dotted);
    },
  );

  test("reports dotted and nested definitions with identical keys as distinct physical sources", async () => {
    const { deps, write } = fixture();
    const dotted = write("attributes/user.id.json", { type: "string" });
    const nested = write("attributes/user/id.json", { type: "string" });
    const report = await lintProject(deps, { json: true });
    expect(report.errors).toHaveLength(2);
    expect(report.errors).toEqual(
      expect.arrayContaining(
        [dotted, nested].map((filePath) =>
          expect.objectContaining({
            key: "user.id",
            code: "invalid_attribute_namespace",
            filePath: path.relative(process.cwd(), filePath),
          }),
        ),
      ),
    );
  });

  test.each([".", "/", "::"])(
    "direct dotted access reports a literal source path with %s",
    async (namespace) => {
      const { datasource, projectConfig, write } = fixture(namespace);
      const source = write("attributes/user.id.json", {
        description: "Invalid dotted name",
        type: "string",
      });
      const before = fs.readFileSync(source, "utf8");
      const adapter = new FilesystemAdapter(projectConfig, root);
      await expect(datasource.readAttribute("user.id")).rejects.toThrow(source);
      await expect(datasource.writeAttribute("user.id", { type: "string" })).rejects.toThrow(
        source,
      );
      await expect(adapter.readEntity("attribute", "user.id")).rejects.toThrow(source);
      expect(fs.readFileSync(source, "utf8")).toBe(before);
      expect(fs.existsSync(path.join(root, "attributes/user/id.json"))).toBe(false);
    },
  );

  test("allows dots in the configured directory and extension, not the attribute name", async () => {
    const { datasource, deps, write } = fixture("/", "config.json", "context.v1/input");
    write("context.v1/input/user_id.config.json", {
      description: "Valid identifier",
      type: "string",
    });
    await expect(datasource.listAttributes()).resolves.toEqual(["user_id"]);
    const report = await lintProject(deps, { json: true });
    expect(report.errors).toEqual([]);
  });

  test("does not ban dotted basenames for other entities with slash namespaces", async () => {
    const { deps, datasource, write } = fixture("/");
    write("attributes/userId.json", { description: "Identifier", type: "string" });
    write("attributes/country.json", { description: "Country", type: "string" });
    write("segments/audience.nl.json", {
      description: "Netherlands",
      conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
    });
    write("features/checkout.flag.json", {
      description: "Checkout",
      bucketBy: "userId",
      rules: [{ key: "all", conditions: "audience.nl", percentage: 100 }],
    });
    write("variables/checkout.label.json", {
      description: "Label",
      type: "string",
      defaultValue: "Pay now",
    });
    write("schemas/checkout.text.json", { type: "string" });
    write("targets/checkout.web.json", { description: "All definitions" });
    const report = await lintProject(deps, { json: true });
    expect(report.errors).toEqual([]);
    await expect(datasource.listFeatures()).resolves.toEqual(["checkout.flag"]);
    await expect(datasource.listSegments()).resolves.toEqual(["audience.nl"]);
    await expect(datasource.listVariables()).resolves.toEqual(["checkout.label"]);
    await expect(datasource.listSchemas()).resolves.toEqual(["checkout.text"]);
    await expect(datasource.listTargets()).resolves.toEqual(["checkout.web"]);
  });

  test("reports only the attribute naming rules for other invalid characters", async () => {
    const { deps, write } = fixture("/");
    write("attributes/user name.json", { description: "Invalid space", type: "string" });
    const report = await lintProject(deps, { json: true });
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "invalid_name", key: "user name" }),
    ]);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await lintProject(deps);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("Attribute names must be alphanumeric and can contain _ and -.");
      expect(output).toContain(
        "Dots, directory separators and the configured namespace character are not allowed.",
      );
      expect(output).not.toContain("can contain _, -, /, .");
    } finally {
      log.mockRestore();
    }
  });

  test("validates nested definitions even with lint key and entity filters", async () => {
    const { deps, write } = fixture();
    write("attributes/nested/unused.json", { type: "string" });
    const report = await lintProject(deps, {
      json: true,
      entityType: "feature",
      keyPattern: "checkout",
    });
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "invalid_attribute_namespace" }),
    ]);
  });

  test("continues checking valid attributes after discovery errors", async () => {
    const { deps, write } = fixture();
    write("attributes/nested/unused.json", { type: "string" });
    write("attributes/broken.json", { type: "unsupported" });
    const report = await lintProject(deps, { json: true });
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_attribute_namespace" }),
        expect.objectContaining({ entityType: "attribute", key: "broken" }),
      ]),
    );
  });

  test("allows empty directories and unrelated files, and handles a missing directory", async () => {
    const { datasource, write } = fixture();
    await expect(datasource.listAttributes()).resolves.toEqual([]);
    fs.mkdirSync(path.join(root, "attributes/empty"), { recursive: true });
    write("attributes/notes/readme.txt", "Not a definition");
    write("attributes/country.json", { type: "string" });
    await expect(datasource.listAttributes()).resolves.toEqual(["country"]);
  });

  test("keeps flat attribute reads, writes, existence checks and deletion working", async () => {
    const { datasource } = fixture("/", "definition", "context/input");
    const attribute = { description: "Country", type: "string" as const };
    await expect(datasource.writeAttribute("country", attribute)).resolves.toEqual(attribute);
    await expect(datasource.attributeExists("country")).resolves.toBe(true);
    await expect(datasource.readAttribute("country")).resolves.toEqual(attribute);
    await expect(datasource.listAttributes()).resolves.toEqual(["country"]);
    await datasource.deleteAttribute("country");
    await expect(datasource.attributeExists("country")).resolves.toBe(false);
    await expect(datasource.listAttributes()).resolves.toEqual([]);
  });

  test.each([".", "/", "::"])(
    "blocks direct nested attribute access with separator %s",
    async (namespace) => {
      const { datasource, projectConfig, write } = fixture(namespace);
      const file = write("attributes/geo/country.json", { type: "string" });
      const before = fs.readFileSync(file, "utf8");
      const key = ["geo", "country"].join(namespace);
      const adapter = new FilesystemAdapter(projectConfig, root);
      await expect(datasource.readAttribute(key)).rejects.toBeInstanceOf(AttributeNamespaceError);
      await expect(datasource.attributeExists(key)).rejects.toBeInstanceOf(AttributeNamespaceError);
      await expect(datasource.writeAttribute(key, { type: "string" })).rejects.toBeInstanceOf(
        AttributeNamespaceError,
      );
      await expect(datasource.deleteAttribute(key)).rejects.toBeInstanceOf(AttributeNamespaceError);
      await expect(
        adapter.writeEntity("attribute", key, { type: "string" }),
      ).rejects.toBeInstanceOf(AttributeNamespaceError);
      expect(() => adapter.getEntityPath("attribute", key)).toThrow(AttributeNamespaceError);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
      await expect(
        datasource.writeAttribute(["new", "country"].join(namespace), { type: "string" }),
      ).rejects.toBeInstanceOf(AttributeNamespaceError);
      expect(fs.existsSync(path.join(root, "attributes/new"))).toBe(false);
    },
  );

  test.each(["geo.country", "geo/country", "geo\\country", "../escape", ".", ".."])(
    "rejects path components in direct key %s",
    async (key) => {
      const { datasource } = fixture("::");
      await expect(datasource.writeAttribute(key, { type: "string" })).rejects.toBeInstanceOf(
        AttributeNamespaceError,
      );
      expect(fs.existsSync(path.join(root, "attributes"))).toBe(false);
    },
  );

  test("guards custom adapter attribute keys before reading or writing", async () => {
    const { projectConfig, deps } = fixture("::");
    const readEntity = jest.fn();
    const writeEntity = jest.fn();
    const listEntities = jest.fn(async () => ["country", "geo::country"]);
    projectConfig.adapter = class {
      listEntities = listEntities;
      readEntity = readEntity;
      writeEntity = writeEntity;
    } as any;
    const datasource = new Datasource(projectConfig, root);
    const report = await lintProject(
      {
        ...deps,
        datasource: {
          getExtension: () => "json",
          listSchemas: async () => [],
          listAttributes: () => datasource.listAttributes(),
          readAttribute: async () => ({ description: "Country", type: "string" }),
          listSegments: async () => [],
          listFeatures: async () => [],
          listVariables: async () => [],
          listTargets: async () => [],
          listTests: async () => [],
          listScenarios: async () => [],
        } as any,
      },
      { json: true },
    );
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "invalid_attribute_namespace", key: "geo::country" }),
    ]);
    await expect(datasource.readAttribute("geo::country")).rejects.toBeInstanceOf(
      AttributeNamespaceError,
    );
    await expect(
      datasource.writeAttribute("geo::country", { type: "string" }),
    ).rejects.toBeInstanceOf(AttributeNamespaceError);
    expect(readEntity).not.toHaveBeenCalled();
    expect(writeEntity).not.toHaveBeenCalled();
  });

  test("validates each Set relative to its own attribute directory", async () => {
    const { projectConfig, datasource, write } = fixture();
    projectConfig.sets = true;
    write("sets/staging/attributes/country.json", { type: "string" });
    write("sets/production/attributes/geo/country.json", { type: "string" });
    await expect(datasource.forSet("staging").listAttributes()).resolves.toEqual(["country"]);
    await expect(datasource.forSet("production").listAttributes()).rejects.toMatchObject({
      invalidAttributes: [
        {
          key: "geo.country",
          filePath: path.join(root, "sets/production/attributes/geo/country.json"),
        },
      ],
    });
  });

  test.each([".", "/", "::"])(
    "keeps object attribute paths and other namespaces with %s",
    async (namespace) => {
      const { projectConfig, datasource, deps, write } = fixture(namespace);
      write("attributes/geo.json", {
        description: "Geographic context",
        type: "object",
        properties: { country: { type: "string" }, userId: { type: "string" } },
      });
      write("segments/countries/netherlands.json", {
        description: "Netherlands",
        conditions: [{ attribute: "geo.country", operator: "equals", value: "nl" }],
      });
      write("features/checkout/express.json", {
        description: "Express",
        bucketBy: "geo.userId",
        rules: [
          { key: "all", conditions: ["countries", "netherlands"].join(namespace), percentage: 100 },
        ],
      });
      write("variables/checkout/label.json", {
        description: "Label",
        type: "string",
        defaultValue: "Pay now",
      });
      write("schemas/checkout/notice.json", { type: "string" });
      write("targets/web/checkout.json", { description: "All definitions" });
      write("tests/features/checkout/express.spec.json", {
        feature: ["checkout", "express"].join(namespace),
        assertions: [
          { at: 50, context: { geo: { country: "nl", userId: "123" } }, expectedToBeEnabled: true },
        ],
      });
      const report = await lintProject(deps, { json: true });
      expect(report.errors).toEqual([]);
      await expect(datasource.listAttributes()).resolves.toEqual(["geo"]);
      for (const [method, expected] of [
        ["listFeatures", ["checkout", "express"]],
        ["listSegments", ["countries", "netherlands"]],
        ["listVariables", ["checkout", "label"]],
        ["listSchemas", ["checkout", "notice"]],
        ["listTargets", ["web", "checkout"]],
      ] as const)
        await expect(datasource[method]()).resolves.toEqual([expected.join(namespace)]);
      const datafile = await buildDatafile(
        projectConfig,
        datasource,
        {
          revision: "test",
          environment: false,
        },
        { features: {} },
      );
      const f = createFeaturevisor({ datafile, logLevel: "fatal" });
      try {
        expect(
          f.isEnabled(["checkout", "express"].join(namespace), {
            geo: { country: "nl", userId: "123" },
          }),
        ).toBe(true);
      } finally {
        f.close();
      }
    },
  );

  test("build rejects even an unused nested attribute without a separate lint", async () => {
    const { projectConfig, datasource, write } = fixture();
    write("attributes/nested/unused.json", { type: "string" });
    await expect(
      buildDatafile(
        projectConfig,
        datasource,
        { revision: "test", environment: false },
        { features: {} },
      ),
    ).rejects.toBeInstanceOf(AttributeNamespaceError);
  });
});
