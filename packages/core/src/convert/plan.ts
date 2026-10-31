import * as fs from "node:fs";
import * as path from "node:path";

import { isMap, isSeq, Scalar, YAMLMap } from "yaml";
import type { Document, Node } from "yaml";
import type { EntityType } from "@featurevisor/types";

import { CONFIG_MODULE_NAME, getProjectConfigForSet } from "../config";
import { getExistingStateFilePath } from "../datasource/filesystemAdapter";
import type { Kind } from "../rewrite/files";
import { BUILT_IN_PARSERS, lineEndings, same } from "../rewrite/lines";
import { editConfig, quote } from "./config";
import {
  formatted,
  isFormatted,
  isSpaced,
  laneMap,
  load,
  nodeAt,
  render,
  rootMap,
  setKey,
  spreadLanes,
  takeLane,
} from "./documents";
import { directoriesOf, type DefinitionFile, type Project, type Shape } from "./project";
import { mergeSpecs, specForLane, specForLanes, specKind } from "./tests";
import { getFormatFelOptions } from "../formatter/fel";

export interface Plan {
  from: Project["shape"];
  to: Shape;
  /** The environments or sets, in order */
  lanes: string[];
  /** The lane a conversion to flat keeps */
  keep?: string;
  /** New contents by absolute path: definitions, specs, state and the configuration */
  writes: Map<string, string>;
  /** Absolute paths to delete */
  removes: Set<string>;
  /** featurevisor.config.js: what convert changes in it, or leaves for the user to change */
  config: ConfigPlan;
  /** What stops the conversion */
  conflicts: string[];
  /** What changes that is not a definition's meaning, or what a conversion to flat drops */
  differences: string[];
  /** What to change outside the project afterwards */
  next: string[];
}

const DIRECTORY_OPTIONS = [
  "attributesDirectoryPath",
  "schemasDirectoryPath",
  "segmentsDirectoryPath",
  "featuresDirectoryPath",
  "variablesDirectoryPath",
  "targetsDirectoryPath",
  "testsDirectoryPath",
];

/** The keys grouped by lane in each kind of definition */
const LANE_KEYS: Partial<Record<Kind, string[]>> = {
  feature: ["rules", "force", "expose"],
  variable: ["overrides"],
};

const SHARED: Kind[] = ["attribute", "schema", "segment", "target"];

/** featurevisor.config.js in a plan */
export interface ConfigPlan {
  /** What convert changed, or what the user changes by hand, as the summary says it */
  edits: string[];
  /** Settings the new shape cannot have */
  remove: string[];
  /** Settings the new shape adds, as JavaScript, with how the summary says it */
  add: [name: string, value: string | string[], says: string][];
  /** Why the user edits it after converting, when convert cannot */
  byHand?: string;
}

/** A change to featurevisor.config.js */
interface ConfigChange {
  /** Settings the new shape cannot have, which the file must set where convert can edit them */
  remove?: string[];
  /** Settings the new shape ignores, removed when the file sets them, with why when it helps */
  tidy?: [name: string, why?: string][];
  /** Settings to add, with how the summary says it */
  add?: ConfigPlan["add"];
}

/** Leaves the configuration for the user to change after converting, saying why */
export function leaveConfigByHand(config: ConfigPlan, reason: string) {
  config.byHand = reason;
  config.edits = [
    ...config.remove.map((name) => `removes ${name}`),
    ...config.add.map(([, , says]) => says),
  ];
}

/** The lanes a project without either gets, as init's example with environments has */
const DEFAULT_LANES = ["staging", "production"];

const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

class Builder {
  plan: Plan;
  /** Files whose aliases were written out in full */
  expanded = new Set<string>();
  /** Files of a custom format written as its parser writes them, which may lose comments */
  rewritten = new Set<string>();
  /** Whether fmt leaves each file as it is, asked once however many lanes it is written to */
  private wasFormatted = new Map<DefinitionFile, boolean>();
  private configPath: string;
  private configText?: string;

  constructor(
    private project: Project,
    from: Project["shape"],
    to: Shape,
    lanes: string[],
  ) {
    this.plan = {
      from,
      to,
      lanes,
      writes: new Map(),
      removes: new Set(),
      config: { edits: [], remove: [], add: [] },
      conflicts: [],
      differences: [],
      next: [],
    };
    this.configPath = path.join(project.rootDirectoryPath, CONFIG_MODULE_NAME);
  }

