import type { ProjectConfig } from "../config";
import { ENVIRONMENT_KEYS, writesEnvironment } from "../config/environmentSettings";
import { FeaturevisorCLIError } from "../error";

type InheritConfig = Pick<ProjectConfig, "inheritEnvironments">;

/** The environment this one inherits from, when the project says so. */
export function getInheritedEnvironment(
  config: InheritConfig,
  environment: string | false | undefined,
): string | undefined {
  return environment ? config.inheritEnvironments?.[environment]?.from : undefined;
}

/** Which of a definition's environment keys come from another environment, when any do. */
export function getInheritedKeys(
  definition: { rules?: unknown; force?: unknown; expose?: unknown; overrides?: unknown },
  environment: string | false | undefined,
  config: InheritConfig,
): { from: string; keys: string[] } | undefined {
  const from = getInheritedEnvironment(config, environment);
  if (!from) return undefined;
  const keys = [...ENVIRONMENT_KEYS.feature, ...ENVIRONMENT_KEYS.variable].filter(
    (key) =>
      resolveForEnvironment(
        definition[key] as Record<string, unknown> | undefined,
        environment as string,
        config,
      ).inheritedFrom,
  );
  return keys.length > 0 ? { from, keys } : undefined;
}

/**
 * What a map of `rules`, `force`, `expose` or `overrides` says for an environment: its own entry
 * whatever that holds, so `[]` stays empty, or else the entry of the environment it inherits from.
 * Definitions stay as authored everywhere else, since lint and the writers read the file.
 */
export function resolveForEnvironment<T>(
  byEnvironment: Record<string, T> | undefined,
  environment: string,
  config: InheritConfig,
): { value?: T; inheritedFrom?: string } {
  if (writesEnvironment(byEnvironment, environment)) return { value: byEnvironment![environment] };
  const from = getInheritedEnvironment(config, environment);
  return from && writesEnvironment(byEnvironment, from)
    ? { value: byEnvironment![from], inheritedFrom: from }
    : {};
}

/** Resolve selection before reading state or writing any output. */
export function resolveBuildEnvironments(
  config: Pick<ProjectConfig, "environments">,
  environment: string | false | undefined,
  single = false,
): Array<string | false> {
  const configured = config.environments;
  if (typeof environment === "string") {
    if (!Array.isArray(configured) || !configured.includes(environment)) {
      throw new FeaturevisorCLIError(
        Array.isArray(configured)
          ? `Unknown environment "${environment}". Available environments: ${configured.join(", ")}.`
          : `This project does not configure environments. Omit --environment.`,
        { code: "invalid_environment", details: { environment, available: configured || [] } },
      );
    }
    return [environment];
  }
  if (!Array.isArray(configured)) return [false];
  if (single) {
    throw new FeaturevisorCLIError(
      "Pass --environment=<environment> when selecting one datafile.",
      {
        code: "missing_environment",
        details: { available: configured },
      },
    );
  }
  return configured;
}
