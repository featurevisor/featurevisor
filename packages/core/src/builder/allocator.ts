import { Range, Percentage } from "@featurevisor/types";

export function getAllocation(availableRanges: Range[], fill: Percentage): Range[] {
  const result: Range[] = [];

  let remaining = fill;
  let i = 0;
  while (remaining > 0 && i < availableRanges.length) {
    const range = availableRanges[i];
    const [start, end] = range;

    const rangeFill = Math.min(remaining, end - start);
    result.push([start, start + rangeFill]);
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
    const [start, end] = range;
    const rangeFill = Math.min(remaining, end - start);
    if (rangeFill < end - start) {
      result.push([start + rangeFill, end]);
    }
    remaining -= rangeFill;
    i++;
  }

  return result;
}
