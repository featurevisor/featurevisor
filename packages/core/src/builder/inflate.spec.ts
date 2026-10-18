import { inflateEntries } from "./inflate";

describe("synthetic datafile inflation", () => {
  it("preserves originals and avoids both existing and generated key collisions", () => {
    const originals = [
      { key: "flag", value: { nested: [1] } },
      { key: "flag-0", value: { nested: [2] } },
    ];
    const result = inflateEntries(originals, 3);
    expect(result).toHaveLength(6);
    expect(new Set(result.map((entry) => entry.key)).size).toBe(6);
    expect(result.slice(-2)).toEqual(originals);
    expect(result.find((entry) => entry.key === "flag-1")?.value).toEqual({ nested: [1] });
    result[0].value.nested.push(100);
    expect(originals[0].value.nested).toEqual([1]);
    expect(inflateEntries(originals, 3).map((entry) => entry.key)).toEqual(
      result.map((entry) => entry.key),
    );
  });
  it("does not rewrite dependencies or literal payloads", () => {
    const [copy] = inflateEntries(
      [
        {
          key: "value",
          conditions: [{ feature: "flag" }, { variable: "limit", operator: "equals", value: 1 }],

          defaultValue: "limit",
        },
      ],
      2,
    );
    expect(copy).toEqual({
      key: "value-0",
      conditions: [{ feature: "flag" }, { variable: "limit", operator: "equals", value: 1 }],

      defaultValue: "limit",
    });
  });
  it("keeps factor one and empty inputs unchanged in content", () => {
    expect(inflateEntries([{ key: "flag" }], 1)).toEqual([{ key: "flag" }]);
    expect(inflateEntries([], 10)).toEqual([]);
  });
});
