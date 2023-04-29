import { getAllocation, getUpdatedAvailableRangesAfterFilling } from "./allocator";

describe("core: allocator", function () {
  test("is a function", function () {
    expect(getAllocation).toBeInstanceOf(Function);
    expect(getUpdatedAvailableRangesAfterFilling).toBeInstanceOf(Function);
  });

  test("fills a single range fully", function () {
    const availableRanges = [{ start: 0, end: 100 }];
    const result = getAllocation(availableRanges, 100);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 100);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills a single range partially", function () {
    const availableRanges = [{ start: 0, end: 100 }];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual([{ start: 0, end: 80 }]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([{ start: 80, end: 100 }]);
  });

  test("fills multiple ranges fully", function () {
    const availableRanges = [
      { start: 0, end: 50 },
      { start: 50, end: 100 },
    ];
    const result = getAllocation(availableRanges, 100);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 100);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills multiple ranges with breaks in between fully", function () {
    const availableRanges = [
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills multiple ranges partially", function () {
    const availableRanges = [
      { start: 0, end: 50 },
      { start: 50, end: 100 },
    ];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 80 },
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([{ start: 80, end: 100 }]);
  });

  test("fills multiple ranges with breaks in between partially", function () {
    const availableRanges = [
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ];
    const result = getAllocation(availableRanges, 50);

    expect(result).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 70 },
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 50);
    expect(updatedAvailableRanges).toEqual([{ start: 70, end: 100 }]);
  });

  test("fills multiple ranges with breaks in between partially, with 3 range items", function () {
    const availableRanges = [
      { start: 0, end: 30 },
      { start: 60, end: 70 },
      { start: 90, end: 95 },
    ];
    const result = getAllocation(availableRanges, 42);

    expect(result).toEqual([
      { start: 0, end: 30 },
      { start: 60, end: 70 },
      { start: 90, end: 92 },
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 42);
    expect(updatedAvailableRanges).toEqual([{ start: 92, end: 95 }]);
  });
});
