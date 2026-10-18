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
  globalVariablePrefix?: string;
  onTrack?: FeaturevisorProviderTrackingHandler;
}

type ExpectedType = "boolean" | "string" | "number" | "object";

const errorReasons = new Set(["feature_not_found", "variable_not_found", "no_variations", "error"]);

const targetingReasons = new Set([
  "variable_composed",
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
      // JSON keys are data, including the legacy prototype setter name.
      Object.defineProperty(result, key, {
        value: normalizeContextValue((value as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
    return result;
  }

  return value;
}

function asContext(context: EvaluationContext, targetingKeyField: string): Context {
  const result = normalizeContextValue(context) as Context;
  if (
    Object.prototype.hasOwnProperty.call(context, "targetingKey") &&
    (typeof context.targetingKey === "string" ||
      (typeof context.targetingKey === "number" && Number.isFinite(context.targetingKey)))
  ) {
    Object.defineProperty(result, targetingKeyField, {
      value: context.targetingKey,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function reasonFor(evaluation: Evaluation): string {
  const reason: string = evaluation.reason;
  if (errorReasons.has(reason)) return StandardResolutionReasons.ERROR;
  if (targetingReasons.has(reason)) return StandardResolutionReasons.TARGETING_MATCH;
  if (reason === "allocated") return StandardResolutionReasons.SPLIT;
  if (reason === "conditions_unmet") {
    return StandardResolutionReasons.DISABLED;
  }
  if (reason === "disabled" || reason === "variation_disabled" || reason === "variable_disabled") {
    return StandardResolutionReasons.DISABLED;
  }
  return StandardResolutionReasons.DEFAULT;
}

function metadataFor(evaluation: Evaluation, featurevisor: Featurevisor): FlagMetadata {
  const metadata: FlagMetadata = {
    featurevisorReason: evaluation.reason,
    schemaVersion: featurevisor.getSchemaVersion(),
  };
  if (evaluation.featureKey) metadata.featureKey = evaluation.featureKey;
  const revision = featurevisor.getRevision();
  if (revision) metadata.revision = revision;
  if (evaluation.variableKey) metadata.variableKey = evaluation.variableKey;
  if (evaluation.ruleKey) metadata.ruleKey = evaluation.ruleKey;
  if (evaluation.bucketKey) metadata.bucketKey = evaluation.bucketKey;
  if (typeof evaluation.bucketValue === "number") metadata.bucketValue = evaluation.bucketValue;
  if (typeof evaluation.forceIndex === "number") metadata.forceIndex = evaluation.forceIndex;
  if (typeof evaluation.variableOverrideIndex === "number")
    metadata.variableOverrideIndex = evaluation.variableOverrideIndex;
  if (evaluation.variableOverrideKey) metadata.variableOverrideKey = evaluation.variableOverrideKey;
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
    return `Feature \"${evaluation.featureKey || ""}\" was not found`;
  if (evaluation.reason === "variable_not_found")
    return evaluation.featureKey
      ? `Variable \"${evaluation.variableKey}\" was not found for feature \"${evaluation.featureKey}\"`
      : `Global variable \"${evaluation.variableKey}\" was not found`;
  if (evaluation.reason === "no_variations")
    return `Feature \"${evaluation.featureKey || ""}\" has no variations`;
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
  readonly globalVariablePrefix: string;
  private readonly onTrack?: FeaturevisorProviderTrackingHandler;
  private readonly ownsFeaturevisor: boolean;
  private datafileError?: string;
  private readonly unsubscribe: Array<() => void>;

  constructor(options: FeaturevisorProviderOptions = {}) {
    const {
      featurevisor,
      targetingKeyField,
      keySeparator,
      variationKey,
      globalVariablePrefix,
      onTrack,
      ...featurevisorOptions
    } = options;
    this.targetingKeyField = targetingKeyField || "userId";
    this.keySeparator = keySeparator || ":";
    this.variationKey = variationKey || "variation";
    this.globalVariablePrefix = globalVariablePrefix || "variable";
    if (this.globalVariablePrefix.indexOf(this.keySeparator) !== -1) {
      throw new Error("globalVariablePrefix cannot contain keySeparator");
    }
    this.ownsFeaturevisor = !featurevisor;
    if (featurevisor) {
      this.featurevisor = featurevisor;
    } else {
      this.featurevisor = createFeaturevisor({
        ...featurevisorOptions,
        // Attach health listeners before accepting the initial datafile. Module
        // setup still runs before that datafile, as in ordinary SDK creation.
        datafile: undefined,
        onDiagnostic: featurevisorOptions.onDiagnostic || (() => {}),
      });
    }
    this.onTrack = onTrack;
    this.unsubscribe = [
      this.featurevisor.on("error", ({ diagnostic }) => {
        if (diagnostic.code === "invalid_datafile") this.datafileError = diagnostic.message;
      }),
      this.featurevisor.on("datafile_set", () => {
        this.datafileError = undefined;
      }),
    ];
    if (this.ownsFeaturevisor && featurevisorOptions.datafile !== undefined) {
      this.featurevisor.setDatafile(featurevisorOptions.datafile, true);
    }
  }

  getDatafileError(): string | undefined {
    return this.datafileError;
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

    if (featureKey === this.globalVariablePrefix && selector) {
      evaluation = this.featurevisor.evaluateVariable(selector, featurevisorContext);
      value = evaluation.variable?.compose
        ? evaluation.variableValue
        : this.normalizeVariable(evaluation.variableValue, evaluation.variable?.type);
    } else if (!selector) {
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
    if (
      evaluation.featureKey &&
      (typeof evaluation.variationValue !== "undefined" || evaluation.variation)
    ) {
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
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
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
