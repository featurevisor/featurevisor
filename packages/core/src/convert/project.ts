import * as fs from "node:fs";
import * as path from "node:path";

import type { CustomParser } from "@featurevisor/parsers";

import { getProjectConfigForSet, type ProjectConfig } from "../config";
import { filesIn, KINDS, type Kind } from "../rewrite/files";

/** A project's shape: no environments and no sets, environments, or sets */
export type Shape = "flat" | "environments" | "sets";

export interface DefinitionFile {
  kind: Kind;
  /** The set it belongs to, in a project with sets */
  set?: string;
  /** Its path inside its kind's directory, such as `checkout/page.yml` */
  relative: string;
  filePath: string;
  source: string;
  value: unknown;
}

export interface Project {
  rootDirectoryPath: string;
  config: ProjectConfig;
  parser: CustomParser;
  shape: Shape | "sets and environments";
  /** The environments, or the sets in promotion order */
  lanes: string[];
  files: DefinitionFile[];
}

/** The sets, in the order promotions move through them when they form one chain */
export function orderSets(sets: string[], config: ProjectConfig): string[] {
  const flows = config.promotionFlows || [];
  const next = new Map(flows.map(({ from, to }) => [from, to]));
  const targets = new Set(flows.map(({ to }) => to));
  const starts = sets.filter((set) => next.has(set) && !targets.has(set));
  if (starts.length === 1) {
    const chain: string[] = [];
    for (
      let set: string | undefined = starts[0];
      set && !chain.includes(set);
      set = next.get(set)
    ) {
      chain.push(set);
    }
    if (chain.length === sets.length && chain.every((set) => sets.includes(set))) return chain;
  }
  return [...sets].sort();
}

/** The directories a project's definitions are in, by kind, for a set or the whole project */
export function directoriesOf(config: ProjectConfig): Record<Kind, string> {
  const directories = KINDS.map(([kind, key]) => [kind, config[key as keyof ProjectConfig]]);
  return Object.fromEntries(directories) as Record<Kind, string>;
}

export function readProject(rootDirectoryPath: string, config: ProjectConfig): Project {
  const parser = config.parser as CustomParser;
  const environments = Array.isArray(config.environments) ? config.environments : undefined;
  const sets =
    config.sets && fs.existsSync(config.setsDirectoryPath)
      ? fs
          .readdirSync(config.setsDirectoryPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
      : [];

  const shape: Project["shape"] = config.sets
    ? environments
      ? "sets and environments"
      : "sets"
    : environments
      ? "environments"
      : "flat";

  const roots = config.sets
    ? sets.map((set) => ({ set, config: getProjectConfigForSet(config, set) }))
    : [{ set: undefined, config }];

  const files: DefinitionFile[] = [];
  for (const root of roots) {
    const directories = directoriesOf(root.config);
    for (const [kind] of KINDS) {
      for (const filePath of filesIn(directories[kind], parser.extension)) {
        const source = fs.readFileSync(filePath, "utf8");
        files.push({
          kind,
          ...(root.set ? { set: root.set } : {}),
          relative: path.relative(directories[kind], filePath),
          filePath,
          source,
          value: parser.parse(source, filePath),
        });
      }
    }
  }

  return {
    rootDirectoryPath,
    config,
    parser,
    shape,
    lanes: shape === "sets" ? orderSets(sets, config) : environments || [],
    files,
  };
}
