// React server components cannot create a context, so this runs on the client.
"use client";

import * as React from "react";
import type { Context } from "@featurevisor/types";
import { mergeContext } from "@featurevisor/signals";

/** The merged context of the enclosing scopes, undefined outside any scope. */
export const ScopeContext = React.createContext<Context | undefined>(undefined);

/**
 * The context a hook evaluates with: its own context merged over the enclosing
 * scopes. Outside any scope it is the same object, so the SDK receives exactly
 * what it did before scopes existed.
 */
export function useScopedContext(context: Context): Context {
  const scope = React.useContext(ScopeContext);

  return scope ? mergeContext(scope, context) : context;
}
