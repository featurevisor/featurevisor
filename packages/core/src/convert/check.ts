import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildProjectSets } from "../builder/buildProject";
import { CONFIG_MODULE_NAME, getProjectConfig, type ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject, type LintErrorItem } from "../linter/lintProject";
import { filesIn } from "../rewrite/files";
import { getProjectSetExecutions } from "../sets";
import { createTestReport } from "../tester/report";
import { testProject } from "../tester/testProject";
import { writeSetting } from "./config";
import { simplestConditions } from "../rewrite/conditions";
import { isConditionForm, leaveConfigByHand, type Plan } from "./plan";

/**
 * Converts a temporary copy of the project, then lints, builds and tests both. Every lane's
 * features and variables must build byte identical, and both test suites must pass, before
 * a conversion touches the project.
 */

export interface CheckResult {
  passed: boolean;
  problems: string[];
  lint?: number;
  tests?: { before: number; after: number };
  /** Lanes whose datafiles were compared, and datafiles the conversion adds */
  lanes: string[];
  added: string[];
  /**
   * Dependencies a lane's datafiles stop or start carrying. With environments, each
   * environment's datafile takes in what any environment's rules use, and a set's only what
   * the set uses.
   */
  carried: string[];
}

/** Applies a plan to a project at `root`, which may be a copy of the project it was made for */
export function applyPlan(plan: Plan, planRoot: string, root = planRoot) {
  const at = (filePath: string) => path.join(root, path.relative(planRoot, filePath));
  for (const [filePath, content] of plan.writes) {
    fs.mkdirSync(path.dirname(at(filePath)), { recursive: true });
    fs.writeFileSync(at(filePath), content);
  }
  const emptied = new Set<string>();
  for (const filePath of plan.removes) {
    if (!fs.existsSync(at(filePath))) continue;
    fs.rmSync(at(filePath));
    emptied.add(path.dirname(at(filePath)));
  }
  // directories the conversion emptied, up to the project's root
  for (let directory of [...emptied].sort((a, b) => b.length - a.length)) {
    while (directory.startsWith(root + path.sep) && fs.existsSync(directory)) {
      if (fs.readdirSync(directory).length > 0) break;
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
}

function nearestNodeModules(directory: string): string | undefined {
  for (let current = directory; ; current = path.dirname(current)) {
    const candidate = path.join(current, "node_modules");
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(current) === current) return undefined;
  }
}

function copyProject(root: string, config: ProjectConfig): string {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-convert-"));
  const skip = new Set([
    path.join(root, "node_modules"),
    path.join(root, ".git"),
    config.datafilesDirectoryPath,
    config.catalogDirectoryPath,
  ]);
  fs.cpSync(root, copy, { recursive: true, filter: (source) => !skip.has(source) });
  // configurations and custom parsers require packages from the project
  const modules = nearestNodeModules(root);
  if (modules) fs.symlinkSync(modules, path.join(copy, "node_modules"), "dir");
  return copy;
}

/** Whether a configuration's settings have the shape, or allow the conditions, a plan converts to */
function hasShape(
  config: { sets?: unknown; environments?: unknown; allowConditionExpressions?: unknown },
  plan: Plan,
): boolean {
  if (isConditionForm(plan.to)) {
    return (config.allowConditionExpressions === true) === (plan.to === "expressions");
  }
  return (
    (plan.to === "sets") === Boolean(config.sets) &&
    (plan.to === "environments") === Array.isArray(config.environments)
  );
}

/**
 * The settings a configuration's text exports, read beside the copy's own under a name nothing
 * has required yet, so the copy's configuration is required once, in its final form
 */
function settingsOf(copy: string, text: string): Record<string, unknown> {
  const probe = path.join(copy, `featurevisor.config.probe-${Date.now()}.js`);
  fs.writeFileSync(probe, text);
  try {
    return require(probe);
  } finally {
    fs.rmSync(probe);
  }
}

/**
 * Gives a copy the configuration the user is asked to write by hand: the project's own, with the
 * new shape's settings over it, so the converted definitions can be checked before the user
 * edits anything
 */
function writeConfigByHand(root: string, copy: string, plan: Plan) {
  const own = "featurevisor.config.before-convert.js";
  fs.copyFileSync(path.join(root, CONFIG_MODULE_NAME), path.join(copy, own));
  const settings = [
    ...plan.config.remove.map((name) => `  ${name}: undefined,`),
    ...plan.config.add.map(([name, value]) => writeSetting(name, value)),
  ];
  fs.writeFileSync(
    path.join(copy, CONFIG_MODULE_NAME),
    `module.exports = {\n  ...require("./${own}"),\n${settings.join("\n")}\n};\n`,
  );
}

/** Runs `work` without the output of the commands it calls */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const { log, warn, info } = console;
  const write = process.stdout.write;
  console.log = console.warn = console.info = () => undefined;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await work();
  } finally {
    Object.assign(console, { log, warn, info });
    process.stdout.write = write;
  }
}

