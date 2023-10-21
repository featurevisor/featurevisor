import { SearchIndex } from "@featurevisor/types";

export interface Query {
  keyword: string;
  tags: string[];
  environments: string[];
  archived?: boolean;
  capture?: boolean;
}

export function parseSearchQuery(queryString: string) {
  const query: Query = {
    keyword: "",
    tags: [],
    environments: [],
    archived: undefined,
    capture: undefined,
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
    } else if (part.startsWith("capture:")) {
      const capture = part.replace("capture:", "");

      if (capture === "true") {
        query.capture = true;
      } else if (capture === "false") {
        query.capture = false;
      }
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

  if (!feature.environments[environment]) {
    return false;
  }

  if (feature.environments[environment].exposed === false) {
    return false;
  }

  if (feature.environments[environment].rules.some((rule: any) => rule.percentage > 0)) {
    return true;
  }

  return false;
}

export function isEnabledInAnyEnvironment(feature: any) {
  const environments = Object.keys(feature.environments);

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

      if (query.keyword.length > 0 && feature.key.indexOf(query.keyword.toLowerCase()) === -1) {
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

      if (typeof query.capture === "boolean") {
        if (query.capture && a.capture !== query.capture) {
          matched = false;
        }

        if (!query.capture && a.capture === true) {
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
