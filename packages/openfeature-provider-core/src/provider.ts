import {
  createFeaturevisor,
  type Context,
  type Evaluation,
  type Featurevisor,
  type FeaturevisorOptions,
  type VariableValue,
} from "@featurevisor/sdk";
import {
  ErrorCode,
  StandardResolutionReasons,
  type EvaluationContext,
  type FlagMetadata,
  type JsonValue,
  type ResolutionDetails,
  type TrackingEventDetails,
} from "@openfeature/core";

export interface FeaturevisorProviderTrackingEvent {
  name: string;
  context: EvaluationContext;
  details: TrackingEventDetails;
}

export type FeaturevisorProviderTrackingHandler = (
  event: FeaturevisorProviderTrackingEvent,
) => void;

export interface FeaturevisorProviderOptions extends FeaturevisorOptions {
  featurevisor?: Featurevisor;
  targetingKeyField?: string;
  keySeparator?: string;
  variationKey?: string;
  onTrack?: FeaturevisorProviderTrackingHandler;
}

type ExpectedType = "boolean" | "string" | "number" | "object";

const errorReasons = new Set(["feature_not_found", "variable_not_found", "no_variations", "error"]);

const targetingReasons = new Set([
  "required",
  "forced",
  "sticky",
  "rule",
  "variable_override_variation",
  "variable_override_rule",
]);

function normalizeContextValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeContextValue);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      result[key] = normalizeContextValue((value as Record<string, unknown>)[key]);
    });
    return result;
  }

  return value;
}

function asContext(context: EvaluationContext, targetingKeyField: string): Context {
  const result = normalizeContextValue(context) as Context;
  if (context.targetingKey) {
    result[targetingKeyField] = context.targetingKey;
  }
  return result;
}

function reasonFor(evaluation: Evaluation): string {
  if (errorReasons.has(evaluation.reason)) return StandardResolutionReasons.ERROR;
  if (targetingReasons.has(evaluation.reason)) return StandardResolutionReasons.TARGETING_MATCH;
  if (evaluation.reason === "allocated") return StandardResolutionReasons.SPLIT;
  if (
    evaluation.reason === "disabled" ||
    evaluation.reason === "variation_disabled" ||
    evaluation.reason === "variable_disabled"
  ) {
    return StandardResolutionReasons.DISABLED;
  }
  return StandardResolutionReasons.DEFAULT;
}

function metadataFor(evaluation: Evaluation, featurevisor: Featurevisor): FlagMetadata {
  const metadata: FlagMetadata = {
    featureKey: evaluation.featureKey,
    featurevisorReason: evaluation.reason,
    schemaVersion: featurevisor.getSchemaVersion(),
  };
  const revision = featurevisor.getRevision();
  if (revision) metadata.revision = revision;
  if (evaluation.variableKey) metadata.variableKey = evaluation.variableKey;
  if (evaluation.ruleKey) metadata.ruleKey = evaluation.ruleKey;
  if (evaluation.bucketKey) metadata.bucketKey = evaluation.bucketKey;
  if (typeof evaluation.bucketValue === "number") metadata.bucketValue = evaluation.bucketValue;
  if (typeof evaluation.forceIndex === "number") metadata.forceIndex = evaluation.forceIndex;
  if (typeof evaluation.variableOverrideIndex === "number")
    metadata.variableOverrideIndex = evaluation.variableOverrideIndex;
  return metadata;
}

function errorCodeFor(evaluation: Evaluation): ErrorCode | undefined {
  if (evaluation.reason === "feature_not_found") return ErrorCode.FLAG_NOT_FOUND;
  if (evaluation.reason === "error") return ErrorCode.GENERAL;
  if (evaluation.reason === "variable_not_found" || evaluation.reason === "no_variations") {
    return ErrorCode.FLAG_NOT_FOUND;
  }
  return undefined;
}

function errorMessageFor(evaluation: Evaluation): string | undefined {
  if (evaluation.error) return evaluation.error.message;
  if (evaluation.reason === "feature_not_found")
    return `Feature \"${evaluation.featureKey}\" was not found`;
  if (evaluation.reason === "variable_not_found")
    return `Variable \"${evaluation.variableKey}\" was not found for feature \"${evaluation.featureKey}\"`;
  if (evaluation.reason === "no_variations")
    return `Feature \"${evaluation.featureKey}\" has no variations`;
  return undefined;
}

