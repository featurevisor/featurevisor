import { describeDefinitionChanges, formatDetails } from "./details";

const rule = (key: string, percentage = 100) => ({ key, segments: "*", percentage });
const feature = (rules: unknown) => ({ rules });
const report = (before: unknown, after: unknown, entity = "feature") =>
  formatDetails(describeDefinitionChanges(entity, before, after)).join("\n");

describe("core: Featurevisor diff details", () => {
  it("identifies updated rules by key within their environment", () => {
    const output = report(
      feature({ production: [rule("rollout", 10)] }),
      feature({ production: [rule("rollout", 50)] }),
    );
    expect(output).toBe(
      [
        '  Rules ("production")',
        '    Rule "rollout" updated',
        "      Rollout percentage: 10 → 50",
      ].join("\n"),
    );
    expect(output).not.toContain("/rules/");
  });

  it("reports insertions without pretending subsequent rules changed", () => {
    const output = report(feature([rule("existing")]), feature([rule("new"), rule("existing")]));
    expect(output).toContain('Rule "new" added (position 1)');
    expect(output).not.toContain('Rule "existing"');
    expect(output).not.toContain("reordered");
  });

  it("reports removals without positional updates to remaining rules", () => {
    const output = report(
      feature([rule("removed"), rule("existing")]),
      feature([rule("existing")]),
    );
    expect(output).toContain('Rule "removed" removed');
    expect(output).not.toContain('Rule "existing"');
    expect(output).not.toContain("reordered");
  });

  it("reports a real reorder separately, including concurrent updates", () => {
    const output = report(feature([rule("a"), rule("b")]), feature([rule("b", 50), rule("a")]));
    expect(output).toContain('Rule "b" updated');
    expect(output).not.toContain('Rule "a" updated');
    expect(output).toContain('Rule order (reordered): ["a","b"] → ["b","a"]');
  });

  it("treats a renamed key as removal and addition", () => {
    const output = report(feature([rule("old")]), feature([rule("new")]));
    expect(output).toContain('Rule "old" removed');
    expect(output).toContain('Rule "new" added');
    expect(output).not.toContain("updated");
  });

  it("handles environment addition and removal and direct rule lists", () => {
    const output = report(
      feature({ staging: [rule("all")] }),
      feature({ production: [rule("all")] }),
    );
    expect(output).toContain('Rules ("staging")');
    expect(output).toContain('Rule "all" removed');
    expect(output).toContain('Rules ("production")');
    expect(output).toContain('Rule "all" added');
    expect(report({}, feature([rule("all")]))).toContain('Rule "all" added');
    expect(report(feature([rule("all")]), {})).toContain('Rule "all" removed');
  });

  it("keeps nested global overrides under their named parents", () => {
    const variable = (title: string) => ({
      overrides: {
        production: [
          {
            key: "netherlands",
            value: {},
            overrides: [{ key: "amsterdam", mutate: { "cta.title": title } }],
          },
        ],
      },
    });
    const output = report(variable("Learn more"), variable("Explore"), "variable");
    expect(output).toContain('Overrides ("production")');
    expect(output).toContain('Override "netherlands" updated');
    expect(output).toContain('Override "amsterdam" updated');
    expect(output).toContain('"cta.title": "Learn more" → "Explore"');
    expect(output).toContain("Mutations");
  });

  it("reports global override additions, removals and reordering", () => {
    const override = (key: string) => ({ key, segments: "*", value: key });
    const output = report(
      { overrides: [override("a"), override("b"), override("c")] },
      { overrides: [override("c"), override("new"), override("a")] },
      "variable",
    );
    expect(output).toContain('Override "b" removed');
    expect(output).toContain('Override "new" added (position 2)');
    expect(output).toContain("Override order (reordered)");
    expect(output).not.toContain('Override "c" updated');
  });

  it("matches variations by value and their variable overrides by key", () => {
    const variation = (value: string, text: string) => ({
      value,
      variableOverrides: {
        banner: [{ key: "mobile", segments: "mobile", value: text }],
      },
    });
    const output = report(
      { variations: [variation("control", "Original")] },
      { variations: [variation("test", "Test"), variation("control", "Updated")] },
    );
    expect(output).toContain('Variation "test" added');
    expect(output).toContain('Variation "control" updated');
    expect(output).toContain('Variable "banner" updated');
    expect(output).toContain('Override "mobile" updated');
    expect(output).toContain('Value: "Original" → "Updated"');
  });

  it("handles variable overrides inside rules", () => {
    const rules = (value: number) =>
      feature([
        {
          ...rule("all"),
          variableOverrides: {
            retries: [{ key: "mobile", segments: "mobile", value }],
          },
        },
      ]);
    expect(report(rules(1), rules(2))).toContain('Override "mobile" updated');
  });

  it("identifies feature variables by their schema map keys", () => {
    const output = report(
      { variablesSchema: { retries: { type: "integer", defaultValue: 1 } } },
      {
        variablesSchema: {
          retries: { type: "integer", defaultValue: 3 },
          banner: { type: "string", defaultValue: "Hello" },
        },
      },
    );
    expect(output).toContain('Variable "retries" updated');
    expect(output).toContain('"defaultValue": 1 → 3');
    expect(output).toContain('Variable "banner" added');
  });

  it.each([
    [{ value: 1 }, { value: 2 }],
    [
      { key: "duplicate", value: 1 },
      { key: "duplicate", value: 2 },
    ],
  ])("uses an explicit positional fallback for missing or duplicate keys: %j", (...items) => {
    const before = { overrides: items };
    const after = { overrides: [...items].reverse() };
    const output = report(before, after, "variable");
    expect(output).toContain("compared by position: missing or duplicate identities");
    expect(output).toContain("Override at position 1");
    expect(output).not.toContain("reordered");
  });

  it("never treats fields in arbitrary variable payloads as authored rules or overrides", () => {
    const output = report(
      { defaultValue: { rules: [rule("a"), rule("b")] } },
      { defaultValue: { rules: [rule("b"), rule("a")] } },
      "variable",
    );
    expect(output).toContain('"rules":');
    expect(output).not.toContain('Rule "');
    expect(output).not.toContain("reordered");
  });

  it("preserves empty collections, null, and type changes", () => {
    for (const [before, after] of [
      [{}, { rules: [] }],
      [{ rules: [] }, {}],
      [{ rules: {} }, {}],
      [{ rules: [] }, { rules: {} }],
    ]) {
      expect(report(before, after)).not.toBe("");
    }
    expect(report({ defaultValue: null }, { defaultValue: {} }, "variable")).toContain("null → {}");
  });

  it("handles special keys without interpreting them as paths or object prototypes", () => {
    const output = report(feature([rule("__proto__/a~b")]), feature([rule("__proto__/a~b", 25)]));
    expect(output).toContain('Rule "__proto__/a~b" updated');
  });

  it("has no detail changes for mapping reordering and renders added definitions as blocks", () => {
    expect(describeDefinitionChanges("feature", { a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
    expect(report(undefined, { defaultValue: 3 }, "variable")).toContain(
      'Definition added\n    {\n      "defaultValue": 3\n    }',
    );
  });
});