function dependencies(root: string, config: ProjectConfig) {
  return {
    rootDirectoryPath: root,
    projectConfig: config,
    datasource: new Datasource(config, root),
    options: {},
  };
}

/** Each set of a project with sets, or the whole project, as lint and test run them */
async function executions(root: string, config: ProjectConfig) {
  const { datasource } = dependencies(root, config);
  return (await getProjectSetExecutions(config, datasource)).map((execution) => ({
    set: execution.set,
    deps: { ...dependencies(root, execution.projectConfig), datasource: execution.datasource },
  }));
}

async function lintAll(root: string, config: ProjectConfig): Promise<LintErrorItem[]> {
  const errors: LintErrorItem[] = [];
  for (const { deps } of await executions(root, config)) {
    errors.push(...(await lintProject(deps, { json: true })).errors);
  }
  return errors;
}

async function runTests(root: string, config: ProjectConfig) {
  const report = createTestReport();
  let failed = false;
  for (const { set, deps } of await executions(root, config)) {
    const options = { quiet: true, onlyFailures: true, report, set: set || null };
    failed = (await testProject({ ...deps, options }, options)) || failed;
  }
  return { failed, cases: report.summary.assertions.passed + report.summary.assertions.failed };
}

/** The datafiles built under a directory, by their paths in it */
function datafilesIn(directory: string): string[] {
  return filesIn(directory, "json").map((filePath) => path.relative(directory, filePath));
}

const ENTRIES = ["features", "segments", "variables"];

/**
 * A datafile entry with every `conditions` value in its simplest form and without its hash,
 * for comparing entries whose conditions were simplified: two entries that evaluate the same
 * are equal in this form. Conditions a datafile stores as JSON text are read first.
 */
function simplestEntry(value: unknown, key?: string): unknown {
  if (key === "conditions") {
    const conditions = typeof value === "string" && /^[[{]/.test(value) ? JSON.parse(value) : value;
    return simplestConditions(conditions);
  }
  if (Array.isArray(value)) return value.map((item) => simplestEntry(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== "hash")
      .map(([name, item]) => [name, simplestEntry(item, name)]),
  );
}

/**
 * What differs between two datafiles of a lane. An entry both have must be byte identical, or
 * evaluate the same when the conversion simplified conditions. An entry only one has may be a
 * dependency of another lane's rules, which `isCarried` decides.
 */
function compareDatafiles(
  before: Record<string, any>,
  after: Record<string, any>,
  simplified = false,
) {
  const same = (a: unknown, b: unknown) =>
    simplified
      ? JSON.stringify(simplestEntry(a)) === JSON.stringify(simplestEntry(b))
      : JSON.stringify(a) === JSON.stringify(b);
  const problems: string[] = [];
  const fewer: string[] = [];
  const more: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!ENTRIES.includes(key)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) problems.push(key);
      continue;
    }
    const a = before[key] || {};
    const b = after[key] || {};
    const kind = key.slice(0, -1);
    for (const entry of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(entry in b)) fewer.push(`${kind} ${entry}`);
      else if (!(entry in a)) more.push(`${kind} ${entry}`);
      else if (!same(a[entry], b[entry])) problems.push(`${kind} ${entry}`);
    }
  }
  return { problems, fewer, more };
}

