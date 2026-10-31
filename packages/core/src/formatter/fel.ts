import { formatExpression, type FelOptions } from "@featurevisor/fel";
import { applyFormatText, type FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import {
  expandDefinitionFel,
  FelExpressionError,
  getFelExpressions,
  type FelExpressionRecord,
} from "../datasource/fel";
import { HOUSE_STYLE } from "./style";

/** The FEL options fmt formats expressions with, or undefined when the project has no FEL */
export function getFormatFelOptions(config: ProjectConfig): FelOptions | undefined {
  return config.allowFEL ? { namespaceCharacter: config.namespaceCharacter } : undefined;
}

/** House style texts of FEL expressions, by the JSON of their path in the definition */
export type FelTexts = Map<string, string>;

function findExpressions(
  entityType: EntityType,
  value: unknown,
  options: FelOptions,
): FelExpressionRecord[] {
  if (entityType !== "feature" && entityType !== "segment" && entityType !== "variable") return [];
  try {
    return getFelExpressions(expandDefinitionFel(entityType, "", value, options));
  } catch (error) {
    // the expressions that compile are formatted, and the others left for lint to report
    if (error instanceof FelExpressionError) return error.expressions;
    throw error;
  }
}

/**
 * Each FEL expression in a definition that the house style writes differently, as it would
 * write it. An expression with an error, or one fel's formatter leaves as written, has none.
 */
export function getFelTexts(entityType: EntityType, value: unknown, options: FelOptions): FelTexts {
  const texts: FelTexts = new Map();
  for (const record of findExpressions(entityType, value, options)) {
    if (record.errors.length > 0) continue;
    let text = formatExpression(record.source, {
      ...options,
      root: record.path.length === record.conditionsPath.length,
      width: HOUSE_STYLE.fel.width,
    });
    if (text === undefined) continue;
    if (HOUSE_STYLE.fel.finalNewline && text.includes("\n")) text += "\n";
    if (text !== record.source) texts.set(JSON.stringify(record.path), text);
  }
  return texts;
}

/** The layout's formatText for these texts */
export function formatTextOf(texts: FelTexts) {
  return (path: FormatPath) => texts.get(JSON.stringify(path));
}

function valueAt(value: unknown, path: FormatPath): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

/**
 * The value as formatting should leave it: each expression in the house style, except where
 * the parser kept it as written, such as on a line marked with the ignore comment. Any other
 * difference from the formatted value is a fault the guard catches.
 */
export function withFelTexts<T>(value: T, texts: FelTexts, formatted: unknown): T {
  const applied: FelTexts = new Map();
  for (const [key, text] of texts) {
    if (valueAt(formatted, JSON.parse(key)) === text) applied.set(key, text);
  }
  return applied.size > 0 ? applyFormatText(value, formatTextOf(applied)) : value;
}
