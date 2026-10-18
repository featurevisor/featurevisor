import { listTestSpecs, normalizeScenario } from "./scenarios";
import type { Scenario } from "@featurevisor/types";

const normalize = (value: Scenario) => normalizeScenario(value, "checkout.readiness.spec");

describe("core: list scenarios", () => {
  test("rejects shared public identities from custom datasources", async () => {
    const datasource = {
      listTests: async () => ["checkout"],
      listScenarios: async () => ["checkout"],
      readTest: jest.fn(),
      readScenario: jest.fn(),
    };
    await expect(listTestSpecs(datasource as any)).rejects.toThrow(
      'Test identity collision for "checkout"',
    );
    expect(datasource.readTest).not.toHaveBeenCalled();
    expect(datasource.readScenario).not.toHaveBeenCalled();
  });

  test("authoring types require root checks and exclude the execution wrapper", () => {
    const scenario: Scenario = {
      checks: [{ feature: "checkout", enabled: true }],
    };
    // @ts-expect-error Root checks are required even when children have checks.
    const missingChecks: Scenario = {
      children: [{ checks: [{ feature: "checkout", enabled: true }] }],
    };
    const wrapped: Scenario = {
      ...scenario,
      // @ts-expect-error Assertions belong only to the normalized execution format.
      assertions: [],
    };
    const keyed: Scenario = {
      ...scenario,
      // @ts-expect-error The filename supplies the storage key.
      key: "checkout",
    };
    expect(normalize(scenario).assertions).toHaveLength(1);
    expect(() => normalize(missingChecks)).toThrow("nonempty checks");
    expect(() => normalize(wrapped)).toThrow("without assertions");
    expect(() => normalize(keyed)).toThrow('Unknown scenario property "key"');
  });
  test("normalizes one authored root into the execution assertions wire format", () => {
    const scenario = {
      promotable: false,
      description: "Checkout remains available",
      environment: "production",
      target: "web",
      at: 75,
      context: { country: "nl" },
      stickyFeatures: { checkout: { enabled: true, variation: "treatment" } },
      stickyVariables: { settings: "configured" },
      matrix: { customer: ["new", "returning"] },
      checks: [{ variable: "settings", operator: "notNull" as const }],
      children: [
        {
          context: { country: "gb" },
          checks: [{ feature: "checkout", enabled: true }],
        },
      ],
    };
    const original = JSON.parse(JSON.stringify(scenario));

    expect(normalize(scenario)).toEqual({
      scenario: "checkout.readiness.spec",
      promotable: false,
      assertions: [
        {
          description: "Checkout remains available",
          environment: "production",
          target: "web",
          at: 75,
          context: { country: "nl" },
          stickyFeatures: { checkout: { enabled: true, variation: "treatment" } },
          stickyVariables: { settings: "configured" },
          matrix: { customer: ["new", "returning"] },
          checks: [{ variable: "settings", operator: "notNull" }],
          children: [
            {
              context: { country: "gb" },
              checks: [{ feature: "checkout", enabled: true }],
            },
          ],
        },
      ],
    });
    expect(scenario).toEqual(original);
  });

  test.each([
    [null, "Scenario must be an object"],
    [[], "Scenario must be an object"],
    [{}, "nonempty checks at the root"],
    [
      {
        assertions: [{ checks: [{ variable: "settings", operator: "exists" }] }],
      },
      "without assertions",
    ],
    [
      {
        checks: [{ variable: "settings", operator: "exists" }],
        expectedValue: true,
      },
      'Unknown scenario property "expectedValue"',
    ],
  ])("rejects malformed authored scenarios %#", (scenario, message) => {
    expect(() => normalize(scenario as any)).toThrow(message as string);
  });

  test("keeps distinct full storage keys for entity tests and scenarios", async () => {
    const entityTest = {
      variable: "settings",
      assertions: [{ expectedValue: "configured" }],
    };
    const scenario = {
      checks: [{ variable: "settings", operator: "notNull" }],
    };
    const datasource = {
      listTests: async () => ["settings"],
      readTest: async () => entityTest,
      listScenarios: async () => ["journeys.settings.spec"],
      readScenario: async () => scenario,
    };

    await expect(listTestSpecs(datasource as any)).resolves.toEqual([
      {
        ...entityTest,
        key: "settings",
      },
      {
        key: "journeys.settings.spec",
        scenario: "journeys.settings.spec",
        assertions: [{ checks: [{ variable: "settings", operator: "notNull" }] }],
      },
    ]);
    expect(scenario).not.toHaveProperty("assertions");
  });

  test("wraps the authored situation without renaming or mutating user payloads", () => {
    const checks = [{ feature: "checkout", enabled: true }];
    const context = { custom: "authored value", checks: "context attribute" };
    const stickyVariables = { settings: { custom: [1], checks: [2] } };
    const input: Scenario = {
      checks,
      context,
      stickyVariables,
      children: [{ context, stickyVariables, checks }],
    };
    const result = normalize(input);
    expect(result.assertions[0]).toEqual({
      context,
      stickyVariables,
      checks,
      children: [{ context, stickyVariables, checks }],
    });
    expect(input.children![0]).toHaveProperty("checks", checks);
    expect(input).not.toHaveProperty("assertions");
    expect(result.assertions[0].context).toBe(context);
    expect(result.assertions[0].stickyVariables).toBe(stickyVariables);
  });

  test.each([
    [null, "Scenario child must be an object"],
    [[], "Scenario child must be an object"],
    [{}, "nonempty checks"],
    [{ checks: [] }, "nonempty checks"],
    [
      { checks: [{ feature: "checkout", enabled: true }], unexpectedProperty: [] },
      'Unknown scenario child property "unexpectedProperty"',
    ],
    [{ checks: [{ feature: "checkout", enabled: true }], assertions: [] }, "without assertions"],
    [
      { checks: [{ feature: "checkout", enabled: true }], children: [] },
      'Unknown scenario child property "children"',
    ],
  ])("rejects invalid child authoring %#", (child, message) => {
    expect(() =>
      normalize({
        checks: [{ feature: "checkout", enabled: true }],
        children: [child],
      } as any),
    ).toThrow(message as string);
  });

  test.each([[], {}, null])("rejects malformed children collections %#", (children) => {
    expect(() =>
      normalize({
        checks: [{ feature: "checkout", enabled: true }],
        children,
      } as any),
    ).toThrow("nonempty array");
  });

  test("rejects unknown scenario and child properties in types and validation", () => {
    const scenario: Scenario = {
      checks: [{ feature: "checkout", enabled: true }],
      // @ts-expect-error Scenario authoring only accepts declared properties.
      unexpectedProperty: true,
    };
    const child: Scenario = {
      checks: [{ feature: "checkout", enabled: true }],
      children: [
        {
          checks: [{ feature: "checkout", enabled: true }],
          // @ts-expect-error Scenario children only accept declared properties.
          unexpectedProperty: true,
        },
      ],
    };
    expect(() => normalize(scenario)).toThrow('Unknown scenario property "unexpectedProperty"');
    expect(() => normalize(child)).toThrow('Unknown scenario child property "unexpectedProperty"');
  });
});
