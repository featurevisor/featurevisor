type IsAny<T> = 0 extends 1 & T ? true : false;

export type IsExact<TActual, TExpected> =
  IsAny<TActual> extends true
    ? IsAny<TExpected>
    : IsAny<TExpected> extends true
      ? false
      : [TActual] extends [TExpected]
        ? [TExpected] extends [TActual]
          ? true
          : false
        : false;

export function expectExactType<T extends true>(value: T): void {
  expect(value).toBe(true);
}
