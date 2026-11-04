/**
 * What an inheriting environment takes from another, for the exporter and the pages alike. Core's
 * builder is the authority on what a datafile holds, and Catalog cannot import it, so this reads
 * authored lists the same way: an environment's own entry, whatever it holds, or else its parent's.
 */
export type InheritEnvironments = Record<string, { from: string }>;

function has(byEnvironment: unknown, environment: string) {
  return (
    !!byEnvironment &&
    typeof byEnvironment === "object" &&
    !Array.isArray(byEnvironment) &&
    Object.prototype.hasOwnProperty.call(byEnvironment, environment)
  );
}

/** The environment this environment's list comes from, when it comes from another */
export function getInheritedFrom(
  byEnvironment: unknown,
  environment: string | undefined,
  inherit: InheritEnvironments | undefined,
): string | undefined {
  const from = environment ? inherit?.[environment]?.from : undefined;
  return from && !has(byEnvironment, environment as string) && has(byEnvironment, from)
    ? from
    : undefined;
}

/** A map of lists by environment, with each inheriting environment's list filled in */
export function withInherited<T>(byEnvironment: T, inherit: InheritEnvironments | undefined): T {
  if (!inherit || !byEnvironment || typeof byEnvironment !== "object") return byEnvironment;
  if (Array.isArray(byEnvironment)) return byEnvironment;
  const result = { ...byEnvironment } as Record<string, unknown>;
  for (const environment of Object.keys(inherit)) {
    const from = getInheritedFrom(byEnvironment, environment, inherit);
    if (from) result[environment] = (byEnvironment as Record<string, unknown>)[from];
  }
  return result as T;
}

/** A definition as each environment reads it, for what depends on behaviour and not authorship */
export function withInheritedEntries<T extends object>(
  entity: T,
  inherit: InheritEnvironments | undefined,
): T {
  if (!inherit) return entity;
  const { rules, force, expose, overrides } = entity as Record<string, unknown>;
  return {
    ...entity,
    ...(rules !== undefined ? { rules: withInherited(rules, inherit) } : {}),
    ...(force !== undefined ? { force: withInherited(force, inherit) } : {}),
    ...(expose !== undefined ? { expose: withInherited(expose, inherit) } : {}),
    ...(overrides !== undefined ? { overrides: withInherited(overrides, inherit) } : {}),
  };
}

/** Environments whose `rules` or `overrides` come from another, for `inherited:` */
export function getInheritedEnvironments(
  entity: { rules?: unknown; overrides?: unknown },
  inherit: InheritEnvironments | undefined,
): string[] | undefined {
  if (!inherit) return undefined;
  const environments = Object.keys(inherit).filter((environment) =>
    getInheritedFrom(entity.rules ?? entity.overrides, environment, inherit),
  );
  return environments.length > 0 ? environments : undefined;
}
