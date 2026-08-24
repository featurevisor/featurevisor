import type {
  Context,
  StickyFeatures,
  FeatureKey,
  VariationValue,
  VariableValue,
  EvaluatedFeatures,
  ObjectValue,
  StickyVariables,
  TopLevelVariableKey,
} from "@featurevisor/types";

import type { Featurevisor, OverrideOptions } from "./instance.js";
import type { Evaluation, TopLevelVariableEvaluation } from "./evaluate.js";
import type { EventCallback, EventDetailsByName, EventName } from "./events.js";

function getStickyFeaturesChangeDetails(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
) {
  const allKeys = [...Object.keys(previousStickyFeatures), ...Object.keys(newStickyFeatures)];

  return {
    features: allKeys.filter((element, index) => allKeys.indexOf(element) === index),
    variables: [],
    replaced: replace,
  };
}

type ChildEventName = "context_set" | "sticky_features_set" | "sticky_variables_set" | "sticky_set";

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

  constructor(options: {
    parent: Featurevisor;
    context: Context;
    stickyFeatures?: StickyFeatures;
    /** @deprecated Use `stickyFeatures`. */
    sticky?: StickyFeatures;
    stickyVariables?: StickyVariables;
  }) {
    this.parent = options.parent;
    this.context = options.context;
    this.stickyFeatures = options.stickyFeatures || options.sticky || {};
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

    if (eventName === "sticky_set") {
      return this.onChildEvent("sticky_set", callback as EventCallback<"sticky_set">);
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
    if (replace) {
      this.context = context;
    } else {
      this.context = { ...this.context, ...context };
    }

    this.trigger("context_set", {
      context: this.context,
      replaced: replace,
    });
  }

  getContext(context?: Context): Context {
    return this.parent.getContext({
      ...this.context,
      ...context,
    });
  }

  private getChildContext(context: Context = {}): Context {
    return {
      ...this.context,
      ...context,
    };
  }

  private getChildOptions(options: OverrideOptions = {}): OverrideOptions & {
    __featurevisorChildStickyFeatures: StickyFeatures;
    __featurevisorChildStickyVariables: StickyVariables;
  } {
    return {
      ...options,
      // This is an SDK-private transport field. Public evaluation options do
      // not accept sticky values; sticky belongs to the child instance.
      __featurevisorChildStickyFeatures: this.stickyFeatures,
      __featurevisorChildStickyVariables: this.stickyVariables,
    };
  }

  setStickyFeatures(stickyFeatures: StickyFeatures, replace = false) {
    const previousStickyFeatures = this.stickyFeatures || {};

    if (replace) {
      this.stickyFeatures = { ...stickyFeatures };
    } else {
      this.stickyFeatures = {
        ...this.stickyFeatures,
        ...stickyFeatures,
      };
    }

    const details = getStickyFeaturesChangeDetails(
      previousStickyFeatures,
      this.stickyFeatures,
      replace,
    );

    this.trigger("sticky_features_set", {
      features: details.features,
      replaced: replace,
    });
    this.trigger("sticky_set", details);
  }

  /** @deprecated Use `setStickyFeatures`. */
  setSticky(stickyFeatures: StickyFeatures, replace = false) {
    this.setStickyFeatures(stickyFeatures, replace);
  }

  setStickyVariables(stickyVariables: StickyVariables, replace = false) {
    const previousKeys = Object.keys(this.stickyVariables);
    this.stickyVariables = replace
      ? { ...stickyVariables }
      : { ...this.stickyVariables, ...stickyVariables };
    const details = {
      features: [],
      variables: [...previousKeys, ...Object.keys(this.stickyVariables)].filter(
        (key, index, keys) => keys.indexOf(key) === index,
      ),
      replaced: replace,
    };
    this.trigger("sticky_variables_set", {
      variables: details.variables,
      replaced: replace,
    });
    this.trigger("sticky_set", details);
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
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): TopLevelVariableEvaluation;
  evaluateVariable(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): Evaluation | TopLevelVariableEvaluation {
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
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
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
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): boolean | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableBoolean(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableBoolean(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): string | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableString(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableString(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableInteger(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableInteger(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableDouble(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableDouble(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableDouble(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableDouble(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  /**
   * Returns an array variable after runtime type checking. The item type defaults
   * to string for compatibility. Pass it explicitly for other array item types.
   */
  getVariableArray<T = string>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = string>(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = string>(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T[] | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableArray<T>(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableArray<T>(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  /** Returns an object variable after runtime type checking. */
  getVariableObject<T = ObjectValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableObject<T>(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableObject<T>(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  /** Returns and parses a JSON variable. */
  getVariableJSON<T = VariableValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    variableKey: TopLevelVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    return typeof variableKeyOrContext === "string"
      ? this.parent.getVariableJSON<T>(
          featureKeyOrVariableKey,
          variableKeyOrContext,
          this.getChildContext(contextOrOptions as Context),
          this.getChildOptions(options),
        )
      : this.parent.getVariableJSON<T>(
          featureKeyOrVariableKey,
          this.getChildContext(variableKeyOrContext),
          this.getChildOptions(contextOrOptions),
        );
  }

  getAllEvaluations(
    context: Context = {},
    featureKeys: string[] = [],
    options: OverrideOptions = {},
  ): EvaluatedFeatures {
    return this.parent.getAllEvaluations(
      this.getChildContext(context),
      featureKeys,
      this.getChildOptions(options),
    );
  }
}
