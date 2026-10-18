import { getProjectSetExecutions } from "./sets";
import type { ProjectConfig } from "./config";
import type { Datasource } from "./datasource";

describe("Set selection", () => {
  it.each(["production", "", "does-not-exist"])(
    "rejects explicit %p without configured Sets",
    async (selected) => {
      const datasource = { listSets: jest.fn() } as unknown as Datasource;
      await expect(
        getProjectSetExecutions({ sets: false } as ProjectConfig, datasource, selected),
      ).rejects.toThrow("Omit --set");
      expect(datasource.listSets).not.toHaveBeenCalled();
    },
  );
  it("preserves omitted selection for flat projects", async () => {
    const config = { sets: false } as ProjectConfig;
    const datasource = {} as Datasource;
    expect(await getProjectSetExecutions(config, datasource)).toEqual([
      { set: "", projectConfig: config, datasource },
    ]);
  });
  it("does not expand an explicit empty Set selector into every Set", async () => {
    const datasource = {
      listSets: jest.fn().mockResolvedValue(["production"]),
      forSet: jest.fn(),
    } as unknown as Datasource;
    await expect(
      getProjectSetExecutions({ sets: true } as ProjectConfig, datasource, ""),
    ).rejects.toThrow('Unknown set ""');
    expect(datasource.forSet).not.toHaveBeenCalled();
  });
});
