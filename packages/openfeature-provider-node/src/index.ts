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
} from "@openfeature/server-sdk";

export type {
  FeaturevisorProviderOptions,
  FeaturevisorProviderTrackingEvent,
  FeaturevisorProviderTrackingHandler,
} from "@featurevisor/openfeature-provider-core";

export class FeaturevisorOpenFeatureProvider implements Provider {
  readonly metadata = { name: "Featurevisor" } as const;
  readonly runsOn = "server" as const;
  readonly featurevisor: Featurevisor;
  private readonly provider: FeaturevisorProvider;

  constructor(options: FeaturevisorProviderOptions = {}) {
    this.provider = new FeaturevisorProvider(options);
    this.featurevisor = this.provider.featurevisor;
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    return this.provider.resolve(flagKey, defaultValue, context, "boolean");
  }
  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return this.provider.resolve(flagKey, defaultValue, context, "string");
  }
  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return this.provider.resolve(flagKey, defaultValue, context, "number");
  }
  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return this.provider.resolve(flagKey, defaultValue, context, "object");
  }
  track(name: string, context: EvaluationContext, details: TrackingEventDetails): void {
    this.provider.track(name, context, details);
  }
  async onClose(): Promise<void> {
    await this.provider.close();
  }
}
