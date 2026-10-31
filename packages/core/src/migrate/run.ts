import * as fs from "node:fs";
import * as path from "node:path";

import type { ParsedOptions } from "../cli";
import { getProjectConfig } from "../config/projectConfig";
import { describeParseError } from "../datasource/parseError";
import { formatFeaturevisorCLIError } from "../error";
import { unifiedDiff } from "../rewrite/diff";
import { same } from "../rewrite/lines";
import {
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import {
  migrateAttribute,
  migrateFeature,
  migrateSchema,
  migrateSegment,
  migrateTest,
  migrateVariable,
  Migration,
  type Attributes,
} from "./definitions";
import { readProject, type DefinitionFile } from "./project";
import { WriteError, writeDefinition } from "./write";

const GUIDE = "https://featurevisor.com/docs/migrations/v4/";

export interface MigrateOptions {
  /** Report what would change and write nothing */
  check?: boolean;
  /** Print what would change as a unified diff, writing nothing */
  diff?: boolean;
}

export interface MigratedFile {
  filePath: string;
  set?: string;
  /** What changed: conditions, types, operators, stickyFeatures, evaluations, mutation order */
  changes: string[];
  /** What needs a person, with the guide section that explains it */
  notes: { path: string; message: string; link: string }[];
  error?: string;
  diff?: string;
}

export interface MigrationResult {
  files: MigratedFile[];
  /** Problems that stopped migration before anything was written */
  blockers: { message: string; link: string }[];
  /** Definition files read, changed or not */
  total: number;
  migrated: number;
  errors: number;
}

const link = (section: string) => `${GUIDE}#${section}`;
const relative = (filePath: string) => path.relative(process.cwd(), filePath) || filePath;

/** An attribute's key, from its file name */
function attributeKey(file: DefinitionFile, extension: string) {
  return path.basename(file.filePath, `.${extension}`);
}

export function migrateProject(
  rootDirectoryPath: string,
  options: MigrateOptions = {},
): MigrationResult {
  const project = readProject(rootDirectoryPath);
  const result: MigrationResult = {
    files: [],
    blockers: project.blockers.map(({ message, section }) => ({ message, link: link(section) })),
    total: project.files.length,
    migrated: 0,
    errors: 0,
  };
  if (result.blockers.length > 0) return result;

  const write = !options.check && !options.diff;
  const { parser } = project;
  const read = new Map<DefinitionFile, { source: string; value: unknown }>();
  const report = (file: DefinitionFile, entry: Omit<MigratedFile, "filePath" | "set">) => {
    if (entry.changes.length === 0 && entry.notes.length === 0 && !entry.error) return;
    result.files.push({
      filePath: relative(file.filePath),
      ...(file.set ? { set: file.set } : {}),
      ...entry,
    });
  };

  for (const file of project.files) {
    const source = fs.readFileSync(file.filePath, "utf8");
    try {
      read.set(file, { source, value: parser.parse(source, file.filePath) });
    } catch (error) {
      const { message, line, column } = describeParseError(error);
      const where = line ? ` (line ${line}${column ? `, column ${column}` : ""})` : "";
      report(file, { changes: [], notes: [], error: `${message}${where}` });
    }
  }

  // attributes first, so conditions can be checked against their migrated types
  const migrated = new Map<DefinitionFile, { value: unknown; migration: Migration }>();
  const attributes = new Map<string, Attributes>();
  for (const [file, { value }] of read) {
    if (file.kind !== "attribute") continue;
    const migration = new Migration();
    const after = migrateAttribute(value, migration);
    migrated.set(file, { value: after, migration });
    const set = attributes.get(file.set || "") || {};
    set[attributeKey(file, parser.extension)] = after;
    attributes.set(file.set || "", set);
  }
  for (const [file, { value }] of read) {
    if (file.kind === "attribute") continue;
    const migration = new Migration();
    const inSet = attributes.get(file.set || "") || {};
    const kinds: Record<DefinitionFile["kind"], () => unknown> = {
      attribute: () => value,
      schema: () => migrateSchema(value, [], migration),
      segment: () => migrateSegment(value, inSet, migration),
      feature: () => migrateFeature(value, inSet, migration),
      variable: () => migrateVariable(value, inSet, migration),
      target: () => value,
      test: () => migrateTest(value, migration),
    };
    migrated.set(file, { value: kinds[file.kind](), migration });
  }

  for (const file of project.files) {
    const entry = migrated.get(file);
    if (!entry) continue;
    const { source, value } = read.get(file)!;
    const { migration } = entry;
    const notes = migration.notes.map((note) => ({
      path: note.path.join("."),
      message: note.message,
      link: link(note.section),
    }));
    if (project.nestedAttributes.includes(file.filePath)) {
      notes.push({
        path: "",
        message:
          "v4 reads attribute files only directly in the attributes directory, without dots in their names. Move or rename it, or declare an object attribute.",
        link: link("attribute-directories"),
      });
    }

    if (same(entry.value, value)) {
      report(file, { changes: [], notes });
      continue;
    }
    try {
      const output = writeDefinition(source, value, entry.value, migration.renames, parser);
      const changes = [...migration.changes];
      const diff = options.diff
        ? unifiedDiff(relative(file.filePath), relative(file.filePath), source, output)
        : undefined;
      if (write) fs.writeFileSync(file.filePath, output);
      result.migrated++;
      report(file, { changes, notes, ...(diff ? { diff } : {}) });
    } catch (error) {
      const message =
        error instanceof WriteError
          ? `${error.message} Migrate it by hand.`
          : (error as Error).message;
      report(file, { changes: [...migration.changes], notes, error: message });
    }
  }

  const { config } = project;
  if (config.migrated !== config.source) {
    const diff = options.diff
      ? unifiedDiff(
          relative(config.filePath),
          relative(config.filePath),
          config.source,
          config.migrated,
        )
      : undefined;
    if (write) fs.writeFileSync(config.filePath, config.migrated);
    result.files.push({
      filePath: relative(config.filePath),
      changes: config.changes,
      notes: [],
      ...(diff ? { diff } : {}),
    });
    result.migrated++;
  }
  if (write) {
    try {
      getProjectConfig(rootDirectoryPath);
    } catch (error) {
      result.files.push({
        filePath: relative(config.filePath),
        changes: [],
        notes: [
          {
            path: "",
            message: `v4 still cannot load the configuration: ${(error as Error).message}`,
            link: link("changes-when-you-upgrade-the-cli"),
          },
        ],
      });
    } finally {
      delete require.cache[require.resolve(config.filePath)];
    }
  }

  result.errors = result.files.filter((file) => file.error).length;
  return result;
}

function printResult(result: MigrationResult, options: MigrateOptions) {
  const write = !options.check && !options.diff;
  if (result.blockers.length > 0) {
    for (const blocker of result.blockers) {
      console.log(CLI_FORMAT_RED, blocker.message);
      console.log(CLI_FORMAT_DIM, `  ${blocker.link}`);
    }
    console.log("");
    console.log(CLI_FORMAT_RED, "Nothing was migrated");
    return;
  }

  for (const file of result.files) {
    if (file.error) {
      console.log(CLI_FORMAT_RED, file.filePath);
      console.log(CLI_FORMAT_RED, `  => Error: ${file.error}`);
    } else if (file.changes.length > 0) {
      if (options.diff && file.diff) process.stdout.write(file.diff);
      else console.log(`${write ? "Migrated " : ""}${file.filePath}: ${file.changes.join(", ")}`);
    }
  }

  const notes = result.files.filter((file) => file.notes.length > 0);
  if (notes.length > 0) {
    console.log("");
    console.log(CLI_FORMAT_YELLOW, "Needs you:");
    for (const file of notes) {
      for (const note of file.notes) {
        console.log(`  ${file.filePath}${note.path ? ` (${note.path})` : ""}`);
        console.log(`    ${note.message}`);
        console.log(CLI_FORMAT_DIM, `    ${note.link}`);
      }
    }
  }

  const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;
  console.log("");
  if (result.errors > 0)
    console.log(CLI_FORMAT_RED, `${files(result.errors)} could not be migrated`);
  if (result.migrated === 0) {
    console.log(CLI_FORMAT_GREEN, "✔ Nothing left to migrate");
  } else if (write) {
    console.log(CLI_FORMAT_GREEN, `✔ Migrated ${files(result.migrated)}`);
    console.log("Next: run lint, test and build, and review the changes before you commit them.");
  } else {
    const verb = result.migrated === 1 ? "needs" : "need";
    console.log(
      CLI_FORMAT_YELLOW,
      `${files(result.migrated)} ${verb} migrating. Run: npx featurevisor migrate`,
    );
  }
}

/** The command: 0 when done, 1 when --check finds files to migrate, and 2 on errors */
export async function runMigration(
  rootDirectoryPath: string,
  parsed: ParsedOptions,
): Promise<number> {
  const options: MigrateOptions = { check: parsed.check === true, diff: parsed.diff === true };
  const json = parsed.json === true;
  try {
    const result = migrateProject(rootDirectoryPath, options);
    if (json) {
      console.log(parsed.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    } else {
      printResult(result, options);
    }
    if (result.blockers.length > 0 || result.errors > 0) return 2;
    if (options.check && result.migrated > 0) return 1;
    return 0;
  } catch (error) {
    console.error(formatFeaturevisorCLIError(error, { json, pretty: parsed.pretty === true }));
    return 2;
  }
}
