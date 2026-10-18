import type { ProjectConfig } from "../config";
import { FeaturevisorCLIError } from "../error";

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
