import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config";
import { Datasource } from "./datasource";
import {
  expandDefinitionFel,
  FelExpressionError,
  getFelExpressions,
  restoreAuthoredFel,
} from "./fel";

const options = { namespaceCharacter: "." };
const plan = { attribute: "plan", operator: "equals", value: "paid" };

describe("expandDefinitionFel", () => {
  it("expands every condition location of a feature", () => {
    const feature = {
      conditions: "plan == 'paid'",
      rules: {
        production: [
          {
            key: "all",
            conditions: ["netherlands", "plan == 'paid'"],
            variableOverrides: { title: [{ conditions: "plan == 'paid'", value: "Paid" }] },
          },
        ],
      },
      force: [{ conditions: "plan == 'paid' and netherlands", enabled: true }],
      variations: [
        { value: "control" },
        {
          value: "treatment",
          variableOverrides: {
            title: [{ conditions: { or: ["a", "plan == 'paid'"] }, value: "T" }],
          },
        },
      ],
    };
    const authored = structuredClone(feature);
    const expanded = expandDefinitionFel("feature", "checkout", feature, options);

    expect(feature).toEqual(authored);
    expect(expanded).toEqual({
      conditions: plan,
      rules: {
        production: [
          {
            key: "all",
            conditions: ["netherlands", plan],
            variableOverrides: { title: [{ conditions: plan, value: "Paid" }] },
          },
        ],
      },
      force: [{ conditions: [plan, "netherlands"], enabled: true }],
      variations: [
        { value: "control" },
        {
          value: "treatment",
          variableOverrides: { title: [{ conditions: { or: ["a", plan] }, value: "T" }] },
        },
      ],
    });
    expect(
      getFelExpressions(expanded).map(({ path, location, conditionsPath }) => ({
        path,
        location,
        conditionsPath,
      })),
    ).toEqual([
      { path: ["conditions"], location: "features", conditionsPath: ["conditions"] },
      {
        path: ["rules", "production", 0, "conditions", 1],
        location: "rules",
        conditionsPath: ["rules", "production", 0, "conditions"],
      },
      {
        path: ["rules", "production", 0, "variableOverrides", "title", 0, "conditions"],
        location: "featureVariableOverrides",
        conditionsPath: ["rules", "production", 0, "variableOverrides", "title", 0, "conditions"],
      },
      {
        path: ["force", 0, "conditions"],
        location: "force",
        conditionsPath: ["force", 0, "conditions"],
      },
      {
        path: ["variations", 1, "variableOverrides", "title", 0, "conditions", "or", 1],
        location: "featureVariableOverrides",
        conditionsPath: ["variations", 1, "variableOverrides", "title", 0, "conditions"],
      },
    ]);
    expect(getFelExpressions(expanded)[1].spans[0].path).toEqual([
      "rules",
      "production",
      0,
      "conditions",
      1,
    ]);
  });

  it("expands segments and global variables, nested overrides included", () => {
    expect(expandDefinitionFel("segment", "s", { conditions: "plan == 'paid'" }, options)).toEqual({
      conditions: plan,
    });
    const variable = {
      conditions: "plan == 'paid'",
      overrides: [
        {
          key: "a",
          conditions: "*",
          value: 1,
          overrides: [{ key: "b", conditions: "plan == 'paid'", value: 2 }],
        },
      ],
    };
    const expanded = expandDefinitionFel("variable", "v", variable, options);
    expect(expanded.overrides[0].overrides[0].conditions).toEqual(plan);
    expect(getFelExpressions(expanded).map((record) => record.location)).toEqual([
      "variables",
      "variableOverrides",
    ]);
  });

  it("returns definitions without FEL unchanged", () => {
    const segment = { conditions: ["netherlands", plan] };
    expect(expandDefinitionFel("segment", "s", segment, options)).toBe(segment);
    expect(getFelExpressions(segment)).toEqual([]);
    expect(expandDefinitionFel("segment", "s", null, options)).toBe(null);
    expect(getFelExpressions(undefined)).toEqual([]);
  });

  it("throws for an expression that does not compile, keeping what did", () => {
    let thrown: unknown;
    try {
      expandDefinitionFel(
        "segment",
        "dutch",
        { conditions: ["plan == 'paid'", "country = 'nl'"] },
        options,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FelExpressionError);
    const error = thrown as FelExpressionError;
    expect(error.entityType).toBe("segment");
    expect(error.entityKey).toBe("dutch");
    expect(error.definition).toEqual({ conditions: [plan, "country = 'nl'"] });
    expect(error.expressions[1].errors[0].code).toBe("fel_single_equals");
    expect(error.message).toBe(
      'Invalid FEL in segment "dutch":\n' +
        "  conditions.1: A single `=` does not compare. Use == to compare, such as country == ... (line 1, column 9 of the expression)\n" +
        "Run featurevisor lint to see each problem in its file.",
    );
    expect(getFelExpressions(error.definition)).toBe(error.expressions);
  });

  it("reads the project's namespace character", () => {
    expect(
      expandDefinitionFel(
        "segment",
        "s",
        { conditions: "countries:nl and x == 1" },
        { namespaceCharacter: ":" },
      ),
    ).toEqual({
      conditions: ["countries:nl", { attribute: "x", operator: "equals", value: 1 }],
    });
  });
});

describe("restoreAuthoredFel", () => {
  it("writes back authored FEL where the expanded value is unchanged", () => {
    const authored = { conditions: "netherlands and plan == 'paid'", description: "Source" };
    const destination = { conditions: ["other"], description: "Destination" };
    const merged = { conditions: ["netherlands", plan], description: "Merged" };
    expect(restoreAuthoredFel("segment", merged, [authored, destination], options)).toEqual({
      conditions: "netherlands and plan == 'paid'",
      description: "Merged",
    });
  });

  it("matches across environments and ignores key order", () => {
    const authored = { rules: { staging: [{ key: "a", conditions: "plan == 'paid'" }] } };
    const merged = {
      rules: {
        production: [
          { key: "a", conditions: { value: "paid", operator: "equals", attribute: "plan" } },
        ],
      },
    };
    expect(restoreAuthoredFel("feature", merged, [authored], options)).toEqual({
      rules: { production: [{ key: "a", conditions: "plan == 'paid'" }] },
    });
  });

  it("keeps values that no authored FEL expands to", () => {
    const merged = { conditions: ["something", "else"] };
    expect(
      restoreAuthoredFel("segment", merged, [{ conditions: "plan == 'paid'" }, undefined], options),
    ).toBe(merged);
    expect(restoreAuthoredFel("segment", merged, [{ conditions: ["a"] }], options)).toBe(merged);
    expect(restoreAuthoredFel("segment", merged, [{ conditions: "x = 1" }], options)).toBe(merged);
  });
});

describe("Datasource with FEL", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fel-datasource-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};");
    fs.mkdirSync(path.join(root, "segments"));
    fs.mkdirSync(path.join(root, "features"));
    fs.mkdirSync(path.join(root, "variables"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("reads expanded definitions, and authored ones for writing back", async () => {
    fs.writeFileSync(
      path.join(root, "segments/paid.yml"),
      "description: Paid\nconditions: |\n  # paying accounts\n  plan == 'paid'\n",
    );
    fs.writeFileSync(
      path.join(root, "features/checkout.yml"),
      "description: Checkout\nconditions: feature('a') == false\n",
    );
    fs.writeFileSync(
      path.join(root, "variables/limit.yml"),
      "description: Limit\ntype: integer\ndefaultValue: 1\nconditions: x exists\n",
    );
    const datasource = new Datasource(getProjectConfig(root), root);

    expect((await datasource.readSegment("paid")).conditions).toEqual(plan);
    expect((await datasource.readFeature("checkout")).conditions).toEqual({
      feature: "a",
      enabled: false,
    });
    expect((await datasource.readVariable("limit")).conditions).toEqual({
      attribute: "x",
      operator: "exists",
    });
    expect(await datasource.readAuthoredEntity("segment", "paid")).toEqual({
      description: "Paid",
      conditions: "# paying accounts\nplan == 'paid'\n",
    });
    expect(datasource.getFelOptions()).toEqual({ namespaceCharacter: "." });
  });

  it("fails a read whose FEL does not compile", async () => {
    fs.writeFileSync(
      path.join(root, "segments/broken.yml"),
      "description: B\nconditions: plan = 'paid'\n",
    );
    const datasource = new Datasource(getProjectConfig(root), root);
    await expect(datasource.readSegment("broken")).rejects.toBeInstanceOf(FelExpressionError);
  });
});
