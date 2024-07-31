import type { Plugin } from "./cli";

import { initPlugin } from "../init";

// @TODO: add these plugins
// - [x] init
// - [ ] lint
// - [ ] build
// - [ ] restore
// - [ ] site
// - [ ] serve
// - [ ] generate-code
// - [ ] find-duplicate-segments
// - [ ] find-usage
// - [ ] benchmark
// - [ ] config
// - [ ] evaluate
// - [ ] assess-distribution
// - [ ] info

// that do not require an existing project
export const nonProjectPlugins: Plugin[] = [initPlugin];

// that require an existing Featurevisor project
export const projectBasedPlugins: Plugin[] = [
  // @TODO: implement core plugins
];

export const commonPlugins: Plugin[] = [];
