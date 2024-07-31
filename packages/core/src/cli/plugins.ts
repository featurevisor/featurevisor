import type { Plugin } from "./cli";

// that do not require an existing project
export const nonProjectPlugins: Plugin[] = [
  // ...
];

// that require an existing Featurevisor project
export const projectBasedPlugins: Plugin[] = [
  // @TODO: implement core plugins
];

export const commonPlugins: Plugin[] = [];
