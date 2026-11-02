import type { ExpressionPosition } from "./types.js";

/** Turns offsets into one based lines and columns, for one source string. */
export function createPositionResolver(source: string): (offset: number) => ExpressionPosition {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  return (offset: number) => {
    const clamped = Math.max(0, Math.min(offset, source.length));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= clamped) low = middle;
      else high = middle - 1;
    }
    return { offset: clamped, line: low + 1, column: clamped - lineStarts[low] + 1 };
  };
}
