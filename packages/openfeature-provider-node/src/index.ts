import {
  FeaturevisorProvider,
  type FeaturevisorProviderOptions,
} from "@featurevisor/openfeature-provider-core";
import type { Featurevisor } from "@featurevisor/sdk";
import { OpenFeatureEventEmitter, ParseError, ProviderEvents } from "@openfeature/server-sdk";
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
  readonly events = new OpenFeatureEventEmitter();
  readonly featurevisor: Featurevisor;
  private readonly provider: FeaturevisorProvider;
  private readonly unsubscribe: Array<() => void>;
  private datafileError: boolean;

  constructor(options: FeaturevisorProviderOptions = {}) {
    this.provider = new FeaturevisorProvider(options);
    this.featurevisor = this.provider.featurevisor;
    this.datafileError = this.provider.getDatafileError() !== undefined;
    this.unsubscribe = [
      this.featurevisor.on("error", ({ diagnostic }) => {
        if (diagnostic.code === "invalid_datafile") {
          this.datafileError = true;
          this.events.emit(ProviderEvents.Error, { message: diagnostic.message });
        }
      }),
      this.featurevisor.on("datafile_set", () => {
        const recovered = this.datafileError;
        this.datafileError = false;
        if (recovered) this.events.emit(ProviderEvents.Ready, {});
      }),
    ];
  }

  async initialize(): Promise<void> {
    const error = this.provider.getDatafileError();
    if (error !== undefined) throw new ParseError(error);
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
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    await this.provider.close();
  }
}
