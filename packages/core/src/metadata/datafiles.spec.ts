import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsers } from "@featurevisor/parsers";

import { buildProjectSets } from "../builder/buildProject";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";

// Metadata is for people. It never reaches a datafile, a state file or a revision.

describe("metadata never reaches a datafile", () => {
  const example = path.resolve(__dirname, "../../../../examples/example-1");
  const roots: string[] = [];

  beforeAll(() => jest.spyOn(console, "log").mockImplementation(() => undefined));
  afterAll(() => {
    jest.restoreAllMocks();
    roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  });

  function copy() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-metadata-"));
    roots.push(root);
    fs.cpSync(example, root, {
      recursive: true,
      filter: (source) =>
        !/node_modules|datafiles|\.featurevisor/.test(path.relative(example, source)),
    });
    return root;
  }

  /** Every definition file of a project, with or without its metadata */
  function definitionFiles(root: string) {
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".yml")) files.push(full);
      }
    };
    for (const name of ["features", "segments", "attributes", "schemas", "variables", "targets"]) {
      walk(path.join(root, name));
    }
    return files;
  }

  async function build(root: string, options: { revisionFromHash?: boolean } = {}) {
    const projectConfig = getProjectConfig(root);
    await buildProjectSets(
      {
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        options: {},
      },
      options.revisionFromHash ? { revisionFromHash: true } : { revision: "metadata" },
    );
    const files: Record<string, string> = {};
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    };
    for (const name of ["datafiles", ".featurevisor"]) {
      if (fs.existsSync(path.join(root, name))) walk(path.join(root, name));
    }
    return files;
  }

  it.each([false, true])(
    "builds byte identical outputs with and without metadata (revision from hash: %s)",
    async (revisionFromHash) => {
      const withMetadata = copy();
      const withoutMetadata = copy();
      let stripped = 0;
      for (const file of definitionFiles(withoutMetadata)) {
        const content = parsers.yml.parse(fs.readFileSync(file, "utf8"), file) as Record<
          string,
          unknown
        >;
        if (content && typeof content === "object" && "metadata" in content) {
          delete content.metadata;
          fs.writeFileSync(file, parsers.yml.stringify(content, file));
          stripped++;
        }
      }
      const config = path.join(withoutMetadata, "featurevisor.config.js");
      fs.writeFileSync(
        config,
        fs.readFileSync(config, "utf8").replace(/\n  metadataSchema: \{[\s\S]*?\n  \},\n/, "\n"),
      );
      expect(stripped).toBeGreaterThanOrEqual(6);
      expect(getProjectConfig(withMetadata).metadataSchema).toBeDefined();
      expect(getProjectConfig(withoutMetadata).metadataSchema).toBeUndefined();

      const built = await build(withMetadata, { revisionFromHash });
      expect(Object.keys(built).length).toBeGreaterThan(0);
      expect(await build(withoutMetadata, { revisionFromHash })).toEqual(built);
    },
    120000,
  );
});
