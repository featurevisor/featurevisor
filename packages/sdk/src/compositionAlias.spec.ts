import type { DatafileContent, VariableValue } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";

function datafile(value: VariableValue = { limit: 10, items: ["card"] }): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "alias",
    segments: {},
    features: {},
    variables: {
      source: { type: "object", defaultValue: value, hash: "source-1" },
      alias: { type: "object", compose: "source", hash: "alias-1" },
      chain: { type: "object", compose: "alias", hash: "chain-1" },
      view: { type: "object", compose: [{ key: "value", variable: "alias" }] },
    },
  };
}

describe("string compositions", () => {
  it.each(
    [false, 0, "", "plain", null, [], [1, false, null], { limit: 10 }].map((value) => [value]),
  )("returns the exact source value %j without wrapping or copying it", (value) => {
    const f = createFeaturevisor({ datafile: datafile(value) });
    expect(f.getVariable("alias")).toBe(f.getVariable("source"));
    expect(f.getVariable("chain")).toBe(f.getVariable("source"));
    expect(f.getVariable("view")).toEqual({ value });
    expect(f.evaluateVariable("alias")).toMatchObject({
      reason: "variable_composed",
      variableKey: "alias",
      variableValue: value,
    });
    f.close();
  });

  it.each(
    [
      "plain text",
      "null",
      "true",
      "123",
      '{"nested":true}',
      "",
      0,
      12.5,
      true,
      false,
      [],
      ["card"],
      [null, 0, false],
      { enabled: true },
      null,
    ].map((value) => [value]),
  )("decodes a JSON source exactly once for %j, including dependencies and chains", (value) => {
    const file = datafile();
    file.variables!.source = { type: "json", defaultValue: JSON.stringify(value) };
    file.variables!.alias = { type: "json", compose: "source" };
    file.variables!.chain = { type: "json", compose: "alias" };
    file.variables!.consumer = {
      type: "boolean",
      defaultValue: true,
      disabledValue: false,
      conditions: [
        {
          variable: "chain",
          operator: value === null ? "isNull" : typeof value === "object" ? "notNull" : "equals",
          ...(value === null || typeof value === "object" ? {} : { value }),
        } as any,
      ],
    };
    const diagnostics: unknown[] = [];
    const f = createFeaturevisor({
      datafile: file,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      logLevel: "error",
    });
    expect(f.getVariable("alias")).toEqual(value);
    expect(f.getVariableJSON("alias")).toEqual(value);
    expect(f.getVariable("chain")).toEqual(value);
    expect(f.getVariableJSON("chain")).toEqual(value);
    expect(f.getVariable("consumer")).toBe(true);
    expect(f.getVariable("view")).toEqual({ value });
    expect(diagnostics).toEqual([]);
    f.close();
  });

  it("preserves source fallbacks and null without forwarding caller defaults", () => {
    const file = datafile();
    file.variables!.source = {
      type: "boolean",
      defaultValue: true,
      disabledValue: false,
      requiredFeatures: ["missing"],
    };
    const f = createFeaturevisor({ datafile: file, logLevel: "fatal" });
    expect(f.getVariable("alias")).toBe(false);
    delete file.variables!.source.disabledValue;
    f.setDatafile({ ...file, revision: "without-fallback" }, true);
    expect(f.getVariable("alias", {}, { defaultVariableValue: "caller" })).toBeNull();
    delete file.variables!.source;
    f.setDatafile({ ...file, revision: "without-source" }, true);
    expect(f.getVariable("alias", {}, { defaultVariableValue: "caller" })).toBeNull();
    f.close();
  });

  it.each(["alias", "source"])("reports deprecated %s keys on each independent read", (key) => {
    const file = datafile();
    file.variables![key].deprecated = true;
    const onDiagnostic = jest.fn();
    const f = createFeaturevisor({ datafile: file, onDiagnostic, logLevel: "warn" });
    for (let read = 0; read < 2; read++) {
      expect(f.getVariable("alias")).toEqual({ limit: 10, items: ["card"] });
      expect(onDiagnostic).toHaveBeenNthCalledWith(
        read + 1,
        expect.objectContaining({
          code: "deprecated_variable",
          details: expect.objectContaining({ variableKey: key }),
        }),
      );
    }
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
    f.close();
  });

  it("preserves source getter error fallbacks without leaving active frames", () => {
    const file = datafile();
    file.variables!.source = { type: "json", defaultValue: "not JSON" };
    file.variables!.alias.type = "json";
    file.variables!.independent = { type: "boolean", defaultValue: true };
    const onDiagnostic = jest.fn();
    const f = createFeaturevisor({ datafile: file, onDiagnostic, logLevel: "error" });
    expect(f.getVariable("alias")).toBeNull();
    expect(f.getVariable("independent")).toBe(true);
    expect(onDiagnostic).toHaveBeenCalled();
    f.close();
  });

  it("uses source and alias sticky values, child state, and the normal module lifecycle", () => {
    const seen: Array<{ key: string; purpose?: string; owner?: string }> = [];
    const f = createFeaturevisor({
      datafile: datafile(),
      context: { country: "nl" },
      modules: [
        {
          name: "track",
          beforeEvaluation: (options) => {
            if (options.type === "variable" && options.variableKey)
              seen.push({
                key: options.variableKey,
                purpose: options.dependencyPurpose,
                owner:
                  options.dependencyOf && "variableKey" in options.dependencyOf
                    ? options.dependencyOf.variableKey
                    : undefined,
              });
            return options;
          },
          afterEvaluation: (evaluation, options) =>
            evaluation.variableKey === "source"
              ? { ...evaluation, variableValue: { country: String(options.context.country) } }
              : evaluation,
        },
      ],
    });
    const child = f.spawn({ country: "de" });
    child.setStickyVariables({ source: false });
    expect(child.getVariable("chain")).toEqual({ country: "de" });
    expect(seen).toEqual([
      { key: "chain", purpose: undefined, owner: undefined },
      { key: "alias", purpose: "composition", owner: "chain" },
      { key: "source", purpose: "composition", owner: "alias" },
    ]);
    child.setStickyVariables({ alias: "child" });
    expect(child.getVariable("alias")).toBe("child");
    child.setStickyVariables({ chain: null });
    seen.length = 0;
    expect(child.getVariable("chain")).toBeNull();
    expect(seen.map((item) => item.key)).toEqual(["chain"]);
    f.close();
  });

  it("applies root replacements and continuing mutations to evaluated values without mutating sources", () => {
    const file = datafile();
    file.variables!.alias.overrideProgram = [
      {
        key: "first",
        keyPath: ["first"],
        operations: [{ op: "set", path: ["limit"], value: 20 }],
        onMatch: 1,
        onMiss: 2,
      },
      {
        key: "second",
        keyPath: ["second"],
        operations: [{ op: "appendUnique", path: ["items"], value: "ideal" }],
        onMatch: 2,
        onMiss: 2,
      },
    ];
    const original = JSON.stringify(file);
    const f = createFeaturevisor({ datafile: file });
    expect(f.getVariable("alias")).toEqual({ limit: 20, items: ["card", "ideal"] });
    expect(f.getVariable("source")).toEqual({ limit: 10, items: ["card"] });
    expect(f.evaluateVariable("chain")).toMatchObject({
      reason: "variable_composed",
      variableValue: { limit: 20, items: ["card", "ideal"] },
    });
    expect(f.evaluateVariable("alias")).toMatchObject({
      reason: "variable_override_rule",
      variableOverridePaths: [["first"], ["second"]],
    });
    expect(JSON.stringify(file)).toBe(original);
    for (const value of [false, 0, "text", null, ["card"], { limit: 1 }]) {
      file.variables!.alias.overrideProgram = [
        { key: "replace", operations: [{ op: "set", path: [], value }], onMatch: 1, onMiss: 1 },
      ];
      f.setDatafile({ ...file, revision: JSON.stringify(value) }, true);
      expect(f.getVariable("alias")).toBe(value);
    }
    f.close();
  });

  it("supports whole array operations and typed getters", () => {
    const file = datafile(["card"]);
    file.variables!.alias.type = "array";
    file.variables!.alias.overrideProgram = [
      {
        key: "append",
        operations: [{ op: "append", path: [], value: "ideal" }],
        onMatch: 1,
        onMiss: 1,
      },
    ];
    const f = createFeaturevisor({ datafile: file });
    expect(f.getVariableArray("alias")).toEqual(["card", "ideal"]);
    expect(f.getVariableArray("source")).toEqual(["card"]);
    expect(f.getVariableString("alias")).toBeNull();
    f.close();
  });

  it.each(["plain text", "null", "123", null, [1, 2], { limit: 7 }].map((value) => [value]))(
    "uses JSON alias replacements as evaluated values: %j",
    (value) => {
      const file = datafile();
      file.variables!.source = { type: "json", defaultValue: '{"limit":10}' };
      file.variables!.alias = {
        type: "json",
        compose: "source",
        overrideProgram: [
          {
            key: "literal",
            segments: "*",
            operations: [{ op: "set", path: [], value }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      };
      file.variables!.chain.type = "json";
      const f = createFeaturevisor({ datafile: file, logLevel: "fatal" });
      expect(f.getVariable("alias")).toBe(value);
      expect(f.getVariable("chain")).toBe(value);
      expect(f.getVariable("view")).toEqual({ value });
      expect(f.getVariable("source")).toEqual({ limit: 10 });
      f.close();
    },
  );

  it("retains literal namespaced source keys and source update notifications through chains", () => {
    const file = datafile();
    file.variables!["source.policy"] = file.variables!.source;
    file.variables!.alias.compose = "source.policy";
    const f = createFeaturevisor({ datafile: file });
    const changes: unknown[] = [];
    f.on("datafile_set", (details) => changes.push(details.variables));
    f.setDatafile({
      schemaVersion: "2",
      revision: "updated",
      features: {},
      segments: {},
      variables: {
        "source.policy": { type: "object", defaultValue: { limit: 90 }, hash: "source-2" },
      },
    });
    expect(f.getVariable("chain")).toEqual({ limit: 90 });
    expect(changes[0]).toEqual(expect.arrayContaining(["source.policy", "alias", "chain", "view"]));
    f.close();
  });

  it("fails cycles without leaking active frames into a subsequent independent read", () => {
    const file = datafile();
    file.variables!.alias.compose = "chain";
    const f = createFeaturevisor({ datafile: file, logLevel: "fatal" });
    expect(f.evaluateVariable("alias").reason).toBe("error");
    expect(f.getVariable("alias")).toBeNull();
    expect(f.getVariable("source")).toEqual({ limit: 10, items: ["card"] });
    f.close();
  });

  it("borrows large source objects without visiting their descendants", () => {
    const source = { limit: 10 };
    Object.defineProperty(source, "unread", {
      enumerable: true,
      get() {
        throw new Error("Unexpected traversal");
      },
    });
    const f = createFeaturevisor({ datafile: datafile(source) });
    expect(f.getVariable("alias")).toBe(source);
    expect(f.getVariable("chain")).toBe(source);
    f.close();
  });

  it("memoizes shared sources within a call but not across calls or sticky changes", () => {
    const file = datafile();
    file.variables!.second = { type: "object", compose: "source" };
    file.variables!.view.compose = [
      { key: "a", variable: "alias" },
      { key: "b", variable: "second" },
    ];
    let calls = 0;
    const f = createFeaturevisor({
      datafile: file,
      modules: [
        {
          name: "count",
          afterEvaluation(e) {
            if (e.variableKey === "source") calls++;
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("view")).toEqual({
      a: { limit: 10, items: ["card"] },
      b: { limit: 10, items: ["card"] },
    });
    // Requester identities are distinct, even when their source happens to match.
    expect(calls).toBe(2);
    f.getVariable("view");
    expect(calls).toBe(4);
    f.setStickyVariables({ source: false });
    expect(f.getVariable("view")).toEqual({ a: false, b: false });
    f.close();
  });

  it("keeps sticky state separate between parent and children", () => {
    const f = createFeaturevisor({ datafile: datafile(), stickyVariables: { source: 1 } });
    const child = f.spawn({ country: "nl" });
    expect(child.getVariable("chain")).toEqual({ limit: 10, items: ["card"] });
    child.setStickyVariables({ source: 2 });
    expect(child.getVariable("chain")).toBe(2);
    expect(f.getVariable("chain")).toBe(1);
    child.setStickyVariables({ alias: null });
    expect(child.getVariable("chain")).toBeNull();
    f.close();
  });

  it("bounds long alias chains and clears failed evaluation sessions", () => {
    const file = datafile();
    for (let index = 0; index < 260; index++)
      file.variables![`link${index}`] = {
        type: "object",
        compose: index === 259 ? "source" : `link${index + 1}`,
      };
    const f = createFeaturevisor({ datafile: file, logLevel: "fatal" });
    expect(f.getVariable("link0")).toBeNull();
    expect(f.evaluateVariable("link0").reason).toBe("error");
    expect(f.getVariable("alias")).toBe(f.getVariable("source"));
    f.close();
  });

  it("propagates removals through the old dependency index on replacement", () => {
    const file = datafile();
    const f = createFeaturevisor({ datafile: file, logLevel: "fatal" });
    const changed = jest.fn();
    f.on("datafile_set", changed);
    const next = { ...file, revision: "removed", variables: { ...file.variables } };
    delete next.variables.source;
    expect(f.setDatafile(next, true)).toBe(true);
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.arrayContaining(["source", "alias", "chain", "view"]),
      }),
    );
    expect(f.getVariable("chain")).toBeNull();
    f.close();
  });
});
