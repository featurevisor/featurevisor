import {
  createTestInputSnapshot,
  getTestInputFingerprint,
  getTestInputStatePaths,
} from "./provenance";
import * as path from "node:path";

describe("test input fingerprint contract", () => {
  it("selects only exact allocation files from the effective configuration", () => {
    const stateDirectoryPath = path.resolve("custom", "state", "sets", "dev");
    expect(getTestInputStatePaths({ stateDirectoryPath } as any)).toEqual([
      path.join(stateDirectoryPath, "existing-state.json"),
    ]);
    expect(
      getTestInputStatePaths({
        stateDirectoryPath,
        environments: ["staging", "production"],
      } as any),
    ).toEqual([
      path.join(stateDirectoryPath, "existing-state-staging.json"),
      path.join(stateDirectoryPath, "existing-state-production.json"),
    ]);
  });
  function fixture() {
    const definitions: Record<string, Record<string, any>> = {
      Feature: { flag: { rules: [] } },
      Segment: {},
      Attribute: {},
      Schema: {},
      Variable: { limit: { type: "integer", defaultValue: 10 } },
      Target: {},
      Test: { limit: { variable: "limit", assertions: [{ key: "named", expectedValue: 10 }] } },
      Scenario: {},
    };
    let state = { features: {} };
    const datasource: any = { readState: jest.fn(async () => state) };
    for (const [singular, records] of Object.entries(definitions)) {
      datasource[`list${singular === "Schema" ? "Schemas" : `${singular}s`}`] = jest.fn(async () =>
        Object.keys(records),
      );
      datasource[`read${singular}`] = jest.fn(async (key) => records[key]);
    }
    const config: any = { namespaceCharacter: "/", sets: false, defaultBucketBy: "userId" };
    return {
      datasource,
      definitions,
      config,
      setState: (value: any) => {
        state = value;
      },
    };
  }

  it.each(["Feature", "Segment", "Attribute", "Schema", "Variable", "Target", "Test", "Scenario"])(
    "covers dirty %s input additions, edits and removals",
    async (kind) => {
      const source = fixture();
      const fingerprint = () => getTestInputFingerprint(source.config, source.datasource);
      const before = await fingerprint();
      source.definitions[kind].extra = { value: 1 };
      const added = await fingerprint();
      expect(added).not.toBe(before);
      source.definitions[kind].extra.value = 2;
      expect(await fingerprint()).not.toBe(added);
      delete source.definitions[kind].extra;
      expect(await fingerprint()).toBe(before);
    },
  );

  it("covers state and effective config but ignores transport paths and formatting", async () => {
    const source = fixture();
    const before = await getTestInputFingerprint(source.config, source.datasource);
    expect(
      await getTestInputFingerprint(
        {
          ...source.config,
          catalogDirectoryPath: "/unrelated",
          featuresDirectoryPath: "/elsewhere",
          prettyDatafile: true,
        },
        source.datasource,
      ),
    ).toBe(before);
    expect(
      await getTestInputFingerprint(
        { ...source.config, precomputeMutations: false },
        source.datasource,
      ),
    ).not.toBe(before);
    source.setState({ features: { flag: { rules: { rollout: 50 } } } });
    expect(await getTestInputFingerprint(source.config, source.datasource)).not.toBe(before);
  });

  it("retains matrix axis order while making configuration property order irrelevant", async () => {
    const source = fixture();
    source.definitions.Test.limit.assertions[0].matrix = { country: ["gb"], plan: ["free"] };
    const before = await getTestInputFingerprint(source.config, source.datasource);
    expect(
      await getTestInputFingerprint(
        Object.fromEntries(Object.entries(source.config).reverse()) as any,
        source.datasource,
      ),
    ).toBe(before);
    source.definitions.Test.limit.assertions[0].matrix = { plan: ["free"], country: ["gb"] };
    expect(await getTestInputFingerprint(source.config, source.datasource)).not.toBe(before);
  });

  it("reads each input once and keeps it read only through nested datasource methods", async () => {
    const source = fixture();
    source.datasource.nested = async function () {
      return this.readVariable("limit");
    };
    const snapshot = createTestInputSnapshot(source.datasource);
    const before = await getTestInputFingerprint(source.config, snapshot);
    source.definitions.Variable.limit.defaultValue = 20;
    const copy = await snapshot.readVariable("limit");
    expect(() => {
      copy.defaultValue = 30;
    }).toThrow(TypeError);
    expect(await (snapshot as any).nested()).toMatchObject({ defaultValue: 10 });
    expect(await (snapshot as any).nested()).toBe(copy);
    expect(await getTestInputFingerprint(source.config, snapshot)).toBe(before);
    expect(source.datasource.readVariable).toHaveBeenCalledTimes(1);
    expect(
      await getTestInputFingerprint(source.config, createTestInputSnapshot(source.datasource)),
    ).not.toBe(before);
  });
});