function typeMatches(value: unknown, expectedType: ExpectedType): boolean {
  if (expectedType === "boolean") return typeof value === "boolean";
  if (expectedType === "string") return typeof value === "string";
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  return value !== null && typeof value === "object";
}

export class FeaturevisorProvider {
  readonly featurevisor: Featurevisor;
  readonly targetingKeyField: string;
  readonly keySeparator: string;
  readonly variationKey: string;
  private readonly onTrack?: FeaturevisorProviderTrackingHandler;
  private readonly ownsFeaturevisor: boolean;
  private datafileError?: string;

  constructor(options: FeaturevisorProviderOptions = {}) {
    const {
      featurevisor,
      targetingKeyField,
      keySeparator,
      variationKey,
      onTrack,
      ...featurevisorOptions
    } = options;
    this.ownsFeaturevisor = !featurevisor;
    if (featurevisor) {
      this.featurevisor = featurevisor;
    } else {
      const onDiagnostic = featurevisorOptions.onDiagnostic;
      this.featurevisor = createFeaturevisor({
        ...featurevisorOptions,
        onDiagnostic: (diagnostic) => {
          if (diagnostic.code === "invalid_datafile") this.datafileError = diagnostic.message;
          if (diagnostic.code === "datafile_set") this.datafileError = undefined;
          onDiagnostic?.(diagnostic);
        },
      });
    }
    this.targetingKeyField = targetingKeyField || "userId";
    this.keySeparator = keySeparator || ":";
    this.variationKey = variationKey || "variation";
    this.onTrack = onTrack;
  }

  resolve<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expectedType: ExpectedType,
  ): ResolutionDetails<T> {
    if (this.datafileError) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.PARSE_ERROR,
        errorMessage: this.datafileError,
      };
    }
    const separatorIndex = flagKey.indexOf(this.keySeparator);
    const featureKey = separatorIndex === -1 ? flagKey : flagKey.slice(0, separatorIndex);
    const selector =
      separatorIndex === -1 ? undefined : flagKey.slice(separatorIndex + this.keySeparator.length);
    const featurevisorContext = asContext(context, this.targetingKeyField);

    let evaluation: Evaluation;
    let value: unknown;

    if (!selector) {
      if (expectedType !== "boolean") return this.typeMismatch(flagKey, defaultValue, expectedType);
      evaluation = this.featurevisor.evaluateFlag(featureKey, featurevisorContext);
      value = evaluation.enabled;
    } else if (selector === this.variationKey) {
      evaluation = this.featurevisor.evaluateVariation(featureKey, featurevisorContext);
      value = evaluation.variationValue ?? evaluation.variation?.value;
    } else {
      evaluation = this.featurevisor.evaluateVariable(featureKey, selector, featurevisorContext);
      value = this.normalizeVariable(evaluation.variableValue, evaluation.variableSchema?.type);
    }

    const result: ResolutionDetails<T> = {
      value: defaultValue,
      reason: reasonFor(evaluation),
      flagMetadata: metadataFor(evaluation, this.featurevisor),
    };
    if (typeof evaluation.variationValue !== "undefined" || evaluation.variation) {
      result.variant = String(evaluation.variationValue ?? evaluation.variation?.value);
    }

    const errorCode = errorCodeFor(evaluation);
    if (errorCode) {
      result.errorCode = errorCode;
      result.errorMessage = errorMessageFor(evaluation);
      return result;
    }

    if (typeof value === "undefined" || value === null) return result;
    if (!typeMatches(value, expectedType))
      return this.typeMismatch(flagKey, defaultValue, expectedType, result.flagMetadata);
    result.value = value as T;
    return result;
  }

  track(name: string, context: EvaluationContext, details: TrackingEventDetails): void {
    this.onTrack?.({ name, context, details });
  }

  async close(): Promise<void> {
    if (this.ownsFeaturevisor) await this.featurevisor.close();
  }

  private normalizeVariable(value: VariableValue | undefined, schemaType?: string): unknown {
    if (schemaType === "json" && typeof value === "string") {
      try {
        return JSON.parse(value) as JsonValue;
      } catch {
        return value;
      }
    }
    return value;
  }

  private typeMismatch<T>(
    flagKey: string,
    defaultValue: T,
    expectedType: ExpectedType,
    flagMetadata?: FlagMetadata,
  ): ResolutionDetails<T> {
    return {
      value: defaultValue,
      reason: StandardResolutionReasons.ERROR,
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `Flag \"${flagKey}\" did not resolve to a ${expectedType} value`,
      flagMetadata,
    };
  }
}
