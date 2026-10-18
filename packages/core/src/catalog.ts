import * as path from "path";
import { gzipSync } from "zlib";

import type { Target } from "@featurevisor/types";

import { buildTargetDatafile } from "./builder/buildProject";
import { resolveVariableOverrideValue } from "./builder/buildDatafile";
import { CONFIG_MODULE_NAME, getProjectConfig, type ProjectConfig } from "./config";
import { Datasource } from "./datasource";
import { buildDependencyGraph } from "./datasource/dependencies";
import { targetIncludesFeature, targetIncludesVariable } from "./targeting";

export async function getCatalogTargetMemberships(
  projectConfig: ProjectConfig,
  datasource: Datasource,
) {
  const environments: Array<string | false> = Array.isArray(projectConfig.environments)
    ? projectConfig.environments
    : [false];
  const memberships: Record<
    string,
    {
      features: string[];
      variables: string[];
      /** Segments the datafile carries, needed by its features and variables. */
      segments: string[];
      /** Members the Target does not select, held only because selected entities need them. */
      dependencyFeatures: string[];
      dependencyVariables: string[];
      /** Estimated size of each environment's datafile, formatted as the project configures. */
      datafiles: Array<{ environment: string | null; bytes: number; gzipBytes: number }>;
    }
  > = {};

  // Built once for every Target and environment, since it depends only on definitions.
  const dependencyGraph = await buildDependencyGraph(datasource);

  for (const targetKey of await datasource.listTargets()) {
    const target: Target = await datasource.readTarget(targetKey);
    const features = new Set<string>();
    const variables = new Set<string>();
    const segments = new Set<string>();
    const datafiles: Array<{ environment: string | null; bytes: number; gzipBytes: number }> = [];

    for (const environment of environments) {
      const datafile = await buildTargetDatafile({
        projectConfig,
        datasource,
        target,
        environment,
        existingState: await datasource.readState(environment),
        revision: "catalog",
        dependencyGraph,
      });

      // An estimate: the revision is synthetic, and hosts may compress differently. It does
      // follow the project's own datafile formatting.
      const serialized = Buffer.from(
        projectConfig.prettyDatafile ? JSON.stringify(datafile, null, 2) : JSON.stringify(datafile),
      );
      datafiles.push({
        environment: environment === false ? null : environment,
        bytes: serialized.byteLength,
        gzipBytes: gzipSync(serialized).byteLength,
      });

      Object.keys(datafile.features).forEach((key) => features.add(key));
      Object.keys(datafile.variables || {}).forEach((key) => variables.add(key));
      Object.keys(datafile.segments || {}).forEach((key) => segments.add(key));
    }

    const sorted = (values: Iterable<string>) =>
      Array.from(values).sort((left, right) => left.localeCompare(right));
    const dependencyFeatures: string[] = [];
    for (const key of features) {
      if (!targetIncludesFeature(target, key, await datasource.readFeature(key)))
        dependencyFeatures.push(key);
    }
    const dependencyVariables: string[] = [];
    for (const key of variables) {
      if (!targetIncludesVariable(target, key, await datasource.readVariable(key)))
        dependencyVariables.push(key);
    }

    memberships[targetKey] = {
      features: sorted(features),
      variables: sorted(variables),
      segments: sorted(segments),
      dependencyFeatures: sorted(dependencyFeatures),
      dependencyVariables: sorted(dependencyVariables),
      datafiles,
    };
  }

  return memberships;
}

export async function reloadCatalogProject(rootDirectoryPath: string) {
  const configModulePath = require.resolve(path.join(rootDirectoryPath, CONFIG_MODULE_NAME));
  delete require.cache[configModulePath];

  const projectConfig = getProjectConfig(rootDirectoryPath);
  return {
    projectConfig,
    datasource: new Datasource(projectConfig, rootDirectoryPath),
  };
}

/** Resolve one global override step for Catalog accumulation previews. */
export function resolveCatalogOverrideValue(variable: any, override: any, baseValue: any) {
  return resolveVariableOverrideValue(variable, override, baseValue);
}
