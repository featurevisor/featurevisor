import {
  FeaturevisorProvider,
  type FeaturevisorProviderOptions,
} from "@featurevisor/openfeature-provider-core";
import type { Featurevisor } from "@featurevisor/sdk";
import type {
  EvaluationContext,
  JsonValue,
  Provider,
  ResolutionDetails,
  TrackingEventDetails,
} from "@openfeature/web-sdk";

export type {
  FeaturevisorProviderOptions,
  FeaturevisorProviderTrackingEvent,
  FeaturevisorProviderTrackingHandler,
} from "@featurevisor/openfeature-provider-core";

export class FeaturevisorOpenFeatureProvider implements Provider {
  readonly metadata = { name: "Featurevisor" } as const;
  readonly runsOn = "client" as const;
  readonly featurevisor: Featurevisor;
  private readonly provider: FeaturevisorProvider;

  constructor(options: FeaturevisorProviderOptions = {}) {
    this.provider = new FeaturevisorProvider(options);
    this.featurevisor = this.provider.featurevisor;
  }
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): ResolutionDetails<boolean> {
    return this.provider.resolve(flagKey, defaultValue, context, "boolean");
  }
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): ResolutionDetails<string> {
    return this.provider.resolve(flagKey, defaultValue, context, "string");
  }
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): ResolutionDetails<number> {
    return this.provider.resolve(flagKey, defaultValue, context, "number");
  }
  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): ResolutionDetails<T> {
    return this.provider.resolve(flagKey, defaultValue, context, "object");
  }
  track(name: string, context: EvaluationContext, details: TrackingEventDetails): void {
    this.provider.track(name, context, details);
  }
  async onClose(): Promise<void> {
    await this.provider.close();
  }
}
