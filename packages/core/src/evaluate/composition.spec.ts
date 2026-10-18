import type { DatafileContent } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";
import { explainEvaluation, printExplanation } from "./explain";
import { assertExplanationMatchesEvaluation } from "./validateExplanation";

function semanticOutput(log: jest.SpyInstance): string {
  return log.mock.calls
    .flat()
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
}

const datafile: DatafileContent = {
  schemaVersion: "2",
  revision: "composition",
  features: {},
  segments: {},
  variables: {
    config: {
      type: "object",
      compose: [
        { key: "enabled", feature: "checkout" },
        { key: "layout", feature: "checkout", variation: true as const },
        { key: "label", feature: "checkout", variable: "label" },
        { key: "policy/eu", variable: "policy" },
      ],
    },
  },
};

test.each(["source", [{ key: "member", variable: "source" }]])(
  "an unmet composition gate explains fallback without claiming a source result: %j",
  (compose) => {
    const file: DatafileContent = {
      ...datafile,
      variables: {
        config: {
          type: "object",
          compose: compose as any,
          conditions: { attribute: "member", operator: "equals", value: true },
          disabledValue: { blocked: true },
        },
      },
    };
    const evaluation: Evaluation = {
      type: "variable",
      variableKey: "config",
      reason: "conditions_unmet",
      variableValue: { blocked: true },
      conditions: file.variables!.config.conditions,
    };
    const explanation = explainEvaluation(evaluation, file, [], {});
    expect(
      explanation.evidence.some(
        (entry) => entry.title === "Composition source" || entry.title === "Composition members",
      ),
    ).toBe(false);
    expect(
      explanation.evidence.find((entry) => entry.title === "Variable value policy")?.details
        .disabledValue,
    ).toEqual({ blocked: true });
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, file, {}),
    ).not.toThrow();
  },
);

test("a composition gate without a disabled value validates the explicit null fallback", () => {
  const file: DatafileContent = {
    ...datafile,
    variables: {
      alias: { type: "object", compose: "source", conditions: { feature: "gate" } },
    },
  };
  const evaluation: Evaluation = {
    type: "variable",
    variableKey: "alias",
    reason: "conditions_unmet",
    variableValue: null,
  };
  const explanation = explainEvaluation(evaluation, file, [], {});
  expect(explanation.result).toMatchObject({ hasValue: true, value: null });
  expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, file, {})).not.toThrow();
});

test.each([false, 0, "", "decoded JSON string", null, ["borrowed"], { items: [1] }, undefined])(
  "alias evidence describes one exact source and the complete SDK result %j",
  (value) => {
    const file: DatafileContent = {
      ...datafile,
      variables: { alias: { type: "json", compose: "policy/eu.current" } },
    };
    const evaluation: Evaluation = {
      type: "variable",
      variableKey: "alias",
      reason: value === undefined ? "error" : "variable_composed",
      variableValue: value,
    };
    const explanation = explainEvaluation(evaluation, file, [], {});
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, file, {}),
    ).not.toThrow();
    const source = explanation.evidence.find((entry) => entry.title === "Composition source")!;
    expect(source.details).toEqual({
      afterOverrides: false,
      source: { variable: "policy/eu.current" },
      sourceKind: "global variable",
      hasValue: value !== undefined,
      value,
    });
    expect(explanation.evidence.some((entry) => entry.title === "Composition members")).toBe(false);
    expect(explanation.evidence.some((entry) => entry.title === "Variable value policy")).toBe(
      false,
    );
    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      printExplanation(explanation);
      const output = semanticOutput(log);
      expect(output).toContain("Alias source: policy/eu.current, global variable");
      expect(output).toContain(
        `SDK result: ${value === undefined ? "unavailable" : JSON.stringify(value)}`,
      );
    } finally {
      log.mockRestore();
    }
    for (const [field, mismatch] of [
      ["source", { variable: "policy" }],
      ["sourceKind", "flag"],
      ["hasValue", value === undefined],
      ["value", "incorrect result"],
    ] as const) {
      const changed = structuredClone(explanation);
      changed.evidence.find((entry) => entry.title === "Composition source")!.details[field] =
        mismatch;
      expect(() => assertExplanationMatchesEvaluation(evaluation, changed, file, {})).toThrow(
        `evidence.composition.${field}`,
      );
    }
  },
);

