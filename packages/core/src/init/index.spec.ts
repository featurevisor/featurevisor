import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { Readable } from "stream";

import * as tar from "tar";
import { parsers } from "@featurevisor/parsers";

import { EXAMPLES_TAR_URL, initPlugin, initProject } from ".";

// Scenarios describe a download as a stream or an HTTP status, and a fetch shim replays them.
const get = jest.fn();
global.fetch = jest.fn(async (url: string | URL | Request) => {
  try {
    const { data } = await get(String(url));
    return new Response(Readable.toWeb(data) as ReadableStream);
  } catch (error) {
    const status = (error as { response?: { status: number } }).response?.status;
    if (status) return new Response(null, { status });
    throw error;
  }
}) as typeof fetch;
const repositoryPath = path.resolve(__dirname, "../../../..");
let workPath: string;
let destinationPath: string;
let log: jest.SpyInstance;
let warn: jest.SpyInstance;

async function archive(
  root: string,
  examples: Record<string, string>,
  extraFiles: Record<string, string> = {},
) {
  const sourcePath = fs.mkdtempSync(path.join(workPath, "source-"));
  for (const [example, content] of Object.entries(examples)) {
    const examplePath = path.join(sourcePath, root, "examples", `example-${example}`);
    fs.mkdirSync(examplePath, { recursive: true });
    fs.writeFileSync(
      path.join(examplePath, "package.json"),
      JSON.stringify({
        name: `@featurevisor/example-${example}`,
        version: "3.11.0",
        private: true,
        scripts: { build: "featurevisor build" },
        dependencies: { "@featurevisor/cli": "3.11.0" },
        marker: content,
      }),
    );
    fs.writeFileSync(path.join(examplePath, "CHANGELOG.md"), "Internal release history");
    for (const [name, value] of Object.entries(extraFiles)) {
      fs.writeFileSync(path.join(examplePath, name), value);
    }
  }
  const archivePath = path.join(workPath, `${root}.tar.gz`);
  await tar.c({ gzip: true, file: archivePath, cwd: sourcePath }, [root]);
  return archivePath;
}

beforeEach(() => {
  workPath = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-init-test-"));
  destinationPath = path.join(workPath, "project");
  get.mockReset();
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
  fs.rmSync(workPath, { recursive: true, force: true });
});

test("extracts the selected example from the running CLI version tag", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag", json: "other" });
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await expect(initProject(destinationPath, undefined, "3.11.0")).resolves.toBe(true);
  expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/tar\.gz\/v3\.11\.0$/));
  expect(jest.mocked(global.fetch).mock.lastCall).toEqual([
    expect.stringMatching(/\/tar\.gz\/v3\.11\.0$/),
    { signal: expect.any(AbortSignal) },
  ]);
  const manifest = JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8"));
  expect(manifest).toEqual({
    name: "project",
    private: true,
    marker: "tag",
    scripts: { build: "featurevisor build" },
    dependencies: { "@featurevisor/cli": "3.11.0" },
  });
  expect(fs.readdirSync(destinationPath)).toEqual(["package.json"]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("Project scaffolded"));
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain("Next steps in the directory above:");
  expect(output).toContain("npm install");
  for (const command of ["lint", "test", "build", "catalog"]) {
    expect(output).toContain(`npx featurevisor ${command}`);
  }
  expect(output).toContain("https://featurevisor.com/docs/quick-start/");
  expect(output).toContain("https://featurevisor.com/docs/skills/");
});

async function extractRealExample(example: string, destination: string) {
  const sourcePath = fs.mkdtempSync(path.join(workPath, "real-source-"));
  const archiveRoot = "featurevisor-3.11.0";
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      `examples/example-${example}`,
    ],
    { cwd: repositoryPath, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const target = path.join(sourcePath, archiveRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryPath, file), target);
  }
  const file = path.join(sourcePath, "real-example.tar.gz");
  await tar.c({ gzip: true, file, cwd: sourcePath }, [archiveRoot]);
  get.mockResolvedValueOnce({ data: fs.createReadStream(file) });
  await initProject(destination, example === "yml" ? undefined : example, "3.11.0");
}