/**
 * Whether an entry only one side's datafile has is a dependency of another lane's rules. An
 * environment's datafiles carry what any environment's rules use, so such an entry comes or goes
 * between environments and sets. A segment is read only through the entries that name it, and a
 * build takes in every segment they name, so one that comes or goes changes no evaluation. A
 * feature or global variable can be read directly, so it must be named by some other entry in
 * another lane's datafile. Any other that comes or goes is a fault in the conversion.
 */
function isCarried(entry: string, file: string, otherLanes: string[]): boolean {
  const [kind, key] = [entry.slice(0, entry.indexOf(" ")), entry.slice(entry.indexOf(" ") + 1)];
  if (kind === "segment") return true;
  // conditions are JSON within the datafile's JSON, so a key is named in either quoting
  const named = [JSON.stringify(key), JSON.stringify(JSON.stringify(key)).slice(1, -1)];
  return otherLanes.some((directory) => {
    const filePath = path.join(directory, file);
    if (!fs.existsSync(filePath)) return false;
    const datafile = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return ENTRIES.some((group) =>
      Object.entries(datafile[group] || {}).some(
        ([other, value]) =>
          !(group === `${kind}s` && other === key) &&
          named.some((name) => JSON.stringify(value).includes(name)),
      ),
    );
  });
}

/**
 * Checks a plan on a converted copy. When convert's edits to the configuration leave it in the
 * old shape, the plan leaves the file for the user to edit, and the copy is checked as if they
 * had.
 */
