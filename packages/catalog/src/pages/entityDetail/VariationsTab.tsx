import { Navigate } from "react-router-dom";

import * as React from "react";

import { EmptyState } from "../../components/ui";
import { FeatureVariationsList, VariableValuesTable } from "../../components/variations";
import { ReferenceChips, getFeatureReaders } from "../../components/dependencies";
import { useEntityDetail } from "./shared";

export function FeatureVariationsTab() {
  const { detail, setKey } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variations = entity.variations || [];

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (variations.length === 0) {
    return <EmptyState title="No variations found" />;
  }

  const variablesSchema = (entity.variablesSchema || {}) as Record<string, unknown>;
  const checkedBy = new Map<string, React.ReactNode>();
  for (const [variation, owners] of getFeatureReaders(detail).variations) {
    checkedBy.set(variation, <ReferenceChips references={owners} setKey={setKey} />);
  }
  return (
    <div className="space-y-6">
      <VariableValuesTable variations={variations} variablesSchema={variablesSchema} />
      <FeatureVariationsList
        variations={variations}
        featureHasVariables={Object.keys(variablesSchema).length > 0}
        checkedBy={checkedBy}
        setKey={setKey}
      />
    </div>
  );
}