test.each(["yml", "json", "toml", "no-environments", "targets"])(
  "personalizes only the extracted %s README",
  async (example) => {
    const sourcePath = path.join(repositoryPath, `examples/example-${example}/README.md`);
    const source = fs.readFileSync(sourcePath, "utf8");
    await extractRealExample(example, destinationPath);
    const readme = fs.readFileSync(path.join(destinationPath, "README.md"), "utf8");
    expect(readme).toMatch(/^# project\n/);
    expect(readme).not.toMatch(/^## Initialize$/m);
    expect(readme).toContain("npm install");
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(source);
  },
);

test("README personalization preserves fenced headings and later sections", async () => {
  const readme = [
    "# example-yml",
    "",
    "```md",
    "## Initialize",
    "# Code heading",
    "```",
    "",
    "## Initialize",
    "",
    "```sh",
    "npx @featurevisor/cli init",
    "```",
    "",
    "## Installation",
    "",
    "npm install",
    "",
  ].join("\r\n");
  const file = await archive("featurevisor-3.11.0", { yml: "default" }, { "README.md": readme });
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  await initProject(destinationPath, undefined, "3.11.0");
  const result = fs.readFileSync(path.join(destinationPath, "README.md"), "utf8");
  expect(result).toBe(
    [
      "# project",
      "",
      "```md",
      "## Initialize",
      "# Code heading",
      "```",
      "",
      "## Installation",
      "",
      "npm install",
      "",
    ].join("\r\n"),
  );
});

test.each(["yml", "with-environments", "environments", "sets", "no-environments"])(
  "extracts the real %s project with its intended environment mode",
  async (example) => {
    await extractRealExample(example, destinationPath);
    const config = require(path.join(destinationPath, "featurevisor.config.js"));
    if (example === "environments") {
      expect(config.sets).toBe(true);
      expect(config.environments).toBeUndefined();
      expect(config.promotionFlows).toEqual([
        { from: "dev", to: "staging" },
        { from: "staging", to: "production" },
      ]);
      expect(fs.readdirSync(path.join(destinationPath, "sets")).sort()).toEqual([
        "dev",
        "production",
        "staging",
      ]);
      expect(
        fs.existsSync(path.join(destinationPath, "sets/production/features/checkoutFlow.yml")),
      ).toBe(true);
      return;
    }
    if (example === "sets") {
      expect(config.sets).toBe(true);
      expect(config.environments).toEqual(["staging", "production"]);
      expect(fs.readdirSync(path.join(destinationPath, "sets")).sort()).toEqual([
        "admin",
        "storefront",
      ]);
      return;
    }
    const readYaml = (filePath: string) =>
      parsers.yml.parse<any>(fs.readFileSync(path.join(destinationPath, filePath), "utf8"));
    const feature = readYaml("features/showCookieBanner.yml");
    const spec = readYaml("tests/features/showCookieBanner.spec.yml");
    expect(readYaml("targets/all.yml")).toEqual({
      description: "All features and global variables",
    });
    if (example === "yml" || example === "no-environments") {
      expect(readYaml("attributes/country.yml").description).toBe("Country");
      expect(config.environments).toBeUndefined();
      expect(Array.isArray(feature.rules)).toBe(true);
      expect(spec.assertions.every((assertion: any) => assertion.environment === undefined)).toBe(
        true,
      );
    } else {
      expect(config.environments).toEqual(["staging", "production"]);
      expect(Object.keys(feature.rules)).toEqual(["staging", "production"]);
      expect(new Set(spec.assertions.map((assertion: any) => assertion.environment))).toEqual(
        new Set(["staging", "production"]),
      );
    }
  },
);

test("the CLI README starts with init and its real scaffold passes local commands", async () => {
  const readme = fs.readFileSync(path.join(repositoryPath, "packages/cli/README.md"), "utf8");
  const setup = readme.split("## Create a project")[1].split("## Add to an existing project")[0];
  expect(setup).toContain("npx @featurevisor/cli init\nnpm install\nnpx featurevisor lint");
  await extractRealExample("yml", destinationPath);
  // Use the built local packages so this regression never downloads a released CLI.
  fs.symlinkSync(
    path.join(repositoryPath, "node_modules"),
    path.join(destinationPath, "node_modules"),
    "junction",
  );
  for (const command of ["lint", "test", "build"]) {
    const output = execFileSync(
      process.execPath,
      [path.join(repositoryPath, "packages/cli/bin.js"), command],
      { cwd: destinationPath, encoding: "utf8" },
    );
    expect(output.length).toBeGreaterThan(0);
  }
  expect(fs.existsSync(path.join(destinationPath, "datafiles/featurevisor-all.json"))).toBe(true);
});

test("no environments and default scaffolds stay identical apart from metadata", async () => {
  const defaultPath = path.join(workPath, "default");
  await extractRealExample("yml", defaultPath);
  await extractRealExample("no-environments", destinationPath);

  const contents = (root: string, relative = ""): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      if (["README.md", "CHANGELOG.md"].includes(file)) continue;
      if (entry.isDirectory()) {
        Object.assign(result, contents(root, file));
      } else {
        const content = fs.readFileSync(path.join(root, file), "utf8");
        if (file === "package.json") {
          const manifest = JSON.parse(content);
          delete manifest.name;
          delete manifest.version;
          result[file] = manifest;
        } else {
          result[file] = content;
        }
      }
    }
    return result;
  };
  expect(contents(destinationPath)).toEqual(contents(defaultPath));
});

