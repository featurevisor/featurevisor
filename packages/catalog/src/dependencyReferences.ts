import type { CatalogEntityType, DependencyCheck, DirectDependency } from "./types";

/** One reference an entity authors, with where it sits and what it reads. */
export interface AuthoredReference {
  type: CatalogEntityType;
  key: string;
  location: string;
  check?: Omit<DependencyCheck, "location">;
}

/** "rules › production › eu (inside OR)", the path to a reference and the groups around it. */
export function joinUsageLocation(parts: Array<string | undefined>, operators: string[]) {
  const location = parts.filter((part): part is string => Boolean(part)).join(" › ");
  const groups = operators.map((operator) => operator.toUpperCase()).join(" › ");

  return groups ? `${location} (inside ${groups})` : location;
}

export function walkLogicalTree(
  value: unknown,
  operators: string[],
  visitLeaf: (leaf: unknown, operators: string[]) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkLogicalTree(item, operators, visitLeaf));
    return;
  }

  if (value && typeof value === "object") {
    for (const operator of ["and", "or", "not"]) {
      if (operator in (value as Record<string, unknown>)) {
        walkLogicalTree(
          (value as Record<string, unknown>)[operator],
          [...operators, operator],
          visitLeaf,
        );
        return;
      }
    }
  }

  visitLeaf(value, operators);
}

function byEnvironment(value: unknown): Array<[string | undefined, unknown[]]> {
  if (Array.isArray(value)) return [[undefined, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).map(([environment, rows]) => [
      environment,
      Array.isArray(rows) ? rows : [],
    ]);
  }
  return [];
}

/**
 * Every segment, attribute, feature and global variable an entity refers to, down to the
 * rule, force entry, override path or composition property that does. The exporter builds
 * usage from this, and detail pages read their own dependencies with it, so both agree.
 */
