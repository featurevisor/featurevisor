/** Return changed sticky keys in their original insertion order. */
export function getStickyChangeKeys(previous: object, next: object): string[] {
  return Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]));
}
