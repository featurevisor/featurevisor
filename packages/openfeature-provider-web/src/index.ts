import {
  FeaturevisorProvider,
  type FeaturevisorProviderOptions,
} from "@featurevisor/openfeature-provider-core";
import type { Featurevisor } from "@featurevisor/sdk";
import { OpenFeatureEventEmitter, ParseError, ProviderEvents } from "@openfeature/web-sdk";
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
  readonly events = new OpenFeatureEventEmitter();
  readonly featurevisor: Featurevisor;
  private readonly provider: FeaturevisorProvider;
  private readonly unsubscribeChanges: Array<() => void>;
  private datafileError = false;

  constructor(options: FeaturevisorProviderOptions = {}) {
    this.provider = new FeaturevisorProvider(options);
    this.featurevisor = this.provider.featurevisor;
    this.datafileError = this.provider.getDatafileError() !== undefined;
    const configurationChanged = () => {
      // Featurevisor event keys are direct for sticky state and transitive for
      // datafiles. Omitting flagsChanged conservatively invalidates all flags.
      this.events.emit(ProviderEvents.ConfigurationChanged, {});
    };
    this.unsubscribeChanges = [
      this.featurevisor.on("error", ({ diagnostic }) => {
        if (diagnostic.code === "invalid_datafile") {
          this.datafileError = true;
          this.events.emit(ProviderEvents.Error, { message: diagnostic.message });
        }
      }),
      this.featurevisor.on("datafile_set", ({ features, variables }) => {
        const recovered = this.datafileError;
        this.datafileError = false;
        if (recovered) this.events.emit(ProviderEvents.Ready, {});
        if (recovered || features.length > 0 || variables.length > 0) configurationChanged();
      }),
      this.featurevisor.on("sticky_features_set", ({ features }) => {
        if (features.length > 0) configurationChanged();
      }),
      this.featurevisor.on("sticky_variables_set", ({ variables }) => {
        if (variables.length > 0) configurationChanged();
      }),
      this.featurevisor.on("context_set", configurationChanged),
    ];
  }

  async initialize(): Promise<void> {
    const error = this.provider.getDatafileError();
    if (error !== undefined) throw new ParseError(error);
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
    for (const unsubscribe of this.unsubscribeChanges) unsubscribe();
    await this.provider.close();
  }
}
