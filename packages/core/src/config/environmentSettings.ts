/** Environments that use another environment's lists wherever a definition leaves theirs out. */
export type InheritEnvironments = Record<string, { from: string }>;

/** The keys grouped by environment in each kind of definition */
export const ENVIRONMENT_KEYS = {
  feature: ["rules", "force", "expose"],
  variable: ["overrides"],
} as const;

const REQUIRED_SETTINGS = ["requireRulesIn", "requireOverridesIn"] as const;

/** Settings that mean nothing without `environments` */
export const ENVIRONMENT_SETTINGS = ["inheritEnvironments", ...REQUIRED_SETTINGS] as const;

/** Whether a map by environment has its own entry for an environment, whatever that holds */
export function writesEnvironment(byEnvironment: unknown, environment: string): boolean {
  return Object.prototype.hasOwnProperty.call(byEnvironment ?? {}, environment);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function assertInheritEnvironments(value: unknown, environments: unknown) {
  const name = "inheritEnvironments";
  if (!Array.isArray(environments)) {
    throw new Error(`Invalid ${name}: this project does not configure environments.`);
  }
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new Error(
      `Invalid ${name}: expected an object of environments. Omit it when no environment inherits.`,
    );
  }
  for (const [environment, entry] of Object.entries(value)) {
    if (!environments.includes(environment)) {
      throw new Error(`Invalid ${name}.${environment}: "${environment}" is not in environments.`);
    }
    if (
      !isPlainObject(entry) ||
      Object.keys(entry).length !== 1 ||
      typeof entry.from !== "string"
    ) {
      throw new Error(`Invalid ${name}.${environment}: expected { from: "<environment>" }.`);
    }
    const { from } = entry;
    if (!environments.includes(from)) {
      throw new Error(`Invalid ${name}.${environment}.from: "${from}" is not in environments.`);
    }
    if (from === environment) {
      throw new Error(
        `Invalid ${name}.${environment}.from: an environment cannot inherit from itself.`,
      );
    }
    if (writesEnvironment(value, from)) {
      const parent = (value[from] as { from: string }).from;
      throw new Error(
        `Invalid ${name}.${environment}.from: "${from}" inherits from "${parent}", and an environment can only inherit one level.`,
      );
    }
  }
}

function assertRequiredEnvironments(
  name: string,
  value: unknown,
  environments: unknown,
  inheritEnvironments: unknown,
) {
  if (!Array.isArray(environments)) {
    throw new Error(`Invalid ${name}: this project does not configure environments.`);
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((environment) => typeof environment !== "string")
  ) {
    throw new Error(
      `Invalid ${name}: expected a list of environments. Omit it when none is required.`,
    );
  }
  const seen = new Set<string>();
  for (const environment of value as string[]) {
    if (!environments.includes(environment)) {
      throw new Error(`Invalid ${name}: "${environment}" is not in environments.`);
    }
    if (seen.has(environment)) {
      throw new Error(`Invalid ${name}: duplicate name "${environment}".`);
    }
    seen.add(environment);
    if (writesEnvironment(inheritEnvironments, environment)) {
      const { from } = (inheritEnvironments as InheritEnvironments)[environment];
      throw new Error(
        `Invalid ${name}: "${environment}" inherits from "${from}", so it cannot be required.`,
      );
    }
  }
}

/** Checks the settings that depend on `environments`, once that has been checked itself. */
export function assertEnvironmentSettings(config: {
  environments?: unknown;
  inheritEnvironments?: unknown;
  requireRulesIn?: unknown;
  requireOverridesIn?: unknown;
}) {
  if (typeof config.inheritEnvironments !== "undefined") {
    assertInheritEnvironments(config.inheritEnvironments, config.environments);
  }
  for (const name of REQUIRED_SETTINGS) {
    if (typeof config[name] !== "undefined") {
      assertRequiredEnvironments(
        name,
        config[name],
        config.environments,
        config.inheritEnvironments,
      );
    }
  }
}
