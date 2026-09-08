import path from "node:path";
import fs from "node:fs";
import type { CustomParser } from "@featurevisor/parsers";
import type { Plugin } from "../cli";
import { CONFIG_MODULE_NAME, getProjectConfigForSet, type ProjectConfig } from "../config";
import { FilesystemAdapter } from "../datasource/filesystemAdapter";
import { compareValues, type ValueChange } from "./compare";
import { describeDefinitionChanges, formatDetails, type DiffDetail } from "./details";
import { DiffGit, diffError, type DiffSelection, type GitFile } from "./git";

const entities = [
  "feature",
  "variable",
  "segment",
  "attribute",
  "group",
  "schema",
  "target",
  "test",
] as const;
type EntityType = (typeof entities)[number] | "config";

interface Entity {
  entity: EntityType;
  key: string;
  set?: string;
}

export interface EntityChange extends Entity {
  file: string;
  kind: "added" | "removed" | "changed";
  changes: ValueChange[];
  details: DiffDetail[];
}

export interface DefinitionDiff extends DiffSelection {
  warnings: string[];
  summary: { added: number; removed: number; changed: number };
  changes: EntityChange[];
}

export interface DiffOptions {
  from?: string;
  to?: string;
  set?: string;
}

export function diffDefinitions(
  rootDirectoryPath: string,
  config: ProjectConfig,
  options: DiffOptions = {},
): DefinitionDiff {
  if (config.adapter !== FilesystemAdapter) {
    diffError("The diff command requires the filesystem datasource adapter.");
  }
  if (options.set !== undefined && !config.sets) {
    diffError("This project does not use sets.");
  }
  const git = new DiffGit(rootDirectoryPath);
  const parser = config.parser as CustomParser;
  const relative = (directory: string): string => {
    const value = path.relative(git.root, directory).split(path.sep).join("/");
    if (value === ".." || value.startsWith("../") || path.isAbsolute(value)) {
      diffError("All compared definition directories must be inside the Git working tree.");
    }
    return value;
  };
  const configPath = relative(path.join(rootDirectoryPath, CONFIG_MODULE_NAME));
  const prefix = (directory: string) => {
    const value = relative(directory);
    return value ? value + "/" : "";
  };
  const directories = (projectConfig: ProjectConfig) =>
    entities.map((entity) => ({
      entity,
      prefix: prefix(projectConfig[`${entity}sDirectoryPath`]),
    }));
  const roots = config.sets ? [] : directories(config);
  const setsPrefix = config.sets ? prefix(config.setsDirectoryPath) : "";
  const selection = git.select(options.from, options.to);
  const beforeFiles = git.files(selection.from);
  const afterFiles = git.files(selection.to);
  const allFiles = [...beforeFiles, ...afterFiles];
  const sets = new Set<string>();
  if (config.sets) {
    for (const file of allFiles) {
      if (file.path.startsWith(setsPrefix)) {
        sets.add(file.path.slice(setsPrefix.length).split("/")[0]);
      }
    }
    if (options.set !== undefined && !sets.has(options.set)) {
      diffError(`Set ${JSON.stringify(options.set)} does not exist in either comparison endpoint.`);
    }
  }
  const setDirectories = Array.from(sets).flatMap((set) =>
    directories(getProjectConfigForSet(config, set)).map((directory) => ({ ...directory, set })),
  );
  function identify(file: GitFile): Entity | undefined {
    if (file.path === configPath) return { entity: "config", key: CONFIG_MODULE_NAME };
    const candidates = config.sets
      ? setDirectories
      : roots.map((root) => ({ ...root, set: undefined }));
    const relevant = candidates.filter(
      (directory) => options.set === undefined || options.set === directory.set,
    );
    if (
      relevant.some(
        (directory) =>
          file.path.startsWith(directory.prefix) || directory.prefix.startsWith(file.path + "/"),
      )
    ) {
      if (file.mode && file.mode !== "100644" && file.mode !== "100755") {
        diffError(`Cannot compare nonregular definition file: ${file.path}`);
      }
      if (!file.mode) {
        try {
          const stat = fs.lstatSync(path.join(git.root, file.path));
          if (stat.isSymbolicLink()) diffError(`Cannot compare symbolic link: ${file.path}`);
          if (stat.isDirectory()) diffError(`Cannot compare a nested Git repository: ${file.path}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    if (!file.path.endsWith(`.${parser.extension}`)) return undefined;
    for (const directory of candidates) {
      if (!file.path.startsWith(directory.prefix)) continue;
      if (options.set !== undefined && options.set !== directory.set) continue;
      return {
        entity: directory.entity,
        key: file.path
          .slice(directory.prefix.length, -(parser.extension.length + 1))
          .split("/")
          .join(config.namespaceCharacter),
        ...(directory.set ? { set: directory.set } : {}),
      };
    }
    return undefined;
  }
  const identified = new Map<string, Entity>();
  for (const file of allFiles) {
    const entity = identify(file);
    if (entity) identified.set(file.path, entity);
  }
  const before = git.contents(
    beforeFiles.filter((file) => identified.has(file.path)),
    selection.from,
  );
  const after = git.contents(
    afterFiles.filter((file) => identified.has(file.path)),
    selection.to,
  );
  const result: DefinitionDiff = {
    ...selection,
    warnings: [],
    summary: { added: 0, removed: 0, changed: 0 },
    changes: [],
  };
  const parse = (file: string, content: string | undefined, endpoint: string): unknown => {
    if (content === undefined) return undefined;
    if (file === configPath) return content;
    try {
      const value = parser.parse(content, path.join(git.root, file));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        diffError("Expected a definition object.");
      }
      // A serializable snapshot also detects cyclic YAML aliases and normalizes YAML dates.
      return JSON.parse(JSON.stringify(value));
    } catch {
      diffError(
        `Cannot parse ${file} at ${endpoint}. Fix the definition or check the configured parser.`,
      );
    }
  };
  for (const file of Array.from(identified.keys()).sort()) {
    if (before.get(file) === after.get(file)) continue;
    const previous = parse(file, before.get(file), selection.from.ref);
    const next = parse(file, after.get(file), selection.to.ref);
    const kind = !before.has(file) ? "added" : !after.has(file) ? "removed" : "changed";
    const changes: ValueChange[] =
      kind === "added"
        ? [{ path: "", kind, after: next }]
        : kind === "removed"
          ? [{ path: "", kind, before: previous }]
          : compareValues(previous, next);
    if (!changes.length) continue;
    result.summary[kind]++;
    const entity = identified.get(file)!;
    result.changes.push({
      ...entity,
      file,
      kind,
      changes,
      details: describeDefinitionChanges(entity.entity, previous, next),
    });
  }
  const currentConfig = git
    .contents([{ path: configPath }], { ref: "working-tree" })
    .get(configPath);
  if (
    before.get(configPath) !== after.get(configPath) ||
    before.get(configPath) !== currentConfig
  ) {
    result.warnings.push(
      "Compared or current project configuration differs. Definitions are compared using the current parser and directory layout; historical layouts may contain additional files. Review configuration and directory moves with git diff. Historical configuration is not executed.",
    );
  }
  return result;
}

export function formatDefinitionDiff(result: DefinitionDiff, colour = false): string {
  const paint = (value: string, code: number) => (colour ? `\x1b[${code}m${value}\x1b[0m` : value);
  const lines = [`Comparing ${result.from.ref} → ${result.to.ref}`];
  for (const warning of result.warnings) lines.push(paint(`Warning: ${warning}`, 33));
  if (!result.changes.length) {
    lines.push(
      result.reason === "primary" ? "No changes on the primary branch." : "No definition changes.",
    );
    return lines.join("\n");
  }
  for (const entity of result.changes) {
    const code = entity.kind === "added" ? 32 : entity.kind === "removed" ? 31 : 33;
    const marker = entity.kind === "added" ? "+" : entity.kind === "removed" ? "−" : "~";
    lines.push(
      "",
      paint(
        `${marker} ${entity.entity} ${entity.key}${entity.set ? ` (set: ${entity.set})` : ""}`,
        code,
      ),
    );
    if (entity.entity === "config") {
      lines.push(`  ${entity.kind}: ${entity.file}`);
      continue;
    }
    lines.push(...formatDetails(entity.details, colour));
  }
  lines.push(
    "",
    `${result.summary.added} added, ${result.summary.changed} changed, ${result.summary.removed} removed`,
  );
  return lines.join("\n");
}

export const diffPlugin: Plugin = {
  command: "diff",
  description: "Compare authored definitions using Git history",
  examples: [
    {
      command: "diff",
      description: "Compare local changes, or the current branch with the primary branch",
    },
    { command: "diff --from=main --to=HEAD", description: "Compare two Git commit references" },
    {
      command: "diff --from=HEAD --to=working-tree --json",
      description: "Compare uncommitted definitions as JSON",
    },
  ],
  handler: async ({ rootDirectoryPath, projectConfig, parsed }) => {
    const result = diffDefinitions(rootDirectoryPath, projectConfig, {
      from: parsed.from,
      to: parsed.to,
      set: parsed.set,
    });
    console.log(
      parsed.json
        ? JSON.stringify(result, null, parsed.pretty ? 2 : undefined)
        : formatDefinitionDiff(result, !!process.stdout.isTTY && !process.env.NO_COLOR),
    );
  },
};