test("preserves the destination inode and unrelated .git entries", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag" });
  fs.mkdirSync(path.join(destinationPath, ".git"), { recursive: true });
  fs.writeFileSync(path.join(destinationPath, ".git", "config"), "keep");
  const inode = fs.statSync(destinationPath).ino;
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await initProject(destinationPath, undefined, "3.11.0");
  expect(fs.statSync(destinationPath).ino).toBe(inode);
  expect(fs.readFileSync(path.join(destinationPath, ".git", "config"), "utf8")).toBe("keep");
  expect(
    JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8")).marker,
  ).toBe("tag");
});

test("keeps the direct initProject default example and resolves the CLI package version", async () => {
  const version = require("@featurevisor/cli/package.json").version;
  const file = await archive(`featurevisor-${version}`, { yml: "default" });
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await initProject(destinationPath);
  expect(get.mock.calls[0][0]).toBe(EXAMPLES_TAR_URL.replace(/main$/, `v${version}`));
  expect(
    JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8")).marker,
  ).toBe("default");
});

test("uses main only for a confirmed missing tag", async () => {
  const file = await archive("featurevisor-main", { json: "main" });
  get.mockRejectedValueOnce({ response: { status: 404 } });
  get.mockResolvedValueOnce({ data: fs.createReadStream(file) });

  await expect(initProject(destinationPath, "json", "3.11.0")).resolves.toBe(true);
  expect(get.mock.calls.map(([url]) => url)).toEqual([
    expect.stringMatching(/\/v3\.11\.0$/),
    expect.stringMatching(/\/main$/),
  ]);
  expect(
    JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8")).marker,
  ).toBe("main");
  expect(warn).toHaveBeenCalled();
});

test("uses main directly for an explicit development version", async () => {
  const file = await archive("featurevisor-main", { yml: "development" });
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await initProject(destinationPath, undefined, "3.11.0-dev.1");
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][0]).toMatch(/\/main$/);
});

test.each([401, 403, 500, undefined])(
  "does not fall back for an HTTP or network error (%s)",
  async (status) => {
    get.mockRejectedValue(status ? { response: { status } } : new Error("offline"));

    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
      "Could not download the Featurevisor example archive (v3.11.0)",
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  },
);

test("rejects a missing example without reporting success or leaving files", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag", custom: "custom", json: "json" });
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await expect(initProject(destinationPath, "missing", "3.11.0")).rejects.toThrow(
    'Example "missing" was not found in the Featurevisor archive (v3.11.0). Available documented examples: yml, json.',
  );
  expect(fs.existsSync(destinationPath)).toBe(false);
  expect(fs.readdirSync(workPath).some((name) => name.startsWith(".featurevisor-init-"))).toBe(
    false,
  );
  expect(log).not.toHaveBeenCalled();
});

test.each(["custom", "1", "test-environments"])(
  "accepts the unlisted %s example from the archive",
  async (example) => {
    const file = await archive("featurevisor-3.11.0", { [example]: "custom project" });
    get.mockResolvedValue({ data: fs.createReadStream(file) });
    await expect(initProject(destinationPath, example, "3.11.0")).resolves.toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8")).marker,
    ).toBe("custom project");
  },
);

