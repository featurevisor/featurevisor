export type FeaturevisorLogLevel = "fatal" | "error" | "warn" | "info" | "debug";

export type FeaturevisorDiagnosticCode =
  | "sdk_initialized"
  | "datafile_set"
  | "context_set"
  | "sticky_set"
  | "invalid_datafile"
  | "duplicate_module"
  | "evaluation_error"
  | "invalid_bucket_by"
  | "feature_not_found"
  | "deprecated_feature"
  | "variable_not_found"
  | "deprecated_variable"
  | "no_variations"
  | "condition_match_error"
  | "conditions_parse_error"
  | (string & {});

export interface FeaturevisorDiagnostic {
  level: FeaturevisorLogLevel;
  code: FeaturevisorDiagnosticCode;
  message: string;
  module?: string;
  moduleName?: string;
  featureKey?: string;
  variableKey?: string;
  reason?: string;
  originalError?: unknown;
  [key: string]: unknown;
}

export interface FeaturevisorModuleReportedDiagnostic {
  level: FeaturevisorLogLevel;
  code: FeaturevisorDiagnosticCode;
  message: string;
  moduleName?: string;
  featureKey?: string;
  variableKey?: string;
  reason?: string;
  originalError?: unknown;
  [key: string]: unknown;
}

export type FeaturevisorDiagnosticHandler = (diagnostic: FeaturevisorDiagnostic) => void;

export interface FeaturevisorModuleDiagnosticOptions {
  logLevel?: FeaturevisorLogLevel;
}

export type FeaturevisorDiagnosticReporter = (
  diagnostic: FeaturevisorDiagnostic,
  sourceModuleKey?: string,
) => void;

export const FEATUREVISOR_DIAGNOSTIC_PREFIX = "[Featurevisor]";

export const FEATUREVISOR_LOG_LEVELS: FeaturevisorLogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
];

export function shouldLog(
  configuredLevel: FeaturevisorLogLevel,
  diagnosticLevel: FeaturevisorLogLevel,
): boolean {
  return (
    FEATUREVISOR_LOG_LEVELS.indexOf(configuredLevel) >=
    FEATUREVISOR_LOG_LEVELS.indexOf(diagnosticLevel)
  );
}

export function getConsoleMethodForDiagnostic(level: FeaturevisorLogLevel) {
  if (level === "fatal" || level === "error") {
    return "error";
  }

  if (level === "warn") {
    return "warn";
  }

  if (level === "debug") {
    return "debug";
  }

  return "info";
}

export const noopDiagnosticReporter: FeaturevisorDiagnosticReporter =
  function noopDiagnosticReporter() {};