  get parser() {
    return this.project.parser;
  }

  /** How fmt formats this project's files, its FEL expressions included */
  get format() {
    return { fel: getFormatFelOptions(this.project.config) };
  }

  /** featurevisor.config.js as it is written */
  get configSource(): string {
    return (this.configText ??= fs.readFileSync(this.configPath, "utf8"));
  }

  relative(filePath: string) {
    return path.relative(this.project.rootDirectoryPath, filePath);
  }

  write(filePath: string, content: string) {
    this.plan.writes.set(filePath, content);
    this.plan.removes.delete(filePath);
  }

  /** Removes a file, when there is one */
  remove(filePath: string) {
    if (!this.plan.writes.has(filePath) && fs.existsSync(filePath)) this.plan.removes.add(filePath);
  }

  /** The directory of a kind at the top level, or in a set */
  directory(kind: Kind, set?: string): string {
    const config = set ? getProjectConfigForSet(this.project.config, set) : this.project.config;
    return directoriesOf(config)[kind];
  }

  /** The state file of a lane, as an environment or a set, or of a flat project */
  state(lane: string | undefined, as: Shape): string {
    const config = this.project.config;
    if (as === "sets")
      return getExistingStateFilePath(getProjectConfigForSet(config, lane!), false);
    return getExistingStateFilePath(config, as === "environments" ? lane! : false);
  }

  /** Moves or copies a state file, when there is one */
  moveState(from: string, to: string[]) {
    if (!fs.existsSync(from)) return;
    const content = fs.readFileSync(from, "utf8");
    this.remove(from);
    for (const target of to) this.write(target, content);
  }

  load(file: DefinitionFile): Document {
    const { doc, expanded } = load(file.source, this.parser);
    if (expanded) this.expanded.add(this.relative(file.filePath));
    return doc;
  }

  /**
   * The file's new text, or a conflict when it would not read back as converted. A file that
   * was formatted comes out formatted, so a project fmt keeps clean stays clean.
   */
  rendered(file: DefinitionFile, doc: Document): string {
    const result = render(file.source, doc, this.parser);
    if (!result) {
      this.plan.conflicts.push(
        `The ${file.kind} ${this.relative(file.filePath)} would not read back as converted.`,
      );
      return file.source;
    }
    if (!result.merged && !BUILT_IN_PARSERS.has(this.parser)) {
      this.rewritten.add(this.relative(file.filePath));
    }
    if (result.text === file.source) return result.text;

    // conversion moves assertions and lanes, never what kind of spec a file holds
    const entityType: EntityType =
      file.kind === "test" && specKind(file.value) === "scenario" ? "scenario" : file.kind;
    if (!this.wasFormatted.has(file)) {
      this.wasFormatted.set(file, isFormatted(entityType, file.source, this.parser, this.format));
    }
    return this.wasFormatted.get(file)
      ? formatted(entityType, result.text, this.parser, this.format)
      : result.text;
  }

  /**
   * Edits the configuration, and says what changed. When the file sets a setting the new shape
   * cannot have where convert cannot edit it, the file is left for the user to edit after
   * converting, and a setting the new shape only ignores is left where it is.
   */
  config({ remove = [], tidy = [], add = [] }: ConfigChange) {
    this.plan.config = { edits: [], remove, add };
    const { text, restore } = lineEndings(this.configSource);
    const result = editConfig(text, {
      remove: [...remove, ...tidy.map(([name]) => name)],
      add: add.map(([name, value]) => [name, value]),
    });
    const missing = remove.filter((name) => !result?.removed.includes(name));
    if (!result || missing.length > 0) {
      leaveConfigByHand(
        this.plan.config,
        result
          ? `it sets ${missing.join(" and ")} where convert cannot edit it, such as in an object spread into its settings`
          : "it does not set module.exports to an object convert can edit",
      );
      return;
    }
    this.write(this.configPath, restore(result.text));
    const removed = [...remove, ...tidy.filter(([, why]) => !why).map(([name]) => name)].filter(
      (name) => result.removed.includes(name),
    );
    this.plan.config.edits.push(
      ...(removed.length > 0 ? [`removes ${removed.join(" and ")}`] : []),
      ...add.map(([, , says]) => says),
      ...tidy
        .filter(([name, why]) => why && result.removed.includes(name))
        .map(([name, why]) => `removes ${name}, ${why}`),
    );
  }

