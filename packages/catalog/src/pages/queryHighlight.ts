import { CALLS, clauseStarts, lexFql } from "../query/fql";
import { colourExpression } from "../components/expressionTokens";
import { TOKEN_CLASSES } from "../components/trees";

/** A highlighted piece of FQL: its text, and the class that colours it */
export type FqlSegment = { text: string; className?: string };

/**
 * Clause keywords, in the violet family of `and`, `or` and `not`, so FQL's own words share one hue
 * beside the sky of text, the rose of calls and the amber of numbers. A shade stronger than theirs,
 * so on a dark page they stand apart from the near white of names.
 */
export const KEYWORD_CLASS = "font-bold text-violet-700 dark:text-violet-400";

/** FQL coloured as the Catalog colours conditions, with clause keywords in bold */
export function highlight(source: string): FqlSegment[] {
  const segments: FqlSegment[] = [];
  const tokens = lexFql(source);
  let expression: { start: number } | undefined;
  const flushExpression = (end: number) => {
    if (!expression) return;
    const lines = colourExpression(source.slice(expression.start, end));
    lines.forEach((line, index) => {
      if (index > 0) segments.push({ text: "\n" });
      const words = line.filter((token) => token.text.trim() !== "");
      for (const token of line) {
        // FQL's own calls, such as rollout(), and the row's key inside a read, are not segments
        const at = words.indexOf(token);
        const type =
          CALLS.includes(token.text) && words[at + 1]?.text === "("
            ? "call"
            : token.text === "key" && words[at - 1]?.text === "("
              ? "name"
              : token.type;
        segments.push({ text: token.text, className: TOKEN_CLASSES[type] || undefined });
      }
    });
    expression = undefined;
  };
  const starts = clauseStarts(tokens);
  for (const [index, token] of tokens.entries()) {
    const clause = starts.has(index);
    if (expression && !clause) continue;
    if (clause) flushExpression(token.start);
    const className =
      token.type === "keyword"
        ? KEYWORD_CLASS
        : token.type === "word" && tokens[index + 1]?.text === "("
          ? TOKEN_CLASSES.call
          : token.type === "comment"
            ? TOKEN_CLASSES.comment
            : token.type === "string"
              ? TOKEN_CLASSES.string
              : token.type === "number" || ["true", "false", "null"].includes(token.text)
                ? TOKEN_CLASSES.constant
                : token.type === "operator"
                  ? TOKEN_CLASSES.operator
                  : token.type === "punctuation"
                    ? TOKEN_CLASSES.punctuation
                    : undefined;
    segments.push({ text: token.text, className });
    // A WHERE clause is a condition expression, coloured as conditions are
    if (clause && token.text === "WHERE") expression = { start: token.start + token.text.length };
  }
  flushExpression(source.length);
  return segments;
}