test("suggests documented targets without advertising the no environments alias", async () => {
  const names = [
    "yml",
    "json",
    "toml",
    "with-environments",
    "environments",
    "sets",
    "namespace-slash",
    "no-environments",
    "targets",
  ];
  const file = await archive(
    "featurevisor-3.11.0",
    Object.fromEntries([...names, "1", "test-environments"].map((name) => [name, name])),
  );
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  await expect(initProject(destinationPath, "missing", "3.11.0")).rejects.toThrow(
    `Available documented examples: ${names.filter((name) => name !== "no-environments").join(", ")}. Other example names present in the archive are also accepted.`,
  );
});

test("rejects extraction failures and cleans staging", async () => {
  get.mockResolvedValue({ data: Readable.from([Buffer.from("not a gzip archive")]) });

  await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
    "Could not extract the Featurevisor example archive",
  );
  expect(fs.existsSync(destinationPath)).toBe(false);
  expect(fs.readdirSync(workPath).some((name) => name.startsWith(".featurevisor-init-"))).toBe(
    false,
  );
  expect(log).not.toHaveBeenCalled();
});

test("rejects a stream failure without fallback or partial output", async () => {
  const stream = Readable.from(
    (async function* () {
      yield Buffer.from("partial archive");
      throw new Error("connection interrupted");
    })(),
  );
  get.mockResolvedValue({ data: stream });

  await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
    "connection interrupted",
  );
  expect(get).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(destinationPath)).toBe(false);
  expect(fs.readdirSync(workPath).some((name) => name.startsWith(".featurevisor-init-"))).toBe(
    false,
  );
  expect(log).not.toHaveBeenCalled();
});

test("rejects top-level collisions without overwriting existing entries", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "new" });
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "package.json"), "keep");
  get.mockResolvedValue({ data: fs.createReadStream(file) });

  await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
    "existing entries would be overwritten: package.json",
  );
  expect(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8")).toBe("keep");
  expect(log).not.toHaveBeenCalled();
});

test("suggests Node proxy support when a proxy is configured", async () => {
  get.mockRejectedValue(new Error("offline"));
  const previous = { proxy: process.env.HTTPS_PROXY, use: process.env.NODE_USE_ENV_PROXY };
  process.env.HTTPS_PROXY = "http://proxy.invalid:8080";
  delete process.env.NODE_USE_ENV_PROXY;
  try {
    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
      "offline. Set NODE_USE_ENV_PROXY=1 so Node uses your proxy settings.",
    );
  } finally {
    if (previous.proxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous.proxy;
    if (previous.use !== undefined) process.env.NODE_USE_ENV_PROXY = previous.use;
  }
});

test("the init handler rejects download failure for CLI error handling", async () => {
  get.mockRejectedValue(new Error("offline"));
  await expect(
    initPlugin.handler({
      rootDirectoryPath: destinationPath,
      parsed: { _: [] },
      cliVersion: "3.11.0",
    } as any),
  ).rejects.toThrow("Could not download");
  expect(log).not.toHaveBeenCalled();
});

test("rejects symlinks in the selected archive example", async () => {
  const sourcePath = fs.mkdtempSync(path.join(workPath, "source-"));
  const examplePath = path.join(sourcePath, "featurevisor-3.11.0", "examples", "example-yml");
  fs.mkdirSync(examplePath, { recursive: true });
  fs.writeFileSync(path.join(examplePath, "package.json"), "safe");
  fs.symlinkSync("package.json", path.join(examplePath, "linked.json"));
  const archivePath = path.join(workPath, "links.tar.gz");
  await tar.c({ gzip: true, file: archivePath, cwd: sourcePath }, ["featurevisor-3.11.0"]);
  get.mockResolvedValue({ data: fs.createReadStream(archivePath) });

  await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
    "Unsafe example archive entry",
  );
  expect(fs.existsSync(destinationPath)).toBe(false);
});

test("stages inside the destination and cleans up after a failed download", async () => {
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "README.md"), "keep");
  get.mockImplementation(async () => {
    const staging = fs
      .readdirSync(destinationPath)
      .filter((name) => name.startsWith(".featurevisor-init-"));
    expect(staging).toHaveLength(1);
    expect(fs.readdirSync(workPath)).toEqual(["project"]);
    throw new Error("offline");
  });
  await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
    "Could not download",
  );
  expect(fs.readdirSync(destinationPath)).toEqual(["README.md"]);
  expect(fs.readFileSync(path.join(destinationPath, "README.md"), "utf8")).toBe("keep");
});