export async function checkPlan(
  plan: Plan,
  root: string,
  config: ProjectConfig,
): Promise<CheckResult> {
  const result: CheckResult = {
    passed: false,
    problems: [],
    lanes: [],
    added: [],
    carried: [],
  };
  const outside = [...plan.writes.keys(), ...plan.removes].find(
    (filePath) => !filePath.startsWith(root + path.sep),
  );
  if (outside) {
    result.problems.push(`${outside} is outside the project, so convert cannot check it.`);
    return result;
  }

  const copy = copyProject(root, config);
  const builds = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-convert-datafiles-"));
  try {
    return await quietly(async () => {
      // expressions written back as trees are checked as if the project still allowed them
      const lintBefore = await lintAll(
        root,
        plan.to === "trees" ? { ...config, allowConditionExpressions: true } : config,
      );
      if (lintBefore.length > 0) {
        result.problems.push(
          `Lint reports ${lintBefore.length} errors before converting. Fix them first, so the conversion can be checked.`,
        );
        return result;
      }
      const testsBefore = await runTests(root, config);
      if (testsBefore.failed) {
        result.problems.push(
          "Tests fail before converting. Fix them first, so the conversion can be checked.",
        );
        return result;
      }

      applyPlan(plan, root, copy);
      const edited = plan.writes.get(path.join(root, CONFIG_MODULE_NAME));
      let converted: ProjectConfig;
      try {
        // a file convert's edits leave in the old shape is one for the user to edit, as is one
        // convert could not edit at all
        if (edited !== undefined && !hasShape(settingsOf(copy, edited), plan)) {
          leaveConfigByHand(
            plan.config,
            "its settings still give the old shape after convert's edits",
          );
          plan.writes.delete(path.join(root, CONFIG_MODULE_NAME));
        }
        if (plan.config.byHand) writeConfigByHand(root, copy, plan);
        converted = getProjectConfig(copy);
      } catch (error) {
        result.problems.push(
          `The converted configuration does not load: ${(error as Error).message}`,
        );
        return result;
      }
      if (!hasShape(converted, plan)) {
        result.problems.push(
          `${CONFIG_MODULE_NAME} keeps the old shape even with the new shape's settings over it, so convert cannot check the conversion.`,
        );
        return result;
      }

      const options = { revision: "convert", stateFiles: false };
      const beforeDir = path.join(builds, "before");
      const afterDir = path.join(builds, "after");
      try {
        const lintAfter = await lintAll(copy, converted);
        result.lint = lintAfter.length;
        for (const error of lintAfter.slice(0, 10)) {
          result.problems.push(
            `Lint after converting: ${path.relative(copy, path.resolve(copy, error.filePath))} ${error.path.join(".")}: ${error.message}`,
          );
        }
        // tests and builds of a project lint rejects say nothing more
        if (lintAfter.length > 0) return result;

        const testsAfter = await runTests(copy, converted);
        result.tests = { before: testsBefore.cases, after: testsAfter.cases };
        if (testsAfter.failed) result.problems.push("Tests fail after converting.");

        await buildProjectSets(dependencies(root, config), { ...options, datafilesDir: beforeDir });
        await buildProjectSets(dependencies(copy, converted), {
          ...options,
          datafilesDir: afterDir,
        });
      } catch (error) {
        // a converted project that cannot even be read is a fault in the conversion
        result.problems.push(`The converted project fails: ${(error as Error).message}`);
        return result;
      }

      // conditions written another way keep every datafile where it was
      const pairs: [string, string, string][] = isConditionForm(plan.to)
        ? [["", beforeDir, afterDir]]
        : plan.from === "flat"
          ? plan.lanes.map((lane) => [lane, beforeDir, path.join(afterDir, lane)])
          : plan.to === "flat"
            ? [[plan.keep!, path.join(beforeDir, plan.keep!), afterDir]]
            : plan.lanes.map((lane) => [
                lane,
                path.join(beforeDir, lane),
                path.join(afterDir, lane),
              ]);
      // each lane's datafiles in the shape that has lanes, before and after
      const laneDirectories = (shape: Plan["from"], directory: string, except: string) =>
        shape === "flat"
          ? []
          : plan.lanes.filter((lane) => lane !== except).map((lane) => path.join(directory, lane));
      for (const [lane, before, after] of pairs) {
        if (lane) result.lanes.push(lane);
        const at = (file: string) => (lane ? `${lane}: ${file}` : file);
        // conditions written another way change no lane, so nothing comes or goes
        const carries = (entry: string, file: string, directories: string[]) =>
          !isConditionForm(plan.to) && isCarried(entry, file, directories);
        const fewer = new Set<string>();
        const more = new Set<string>();
        const beforeFiles = datafilesIn(before);
        const afterFiles = datafilesIn(after);
        for (const file of beforeFiles) {
          if (!afterFiles.includes(file)) {
            result.problems.push(`${at(file)} is no longer built.`);
            continue;
          }
          const read = (directory: string) =>
            JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
          const compared = compareDatafiles(read(before), read(after), Boolean(plan.simplified));
          for (const problem of compared.problems) {
            result.problems.push(`${at(file)} changes the ${problem}.`);
          }
          for (const entry of compared.fewer) {
            if (carries(entry, file, laneDirectories(plan.from, beforeDir, lane))) fewer.add(entry);
            else result.problems.push(`${at(file)} no longer has the ${entry}.`);
          }
          for (const entry of compared.more) {
            if (carries(entry, file, laneDirectories(plan.to, afterDir, lane))) more.add(entry);
            else result.problems.push(`${at(file)} now has the ${entry}.`);
          }
        }
        if (fewer.size > 0) {
          result.carried.push(
            `${lane} datafiles no longer carry ${[...fewer].sort().join(", ")}, which only other lanes' rules use.`,
          );
        }
        if (more.size > 0) {
          result.carried.push(
            `${lane} datafiles now also carry ${[...more].sort().join(", ")}, which other lanes' rules use.`,
          );
        }
        for (const file of afterFiles) {
          if (!beforeFiles.includes(file)) result.added.push(lane ? `${lane}/${file}` : file);
        }
      }

      result.passed = result.problems.length === 0;
      return result;
    });
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(builds, { recursive: true, force: true });
  }
}
