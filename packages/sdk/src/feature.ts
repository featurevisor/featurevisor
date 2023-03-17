import {
  Allocation,
  Attributes,
  Traffic,
  Feature,
  Variation,
  VariableKey,
  VariableValue,
  Force,
} from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import { allGroupSegmentsAreMatched } from "./segments";
import { allConditionsAreMatched } from "./conditions";

export function getMatchedTraffic(
  traffic: Traffic[],
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): Traffic | undefined {
  return traffic.find((traffic) => {
    if (bucketValue > traffic.percentage) {
      // out of bucket range
      return false;
    }

    if (
      !allGroupSegmentsAreMatched(
        typeof traffic.segments === "string" && traffic.segments !== "*"
          ? JSON.parse(traffic.segments)
          : traffic.segments,
        attributes,
        datafileReader,
      )
    ) {
      return false;
    }

    return true;
  });
}

// @TODO: make this function better with tests
export function getMatchedAllocation(
  matchedTraffic: Traffic,
  bucketValue: number,
): Allocation | undefined {
  let total = 0;

  for (const allocation of matchedTraffic.allocation) {
    total += allocation.percentage;

    if (bucketValue <= total) {
      return allocation;
    }
  }

  return undefined;
}

function findForceFromFeature(
  feature: Feature,
  attributes: Attributes,
  datafileReader: DatafileReader,
): Force | undefined {
  if (!feature.force) {
    return undefined;
  }

  return feature.force.find((f: Force) => {
    if (f.conditions) {
      return allConditionsAreMatched(f.conditions, attributes);
    }

    if (f.segments) {
      return allGroupSegmentsAreMatched(f.segments, attributes, datafileReader);
    }

    return false;
  });
}

export function getForcedVariation(
  feature: Feature,
  attributes: Attributes,
  datafileReader: DatafileReader,
): Variation | undefined {
  const force = findForceFromFeature(feature, attributes, datafileReader);

  if (!force || !force.variation) {
    return undefined;
  }

  return feature.variations.find((v) => v.value === force.variation);
}

export function getBucketedVariation(
  feature: Feature,
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): Variation | undefined {
  const matchedTraffic = getMatchedTraffic(
    feature.traffic,
    attributes,
    bucketValue,
    datafileReader,
  );

  if (!matchedTraffic) {
    return undefined;
  }

  const allocation = getMatchedAllocation(matchedTraffic, bucketValue);

  if (!allocation) {
    return undefined;
  }

  const variationValue = allocation.variation;

  const variation = feature.variations.find((v) => {
    return v.value === variationValue;
  });

  if (!variation) {
    return undefined;
  }

  return variation;
}

export function getForcedVariableValue(
  feature: Feature,
  variableKey: VariableKey,
  attributes: Attributes,
  datafileReader: DatafileReader,
): VariableValue | undefined {
  const force = findForceFromFeature(feature, attributes, datafileReader);

  if (!force || !force.variables) {
    return undefined;
  }

  return force.variables[variableKey];
}

export function getBucketedVariableValue(
  feature: Feature,
  variableKey: VariableKey,
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): VariableValue | undefined {
  // all variables
  const variablesSchema = feature.variablesSchema;

  if (!variablesSchema) {
    return undefined;
  }

  // single variable
  const variableSchema = variablesSchema.find((v) => {
    return v.key === variableKey;
  });

  if (!variableSchema) {
    return undefined;
  }

  const variation = getBucketedVariation(feature, attributes, bucketValue, datafileReader);

  if (!variation) {
    return undefined;
  }

  const variableFromVariation = variation.variables?.find((v) => {
    return v.key === variableKey;
  });

  if (!variableFromVariation) {
    return variableSchema.defaultValue;
  }

  if (variableFromVariation.overrides) {
    const override = variableFromVariation.overrides.find((o) => {
      if (o.conditions) {
        return allConditionsAreMatched(
          typeof o.conditions === "string" ? JSON.parse(o.conditions) : o.conditions,
          attributes,
        );
      }

      if (o.segments) {
        return allGroupSegmentsAreMatched(
          typeof o.segments === "string" && o.segments !== "*"
            ? JSON.parse(o.segments)
            : o.segments,
          attributes,
          datafileReader,
        );
      }

      return false;
    });

    if (override) {
      return override.value;
    }
  }

  return variableFromVariation.value;
}