export function collectAuthoredReferences(
  type: CatalogEntityType,
  entity: Record<string, unknown>,
): AuthoredReference[] {
  const references: AuthoredReference[] = [];
  const add = (
    referenceType: CatalogEntityType,
    key: string,
    location: string,
    check?: AuthoredReference["check"],
  ) => references.push({ type: referenceType, key, location, ...(check ? { check } : {}) });

  const addConditions = (value: unknown, parts: Array<string | undefined>) => {
    walkLogicalTree(value, [], (leaf, operators) => {
      const location = joinUsageLocation(parts, operators);
      if (typeof leaf === "string") {
        if (leaf !== "*") add("segment", leaf, location);
        return;
      }
      if (!leaf || typeof leaf !== "object") return;
      const node = leaf as Record<string, unknown>;
      if (typeof node.attribute === "string")
        add("attribute", node.attribute.split(".")[0], location);
      else if (typeof node.feature === "string")
        add(
          "feature",
          node.feature,
          typeof node.variable === "string"
            ? joinUsageLocation([...parts, `variable ${node.variable}`], operators)
            : location,
          { condition: { ...node } },
        );
      else if (typeof node.variable === "string")
        add("variable", node.variable, location, { condition: { ...node } });
    });
  };

  const addFeatureVariableOverrides = (value: unknown, parts: Array<string | undefined>) => {
    for (const [variableKey, overrides] of Object.entries(
      (value || {}) as Record<string, unknown>,
    )) {
      (Array.isArray(overrides) ? overrides : []).forEach((override, index) => {
        const record = (override || {}) as Record<string, unknown>;
        addConditions(record.conditions, [
          ...parts,
          `variable ${variableKey}`,
          typeof record.key === "string" ? record.key : `#${index + 1}`,
        ]);
      });
    }
  };

  if (type === "feature") {
    walkLogicalTree(entity.bucketBy, [], (leaf) => {
      if (typeof leaf === "string") add("attribute", leaf.split(".")[0], "bucketBy");
    });
    addConditions(entity.conditions, ["conditions"]);

    for (const [environment, rules] of byEnvironment(entity.rules)) {
      rules.forEach((rule, index) => {
        const row = (rule || {}) as Record<string, unknown>;
        const ruleParts = [
          "rules",
          environment,
          typeof row.key === "string" ? row.key : `#${index + 1}`,
        ];
        addConditions(row.conditions, ruleParts);
        addFeatureVariableOverrides(row.variableOverrides, [...ruleParts, "variable overrides"]);
      });
    }

    for (const [environment, entries] of byEnvironment(entity.force)) {
      entries.forEach((entry, index) => {
        const row = (entry || {}) as Record<string, unknown>;
        addConditions(row.conditions, ["force", environment, `#${index + 1}`]);
      });
    }

    for (const variation of Array.isArray(entity.variations) ? entity.variations : []) {
      const variationRecord = (variation || {}) as Record<string, unknown>;
      addFeatureVariableOverrides(variationRecord.variableOverrides, [
        `variation ${String(variationRecord.value)}`,
        "variable overrides",
      ]);
    }
  } else if (type === "variable") {
    const compose = entity.compose;
    if (typeof compose === "string")
      add("variable", compose, `alias of ${compose}`, { compose: {} });
    for (const [alias, value] of Object.entries(
      compose && typeof compose === "object" ? (compose as Record<string, unknown>) : {},
    )) {
      const source = (value || {}) as { feature?: string; variable?: string; variation?: unknown };
      if (source.feature !== undefined)
        add("feature", source.feature, `compose ${alias}`, {
          compose: {
            ...(source.variable !== undefined ? { variable: source.variable } : {}),
            ...(source.variation ? { variation: true } : {}),
          },
        });
      else if (source.variable !== undefined)
        add("variable", source.variable, `compose ${alias}`, { compose: {} });
    }
    addConditions(entity.conditions, ["conditions"]);

    const visitOverrides = (overrides: unknown[], parts: Array<string | undefined>) => {
      overrides.forEach((override, index) => {
        const row = (override || {}) as Record<string, unknown>;
        const overrideParts = [...parts, typeof row.key === "string" ? row.key : `#${index + 1}`];
        addConditions(row.conditions, overrideParts);
        if (Array.isArray(row.overrides)) visitOverrides(row.overrides, overrideParts);
      });
    };

    for (const [environment, overrides] of byEnvironment(entity.overrides)) {
      visitOverrides(overrides, ["overrides", environment]);
    }
  } else if (type === "segment") {
    addConditions(entity.conditions, ["conditions"]);
  }

  return references;
}

const REFERENCE_TYPE_ORDER: CatalogEntityType[] = ["feature", "variable", "segment", "attribute"];

export function compareReferences(
  left: { type: CatalogEntityType; key: string },
  right: { type: CatalogEntityType; key: string },
) {
  return (
    REFERENCE_TYPE_ORDER.indexOf(left.type) - REFERENCE_TYPE_ORDER.indexOf(right.type) ||
    left.key.localeCompare(right.key)
  );
}

/** References grouped per entity, each place listed once and each check kept once. */
export function groupAuthoredReferences(references: AuthoredReference[]): DirectDependency[] {
  const grouped = new Map<
    string,
    { entry: DirectDependency; locations: Set<string>; checks: Map<string, DependencyCheck> }
  >();
  for (const reference of references) {
    const id = `${reference.type}:${reference.key}`;
    const group = grouped.get(id) || {
      entry: { type: reference.type, key: reference.key, locations: [] },
      locations: new Set<string>(),
      checks: new Map<string, DependencyCheck>(),
    };
    group.locations.add(reference.location);
    if (reference.check) {
      const check = { location: reference.location, ...reference.check };
      group.checks.set(JSON.stringify(check), check);
    }
    grouped.set(id, group);
  }

  return [...grouped.values()]
    .map(({ entry, locations, checks }) => ({
      ...entry,
      locations: [...locations],
      ...(checks.size ? { checks: [...checks.values()] } : {}),
    }))
    .sort(compareReferences);
}
