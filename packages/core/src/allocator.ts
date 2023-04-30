import { Range, Percentage } from "@featurevisor/types";

export function getAllocation(availableRanges: Range[], fill: Percentage): Range[] {
  const result: Range[] = [];

  let remaining = fill;
  let i = 0;
  while (remaining > 0 && i < availableRanges.length) {
    const range = availableRanges[i];
    const rangeFill = Math.min(remaining, range.end - range.start);
    result.push({
      start: range.start,
      end: range.start + rangeFill,
    });
    remaining -= rangeFill;
    i++;
  }

  return result;
}

export function getUpdatedAvailableRangesAfterFilling(
  availableRanges: Range[],
  fill: Percentage,
): Range[] {
  const result: Range[] = [];

  let remaining = fill;
  let i = 0;
  while (remaining > 0 && i < availableRanges.length) {
    const range = availableRanges[i];
    const rangeFill = Math.min(remaining, range.end - range.start);
    if (rangeFill < range.end - range.start) {
      result.push({
        start: range.start + rangeFill,
        end: range.end,
      });
    }
    remaining -= rangeFill;
    i++;
  }

  return result;
}
