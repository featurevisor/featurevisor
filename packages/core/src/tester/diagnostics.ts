import type { FeaturevisorDiagnosticHandler } from "@featurevisor/sdk";

export function createTestDiagnosticHandler(options: {
  verbose?: boolean;
  json?: boolean;
}): FeaturevisorDiagnosticHandler {
  return (diagnostic) => {
    const method = options.json
      ? "error"
      : diagnostic.level === "fatal" || diagnostic.level === "error"
        ? "error"
        : diagnostic.level === "warn"
          ? "warn"
          : diagnostic.level === "debug"
            ? "debug"
            : "info";

    if (options.verbose) {
      console[method]("[Featurevisor]", diagnostic.message, diagnostic);
      return;
    }

    const entities = ["featureKey", "variableKey"]
      .filter((key) => typeof diagnostic.details[key] === "string")
      .map(
        (key) =>
          `${key === "featureKey" ? "feature" : "variable"} ${JSON.stringify(diagnostic.details[key])}`,
      );
    const error = diagnostic.originalError;
    const cause = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const message = [diagnostic.message, cause && cause !== diagnostic.message ? cause : ""]
      .filter(Boolean)
      .join(": ")
      .replace(/\s+/g, " ");
    const context = entities.length ? ` (${entities.join(", ")})` : "";
    console[method](`[Featurevisor] ${diagnostic.level}: ${message}${context}`);
  };
}