test.each(["sticky", "variable_override_rule"] as const)(
  "alias %s evidence reports the final result without claiming a source read",
  (reason) => {
    const file: DatafileContent = {
      ...datafile,
      variables: {
        ...datafile.variables,
        alias: {
          type: "object",
          compose: "config",
          overrideProgram: [
            {
              key: "replace",
              keyPath: ["replace"],
              conditions: "*",
              operations: [{ op: "set", path: [], value: { final: true } }],
              onMatch: 1,
              onMiss: 1,
            },
          ],
        },
      },
    };
    const evaluation: Evaluation = {
      type: "variable",
      variableKey: "alias",
      reason,
      variableValue: { final: true },
      ...(reason === "variable_override_rule"
        ? {
            variableOverrideIndex: 0,
            variableOverrideKey: "replace",
            variableOverridePath: ["replace"],
            variableOverridePaths: [["replace"]],
          }
        : {}),
    };
    const explanation = explainEvaluation(evaluation, file, [], {});
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, file, {}),
    ).not.toThrow();
    const source = explanation.evidence.find((entry) => entry.title === "Composition source")!;
    expect(source.details.sourceKind).toBe("composition");
    expect(source.details.value).toEqual({ final: true });
    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      printExplanation(explanation);
      expect(semanticOutput(log)).toContain(
        reason === "variable_override_rule" ? "SDK result after overrides:" : "SDK result:",
      );
    } finally {
      log.mockRestore();
    }
    source.details.afterOverrides = reason !== "variable_override_rule";
    expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, file, {})).toThrow(
      "evidence.composition.afterOverrides",
    );
  },
);

test("composition evidence uses SDK property values even when sources are absent", () => {
  const evaluation: Evaluation = {
    type: "variable",
    variableKey: "config",
    reason: "variable_composed",
    variableValue: { enabled: false, layout: "disabled", label: null, "policy/eu": { limit: 10 } },
  };
  const explanation = explainEvaluation(evaluation, datafile, [], {});
  expect(() =>
    assertExplanationMatchesEvaluation(evaluation, explanation, datafile, {}),
  ).not.toThrow();
  expect(explanation.evidence.some((entry) => entry.title === "Variable value policy")).toBe(false);
  const members = explanation.evidence.find((entry) => entry.title === "Composition members")!
    .details.members as Array<Record<string, unknown>>;
  expect(members).toEqual([
    {
      property: "enabled",
      source: { feature: "checkout" },
      sourceKind: "flag",
      hasValue: true,
      value: false,
    },
    {
      property: "layout",
      source: { feature: "checkout", variation: true },
      sourceKind: "variation",
      hasValue: true,
      value: "disabled",
    },
    {
      property: "label",
      source: { feature: "checkout", variable: "label" },
      sourceKind: "feature variable",
      hasValue: true,
      value: null,
    },
    {
      property: "policy/eu",
      source: { variable: "policy" },
      sourceKind: "global variable",
      hasValue: true,
      value: { limit: 10 },
    },
  ]);
  const log = jest.spyOn(console, "log").mockImplementation();
  try {
    printExplanation(explanation);
    const output = semanticOutput(log);
    expect(output).toContain("source: checkout, flag");
    expect(output).toContain("source: checkout, variation");
    expect(output).toContain("source: checkout / label, feature variable");
    expect(output).toContain("source: policy, global variable");
    expect(output).not.toContain('"variable":"policy"');
    expect(output).not.toContain('"feature":"checkout"');
  } finally {
    log.mockRestore();
  }
  members[0].value = true;
  expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, datafile, {})).toThrow(
    "evidence.composition.members",
  );
});

