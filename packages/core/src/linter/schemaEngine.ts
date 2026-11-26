import type { Featurevisor, FeaturevisorModule, FeaturevisorModuleApi } from "@featurevisor/sdk";
import type { Schema } from "@featurevisor/types";
import { createSchemas, type Schemas } from "@featurevisor/schemas";

/** The key the node being checked goes under, which no schema file can have. */
const NODE = "\u0000node";

interface Engine {
  entries: Record<string, unknown>;
  s: Schemas;
}

const engines = new WeakMap<object, Engine>();
const noSchemas: Record<string, Schema> = {};

/** Variables can be `json`, a string holding JSON, which schema files cannot. */
function withoutJson(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutJson);
  if (!node || typeof node !== "object") return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node))
    copy[key] = key === "type" && value === "json" ? "string" : withoutJson(value);
  return copy;
}

/**
 * The validator applications use, over a project's schemas as lint reads them.
 * It stands in for an SDK instance with only what the package reads: entries,
 * and conditions, which never match, so values meet a schema's base rules.
 */
function engineFor(schemasByKey: Record<string, Schema>): Engine {
  const existing = engines.get(schemasByKey);
  if (existing) return existing;
  const entries: Record<string, unknown> = { ...schemasByKey };
  const api = {
    getEntry: (section: string, key: string) =>
      section === "schemas" && Object.prototype.hasOwnProperty.call(entries, key)
        ? entries[key]
        : undefined,
    getEntryKeys: (section: string) => (section === "schemas" ? Object.keys(entries) : []),
    matchConditions: () => false,
    getRevision: () => "lint",
    reportDiagnostic: () => {},
  } as unknown as FeaturevisorModuleApi;
  const f = {
    addModule: (module: FeaturevisorModule) => module.setup?.(api),
    on: () => () => {},
    getContext: () => ({}),
  } as unknown as Featurevisor;
  const engine = { entries, s: createSchemas(f) };
  engines.set(schemasByKey, engine);
  return engine;
}

/**
 * Whether a value meets a schema node's rules, by `@featurevisor/schemas`'s own
 * engine, so lint and applications never answer otherwise. Mutations and issue
 * entries do not apply, since lint checks a schema's base rules.
 */
export function validatesWithEngine(
  node: unknown,
  value: unknown,
  schemasByKey: Record<string, Schema> = noSchemas,
): boolean {
  const engine = engineFor(schemasByKey);
  engine.entries[NODE] = withoutJson(node);
  try {
    return engine.s.isValid(NODE, value) === true;
  } catch {
    // A pattern that does not compile has an error of its own, so the value is not blamed.
    return true;
  } finally {
    delete engine.entries[NODE];
  }
}