  lanesValue() {
    return `[${this.plan.lanes.map((lane) => quote(this.configSource, lane)).join(", ")}]`;
  }

  /** One flow from each set to the next, on one line, or one per line when there are several */
  flowsValue(): string | string[] {
    const { lanes } = this.plan;
    const value = (lane: string) => quote(this.configSource, lane);
    const flows = lanes
      .slice(1)
      .map((to, index) => `{ from: ${value(lanes[index])}, to: ${value(to)} }`);
    return flows.length > 1 ? flows : `[${flows.join(", ")}]`;
  }

  /** Turns sets on, with promotions from each to the next, without settings sets ignore */
  configureSets(remove: string[]) {
    const { lanes } = this.plan;
    const add: ConfigChange["add"] = [["sets", "true", "adds sets: true"]];
    if (lanes.length > 1) {
      add.push(["promotionFlows", this.flowsValue(), `adds promotionFlows ${lanes.join(" to ")}`]);
    }
    this.config({
      remove,
      tidy: DIRECTORY_OPTIONS.map((name) => [name, "which does not apply inside sets"]),
      add,
    });
  }

  /** Says where datafiles go now, which applications must follow */
  moveDatafiles(where: string) {
    this.plan.next.push(
      `Datafiles move ${where}. Point applications at them, and clear datafiles/ before the next build.`,
    );
  }
}

/** Whether a segment depends on a feature or a variable, directly or through other segments */
function dependsOnEntities(key: string, segments: Map<string, unknown>, seen = new Set<string>()) {
  if (seen.has(key)) return false;
  seen.add(key);
  const visit = (value: unknown): boolean => {
    if (typeof value === "string")
      return segments.has(value) && dependsOnEntities(value, segments, seen);
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if ("feature" in record || "variable" in record) return true;
    return ["and", "or", "not"].some((group) => visit(record[group]));
  };
  return visit((segments.get(key) as { conditions?: unknown })?.conditions);
}

/** Segments by key, from their paths in the segments directory */
function segmentsOf(files: DefinitionFile[], extension: string, namespace: string) {
  return new Map(
    files
      .filter((file) => file.kind === "segment")
      .map((file) => [
        file.relative
          .slice(0, -(extension.length + 1))
          .split(path.sep)
          .join(namespace),
        file.value,
      ]),
  );
}

/** Whether a spec's assertions need an environment once the project has environments */
function needsEnvironment(value: unknown, segments: Map<string, unknown>): boolean {
  if (specKind(value) !== "segment") return true;
  return dependsOnEntities(String((value as { segment: string }).segment), segments);
}

// Environments to sets

function environmentsToSets(builder: Builder, project: Project) {
  const { lanes } = builder.plan;
  for (const file of project.files) {
    for (const lane of lanes) {
      const target = path.join(builder.directory(file.kind, lane), file.relative);
      if (SHARED.includes(file.kind)) {
        builder.write(target, file.source);
        continue;
      }
      const doc = builder.load(file);
      if (file.kind === "test") {
        const spec = specForLane(doc, lane);
        if (spec) builder.write(target, builder.rendered(file, spec));
        continue;
      }
      const map = rootMap(doc);
      if (map) {
        for (const key of LANE_KEYS[file.kind] || []) {
          // a feature with no rules in an environment keeps no rules in its set
          takeLane(map, key, lane, key === "rules" ? [] : undefined);
        }
      }
      builder.write(target, builder.rendered(file, doc));
    }
    builder.remove(file.filePath);
  }
  for (const lane of lanes) {
    builder.moveState(builder.state(lane, "environments"), [builder.state(lane, "sets")]);
  }
  builder.configureSets(["environments"]);
  builder.plan.next.push(
    "Pass --set=<name> where CI and scripts passed --environment=<name>. Applications load the same datafile paths.",
  );
}

// Sets to environments

