/**
 * Add independent copies for measuring datafile size and lookup breadth.
 * References keep pointing at original definitions, not at other synthetic copies.
 */
export function inflateEntries<T extends { key?: string }>(entries: T[], factor: number): T[] {
  const keys = new Set(entries.map((entry) => entry.key));
  const copies: T[] = [];
  for (const entry of entries) {
    if (entry.key === undefined) continue;
    let suffix = 0;
    for (let index = 1; index < factor; index++) {
      let key: string;
      do {
        key = `${entry.key}-${suffix++}`;
      } while (keys.has(key));
      keys.add(key);
      copies.push({ ...structuredClone(entry), key });
    }
  }
  return copies.concat(entries);
}
