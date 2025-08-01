import type { Plugin } from "./cli";

import { initPlugin } from "../init";
import { lintPlugin } from "../linter";
import { buildPlugin } from "../builder";
import { testPlugin } from "../tester";
import { generateCodePlugin } from "../generate-code";
import { findDuplicateSegmentsPlugin } from "../find-duplicate-segments";
import { findUsagePlugin } from "../find-usage";
import { benchmarkPlugin } from "../benchmark";
import { configPlugin } from "../config";
import { evaluatePlugin } from "../evaluate";
import { assessDistributionPlugin } from "../assess-distribution";
import { infoPlugin } from "../info";
import { listPlugin } from "../list";
import { sitePlugin } from "../site";

// that do not require an existing project
export const nonProjectPlugins: Plugin[] = [initPlugin];

// that require an existing Featurevisor project
export const projectBasedPlugins: Plugin[] = [
  lintPlugin,
  buildPlugin,
  testPlugin,
  generateCodePlugin,
  findDuplicateSegmentsPlugin,
  findUsagePlugin,
  benchmarkPlugin,
  configPlugin,
  evaluatePlugin,
  assessDistributionPlugin,
  infoPlugin,
  listPlugin,
  sitePlugin,
];

export const commonPlugins: Plugin[] = [];
