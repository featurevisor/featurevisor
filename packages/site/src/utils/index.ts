import type { SearchIndex } from "@featurevisor/types";

export interface Query {
  keyword: string;
  tags: string[];
  environments: string[];
  archived?: boolean;
  hasVariations?: boolean;
  hasVariables?: boolean;
  variableKeys?: string[];
  variationValues?: string[];
}

export function parseSearchQuery(queryString: string) {
  const query: Query = {
    keyword: "",
    tags: [],
    environments: [],
    archived: undefined,
  };

  const parts = queryString.split(" ");

  for (const part of parts) {
    if (part.startsWith("tag:")) {
      const tag = part.replace("tag:", "");

      if (tag.length > 0) {
        query.tags.push(tag);
      }
    } else if (part.startsWith("in:")) {
      const environment = part.replace("in:", "");

      if (environment.length > 0) {
        query.environments.push(environment);
      }
    } else if (part.startsWith("archived:")) {
      const archived = part.replace("archived:", "");

      if (archived === "true") {
        query.archived = true;
      } else if (archived === "false") {
        query.archived = false;
      }
    } else if (part.startsWith("variable:")) {
      const variableKey = part.replace("variable:", "");

      if (typeof query.variableKeys === "undefined") {
        query.variableKeys = [];
      }

      if (variableKey.length > 0) {
        query.variableKeys.push(variableKey);
      }
    } else if (part.startsWith("variation:")) {
      const variationValue = part.replace("variation:", "");

      if (typeof query.variationValues === "undefined") {
        query.variationValues = [];
      }

      if (variationValue.length > 0) {
        query.variationValues.push(variationValue);
      }
    } else if (part === "with:variations") {
      query.hasVariations = true;
    } else if (part === "without:variations") {
      query.hasVariations = false;
    } else if (part === "with:variables") {
      query.hasVariables = true;
    } else if (part === "without:variables") {
      query.hasVariables = false;
    } else {
      if (part.length > 0) {
        query.keyword = part;
      }
    }
  }

  return query;
}

export function isEnabledInEnvironment(feature: any, environment: string) {
  if (feature.archived === true) {
    return false;
  }

  if (!Array.isArray(feature.rules)) {
    // with environments
    if (!feature.rules[environment]) {
      return false;
    }

    if (feature.rules[environment].expose === false) {
      return false;
    }

    if (feature.rules[environment].some((rule: any) => rule.percentage > 0)) {
      return true;
    }
  } else if (feature.rules) {
    // no environments
    if (feature.rules.some((rule: any) => rule.percentage > 0)) {
      return true;
    }
  }

  return false;
}

export function isEnabledInAnyEnvironment(feature: any) {
  // no environments
  if (Array.isArray(feature.rules)) {
    if (feature.rules.some((rule: any) => rule.percentage > 0)) {
      return true;
    }

    return false;
  }

  // with environments
  const environments = Object.keys(feature.rules);

  for (const environment of environments) {
    const isEnabled = isEnabledInEnvironment(feature, environment);

    if (isEnabled) {
      return true;
    }
  }

  return false;
}

export function getFeaturesByQuery(query: Query, data: SearchIndex) {
  const features = data.entities.features
    .filter((feature) => {
      let matched = true;

      if (
        query.keyword.length > 0 &&
        feature.key.toLowerCase().indexOf(query.keyword.toLowerCase()) === -1
      ) {
        matched = false;
      }

      if (query.tags.length > 0) {
        for (const tag of query.tags) {
          if (feature.tags.every((t: string) => t.toLowerCase() !== tag.toLowerCase())) {
            matched = false;
          }
        }
      }

      if (query.environments.length > 0 && feature.archived !== false) {
        for (const environment of query.environments) {
          if (isEnabledInEnvironment(feature, environment) === false) {
            matched = false;
          }
        }
      }

      if (typeof query.archived === "boolean") {
        if (query.archived && feature.archived !== query.archived) {
          matched = false;
        }

        if (!query.archived && feature.archived === true) {
          matched = false;
        }
      }

      if (typeof query.hasVariations !== "undefined") {
        if (query.hasVariations && !feature.variations) {
          matched = false;
        }

        if (!query.hasVariations && feature.variations) {
          matched = false;
        }
      }

      if (typeof query.variationValues !== "undefined") {
        if (!feature.variations) {
          matched = false;
        } else {
          const valuesFromFeature = feature.variations.map((v: any) => v.value);

          if (query.variationValues.some((v) => valuesFromFeature.indexOf(v) === -1)) {
            matched = false;
          }
        }
      }

      if (typeof query.variableKeys !== "undefined") {
        if (!feature.variablesSchema) {
          matched = false;
        } else {
          const keysFromFeature = Object.keys(feature.variablesSchema);

          if (query.variableKeys.some((k) => keysFromFeature.indexOf(k) === -1)) {
            matched = false;
          }
        }
      }

      if (typeof query.hasVariables !== "undefined") {
        if (query.hasVariables && !feature.variablesSchema) {
          matched = false;
        }

        if (!query.hasVariables && feature.variablesSchema) {
          matched = false;
        }
      }

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return features;
}

export function getAttributesByQuery(query: Query, data: SearchIndex) {
  const attributes = data.entities.attributes
    .filter((a) => {
      let matched = true;

      if (
        query.keyword.length > 0 &&
        a.key.toLowerCase().indexOf(query.keyword.toLowerCase()) === -1
      ) {
        matched = false;
      }

      if (typeof query.archived === "boolean") {
        if (query.archived && a.archived !== query.archived) {
          matched = false;
        }

        if (!query.archived && a.archived === true) {
          matched = false;
        }
      }

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return attributes;
}

export function getSegmentsByQuery(query: Query, data: SearchIndex) {
  const segments = data.entities.segments
    .filter((a) => {
      let matched = true;

      if (
        query.keyword.length > 0 &&
        a.key.toLowerCase().indexOf(query.keyword.toLowerCase()) === -1
      ) {
        matched = false;
      }

      if (typeof query.archived === "boolean") {
        if (query.archived && a.archived !== query.archived) {
          matched = false;
        }

        if (!query.archived && a.archived === true) {
          matched = false;
        }
      }

      return matched;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return segments;
}
