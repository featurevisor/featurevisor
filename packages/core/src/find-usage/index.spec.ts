import { assertFindUsageOptions, findAllUsageInVariables } from "./index";

describe("core: find usage CLI options", function () {
  test("requires exactly one usage query", function () {
    expect(() => assertFindUsageOptions({})).toThrow("Specify one usage query");
    expect(() => assertFindUsageOptions({ feature: "checkout", unusedSegments: true })).toThrow(
      "Specify only one usage query",
    );
    expect(() => assertFindUsageOptions({ segment: "mobile", authors: true })).not.toThrow();
    expect(() => assertFindUsageOptions({ variable: "settings" })).not.toThrow();
  });

  test("finds transitive schema dependencies without scanning runtime values", async function () {
    const usage = await findAllUsageInVariables({
      datasource: {
        listVariables: async () => ["settings"],
        readVariable: async () => ({
          schema: "outer",
          defaultValue: { schema: "not-a-reference" },
        }),
        readSchema: async (key: string) =>
          key === "outer"
            ? { type: "object", properties: { value: { schema: "inner" } } }
            : { type: "string" },
        getRequiredFeaturesChainForVariable: async () =>
          new Set(["checkout", "account", "authenticated"]),
      },
    } as any);

    expect(Array.from(usage.settings.schemas).sort()).toEqual(["inner", "outer"]);
    expect(Array.from(usage.settings.features).sort()).toEqual([
      "account",
      "authenticated",
      "checkout",
    ]);
  });
});
