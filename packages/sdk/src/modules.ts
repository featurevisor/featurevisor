import type { BucketBy, Context, FeatureKey } from "@featurevisor/types";

import type { EvaluateOptions, Evaluation } from "./evaluate.js";
import type { BucketKey, BucketValue } from "./bucketer.js";
import type {
  FeaturevisorDiagnosticHandler,
  FeaturevisorDiagnosticReporter,
  FeaturevisorModuleReportedDiagnostic,
  FeaturevisorModuleDiagnosticOptions,
} from "./diagnostics.js";

/**
 * bucketKey
 */
export interface ConfigureBucketKeyOptions {
  featureKey: FeatureKey;
  context: Context;
  bucketBy: BucketBy;
  bucketKey: string; // the initial bucket key, which can be modified by modules
}

export type ConfigureBucketKey = (options: ConfigureBucketKeyOptions) => BucketKey;

/**
 * bucketValue
 */
export interface ConfigureBucketValueOptions {
  featureKey: FeatureKey;
  bucketKey: string;
  context: Context;
  bucketValue: number; // the initial bucket value, which can be modified by modules
}

export type ConfigureBucketValue = (options: ConfigureBucketValueOptions) => BucketValue;

export type FeaturevisorUnsubscribe = () => void;
export type FeaturevisorModuleUnsubscribe = () => Promise<void>;

export interface FeaturevisorModuleApi {
  getRevision: () => string;
  onDiagnostic: (
    handler: FeaturevisorDiagnosticHandler,
    options?: FeaturevisorModuleDiagnosticOptions,
  ) => FeaturevisorUnsubscribe;
  reportDiagnostic: (diagnostic: FeaturevisorModuleReportedDiagnostic) => void;
}

/**
 * Modules
 */
export interface FeaturevisorModule {
  name?: string;

  setup?: (api: FeaturevisorModuleApi) => void;

  before?: (options: EvaluateOptions) => EvaluateOptions;

  bucketKey?: ConfigureBucketKey;

  bucketValue?: ConfigureBucketValue;

  after?: (evaluation: Evaluation, options: EvaluateOptions) => Evaluation;

  close?: () => void | Promise<void>;
}

export interface ModulesManagerOptions {
  modules?: FeaturevisorModule[];
  reportDiagnostic: FeaturevisorDiagnosticReporter;
  getModuleApi: (module: FeaturevisorModule) => FeaturevisorModuleApi;
  clearModuleDiagnosticSubscriptions: (module: FeaturevisorModule) => void;
}

export class ModulesManager {
  private modules: FeaturevisorModule[] = [];
  private reportDiagnostic: FeaturevisorDiagnosticReporter;
  private getModuleApi: (module: FeaturevisorModule) => FeaturevisorModuleApi;
  private clearModuleDiagnosticSubscriptions: (module: FeaturevisorModule) => void;

  constructor(options: ModulesManagerOptions) {
    this.reportDiagnostic = options.reportDiagnostic;
    this.getModuleApi = options.getModuleApi;
    this.clearModuleDiagnosticSubscriptions = options.clearModuleDiagnosticSubscriptions;

    if (options.modules) {
      options.modules.forEach((module) => {
        this.add(module);
      });
    }
  }

  private async closeModule(module: FeaturevisorModule): Promise<void> {
    try {
      await module.close?.();
    } catch (error) {
      this.reportDiagnostic({
        level: "error",
        code: "module_close_error",
        message: "Module close failed",
        moduleName: module.name,
        originalError: error,
      });
    }
  }

  add(module: FeaturevisorModule): FeaturevisorModuleUnsubscribe | undefined {
    if (module.name && this.modules.some((existingModule) => existingModule.name === module.name)) {
      this.reportDiagnostic({
        level: "error",
        code: "duplicate_module",
        message: "Duplicate module name",
        moduleName: module.name,
      });

      return;
    }

    module.setup?.(this.getModuleApi(module));
    this.modules.push(module);

    return async () => {
      const moduleExists = this.modules.indexOf(module) !== -1;
      this.modules = this.modules.filter((existingModule) => existingModule !== module);
      this.clearModuleDiagnosticSubscriptions(module);

      if (moduleExists) {
        await this.closeModule(module);
      }
    };
  }

  async remove(name: string): Promise<void> {
    const removedModules = this.modules.filter((module) => module.name === name);

    this.modules = this.modules.filter((module) => module.name !== name);
    for (const module of removedModules) {
      this.clearModuleDiagnosticSubscriptions(module);
      await this.closeModule(module);
    }
  }

  getAll(): FeaturevisorModule[] {
    return this.modules;
  }

  async closeAll() {
    const modules = this.modules.slice();
    this.modules = [];

    for (const module of modules) {
      this.clearModuleDiagnosticSubscriptions(module);
      await this.closeModule(module);
    }
  }
}
