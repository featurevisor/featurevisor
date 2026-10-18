import * as React from "react";
import { Navigate } from "react-router-dom";

import { getBasePath, encodeRouteSegment } from "../../entityTypes";
import { EmptyState } from "../../components/ui";
import { FeatureVariablesList, type VariableSetter } from "../../components/variables";
import {
  getVariationOverrideId,
  getVariationSlug,
  getVariationVariableId,
  rootVariableKey,
} from "../../components/variations";
import { ReferenceChips, getFeatureReaders } from "../../components/dependencies";
import { getEnvironmentMap, slugifyFragment, useEntityDetail } from "./shared";

/**
 * Every place in a feature that sets each variable: variations, rules and force entries, in
 * every environment. Mutation keys such as "methods:appendUnique" count for their variable.
 */
export function getVariableSetters(
  entity: Record<string, any>,
  basePath: string,
  featureKey: string,
): Record<string, VariableSetter[]> {
  const setters: Record<string, VariableSetter[]> = Object.create(null);
  const featureRoute = `${basePath}/features/${encodeRouteSegment(featureKey)}`;
  const add = (keys: string[], setter: VariableSetter) => {
    for (const name of new Set(keys.map(rootVariableKey))) {
      const list = (setters[name] ||= []);
      if (!list.some((item) => item.to === setter.to)) list.push(setter);
    }
  };
  for (const variation of Array.isArray(entity.variations) ? entity.variations : []) {
    const slug = getVariationSlug(variation);
    for (const key of Object.keys(variation.variables || {}))
      add([key], {
        label: `variation ${variation.value}`,
        to: `${featureRoute}/variations#${getVariationVariableId(slug, key)}`,
      });
    for (const key of Object.keys(variation.variableOverrides || {}))
      add([key], {
        label: `variation ${variation.value} overrides`,
        to: `${featureRoute}/variations#${getVariationOverrideId(slug, key)}`,
      });
  }
  for (const [environment, rules] of getEnvironmentMap(entity.rules)) {
    for (const [index, rule] of (Array.isArray(rules) ? rules : []).entries()) {
      const ruleKey = String(rule?.key || `#${index + 1}`);
      const anchor = slugifyFragment(["rules", environment, ruleKey].filter(Boolean).join("-"));
      const setter = {
        label: `rule ${ruleKey}${environment ? ` in ${environment}` : ""}`,
        to: `${featureRoute}/rules${environment ? `/${environment}` : ""}#${anchor}`,
      };
      add(
        [...Object.keys(rule?.variables || {}), ...Object.keys(rule?.variableOverrides || {})],
        setter,
      );
    }
  }
  for (const [environment, entries] of getEnvironmentMap(entity.force)) {
    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      add(Object.keys(entry?.variables || {}), {
        label: `force #${index + 1}${environment ? ` in ${environment}` : ""}`,
        to: `${featureRoute}/force${environment ? `/${environment}` : ""}`,
      });
    }
  }
  return setters;
}

export function FeatureVariablesTab() {
  const { detail, setKey } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variablesSchema = entity.variablesSchema || {};

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (Object.keys(variablesSchema).length === 0) {
    return <EmptyState title="No variables found" />;
  }

  const readBy = new Map<string, React.ReactNode>();
  for (const [variable, owners] of getFeatureReaders(detail).variables) {
    readBy.set(variable, <ReferenceChips references={owners} setKey={setKey} />);
  }

  return (
    <FeatureVariablesList
      variablesSchema={variablesSchema}
      setKey={setKey}
      setBy={getVariableSetters(entity, getBasePath(setKey), detail.key)}
      readBy={readBy}
    />
  );
}
