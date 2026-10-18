/** Match prerequisite groups, reusing the leaf matcher throughout the tree. */
export function matchGroup<T>(
  expression: { and?: T[]; or?: T[]; not?: T[] } | T[],
  match: (value: T) => boolean,
): boolean {
  if ("and" in expression && Array.isArray(expression.and))
    return expression.and.length > 0 && expression.and.every(match);
  if ("or" in expression && Array.isArray(expression.or)) return expression.or.some(match);
  if ("not" in expression && Array.isArray(expression.not))
    return expression.not.length > 0 && !expression.not.every(match);
  return Array.isArray(expression) && expression.length > 0 && expression.every(match);
}
