import * as React from "react";
import type { Context } from "@featurevisor/types";

import { ScopeContext } from "./scope.js";

/**
 * The context the enclosing `FeaturevisorScope` components add, merged from
 * the outermost in, or undefined outside any scope. The flag hooks merge it
 * over the instance context, and packages whose hooks evaluate or validate
 * with a context read it to do the same.
 */
export function useScopeContext(): Context | undefined {
  return React.useContext(ScopeContext);
}
