import * as path from "path";

import { toExpressions } from "@featurevisor/expressions";
import type { EntityType } from "@featurevisor/types";

import { getProjectConfig, type ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { visitConditionLocations } from "../datasource/conditionLocations";
import { FilesystemAdapter } from "../datasource/filesystemAdapter";
import { getConditionExpressions } from "../datasource/expressions";
import { buildTargetDatafile } from "./buildProject";

const rootDirectoryPath = path.resolve(__dirname, "../../../../examples/example-1");

function setAtPath(root: unknown, at: (string | number)[], value: unknown): unknown {
  if (at.length === 0) return value;
  const [head, ...rest] = at;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAtPath(root[head as number], rest, value);
    return copy;
  }
  const record = root as Record<string, unknown>;
  return { ...record, [head]: setAtPath(record[head as string], rest, value) };
}

/** Reads Example 1 as if every condition had been written as an expression. */
function expressionAdapter(exact: boolean) {
  return class extends FilesystemAdapter {
    async readEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
      const entity = await super.readEntity<T>(entityType, entityKey);
      if (entityType !== "feature" && entityType !== "segment" && entityType !== "variable") {
        return entity;
      }
      let result: unknown = entity;
      visitConditionLocations(entityType, entity, (_location, conditions, at) => {
        if (conditions !== undefined) {
          result = setAtPath(result, at, toExpressions(conditions as never, { exact }));
        }
      });
      return result as T;
    }
  };
}

/** Trees in a form where equal meanings compare equal, as the printer's meaning mode reads them. */
function meaning(value: unknown, root = false): unknown {
  const isObject = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  if (root && isObject(value) && Object.keys(value).length === 1 && Array.isArray(value.and)) {
    return meaning(value.and, true);
  }
  if (root && Array.isArray(value) && value.length === 1) return meaning(value[0]);
  if (Array.isArray(value)) return value.map((item) => meaning(item));
  if (!isObject(value)) return value;
  const not = value.not;
  if (
    Array.isArray(not) &&
    not.length === 1 &&
    isObject(not[0]) &&
    Object.keys(not[0]).length === 1 &&
    Array.isArray(not[0].and)
  ) {
    return { not: (not[0].and as unknown[]).map((item) => meaning(item)) };
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "hash") continue;
    if (key === "enabled" && value.enabled === true && "variation" in value) continue;
    const child = value[key];
    if (key === "conditions" && typeof child === "string" && /^[[{]/.test(child)) {
      result[key] = meaning(JSON.parse(child), true);
    } else result[key] = meaning(child, key === "conditions");
  }
  return result;
}

async function buildAll(projectConfig: ProjectConfig, datasource: Datasource) {
  const datafiles: Record<string, unknown> = {};
  for (const targetKey of await datasource.listTargets()) {
    const target = await datasource.readTarget(targetKey);
    for (const environment of projectConfig.environments as string[]) {
      datafiles[`${environment}/${targetKey}`] = await buildTargetDatafile({
        projectConfig,
        datasource,
        target,
        environment,
        existingState: await datasource.readState(environment),
        revision: "expressions",
      });
    }
  }
  return datafiles;
}

describe("Example 1 written as expressions", () => {
  const projectConfig = { ...getProjectConfig(rootDirectoryPath), plugins: [] };
  let trees: Record<string, unknown>;

  beforeAll(async () => {
    trees = await buildAll(projectConfig, new Datasource(projectConfig, rootDirectoryPath));
  });

  it("builds byte identical datafiles when converted exactly", async () => {
    const config = { ...projectConfig, adapter: expressionAdapter(true) };
    const datasource = new Datasource(config, rootDirectoryPath);
    let expressions = 0;
    for (const key of await datasource.listFeatures()) {
      expressions += getConditionExpressions(await datasource.readFeature(key)).length;
    }
    for (const key of await datasource.listSegments()) {
      expressions += getConditionExpressions(await datasource.readSegment(key)).length;
    }
    for (const key of await datasource.listVariables()) {
      expressions += getConditionExpressions(await datasource.readVariable(key)).length;
    }
    expect(expressions).toBeGreaterThan(90);

    const built = await buildAll(config, datasource);
    expect(Object.keys(built)).toEqual(Object.keys(trees));
    for (const key of Object.keys(trees)) {
      expect(JSON.stringify(built[key])).toBe(JSON.stringify(trees[key]));
    }
  });

  it("builds datafiles that mean the same when converted by meaning", async () => {
    const config = { ...projectConfig, adapter: expressionAdapter(false) };
    const built = await buildAll(config, new Datasource(config, rootDirectoryPath));
    for (const key of Object.keys(trees)) {
      expect(meaning(built[key])).toEqual(meaning(trees[key]));
    }
  });
});