/** The top level keys whose values differ between files, as `: a, b` */
function differingKeys(
  entries: DefinitionFile[],
  valueOf: (file: DefinitionFile) => unknown,
): string {
  const values = entries.map((file) => (valueOf(file) || {}) as Record<string, unknown>);
  const keys = [...new Set(values.flatMap((value) => Object.keys(value)))].filter(
    (key) => !values.every((value) => same(value[key], values[0][key])),
  );
  return keys.length > 0 ? `: ${keys.join(", ")}` : "";
}

function setsToEnvironments(builder: Builder, project: Project) {
  const { lanes } = builder.plan;
  const groups = new Map<string, DefinitionFile[]>();
  for (const file of project.files) {
    const id = `${file.kind}:${file.relative}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(file);
  }
  const byLane = (entries: DefinitionFile[]) =>
    lanes
      .map((lane) => entries.find((file) => file.set === lane))
      .filter(Boolean) as DefinitionFile[];
  const name = (file: DefinitionFile) => `${file.kind} ${file.relative}`;
  const segments = new Map<string, Map<string, unknown>>();
  const segmentsIn = (set: string) => {
    if (!segments.has(set)) {
      const inSet = project.files.filter((file) => file.set === set);
      segments.set(
        set,
        segmentsOf(inSet, project.parser.extension, project.config.namespaceCharacter),
      );
    }
    return segments.get(set)!;
  };

  for (const [, unordered] of groups) {
    const entries = byLane(unordered);
    const [first] = entries;
    const target = path.join(builder.directory(first.kind), first.relative);
    entries.forEach((file) => builder.remove(file.filePath));
    const setsOf = (list: DefinitionFile[]) => list.map((file) => file.set).join(", ");

    if (SHARED.includes(first.kind)) {
      if (!entries.every((file) => same(file.value, first.value))) {
        builder.plan.conflicts.push(
          `The ${name(first)} differs between sets ${setsOf(entries)}${differingKeys(entries, (file) => file.value)}.`,
        );
        continue;
      }
      if (first.kind === "target" && entries.length < lanes.length) {
        builder.plan.differences.push(
          `The target ${first.relative} is only in sets ${setsOf(entries)}, so every environment builds it.`,
        );
      }
      builder.write(target, first.source);
      continue;
    }

    if (first.kind === "test") {
      const merged = mergeSpecs(
        entries.map((file) => ({ lane: file.set!, doc: builder.load(file) })),
        lanes,
        needsEnvironment(first.value, segmentsIn(first.set!)),
      );
      if (merged.conflict) {
        builder.plan.conflicts.push(`The ${name(first)}: ${merged.conflict}.`);
        continue;
      }
      if (merged.renamed.length > 0) {
        builder.plan.differences.push(
          `Assertions in ${first.relative} sharing a key across sets got the sets' names after it: ${merged.renamed.join(", ")}.`,
        );
      }
      builder.write(target, builder.rendered(first, merged.doc!));
      continue;
    }

    const keys = LANE_KEYS[first.kind] || [];
    const outside = (file: DefinitionFile) =>
      Object.fromEntries(
        Object.entries(file.value as Record<string, unknown>).filter(
          ([key]) => !keys.includes(key),
        ),
      );
    if (!entries.every((file) => same(outside(file), outside(first)))) {
      builder.plan.conflicts.push(
        `The ${name(first)} differs between sets ${setsOf(entries)} outside its lanes${differingKeys(entries, outside)}.`,
      );
      continue;
    }
    if (first.kind === "variable" && entries.length < lanes.length) {
      builder.plan.conflicts.push(
        `The global variable ${first.relative} is only in sets ${setsOf(entries)}. With environments, it would reach every environment's datafiles.`,
      );
      continue;
    }

    const docs = new Map(entries.map((file) => [file.set!, builder.load(file)]));
    const doc = docs.get(first.set!)!;
    const map = rootMap(doc)!;
    const laneNode = (lane: string, key: string) => {
      const laneDoc = docs.get(lane);
      return laneDoc ? nodeAt(rootMap(laneDoc)!, key) : undefined;
    };
    for (const key of keys) {
      const values = lanes.map((lane): [string, Node | undefined] => {
        const node = laneNode(lane, key);
        // an empty list of rules is a lane left out
        if (key === "rules" && isSeq(node) && node.items.length === 0) return [lane, undefined];
        // a feature missing from a set leaves that environment's datafiles without it
        if (key === "expose" && !docs.has(lane)) return [lane, new Scalar(false)];
        return [lane, node];
      });
      const grouped = laneMap(values, isSpaced(map));
      if (key === "rules") setKey(map, key, grouped || new YAMLMap());
      else setKey(map, key, grouped, first.kind === "feature" ? ["rules", "force"] : undefined);
    }
    builder.write(target, builder.rendered(first, doc));
  }

  for (const lane of lanes) {
    builder.moveState(builder.state(lane, "sets"), [builder.state(lane, "environments")]);
  }
  builder.config({
    remove: ["sets"],
    tidy: [["promotionFlows"]],
    add: [["environments", builder.lanesValue(), `adds environments ${lanes.join(", ")}`]],
  });
  builder.plan.next.push(
    "Pass --environment=<name> where CI and scripts passed --set=<name>. Applications load the same datafile paths. Promotions need sets, so they end.",
  );
}

