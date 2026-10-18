import type {
  Context,
  StickyFeatures,
  FeatureKey,
  VariationValue,
  VariableValue,
  EvaluatedFeatures,
  ObjectValue,
  StickyVariables,
  VariableKey,
  EvaluatedVariables,
} from "@featurevisor/types";

import type { Featurevisor, OverrideOptions } from "./instance.js";
import type { Evaluation } from "./evaluate.js";
import type { EventCallback, EventDetailsByName, EventName } from "./events.js";
import { getValueByType, type VariableGetter } from "./variable.js";
import { getStickyChangeKeys } from "./keys.js";
import type { StickyState } from "./session.js";
import { mergeContext } from "./context.js";

function mergeLookup<TValue>(
  previous: Record<string, TValue> | undefined,
  next: Record<string, TValue>,
): Record<string, TValue> {
  return Object.assign(Object.create(null) as Record<string, TValue>, previous, next);
}

function getStickyFeaturesChangeDetails(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
) {
  return {
    features: getStickyChangeKeys(previousStickyFeatures, newStickyFeatures),
    replaced: replace,
  };
}

type ChildEventName = "context_set" | "sticky_features_set" | "sticky_variables_set";

type ChildListeners = {
  [TEventName in ChildEventName]?: EventCallback<TEventName>[];
};

export class FeaturevisorChildInstance {
  private parent: Featurevisor;
  private context: Context;
  private stickyFeatures: StickyFeatures;
  private stickyVariables: StickyVariables;
  private listeners: ChildListeners = {};
  private parentUnsubscribers: (() => void)[] = [];
  private evaluationGeneration = 0;

  constructor(options: {
    parent: Featurevisor;
    context: Context;
    stickyFeatures?: StickyFeatures;
    stickyVariables?: StickyVariables;
  }) {
    this.parent = options.parent;
    this.context = options.context;
    this.stickyFeatures = options.stickyFeatures || {};
    this.stickyVariables = options.stickyVariables || {};
  }

  on<TEventName extends EventName>(
    eventName: TEventName,
    callback: EventCallback<TEventName>,
  ): () => void;
  on<TEventName extends EventName>(
    eventName: TEventName,
    callback: EventCallback<TEventName>,
  ): () => void {
    if (eventName === "context_set") {
      return this.onChildEvent("context_set", callback as EventCallback<"context_set">);
    }

    if (eventName === "sticky_features_set") {
      return this.onChildEvent(
        "sticky_features_set",
        callback as EventCallback<"sticky_features_set">,
      );
    }

    if (eventName === "sticky_variables_set") {
      return this.onChildEvent(
        "sticky_variables_set",
        callback as EventCallback<"sticky_variables_set">,
      );
    }

    const unsubscribeFromParent = this.parent.on(eventName as never, callback as never);
    let isActive = true;

    const unsubscribe = () => {
      if (!isActive) {
        return;
      }

      isActive = false;
      unsubscribeFromParent();

      const index = this.parentUnsubscribers.indexOf(unsubscribe);
      if (index !== -1) {
        this.parentUnsubscribers.splice(index, 1);
      }
    };

    this.parentUnsubscribers.push(unsubscribe);

    return unsubscribe;
  }

