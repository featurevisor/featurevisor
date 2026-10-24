// A server component, such as a Next.js page, can render it around client
// components, passing a context made of plain values.
"use client";

import * as React from "react";
import type { Context } from "@featurevisor/types";

import { mergeContext, ScopeContext } from "./scope.js";

export interface FeaturevisorScopeProps {
  /** Merged over the instance context and any enclosing scope, for every hook below. */
  context: Context;
  children: React.ReactNode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Compares context values by what they hold. Attribute values are strings,
 * numbers, booleans, dates, arrays and plain objects, so an inline context with
 * nested objects is equal to the one before it when its values are.
 */
function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;

  if (first instanceof Date && second instanceof Date) {
    return first.getTime() === second.getTime();
  }

  if (Array.isArray(first) && Array.isArray(second)) {
    return (
      first.length === second.length && first.every((item, index) => sameValue(item, second[index]))
    );
  }

  if (isPlainObject(first) && isPlainObject(second)) {
    const keys = Object.keys(first);

    return (
      keys.length === Object.keys(second).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(second, key) && sameValue(first[key], second[key]),
      )
    );
  }

  return false;
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
