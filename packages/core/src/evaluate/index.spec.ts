import type { DatafileContent } from "@featurevisor/types";
import type { Dependencies } from "../dependencies";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { evaluateFeature } from "./index";
import { explainEvaluation } from "./explain";

jest.mock("../builder/buildRuntimeDatafiles", () => ({ buildRuntimeDatafiles: jest.fn() }));
jest.mock("./explain", () => {
  const actual = jest.requireActual("./explain");
  return { ...actual, explainEvaluation: jest.fn(actual.explainEvaluation) };
});

const file: DatafileContent = {
  schemaVersion: "2",
  revision: "test",
  segments: {},
  features: {
    pricing: {
      bucketBy: "userId",
      disabledVariationValue: "control",
      variations: [{ value: "control" }, { value: "treatment" }],
      variablesSchema: {
        message: { type: "string", defaultValue: "Hi", useDefaultWhenDisabled: true },
      },
      traffic: [{ key: "off", segments: "*", percentage: 0 }],
    },
  },
  variables: { supportEmail: { type: "string", defaultValue: "support@example.com" } },
};

describe("evaluate --explain", () => {
  const datasource = {
    getSet: jest.fn(() => "production"),
    featureExists: jest.fn(async () => true),
    variableExists: jest.fn(async () => true),
    readVariable: jest.fn(async () => ({ type: "string", defaultValue: "support@example.com" })),
  };
  const deps = { datasource } as unknown as Dependencies;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile: structuredClone(file) }]);
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  const output = () => JSON.parse(log.mock.calls[log.mock.calls.length - 1][0]);

  test.each([false, true])(
    "rejects mismatched explanations before output (json=%s)",
    async (json) => {
      const real = jest.requireActual<typeof import("./explain")>("./explain").explainEvaluation;
      jest.mocked(explainEvaluation).mockImplementationOnce((...args) => {
        const result = real(...args);
        result.result.value = "wrong";
        return result;
      });
      await expect(
        evaluateFeature(deps, { variable: "supportEmail", context: {}, json, explain: true }),
      ).rejects.toMatchObject({ code: "evaluation_explanation_mismatch" });
      expect(log).not.toHaveBeenCalled();
    },
  );

  test.each([{ feature: "pricing" }, { variable: "supportEmail" }])(
    "keeps SDK JSON results unchanged for %j",
    async (selection) => {
      const options = { ...selection, context: {}, json: true };
      await evaluateFeature(deps, options);
      const plain = output();
      expect(plain).not.toHaveProperty("explanation");
      expect(datasource.getSet).not.toHaveBeenCalled();
      expect(datasource.readVariable).not.toHaveBeenCalled();
      await evaluateFeature(deps, { ...options, explain: true, pretty: true, verbose: true });
      const { explanation, ...evaluations } = output();
      expect(evaluations).toEqual(plain);
      expect(explanation).toBeDefined();
      if (selection.feature) {
        expect(explanation.variation.result.value).toBe("control");
        expect(explanation.variables.message.result.value).toBe("Hi");
      } else {
        expect(explanation.result.value).toBe("support@example.com");
      }
      expect(log.mock.calls).toHaveLength(2);
    },
  );

  test("preserves repeated Target wrappers and adds target specific explanations", async () => {
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([
      { target: "all", datafile: file },
      { target: "web", datafile: { ...file, variables: {} } },
    ]);
    await evaluateFeature(deps, {
      variable: "supportEmail",
      target: ["all", "web"],
      context: {},
      json: true,
      explain: true,
    });
    const result = output();
    expect(result.map((entry: { target: string }) => entry.target)).toEqual(["all", "web"]);
    expect(result[0].evaluations.explanation.source).toMatchObject({
      set: "production",
      target: "all",
    });
    expect(result[1].evaluations.explanation.result).toMatchObject({
      reason: "variable_not_found",
      hasValue: false,
    });
    expect(datasource.readVariable).toHaveBeenCalledTimes(1);
  });

  test("does not read nonexistent variable definitions", async () => {
    datasource.variableExists.mockResolvedValueOnce(false);
    await evaluateFeature(deps, { variable: "missing", context: {}, json: true, explain: true });
    expect(output().explanation.result.reason).toBe("variable_not_found");
    expect(datasource.readVariable).not.toHaveBeenCalled();
  });

  test("fixes the disabled variation headline with or without explanation", async () => {
    for (const explain of [false, true]) {
      log.mockClear();
      await evaluateFeature(deps, { feature: "pricing", context: {}, explain });
      const text = log.mock.calls.flat().join("\n");
      expect(text).toContain('Value: "control"');
      expect(text.includes("Explanation:")).toBe(explain);
      if (explain) {
        expect(text.match(/Full evidence and limitations/g)).toHaveLength(1);
        expect(text.match(/Value:/g)).toHaveLength(3);
      }
    }
  });

  test("rejects conflicting selectors before building", async () => {
    await expect(
      evaluateFeature(deps, {
        feature: "pricing",
        variable: "supportEmail",
        context: {},
        explain: true,
      }),
    ).rejects.toThrow("exactly one");
    expect(buildRuntimeDatafiles).not.toHaveBeenCalled();
  });
});
