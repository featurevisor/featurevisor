import { createWriteStream } from "fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

import * as tar from "tar";

import { Plugin } from "../cli";

export const DEFAULT_EXAMPLE = "yml";

const documentedExamples = [
  "yml",
  "json",
  "toml",
  "with-environments",
  "environments",
  "sets",
  "namespace-slash",
  "targets",
];

export const EXAMPLES_ORG_NAME = "featurevisor";
export const EXAMPLES_REPO_NAME = "featurevisor";
export const EXAMPLES_BRANCH_NAME = "main";

export const EXAMPLES_TAR_URL = `https://codeload.github.com/${EXAMPLES_ORG_NAME}/${EXAMPLES_REPO_NAME}/tar.gz/${EXAMPLES_BRANCH_NAME}`;

function isDevelopmentVersion(version: string) {
  return version === "0.0.0" || /(?:^|[.-])(?:dev|development)(?:[.-]|$)/i.test(version);
}

async function downloadArchive(ref: string): Promise<Readable | null> {
  const url = EXAMPLES_TAR_URL.replace(/main$/, encodeURIComponent(ref));
  const proxied =
    !process.env.NODE_USE_ENV_PROXY &&
    ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((name) => process.env[name]);
  const failure = (reason: string) =>
    new Error(
      `Could not download the Featurevisor example archive (${ref}): ${reason}` +
        (proxied ? ". Set NODE_USE_ENV_PROXY=1 so Node uses your proxy settings." : ""),
    );
  // Like the previous HTTP client, the timeout covers the connection, not the whole body.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw failure(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 404 && ref !== EXAMPLES_BRANCH_NAME) return null;
  if (!response.ok || !response.body) throw failure(`HTTP ${response.status}`);
  return Readable.fromWeb(response.body as import("stream/web").ReadableStream);
}

async function listDestination(directoryPath: string): Promise<string[] | null> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isPermissionError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    ["EACCES", "EPERM", "EROFS"].includes(String(error.code))
  );
}

