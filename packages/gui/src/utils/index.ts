import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Query {
  keyword: string;
  tags: string[];
  environments: string[];
  archived?: boolean;
  capture?: boolean;
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

  if (!feature.environments[environment]) {
    return false;
  }

  if (feature.environments[environment].expose === false) {
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

export function sortEnvironmentNames(envNames: string[]): string[] {
  const devNames: string[] = [];
  const testNames: string[] = [];
  const prodNames: string[] = [];
  const otherNames: string[] = [];

  for (const name of envNames) {
    if (name.startsWith("dev")) {
      devNames.push(name);
    } else if (name.startsWith("test")) {
      testNames.push(name);
    } else if (name.startsWith("prod")) {
      prodNames.push(name);
    } else {
      otherNames.push(name);
    }
  }

  devNames.sort();
  testNames.sort();
  prodNames.sort();
  otherNames.sort();

  return [...devNames, ...testNames, ...otherNames, ...prodNames];
}