const permissionTest = process.platform !== "win32" && process.getuid?.() !== 0 ? test : test.skip;
permissionTest("works in a writable directory under a read only parent", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag" });
  const parent = path.join(workPath, "locked");
  destinationPath = path.join(parent, "project");
  fs.mkdirSync(destinationPath, { recursive: true });
  fs.chmodSync(parent, 0o555);
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  try {
    await expect(initProject(destinationPath, undefined, "3.11.0")).resolves.toBe(true);
    expect(fs.readdirSync(parent)).toEqual(["project"]);
    expect(fs.readdirSync(destinationPath)).toEqual(["package.json"]);
  } finally {
    fs.chmodSync(parent, 0o755);
  }
});

permissionTest("names the project requiring write access without downloading", async () => {
  fs.mkdirSync(destinationPath);
  fs.chmodSync(destinationPath, 0o555);
  try {
    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
      `Cannot initialize in ${destinationPath}: write access is required`,
    );
    expect(get).not.toHaveBeenCalled();
    expect(fs.readdirSync(destinationPath)).toEqual([]);
  } finally {
    fs.chmodSync(destinationPath, 0o755);
  }
});

test.each(["README.md", ".gitignore"])(
  "preserves an existing %s and refuses partial scaffolding",
  async (name) => {
    const file = await archive("featurevisor-3.11.0", { yml: "tag" }, { [name]: "template" });
    fs.mkdirSync(destinationPath);
    fs.writeFileSync(path.join(destinationPath, name), "user contents");
    get.mockResolvedValue({ data: fs.createReadStream(file) });
    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
      `existing entries would be overwritten: ${name}`,
    );
    expect(fs.readdirSync(destinationPath)).toEqual([name]);
    expect(fs.readFileSync(path.join(destinationPath, name), "utf8")).toBe("user contents");
  },
);

test("does not replace a user's changelog with the internal example history", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag" });
  fs.mkdirSync(destinationPath);
  fs.writeFileSync(path.join(destinationPath, "CHANGELOG.md"), "user history");
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  await initProject(destinationPath, undefined, "3.11.0");
  expect(fs.readFileSync(path.join(destinationPath, "CHANGELOG.md"), "utf8")).toBe("user history");
});

test.each([
  ["My Project!", "my-project"],
  ["...", "featurevisor-project"],
  ["Checkout", "checkout"],
])("normalizes destination %s into package name %s", async (directory, expected) => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag" });
  destinationPath = path.join(workPath, directory);
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  await initProject(destinationPath, undefined, "3.11.0");
  const manifest = JSON.parse(fs.readFileSync(path.join(destinationPath, "package.json"), "utf8"));
  expect(manifest.name).toBe(expected);
  expect(manifest).not.toHaveProperty("version");
});

test.each(["not json", "null", "[]", '"text"'])(
  "rejects invalid package metadata %s without leaving a project",
  async (contents) => {
    const file = await archive("featurevisor-3.11.0", { yml: "tag" }, { "package.json": contents });
    get.mockResolvedValue({ data: fs.createReadStream(file) });
    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow();
    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  },
);

test("rolls back installed entries and cleans staging if a later move fails", async () => {
  const file = await archive("featurevisor-3.11.0", { yml: "tag" }, { "README.md": "template" });
  fs.mkdirSync(path.join(destinationPath, ".git"), { recursive: true });
  get.mockResolvedValue({ data: fs.createReadStream(file) });
  const promises = require("fs/promises") as typeof import("fs/promises");
  const rename = promises.rename;
  const move = jest.spyOn(promises, "rename").mockImplementation(rename);
  move
    .mockImplementationOnce(rename)
    .mockRejectedValueOnce(Object.assign(new Error("move denied"), { code: "EACCES" }));
  try {
    await expect(initProject(destinationPath, undefined, "3.11.0")).rejects.toThrow(
      `Cannot initialize in ${destinationPath}: write access is required`,
    );
    expect(fs.readdirSync(destinationPath)).toEqual([".git"]);
    expect(log).not.toHaveBeenCalled();
  } finally {
    move.mockRestore();
  }
});
