import type {
  Context,
  StickyFeatures,
  FeatureKey,
  VariationValue,
  VariableValue,
  EvaluatedFeatures,
} from "@featurevisor/types";

import { EventName, EventCallback, Emitter } from "./emitter";
import type { FeaturevisorInstance, OverrideOptions } from "./instance";
import { getParamsForStickySetEvent } from "./events";

export class FeaturevisorChildInstance {
  private parent: FeaturevisorInstance;
  private context: Context;
  private sticky: StickyFeatures;
  private emitter: Emitter;

  constructor(options) {
    this.parent = options.parent;
    this.context = options.context;
    this.sticky = options.sticky || {};
    this.emitter = new Emitter();
  }

  on(eventName: EventName, callback: EventCallback) {
    if (eventName === "context_set" || eventName === "sticky_set") {
      return this.emitter.on(eventName, callback);
    }

    return this.parent.on(eventName, callback);
  }

  close() {
    this.emitter.clearAll();
  }

  setContext(context: Context, replace = false) {
    if (replace) {
      this.context = context;
    } else {
      this.context = { ...this.context, ...context };
    }

    this.emitter.trigger("context_set", {
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

    const params = getParamsForStickySetEvent(previousStickyFeatures, this.sticky, replace);

    this.emitter.trigger("sticky_set", params);
  }

  isEnabled(featureKey: FeatureKey, context: Context = {}, options: OverrideOptions = {}): boolean {
    return this.parent.isEnabled(
      featureKey,
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
    );
  }

  getVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): VariationValue | null {
    return this.parent.getVariation(
      featureKey,
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
    );
  }

  getVariableArray(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): string[] | null {
    return this.parent.getVariableArray(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
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
      {
        ...this.context,
        ...context,
      },
      {
        sticky: this.sticky,
        ...options,
      },
    );
  }

  getAllEvaluations(
    context: Context = {},
    featureKeys: string[] = [],
    options: OverrideOptions = {},
  ): EvaluatedFeatures {
    return this.parent.getAllEvaluations(
      {
        ...this.context,
        ...context,
      },
      featureKeys,
      {
        sticky: this.sticky,
        ...options,
      },
    );
  }
}
