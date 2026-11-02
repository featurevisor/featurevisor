import type { ExpressionOptions } from "@featurevisor/expressions";
import type { CustomParser } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { CONDITION_KINDS, simplifyConditions, type ConditionKind } from "../rewrite/conditions";
import { load, render } from "../rewrite/documents";

/** The source with its conditions simplified, and the comment lines moved into expressions */
export interface SimplifiedSource {
  source: string;
  moved: string[];
}

/**
 * The source with each condition in its simplest form that evaluates the same, the rest of
 * the file as written, for fmt's --simplify to format next. Only `conditions` values change.
 * Undefined when the parser cannot read it back, which fmt then reports.
 */
export function simplifySource(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  expressions?: ExpressionOptions,
): SimplifiedSource | undefined {
  if (!CONDITION_KINDS.includes(entityType)) return { source, moved: [] };
  const { doc } = load(source, parser);
  const result = simplifyConditions(
    doc,
    entityType as ConditionKind,
    parser.parse(source),
    expressions,
  );
  if (result.changed === 0) return { source, moved: [] };
  const rendered = render(source, doc, parser);
  return rendered ? { source: rendered.text, moved: result.moved } : undefined;
}
