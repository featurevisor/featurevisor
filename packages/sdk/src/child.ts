import type {
  Context,
  StickyFeatures,
  FeatureKey,
  VariationValue,
  VariableValue,
  EvaluatedFeatures,
} from "@featurevisor/types";

import type { Featurevisor, OverrideOptions } from "./instance.js";
import type { Evaluation } from "./evaluate.js";
import type { EventCallback, EventDetailsByName, EventName } from "./events.js";

function getStickySetEventDetails(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
) {
  const allKeys = [...Object.keys(previousStickyFeatures), ...Object.keys(newStickyFeatures)];

  return {
    features: allKeys.filter((element, index) => allKeys.indexOf(element) === index),
    replaced: replace,
  };
}

type ChildEventName = "context_set" | "sticky_set";

type ChildListeners = {
  [TEventName in ChildEventName]?: EventCallback<TEventName>[];
};

export class FeaturevisorChildInstance {
  private parent: Featurevisor;
  private context: Context;
  private sticky: StickyFeatures;
  private listeners: ChildListeners = {};
  private parentUnsubscribers: (() => void)[] = [];

  constructor(options: { parent: Featurevisor; context: Context; sticky?: StickyFeatures }) {
    this.parent = options.parent;
    this.context = options.context;
    this.sticky = options.sticky || {};
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

  private getChildOptions(
    options: OverrideOptions = {},
  ): OverrideOptions & { __featurevisorChildSticky: StickyFeatures } {
    return {
      ...options,
      // This is an SDK-private transport field. Public evaluation options do
      // not accept sticky values; sticky belongs to the child instance.
      __featurevisorChildSticky: this.sticky,
    };
  }

  setSticky(sticky: StickyFeatures, replace = false) {
    const previousStickyFeatures = this.sticky || {};

    if (replace) {
      this.sticky = { ...sticky };
    } else {
      this.sticky = {
        ...this.sticky,
        ...sticky,
      };
    }

    const params = getStickySetEventDetails(previousStickyFeatures, this.sticky, replace);

    this.trigger("sticky_set", params);
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

  getVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): VariationValue | null {
    return this.parent.getVariation(
      featureKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  evaluateVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return this.parent.evaluateVariable(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): VariableValue | null {
    return this.parent.getVariable(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): boolean | null {
    return this.parent.getVariableBoolean(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): string | null {
    return this.parent.getVariableString(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): number | null {
    return this.parent.getVariableInteger(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): number | null {
    return this.parent.getVariableDouble(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableArray<T = string>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T[] | null {
    return this.parent.getVariableArray<T>(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableObject<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T | null {
    return this.parent.getVariableObject<T>(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
    );
  }

  getVariableJSON<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T | null {
    return this.parent.getVariableJSON<T>(
      featureKey,
      variableKey,
      this.getChildContext(context),
      this.getChildOptions(options),
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
