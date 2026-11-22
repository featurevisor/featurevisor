// A server component, such as a Next.js page, can render it around client
// components, passing a context made of plain values.
"use client";

import * as React from "react";
import type { Context } from "@featurevisor/types";

import { mergeContext, sameValue } from "@featurevisor/signals";

import { ScopeContext } from "./scope.js";

export interface FeaturevisorScopeProps {
  /** Merged over the instance context and any enclosing scope, for every hook below. */
  context: Context;
  children: React.ReactNode;
}

/**
 * Adds context for every hook below it. It is merged over the instance context
 * and any enclosing scope, and each hook's own context argument is merged over
 * it. A context with the same values, such as an inline object, including
 * nested objects, arrays and dates, keeps the value already provided, so
 * nothing below renders again.
 *
 * Its return type is declared, like FeaturevisorProvider's, so the published
 * declarations work with older @types/react releases.
 */
export function FeaturevisorScope(props: FeaturevisorScopeProps): React.ReactElement {
  const outer = React.useContext(ScopeContext);
  const merged = mergeContext(outer || {}, props.context);

  // Equal values keep the previous object. Replacing it with an equal one in a
  // render React discards would change nothing anyone reads.
  const provided = React.useRef(merged);
  if (!sameValue(provided.current, merged)) {
    provided.current = merged;
  }

  return <ScopeContext.Provider value={provided.current}>{props.children}</ScopeContext.Provider>;
}