// Flat to environments or sets

function flatToEnvironments(builder: Builder, project: Project) {
  const { lanes } = builder.plan;
  const segments = segmentsOf(
    project.files,
    project.parser.extension,
    project.config.namespaceCharacter,
  );
  for (const file of project.files) {
    if (SHARED.includes(file.kind)) continue;
    const doc = builder.load(file);
    let result: Document = doc;
    if (file.kind === "test") {
      result = specForLanes(doc, lanes, needsEnvironment(file.value, segments));
    } else {
      const map = rootMap(doc);
      if (map) {
        for (const key of LANE_KEYS[file.kind] || []) spreadLanes(map, key, lanes, isSpaced(map));
      }
    }
    const output = builder.rendered(file, result);
    if (output !== file.source) builder.write(file.filePath, output);
  }
  builder.moveState(
    builder.state(undefined, "flat"),
    lanes.map((lane) => builder.state(lane, "environments")),
  );
  builder.config({
    add: [["environments", builder.lanesValue(), `adds environments ${lanes.join(", ")}`]],
  });
  builder.moveDatafiles(
    `to datafiles/<environment>/, such as datafiles/${lanes[lanes.length - 1]}/`,
  );
}

function flatToSets(builder: Builder, project: Project) {
  const { lanes } = builder.plan;
  for (const file of project.files) {
    for (const lane of lanes) {
      builder.write(path.join(builder.directory(file.kind, lane), file.relative), file.source);
    }
    builder.remove(file.filePath);
  }
  builder.moveState(
    builder.state(undefined, "flat"),
    lanes.map((lane) => builder.state(lane, "sets")),
  );
  builder.configureSets([]);
  builder.moveDatafiles(`to datafiles/<set>/, such as datafiles/${lanes[lanes.length - 1]}/`);
}

// Back to flat

function environmentsToFlat(builder: Builder, project: Project, keep: string) {
  const dropped = new Map<string, number>();
  for (const file of project.files) {
    if (SHARED.includes(file.kind)) continue;
    const doc = builder.load(file);
    let result: Document | undefined = doc;
    if (file.kind === "test") {
      result = specForLane(doc, keep);
      // assertions for the other environments, or a scenario for one of them
      const count = (value: unknown) => {
        const spec = (value || {}) as { assertions?: unknown[] };
        return Array.isArray(spec.assertions) ? spec.assertions.length : 1;
      };
      if (!result || count(result.toJS()) < count(file.value)) {
        dropped.set("test assertions", (dropped.get("test assertions") || 0) + 1);
      }
    } else {
      const map = rootMap(doc);
      for (const key of (map && LANE_KEYS[file.kind]) || []) {
        const lanes = map!.get(key);
        if (isMap(lanes) && lanes.items.length > (lanes.has(keep) ? 1 : 0)) {
          dropped.set(key, (dropped.get(key) || 0) + 1);
        }
        takeLane(map!, key, keep, key === "rules" ? [] : undefined);
      }
    }
    if (!result) builder.remove(file.filePath);
    else {
      const output = builder.rendered(file, result);
      if (output !== file.source) builder.write(file.filePath, output);
    }
  }
  const others = builder.plan.lanes.filter((lane) => lane !== keep);
  for (const lane of others) builder.remove(builder.state(lane, "environments"));
  builder.moveState(builder.state(keep, "environments"), [builder.state(undefined, "flat")]);
  for (const [what, count] of dropped) {
    builder.plan.differences.push(
      `Drops ${others.join(", ")} from ${what} in ${files(count)}, keeping ${keep}.`,
    );
  }
  builder.config({ remove: ["environments"] });
  builder.moveDatafiles(`from datafiles/${keep}/ to datafiles/`);
}

