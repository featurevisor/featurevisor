import { findDuplicateSegments } from "./findDuplicateSegments";

describe("duplicate unified conditions", () => {
  test("normalizes object key order, implicit AND and compiled variable paths without reordering leaves", async () => {
    const leaf = { variable: "policy", path: "limits.0", operator: "equals", value: 3 };
    const segments = {
      first: { conditions: ["members", leaf, { feature: "checkout" }] },
      same: {
        conditions: {
          and: [
            "members",
            { value: 3, operator: "equals", path: ["limits", 0], variable: "policy" },
            { feature: "checkout" },
          ],
        },
      },
      reordered: { conditions: [{ feature: "checkout" }, leaf, "members"] },
      differentKind: { conditions: ["members", leaf, "checkout"] },
      one: { conditions: { feature: "one" } },
      oneList: { conditions: [{ feature: "one" }] },
    };
    const result = await findDuplicateSegments({
      datasource: {
        listSegments: async () => Object.keys(segments),
        readSegment: async (key) => segments[key],
      },
    } as any);
    expect(result).toEqual([{ segments: ["first", "same"] }, { segments: ["one", "oneList"] }]);
  });
});
