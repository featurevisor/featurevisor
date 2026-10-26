import type { Target } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
import { buildTargetDatafile } from "../builder/buildProject";
import { resolveBuildEnvironments } from "../builder/environments";
import { convertDatafileToSchemaV2, SCHEMA_V2 } from "../builder/schemaV2";
import type { SchemaV2Issue } from "../builder/schemaV2";

export interface SchemaV2TargetIssue extends SchemaV2Issue {
  targets: string[];
  environments: string[];
}

/**
 * Definitions that a schemaVersion "2" target would carry but cannot express.
 * Only those targets are built, so a project without one pays nothing.
 */
export async function findSchemaV2TargetIssues(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  targets: Array<Target & { key: string }>,
): Promise<SchemaV2TargetIssue[]> {
  const selected = targets.filter((target) => target.schemaVersion === SCHEMA_V2);
  if (!selected.length) return [];

  const found = new Map<string, SchemaV2TargetIssue>();
  for (const environment of resolveBuildEnvironments(projectConfig, undefined)) {
    const existingState = await datasource.readState(environment);
    for (const target of selected) {
      let datafile;
      try {
        datafile = await buildTargetDatafile({
          projectConfig,
          datasource,
          target: { ...target, schemaVersion: undefined },
          environment,
          existingState,
          revision: "lint",
        });
      } catch {
        // Other checks report why this target cannot build.
        continue;
      }
      const { issues } = convertDatafileToSchemaV2(datafile, {
        stringify: projectConfig.stringify,
      });
      for (const issue of issues) {
        const id = JSON.stringify([issue.entityType, issue.key, issue.location, issue.reason]);
        const entry = found.get(id) || { ...issue, targets: [], environments: [] };
        if (!entry.targets.includes(target.key)) entry.targets.push(target.key);
        if (environment !== false && !entry.environments.includes(environment)) {
          entry.environments.push(environment);
        }
        found.set(id, entry);
      }
    }
  }

  return [...found.values()];
}

export function describeSchemaV2TargetIssue(issue: SchemaV2TargetIssue): string {
  const names = issue.targets.map((key) => `"${key}"`);
  const targets =
    names.length === 1
      ? `Target ${names[0]} sets`
      : `Targets ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} set`;
  const environments = issue.environments.length
    ? ` in ${issue.environments.length === 1 ? "environment" : "environments"} ${issue.environments.join(", ")}`
    : "";
  return `${issue.location[0].toUpperCase()}${issue.location.slice(1)} ${issue.reason}. ${targets} schemaVersion "2"${environments}, so keep this ${issue.entityType} out of ${names.length === 1 ? "it" : "them"} or write it in a form schema version "2" supports.`;
}
