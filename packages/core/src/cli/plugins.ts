import type { Plugin } from "./cli";

import { initPlugin } from "../init";
import { lintPlugin } from "../linter";
import { buildPlugin } from "../builder";
import { restorePlugin } from "../restore";
import { testPlugin } from "../tester";

// that do not require an existing project
export const nonProjectPlugins: Plugin[] = [initPlugin];

// that require an existing Featurevisor project
export const projectBasedPlugins: Plugin[] = [
  lintPlugin,
  buildPlugin,
  restorePlugin,
  testPlugin,
  // sitePlugin,
  // generateCodePlugin,
  // findDuplicateSegmentsPlugin,
  // findUsagePlugin,
  // benchmarkPlugin,
  // configPlugin,
  // evaluatePlugin,
  // assessDistributionPlugin,
  // infoPlugin,
];

export const commonPlugins: Plugin[] = [];
