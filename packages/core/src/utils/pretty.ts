export function prettyNumber(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function prettyPercentage(
  value: number,
  total: number,
  precision: number = 2,
  suffix: string = "%",
): string {
  return `${((value / total) * 100).toFixed(precision)}${suffix}`;
}