  private onChildEvent<TEventName extends ChildEventName>(
    eventName: TEventName,
    callback: EventCallback<TEventName>,
  ): () => void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }

    const listeners = this.listeners[eventName] as EventCallback<TEventName>[];
    listeners.push(callback);

    let isActive = true;

    return function unsubscribe() {
      if (!isActive) {
        return;
      }

      isActive = false;

      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  private trigger<TEventName extends ChildEventName>(
    eventName: TEventName,
    details: EventDetailsByName[TEventName],
  ) {
    const listeners = this.listeners[eventName];

    if (!listeners) {
      return;
    }

    listeners.slice().forEach(function (listener) {
      try {
        listener(details as never);
      } catch (err) {
        console.error(err);
      }
    });
  }

  close() {
    this.parentUnsubscribers.slice().forEach(function (unsubscribe) {
      unsubscribe();
    });
    this.parentUnsubscribers = [];
    this.listeners = {};
  }

  setContext(context: Context, replace = false) {
    this.evaluationGeneration++;
    if (replace) {
      this.context = context;
    } else {
      this.context = mergeContext(this.context, context);
    }

    this.trigger("context_set", {
      context: this.context,
      replaced: replace,
    });
  }

  getContext(context?: Context): Context {
    return this.parent.getContext(mergeContext(this.context, context));
  }

  private getChildContext(context: Context = {}): Context {
    return mergeContext(this.context, context);
  }

  private readStickyState = (): StickyState => ({
    generation: this.evaluationGeneration,
    stickyFeatures: this.stickyFeatures,
    stickyVariables: this.stickyVariables,
  });

  private getChildOptions(options: OverrideOptions = {}): OverrideOptions & {
    __featurevisorChildStickyFeatures: StickyFeatures;
    __featurevisorChildStickyVariables: StickyVariables;
    __featurevisorReadStickyState: () => StickyState;
  } {
    return {
      ...options,
      // This is an SDK-private transport field. Public evaluation options do
      // not accept sticky values; sticky belongs to the child instance.
      __featurevisorChildStickyFeatures: this.stickyFeatures,
      __featurevisorChildStickyVariables: this.stickyVariables,
      __featurevisorReadStickyState: this.readStickyState,
    };
  }

  setStickyFeatures(stickyFeatures: StickyFeatures, replace = false) {
    this.evaluationGeneration++;
    const previousStickyFeatures = this.stickyFeatures || {};

    this.stickyFeatures = mergeLookup(replace ? undefined : this.stickyFeatures, stickyFeatures);

    const details = getStickyFeaturesChangeDetails(
      previousStickyFeatures,
      this.stickyFeatures,
      replace,
    );

    this.trigger("sticky_features_set", details);
  }

  setStickyVariables(stickyVariables: StickyVariables, replace = false) {
    this.evaluationGeneration++;
    const previous = this.stickyVariables;
    this.stickyVariables = mergeLookup(replace ? undefined : this.stickyVariables, stickyVariables);
    const details = {
      variables: getStickyChangeKeys(previous, this.stickyVariables),
      replaced: replace,
    };
    this.trigger("sticky_variables_set", details);
  }

  evaluateFlag(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return this.parent.evaluateFlag(
      featureKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  isEnabled(featureKey: FeatureKey, context: Context = {}, options: OverrideOptions = {}): boolean {
    return this.parent.isEnabled(
      featureKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  evaluateVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return this.parent.evaluateVariation(
      featureKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  /**
   * Returns the evaluated variation. The optional type parameter narrows the
   * compile time result and does not validate or transform the runtime value.
   */
  getVariation<TVariation extends VariationValue = VariationValue>(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): TVariation | null {
    return this.parent.getVariation<TVariation>(
      featureKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  evaluateVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): Evaluation;
  evaluateVariable(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): Evaluation;
  evaluateVariable(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return typeof variableKeyOrContext === "string"
      ? this.parent.evaluateVariable(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.evaluateVariable(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  /**
   * Returns the evaluated variable. The optional type parameter describes the
   * expected compile time result and does not validate or transform the runtime
   * value. TValue stays unconstrained so TypeScript interfaces without index
   * signatures are accepted.
   */
  getVariable<TValue = VariableValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): TValue | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariable<TValue>(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariable<TValue>(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): boolean | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "boolean",
    ) as boolean | null;
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): string | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "string",
    ) as string | null;
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "integer",
    ) as number | null;
  }

  /** Returns a number variable after runtime type checking, whole or fractional. */
  getVariableNumber(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableNumber(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableNumber(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "number",
    ) as number | null;
  }

  /**
   * Returns an array variable after runtime type checking. Pass an item type
   * explicitly when its structure is known; otherwise items have type unknown.
   */
  getVariableArray<T = unknown>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = unknown>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = unknown>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T[] | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "array",
    ) as T[] | null;
  }

  /** Returns an object variable after runtime type checking. */
  getVariableObject<T = ObjectValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "object",
    ) as T | null;
  }

  /** Returns and parses a JSON variable. */
  getVariableJSON<T = VariableValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    return getValueByType(
      (this.getVariable as VariableGetter<OverrideOptions>)(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions,
        options,
      ),
      "json",
    ) as T | null;
  }

  /** Returns evaluated feature snapshots using this child's context and sticky state. */
  getFeatureEvaluations(
    context: Context = {},
    featureKeys: string[] = [],
    options: OverrideOptions = {},
  ): EvaluatedFeatures {
    return this.parent.getFeatureEvaluations(
      this.getChildContext(context),
      featureKeys,
      this.getChildOptions(options),
    );
  }

  /** Returns evaluated global variable values using this child's context and sticky state. */
  getVariableEvaluations(
    context: Context = {},
    variableKeys: VariableKey[] = [],
    options: OverrideOptions = {},
  ): EvaluatedVariables {
    return this.parent.getVariableEvaluations(
      this.getChildContext(context),
      variableKeys,
      this.getChildOptions(options),
    );
  }
}