function setsToFlat(builder: Builder, project: Project, keep: string) {
  const counts = new Map<string, number>();
  for (const file of project.files) {
    builder.remove(file.filePath);
    if (file.set === keep) {
      builder.write(path.join(builder.directory(file.kind), file.relative), file.source);
    } else {
      counts.set(file.set!, (counts.get(file.set!) || 0) + 1);
    }
  }
  const others = builder.plan.lanes.filter((lane) => lane !== keep);
  for (const lane of others) builder.remove(builder.state(lane, "sets"));
  builder.moveState(builder.state(keep, "sets"), [builder.state(undefined, "flat")]);
  for (const [set, count] of counts) {
    builder.plan.differences.push(`Drops the set ${set}, ${files(count)}, keeping ${keep}.`);
  }
  builder.config({ remove: ["sets"], tidy: [["promotionFlows"]] });
  builder.moveDatafiles(`from datafiles/${keep}/ to datafiles/`);
}

export interface ConvertOptions {
  to: Shape;
  /** Lanes to create from a flat project, or the order of environments made from sets */
  lanes?: string[];
  keep?: string;
}

export function planConversion(project: Project, options: ConvertOptions): Plan {
  const from = project.shape;
  if (from === "sets and environments") {
    const plan = new Builder(project, from, options.to, []).plan;
    plan.conflicts.push(
      "This project uses sets and environments together. convert changes projects with one of them, or neither.",
    );
    return plan;
  }

  let lanes = from === "flat" ? options.lanes || DEFAULT_LANES : project.lanes;
  const builder = new Builder(project, from, options.to, lanes);
  const { plan } = builder;

  if (from === options.to) {
    plan.conflicts.push(
      `The project already has ${from === "flat" ? "no environments and no sets" : from}.`,
    );
    return plan;
  }
  if (from !== "flat" && options.lanes) {
    const given = [...options.lanes].sort();
    if (from === "sets" && options.to === "environments" && same(given, [...lanes].sort())) {
      lanes = plan.lanes = options.lanes;
    } else {
      plan.conflicts.push(
        from === "sets" && options.to === "environments"
          ? `--environments must list the sets, in the order you want: ${lanes.join(", ")}.`
          : `The project's ${from} name the lanes, so leave out --${from === "sets" ? "sets" : "environments"}.`,
      );
      return plan;
    }
  }
  if (new Set(lanes).size !== lanes.length || lanes.some((lane) => !/^[\w-]+$/.test(lane))) {
    plan.conflicts.push(
      `Lane names must be unique and use letters, numbers, _ or -: ${lanes.join(", ")}.`,
    );
    return plan;
  }
  if (options.to === "flat") {
    if (!options.keep || !lanes.includes(options.keep)) {
      plan.conflicts.push(`Name the lane to keep with --keep, one of: ${lanes.join(", ")}.`);
      return plan;
    }
    plan.keep = options.keep;
  } else if (options.keep) {
    plan.conflicts.push("--keep applies only to --to=flat.");
    return plan;
  }

  const conversions: Record<string, () => void> = {
    "environments:sets": () => environmentsToSets(builder, project),
    "sets:environments": () => setsToEnvironments(builder, project),
    "flat:environments": () => flatToEnvironments(builder, project),
    "flat:sets": () => flatToSets(builder, project),
    "environments:flat": () => environmentsToFlat(builder, project, options.keep!),
    "sets:flat": () => setsToFlat(builder, project, options.keep!),
  };
  conversions[`${from}:${options.to}`]();
  if (builder.rewritten.size > 0) {
    plan.differences.push(
      `${[...builder.rewritten].join(", ")} are written as the parser writes them, since convert could not keep their own lines. Check them for comments.`,
    );
  }
  if (builder.expanded.size > 0) {
    plan.differences.push(
      `Aliases are written out in full in ${[...builder.expanded].join(", ")}, since lanes no longer share them.`,
    );
  }
  return plan;
}
