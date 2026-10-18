import type { Scenario, Test, TestScenario } from "@featurevisor/types";
import type { Dependencies } from "../dependencies";
import { classifyTestSpec } from "../datasource/testSpecs";

/** Normalize authoring once so every CLI runner uses the same execution protocol. */
export function normalizeScenario(value: Scenario, key: string): TestScenario {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scenario must be an object");
  }
  if ("assertions" in value) {
    throw new Error("Scenarios use checks at the root, without assertions.");
  }
  if (!Array.isArray(value.checks) || !value.checks.length) {
    throw new Error("Scenarios require nonempty checks at the root");
  }
  const allowed = [
    "promotable",
    "description",
    "matrix",
    "environment",
    "target",
    "at",
    "context",
    "stickyFeatures",
    "stickyVariables",
    "checks",
    "children",
  ];
  for (const property of Object.keys(value)) {
    if (!allowed.includes(property)) throw new Error(`Unknown scenario property "${property}"`);
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children) || !value.children.length) {
      throw new Error("Scenario children must be a nonempty array");
    }
    for (const child of value.children) {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        throw new Error("Scenario child must be an object");
      }
      if ("assertions" in child) {
        throw new Error("Scenario children use checks, without assertions.");
      }
      if (!Array.isArray(child.checks) || !child.checks.length) {
        throw new Error("Scenario children require nonempty checks");
      }
      for (const property of Object.keys(child)) {
        if (
          !["description", "context", "stickyFeatures", "stickyVariables", "checks"].includes(
            property,
          )
        ) {
          throw new Error(`Unknown scenario child property "${property}"`);
        }
      }
    }
  }
  return scenarioToExecution(value, key);
}

/** Wrap the situation without renaming arbitrary context or sticky payload keys. */
export function scenarioToExecution(value: Scenario, key: string): TestScenario {
  const { promotable, ...assertion } = value;
  return { scenario: key, promotable, assertions: [assertion] };
}

/** Entity specs and scenario specs share one test run. */
export async function listTestSpecs(datasource: Dependencies["datasource"]): Promise<Test[]> {
  const result: Test[] = [];
  const testKeys = await datasource.listTests();
  const scenarioKeys = await datasource.listScenarios();
  const entityKeys = new Set(testKeys);
  for (const key of scenarioKeys) {
    if (entityKeys.has(key)) {
      throw new Error(
        `Test identity collision for "${key}": an entity test and scenario share a public key.`,
      );
    }
  }
  for (const key of testKeys) {
    const test = await datasource.readTest(key);
    classifyTestSpec(test);
    result.push({ ...test, key });
  }
  for (const key of scenarioKeys) {
    result.push({ ...normalizeScenario(await datasource.readScenario(key), key), key });
  }
  return result;
}
