export type IsExact<TActual, TExpected> = [TActual] extends [TExpected]
  ? [TExpected] extends [TActual]
    ? true
    : false
  : false;

export function expectExactType<T extends true>(value: T): void {
  expect(value).toBe(true);
}
