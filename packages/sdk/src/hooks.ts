import type { BucketBy, Context, FeatureKey } from "@featurevisor/types";

import type { EvaluateOptions, Evaluation } from "./evaluation";
import type { Logger } from "./logger";
import type { BucketKey, BucketValue } from "./bucketer";

/**
 * bucketKey
 */
export interface ConfigureBucketKeyOptions {
  featureKey: FeatureKey;
  context: Context;
  bucketBy: BucketBy;
  bucketKey: string; // the initial bucket key, which can be modified by hooks
}

export type ConfigureBucketKey = (options: ConfigureBucketKeyOptions) => BucketKey;

/**
 * bucketValue
 */
export interface ConfigureBucketValueOptions {
  featureKey: FeatureKey;
  bucketKey: string;
  context: Context;
  bucketValue: number; // the initial bucket value, which can be modified by hooks
}

export type ConfigureBucketValue = (options: ConfigureBucketValueOptions) => BucketValue;

/**
 * Hooks
 */
export interface Hook {
  name: string;

  before?: (options: EvaluateOptions) => EvaluateOptions;

  bucketKey?: ConfigureBucketKey;

  bucketValue?: ConfigureBucketValue;

  after?: (evaluation: Evaluation, options: EvaluateOptions) => Evaluation;
}

export interface HooksManagerOptions {
  hooks?: Hook[];
  logger: Logger;
}

export class HooksManager {
  private hooks: Hook[] = [];
  private logger: Logger;

  constructor(options: HooksManagerOptions) {
    this.logger = options.logger;

    if (options.hooks) {
      options.hooks.forEach((hook) => {
        this.add(hook);
      });
    }
  }

  add(hook: Hook): (() => void) | undefined {
    if (this.hooks.some((existingHook) => existingHook.name === hook.name)) {
      this.logger.error(`Hook with name "${hook.name}" already exists.`, {
        name: hook.name,
        hook: hook,
      });

      return;
    }

    this.hooks.push(hook);

    return () => {
      this.remove(hook.name);
    };
  }

  remove(name: string): void {
    this.hooks = this.hooks.filter((hook) => hook.name !== name);
  }

  getAll(): Hook[] {
    return this.hooks;
  }
}
