import { fetchIndex } from "../api";
import { encodeRouteSegment } from "../entityTypes";
import { getSetSwitchPath } from "./ui";

jest.mock("../api", () => ({ fetchIndex: jest.fn() }));

describe("Catalog Set navigation", () => {
  it.each(["checkout", "checkout/cart", "checkout/cart 100% β"])(
    "retains the detail tab for key %s when the next Set contains it",
    async (key) => {
      jest.mocked(fetchIndex).mockResolvedValue({ entities: { feature: [{ key }] } } as any);
      expect(
        await getSetSwitchPath(
          `/sets/dev/features/${encodeRouteSegment(key)}/tests`,
          "production β",
        ),
      ).toBe(
        `/sets/${encodeRouteSegment("production β")}/features/${encodeRouteSegment(key)}/tests`,
      );
      expect(fetchIndex).toHaveBeenCalledWith("production β");
    },
  );

  it("returns the list if the next Set lacks the entity or cannot load", async () => {
    jest.mocked(fetchIndex).mockResolvedValue({ entities: { feature: [] } } as any);
    expect(await getSetSwitchPath("/sets/dev/features/cart/rules", "production")).toBe(
      "/sets/production/features",
    );
    jest.mocked(fetchIndex).mockRejectedValue(new Error("offline"));
    expect(await getSetSwitchPath("/sets/dev/features/cart/rules", "production")).toBe(
      "/sets/production/features",
    );
  });

  it.each(["features", "tests", "history"])("preserves the %s page", async (page) => {
    expect(await getSetSwitchPath(`/sets/dev/${page}`, "production")).toBe(
      `/sets/production/${page}`,
    );
  });
});
