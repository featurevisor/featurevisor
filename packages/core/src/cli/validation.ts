import { FeaturevisorCLIError } from "../error";

export function parseRegexOption(name: string, value: unknown, flags = "") {
  if (value instanceof RegExp) {
    return value;
  }

  try {
    return new RegExp(String(value), flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FeaturevisorCLIError(`Invalid ${name}: ${detail}`, {
      code: "invalid_regular_expression",
      details: { option: name, value: String(value) },
    });
  }
}

export function parseJsonOption(name: string, value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FeaturevisorCLIError(`Invalid ${name}: ${detail}`, {
      code: "invalid_json",
      details: { option: name, value },
    });
  }
}

export function parseJsonObjectOption<T extends object = Record<string, unknown>>(
  name: string,
  value: unknown,
) {
  const parsed = parseJsonOption(name, value);

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new FeaturevisorCLIError(`${name} must contain a JSON object.`, {
      code: "invalid_json_type",
      details: { option: name, value },
    });
  }

  return parsed as T;
}

export function parsePositiveIntegerOption(name: string, value: unknown, fallback: number) {
  if (typeof value === "undefined") {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FeaturevisorCLIError(`${name} must be a positive integer.`, {
      code: "invalid_number",
      details: { option: name, value },
    });
  }

  return parsed;
}
