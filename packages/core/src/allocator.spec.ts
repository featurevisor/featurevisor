import { RangeTuple } from "@featurevisor/types";
import { getAllocation, getUpdatedAvailableRangesAfterFilling } from "./allocator";

describe("core: allocator", function () {
  test("is a function", function () {
    expect(getAllocation).toBeInstanceOf(Function);
    expect(getUpdatedAvailableRangesAfterFilling).toBeInstanceOf(Function);
  });

  test("fills a single range fully", function () {
    const availableRanges = [[0, 100]] as RangeTuple[];
    const result = getAllocation(availableRanges, 100);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 100);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills a single range partially", function () {
    const availableRanges = [[0, 100]] as RangeTuple[];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual([[0, 80]]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([[80, 100]]);
  });

  test("fills multiple ranges fully", function () {
    const availableRanges = [
      [0, 50],
      [50, 100],
    ] as RangeTuple[];
    const result = getAllocation(availableRanges, 100);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 100);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills multiple ranges with breaks in between fully", function () {
    const availableRanges = [
      [0, 40],
      [60, 100],
    ] as RangeTuple[];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual(availableRanges);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([]);
  });

  test("fills multiple ranges partially", function () {
    const availableRanges = [
      [0, 50],
      [50, 100],
    ] as RangeTuple[];
    const result = getAllocation(availableRanges, 80);

    expect(result).toEqual([
      [0, 50],
      [50, 80],
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 80);
    expect(updatedAvailableRanges).toEqual([[80, 100]]);
  });

  test("fills multiple ranges with breaks in between partially", function () {
    const availableRanges = [
      [0, 40],
      [60, 100],
    ] as RangeTuple[];
    const result = getAllocation(availableRanges, 50);

    expect(result).toEqual([
      [0, 40],
      [60, 70],
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 50);
    expect(updatedAvailableRanges).toEqual([[70, 100]]);
  });

  test("fills multiple ranges with breaks in between partially, with 3 range items", function () {
    const availableRanges = [
      [0, 30],
      [60, 70],
      [90, 95],
    ] as RangeTuple[];
    const result = getAllocation(availableRanges, 42);

    expect(result).toEqual([
      [0, 30],
      [60, 70],
      [90, 92],
    ]);

    const updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, 42);
    expect(updatedAvailableRanges).toEqual([[92, 95]]);
  });
});
