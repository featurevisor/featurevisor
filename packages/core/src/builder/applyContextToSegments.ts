import type { Conditions, Context } from "@featurevisor/types";
import type { Featurevisor } from "@featurevisor/sdk";
import { applyContextToConditions, removeRedundantConditions } from "./applyContextToConditions";

/** Transitional internal entry points now share the mixed condition specializer. */
export function applyContextToSegments(
  featurevisor: Featurevisor,
  conditions: Conditions,
  context: Context,
  _removeSegments: string[] = [],
): Conditions {
  // Old hints cannot override dependency expressions discovered at build time.
  void _removeSegments;
  return applyContextToConditions(featurevisor, conditions, context);
}
export const removeRedundantGroupSegments = removeRedundantConditions;
export const applyContextToGroupSegments = applyContextToSegments;