test("labels nested compositions from definitions without evaluating or changing sources", () => {
  const file: DatafileContent = {
    ...datafile,
    variables: {
      ...datafile.variables,
      screen: {
        type: "object",
        compose: [
          { key: "view", variable: "config" },
          { key: "source", feature: "checkout/cart", variable: "label/text" },
          { key: "missing", variable: "absent/policy" },
          { key: "aliased", variable: "policyAlias" },
        ],
      },
      policyAlias: { type: "object", compose: "policy" },
    },
  };
  const evaluation: Evaluation = {
    type: "variable",
    variableKey: "screen",
    reason: "sticky",
    variableValue: { view: null, source: "hello", aliased: { limit: 10 } },
  };
  const explanation = explainEvaluation(evaluation, file, [], {});
  const before = structuredClone(explanation);
  const log = jest.spyOn(console, "log").mockImplementation();
  try {
    printExplanation(explanation);
    const output = semanticOutput(log);
    expect(output).toContain("view: null (source: config, composition)");
    expect(output).toContain(
      'source: "hello" (source: checkout/cart / label/text, feature variable)',
    );
    expect(output).toContain("missing: unavailable (source: absent/policy, global variable)");
    expect(output).toContain('aliased: {"limit":10} (source: policyAlias, alias)');
    expect(explanation).toEqual(before);
    expect(file.variables!.screen.compose![0]).toEqual({ key: "view", variable: "config" });
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, file, {}),
    ).not.toThrow();
    const members = explanation.evidence[0].details.members as Array<Record<string, unknown>>;
    expect(members[3]).toMatchObject({ property: "aliased", sourceKind: "alias" });
    expect(members.every((member) => !Object.prototype.hasOwnProperty.call(member, "alias"))).toBe(
      true,
    );
    members[0].sourceKind = "global variable";
    expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, file, {})).toThrow(
      "evidence.composition.members",
    );
  } finally {
    log.mockRestore();
  }
});

test.each(["sticky", "error"] as const)(
  "%s composition result does not imply source evaluations",
  (reason) => {
    const evaluation: Evaluation = {
      type: "variable",
      variableKey: "config",
      reason,
      ...(reason === "sticky" ? { variableValue: { enabled: true } } : {}),
    };
    const explanation = explainEvaluation(evaluation, datafile, [], {});
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, datafile, {}),
    ).not.toThrow();
    const members = explanation.evidence[0].details.members as Array<Record<string, unknown>>;
    expect(members[1].hasValue).toBe(false);
  },
);

test("describes returned members after overrides without claiming they are source getter values", () => {
  const file: DatafileContent = JSON.parse(JSON.stringify(datafile));
  file.variables!.config.overrideProgram = [
    {
      key: "regional",
      keyPath: ["regional"],
      conditions: "*",
      operations: [{ op: "set", path: ["enabled"], value: false }],
      onMatch: 1,
      onMiss: 1,
    },
  ];
  const evaluation: Evaluation = {
    type: "variable",
    variableKey: "config",
    reason: "variable_override_rule",
    variableValue: { enabled: false, layout: null, label: null, "policy/eu": null },
    variableOverrideIndex: 0,
    variableOverrideKey: "regional",
    variableOverridePath: ["regional"],
    variableOverridePaths: [["regional"]],
  };
  const explanation = explainEvaluation(evaluation, file, [], {});
  expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, file, {})).not.toThrow();
  const members = explanation.evidence.find((entry) => entry.title === "Composition members")!;
  expect(members.details.afterOverrides).toBe(true);
  const log = jest.spyOn(console, "log").mockImplementation();
  try {
    printExplanation(explanation);
    expect(semanticOutput(log)).toContain("final property values after overrides");
  } finally {
    log.mockRestore();
  }
  members.details.afterOverrides = false;
  expect(() => assertExplanationMatchesEvaluation(evaluation, explanation, file, {})).toThrow(
    "evidence.composition.afterOverrides",
  );
});
