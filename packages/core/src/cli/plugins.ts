import type { Plugin } from "./cli";

import { initPlugin } from "../init";
import { lintPlugin } from "../linter";
import { buildPlugin } from "../builder";
import { restorePlugin } from "../restore";
import { testPlugin } from "../tester";
import { generateCodePlugin } from "../generate-code";
import { findDuplicateSegmentsPlugin } from "../find-duplicate-segments";
import { findUsagePlugin } from "../find-usage";
import { benchmarkPlugin } from "../benchmark";
import { configPlugin } from "../config";
import { evaluatePlugin } from "../evaluate";
import { assessDistributionPlugin } from "../assess-distribution";
import { infoPlugin } from "../info";

// that do not require an existing project
export const nonProjectPlugins: Plugin[] = [initPlugin];

// that require an existing Featurevisor project
export const projectBasedPlugins: Plugin[] = [
  lintPlugin,
  buildPlugin,
  restorePlugin,
  testPlugin,
  generateCodePlugin,
  findDuplicateSegmentsPlugin,
  findUsagePlugin,
  benchmarkPlugin,
  configPlugin,
  evaluatePlugin,
  assessDistributionPlugin,
  infoPlugin,
  // sitePlugin,
];

export const commonPlugins: Plugin[] = [];
