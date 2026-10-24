import * as React from "react";
import type { Context } from "@featurevisor/types";

import { mergeContext, ScopeContext } from "./scope.js";

export interface FeaturevisorScopeProps {
  /** Merged over the instance context and any enclosing scope, for every hook below. */
  context: Context;
  children: React.ReactNode;
}

function sameContext(first: Context, second: Context): boolean {
  const keys = Object.keys(first);

  return (
    keys.length === Object.keys(second).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(second, key) && Object.is(first[key], second[key]),
    )
  );
}

/**
 * Adds context for every hook below it. It is merged over the instance context
 * and any enclosing scope, and each hook's own context argument is merged over
 * it. A context with the same keys and values, such as an inline object, keeps
 * the value already provided, so nothing below renders again.
 */
export function FeaturevisorScope(props: FeaturevisorScopeProps) {
  const outer = React.useContext(ScopeContext);
  const merged = mergeContext(outer || {}, props.context);

  // Equal values keep the previous object. Replacing it with an equal one in a
  // render React discards would change nothing anyone reads.
  const provided = React.useRef(merged);
  if (!sameContext(provided.current, merged)) {
    provided.current = merged;
  }

  return <ScopeContext.Provider value={provided.current}>{props.children}</ScopeContext.Provider>;
}