async function preparePackage(stagingPath: string, directoryPath: string) {
  const manifestPath = path.join(stagingPath, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The example package.json must contain an object.");
  }
  manifest.name =
    path
      .basename(directoryPath)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 214) || "featurevisor-project";
  delete manifest.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const readmePath = path.join(stagingPath, "README.md");
  let readme: string;
  try {
    readme = await readFile(readmePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const newline = readme.includes("\r\n") ? "\r\n" : "\n";
  let renamed = false;
  let initializing = false;
  let fence: string | undefined;
  const lines: string[] = [];
  for (const line of readme.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    } else if (!fence) {
      if (/^#{1,2}\s/.test(line)) initializing = /^## Initialize\s*$/.test(line);
      if (!renamed && /^#\s/.test(line)) {
        lines.push(`# ${manifest.name}`);
        renamed = true;
        continue;
      }
    }
    if (!initializing) lines.push(line);
  }
  await writeFile(readmePath, lines.join(newline));
}

export async function initProject(
  directoryPath: string,
  exampleName: string = DEFAULT_EXAMPLE,
  cliVersion?: string,
): Promise<boolean> {
  if (!cliVersion) {
    try {
      cliVersion = require("@featurevisor/cli/package.json").version;
    } catch {
      throw new Error("Cannot initialize a project without the running CLI package version.");
    }
  }
  if (!cliVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(cliVersion)) {
    throw new Error("Cannot initialize a project without the running CLI package version.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(exampleName)) {
    throw new Error(`Invalid example name: ${exampleName}`);
  }

  directoryPath = path.resolve(directoryPath);
  let temporaryPath: string | undefined;
  let createdDestination = false;
  let succeeded = false;
  try {
    if ((await listDestination(directoryPath)) === null) {
      await mkdir(directoryPath, { recursive: true });
      createdDestination = true;
    }
    temporaryPath = await mkdtemp(path.join(directoryPath, ".featurevisor-init-"));
    const stagingPath = path.join(temporaryPath, "example");
    const tag = `v${cliVersion}`;
    let ref = isDevelopmentVersion(cliVersion) ? EXAMPLES_BRANCH_NAME : tag;
    let archive = await downloadArchive(ref);
    if (archive === null) {
      console.warn(`No archive found for ${tag}; using ${EXAMPLES_BRANCH_NAME} examples.`);
      ref = EXAMPLES_BRANCH_NAME;
      archive = await downloadArchive(ref);
    }

    const archiveRoot = `${EXAMPLES_REPO_NAME}-${ref.startsWith("v") ? ref.slice(1) : ref}`;
    const examplePrefix = `${archiveRoot}/examples/example-${exampleName}/`;
    await mkdir(stagingPath);
    let filesExtracted = 0;
    const availableExamples = new Set<string>();
    let unsafeEntry: string | undefined;
    try {
      const archivePath = path.join(temporaryPath, "archive.tar.gz");
      await pipeline(archive, createWriteStream(archivePath));
      await tar.x({
        file: archivePath,
        C: stagingPath,
        strip: 3,
        filter: (entryPath, entry) => {
          const examplePath = entryPath.slice(`${archiveRoot}/examples/example-`.length);
          const availableExample = examplePath.match(
            /^([a-zA-Z0-9][a-zA-Z0-9_-]*)\/package\.json$/,
          );
          if (
            entryPath.startsWith(`${archiveRoot}/examples/example-`) &&
            availableExample &&
            "type" in entry &&
            entry.type === "File"
          ) {
            availableExamples.add(availableExample[1]);
          }
          const included = entryPath.startsWith(examplePrefix);
          if (included) {
            const relativePath = entryPath.slice(examplePrefix.length);
            if (relativePath === "CHANGELOG.md") return false;
            const segments = relativePath.split("/");
            if (
              segments.includes(".") ||
              segments.includes("..") ||
              !("type" in entry) ||
              (entry.type !== "File" && entry.type !== "Directory") ||
              (!relativePath && entry.type !== "Directory")
            ) {
              unsafeEntry = entryPath;
              return false;
            }
            if (entry.type === "File") {
              filesExtracted++;
            }
          }
          return included;
        },
      });
    } catch (error) {
      if (isPermissionError(error)) throw error;
      throw new Error(
        `Could not extract the Featurevisor example archive (${ref}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (unsafeEntry) {
      throw new Error(`Unsafe example archive entry: ${unsafeEntry}`);
    }

    if (filesExtracted === 0) {
      const suggestedExamples = documentedExamples.filter((name) => availableExamples.has(name));
      throw new Error(
        `Example "${exampleName}" was not found in the Featurevisor archive (${ref}).` +
          (suggestedExamples.length > 0
            ? ` Available documented examples: ${suggestedExamples.join(", ")}.`
            : " No documented examples were found in this archive.") +
          " Other example names present in the archive are also accepted.",
      );
    }
    await preparePackage(stagingPath, directoryPath);
    const stagedEntries = await readdir(stagingPath);
    if (stagedEntries.length === 0) {
      throw new Error(
        `Example "${exampleName}" produced no project files from the Featurevisor archive (${ref}).`,
      );
    }
    const existingEntries = await listDestination(directoryPath);
    const collisions = stagedEntries.filter((entry) => existingEntries?.includes(entry));
    if (collisions.length > 0) {
      throw new Error(
        `Cannot initialize in ${directoryPath}: existing entries would be overwritten: ${collisions.join(", ")}.`,
      );
    }

    const moved: string[] = [];
    try {
      for (const entry of stagedEntries) {
        await rename(path.join(stagingPath, entry), path.join(directoryPath, entry));
        moved.push(entry);
      }
    } catch (error) {
      for (const entry of moved.reverse()) {
        await rename(path.join(directoryPath, entry), path.join(stagingPath, entry));
      }
      throw error;
    }
    succeeded = true;
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error(
        `Cannot initialize in ${directoryPath}: write access is required in the project directory (and its parent when creating it). ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  } finally {
    if (temporaryPath) await rm(temporaryPath, { recursive: true, force: true });
    if (createdDestination && !succeeded) await rmdir(directoryPath).catch(() => undefined);
  }

  console.log(`Project scaffolded in ${directoryPath}`);
  console.log("");
  console.log("Next steps in the directory above:");
  console.log("  npm install");
  console.log("  npx featurevisor lint");
  console.log("  npx featurevisor test");
  console.log("  npx featurevisor build");
  console.log("  npx featurevisor catalog");
  console.log("");
  console.log("Quick start: https://featurevisor.com/docs/quick-start/");
  console.log("Skill: https://featurevisor.com/docs/skills/");
  return true;
}

export const initPlugin: Plugin = {
  command: "init",
  handler: async function (options) {
    const { rootDirectoryPath, parsed, cliVersion } = options;

    await initProject(rootDirectoryPath, parsed.example, cliVersion);
  },
  examples: [
    {
      command: "init",
      description: "Scaffold a new project in the current directory",
    },
    {
      command: "init --example=with-environments",
      description: "Scaffold a project with staging and production environments",
    },
  ],
};
