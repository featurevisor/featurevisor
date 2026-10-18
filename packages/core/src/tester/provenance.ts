import { createHash } from "node:crypto";
import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
import { getExistingStateFilePath } from "../datasource/filesystemAdapter";

/** Exact allocation inputs only, excluding revision files and generated output. */
export function getTestInputStatePaths(projectConfig: ProjectConfig): string[] {
  const environments: Array<string | false> = projectConfig.environments || [false];
  return environments.map((environment) => getExistingStateFilePath(projectConfig, environment));
}

export interface TestInputProvenance {
  version: 1;
  algorithm: "sha256";
  sets: Array<{ set: string | null; fingerprint: string }>;
}

const entities = [
  ["Features", "Feature"],
  ["Segments", "Segment"],
  ["Attributes", "Attribute"],
  ["Schemas", "Schema"],
  ["Variables", "Variable"],
  ["Targets", "Target"],
  ["Tests", "Test"],
  ["Scenarios", "Scenario"],
] as const;

const sharedReads = /^read(?:Feature|Segment|Attribute|Variable|Schema|Target|Test|Scenario)$/;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Keep report hashing and execution on the same owned input values. */
export function createTestInputSnapshot(datasource: Datasource): Datasource {
  const cache = new Map<string, Promise<unknown>>();
  return new Proxy(datasource, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (typeof property !== "string" || !/^(read|list|\w+Exists$)/.test(property))
          return Reflect.apply(value, receiver, args);
        const key = JSON.stringify([property, args]);
        // Definitions are owned once, then shared read only. A run reads
        // the same definitions for every assertion, and cloning each read dominated
        // large runs. Other reads, such as build state and lists, stay cloned.
        const shared = sharedReads.test(property);
        if (!cache.has(key)) {
          cache.set(
            key,
            Promise.resolve()
              .then(() => Reflect.apply(value, receiver, args))
              .then((result) =>
                shared ? deepFreeze(structuredClone(result)) : structuredClone(result),
              ),
          );
        }
        return shared ? cache.get(key)! : cache.get(key)!.then((result) => structuredClone(result));
      };
    },
  });
}

/**
 * Hash effective authored inputs once per Set, not once per target or case.
 * Paths, parsers and adapters are transport; their parsed results are hashed.
 * Object order inside definitions is retained because matrix order defines case IDs.
 * This is input equality, not a signature or proof of runner authenticity.
 */
export async function getTestInputFingerprint(
  projectConfig: ProjectConfig,
  datasource: Datasource,
): Promise<string> {
  const hash = createHash("sha256");
  const add = (value: unknown) => hash.update(JSON.stringify(value)).update("\n");
  add("featurevisor-test-inputs-v1");
  const omitted = new Set([
    "adapter",
    "parser",
    "plugins",
    "prettyState",
    "prettyDatafile",
    "datafileNamePattern",
    "revisionFileName",
  ]);
  add(
    Object.fromEntries(
      Object.entries(projectConfig)
        .filter(([key]) => !key.endsWith("DirectoryPath") && !omitted.has(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  for (const [plural, singular] of entities) {
    const keys: string[] = await (datasource as any)[`list${plural}`]();
    add([plural, [...keys].sort()]);
    for (const key of [...keys].sort()) {
      try {
        add([key, await (datasource as any)[`read${singular}`](key)]);
      } catch (error) {
        throw new Error(
          `Could not read ${singular.toLowerCase()} "${key}" for test report provenance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const environments: Array<string | false> = projectConfig.environments || [false];
  for (const environment of environments) {
    add(["state", environment, await datasource.readState(environment)]);
  }
  return hash.digest("hex");
}
