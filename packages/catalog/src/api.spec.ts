import { fetchEntityDetail } from "./api";

describe("catalog API", () => {
  it("loads slash-namespaced entity details from nested data paths", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ key: "checkout/redesign" }),
    } as Response);

    await fetchEntityDetail("feature", "checkout/redesign");

    expect(fetchMock).toHaveBeenCalledWith("/data/root/entities/feature/checkout/redesign.json");
  });
});
