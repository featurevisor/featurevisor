import type { TestEntityType } from "@featurevisor/types";

const owners = ["feature", "segment", "variable"] as const;

export function testSpecKeyFromStorageKey(key: string): string {
  return key.endsWith(".spec") ? key.slice(0, -5) : key;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// Discovery leaves malformed entity specs available for individual validation.
export function isScenarioSpec(value: unknown): boolean {
  return (
    isObject(value) && hasOwn(value, "checks") && !owners.some((owner) => hasOwn(value, owner))
  );
}

// This validates root ownership only. The selected schema validates the contents.
export function classifyTestSpec(value: unknown): TestEntityType {
  if (!isObject(value)) {
    throw new Error("Test spec must be an object");
  }

  const presentOwners = owners.filter((owner) => hasOwn(value, owner));
  if (presentOwners.length > 1) {
    throw new Error("Test spec must have exactly one root owner: feature, segment or variable");
  }
  if (presentOwners.length === 1) {
    if (hasOwn(value, "checks")) {
      throw new Error("Entity test specs cannot contain root checks; use assertions instead");
    }
    return presentOwners[0];
  }
  if (isScenarioSpec(value)) {
    return "scenario";
  }
  throw new Error("Test spec must have a root feature, segment or variable, or scenario checks");
}
