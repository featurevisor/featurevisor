import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TestFeature, TestScenario, TestSegment, TestVariable } from "@featurevisor/types";

jest.mock("react-markdown", () => () => null);

import { EntityTests } from "./tests";
import {
  expandTestAssertions,
  getTestAssertionPermalink,
  getTestCheckDisplayLabel,
  getTestCheckPath,
  getTestCheckPermalink,
  getTestValuePresence,
} from "../testModel";

describe("catalog test presentation", () => {
  it("renders unified condition reasons and expectation fields", () => {
    const tests: Array<TestFeature | TestVariable> = [
      {
        feature: "checkout",
        assertions: [
          {
            at: 50,
            expectedToBeEnabled: false,
            expectedEvaluations: {
              flag: { reason: "conditions_unmet", conditions: [{ feature: "prerequisite" }] },
              variation: { reason: "disabled" },
              variables: { message: { reason: "variable_disabled" } },
            },
          },
        ],
      },
      {
        variable: "message",
        assertions: [
          {
            expectedValue: "blocked",
            expectedEvaluation: { reason: "conditions_unmet" },
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, {}, React.createElement(EntityTests, { tests })),
    );
    expect(html).toContain("conditions_unmet");
    expect(html).not.toMatch(/required_features_unmet|required_variables_unmet|requiredFeatures/);
    expect(html).toContain("variable_disabled");
    expect(html).toContain("conditions");
  });

  it("distinguishes an explicit null from a missing value", () => {
    expect(getTestValuePresence(undefined)).toBe("missing");
    expect(getTestValuePresence(null)).toBe("null");
    expect(getTestValuePresence(false)).toBe("value");
  });

  it("keeps authored assertions without matrices as one numbered assertion", () => {
    const test: TestFeature = {
      key: "checkout-primary",
      feature: "checkout",
      assertions: [
        {
          environment: "staging",
          context: { country: "nl" },
          at: 0,
          expectedToBeEnabled: true,
        },
      ],
    };

    expect(expandTestAssertions(test)).toEqual([
      expect.objectContaining({
        assertionIndex: 0,
        label: "1",
        assertion: test.assertions[0],
      }),
    ]);
  });

  it("uses assertion keys for stable labels and matrix permalinks", () => {
    const test: TestFeature = {
      key: "checkout-primary",
      feature: "checkout",
      assertions: [
        {
          key: "production-rollout",
          promotable: false,
          matrix: { at: [10, 20] },
          environment: "staging",
          at: "${{ at }}" as never,
          context: {},
          expectedToBeEnabled: true,
        },
      ],
    };

    const expanded = expandTestAssertions(test);

    expect(expanded.map((item) => item.label)).toEqual([
      "production-rollout.1",
      "production-rollout.2",
    ]);
    expect(expanded[0].assertion).toMatchObject({
      key: "production-rollout",
      promotable: false,
      at: 10,
    });
    expect(getTestAssertionPermalink(test.key!, expanded[0].label)).toBe(
      "checkout-primary:production-rollout.1",
    );
  });

  it("expands feature matrices in deterministic order with dotted case numbers", () => {
    const test: TestFeature = {
      key: "checkout-matrix",
      feature: "checkout",
      assertions: [
        {
          environment: "staging",
          context: {},
          at: 0,
          expectedToBeEnabled: true,
        },
        {
          matrix: {
            environment: ["staging", "production"],
            at: [10, 90],
            country: ["nl"],
          },
          description: "${{ country }} in ${{ environment }} at ${{ at }}%",
          environment: "${{ environment }}",
          target: "${{ environment }}-web",
          at: "${{ at }}" as never,
          context: {
            country: "${{ country }}",
            label: "${{ country }}-${{ environment }}",
          },
          expectedToBeEnabled: true,
        },
      ],
    };

    const expanded = expandTestAssertions(test);

    expect(expanded.map((item) => item.label)).toEqual(["1", "2.1", "2.2", "2.3", "2.4"]);
    expect(expanded[1]).toMatchObject({
      assertionIndex: 1,
      caseIndex: 0,
      caseCount: 4,
      matrixValues: { environment: "staging", at: 10, country: "nl" },
      assertion: {
        description: "nl in staging at 10%",
        environment: "staging",
        target: "staging-web",
        at: 10,
        context: { country: "nl", label: "nl-staging" },
      },
    });
    expect(expanded[4]).toMatchObject({
      matrixValues: { environment: "production", at: 90, country: "nl" },
      assertion: { environment: "production", at: 90 },
    });
    expect("matrix" in expanded[1].assertion).toBe(false);
  });

  it("expands segment contexts and descriptions without changing expectations", () => {
    const test: TestSegment = {
      key: "countries-germany",
      segment: "countries.germany",
      assertions: [
        {
          matrix: { country: ["de"], city: ["berlin", "hamburg"] },
          description: "${{ city }}, ${{ country }}",
          context: { country: "${{ country }}", city: "${{ city }}" },
          expectedToMatch: false,
        },
      ],
    };

    expect(expandTestAssertions(test)).toEqual([
      expect.objectContaining({
        label: "1.1",
        assertion: expect.objectContaining({
          description: "berlin, de",
          context: { country: "de", city: "berlin" },
          expectedToMatch: false,
        }),
      }),
      expect.objectContaining({
        label: "1.2",
        assertion: expect.objectContaining({
          description: "hamburg, de",
          context: { country: "de", city: "hamburg" },
          expectedToMatch: false,
        }),
      }),
    ]);
  });

  it("uses the test key and dotted case number for stable permalink identities", () => {
    expect(getTestAssertionPermalink("features/checkout/redesign.spec", "2.3")).toBe(
      "features/checkout/redesign.spec:2.3",
    );
  });

  it("uses named check paths for stable nested permalinks with numeric fallbacks", () => {
    expect(getTestCheckDisplayLabel({ variable: "settings", operator: "exists" }, 1)).toBe("2");
    expect(
      getTestCheckDisplayLabel(
        { key: "enabled", feature: "checkout", enabled: true },
        0,
        "availability",
      ),
    ).toBe("availability.enabled");
    expect(
      getTestCheckPermalink("checkout", "production.2", [
        ["key", "availability"],
        ["key", "enabled"],
      ]),
    ).toBe('checkout:production.2:check:[["key","availability"],["key","enabled"]]');
  });

  it("keeps dotted, numeric-looking, nested, and child check identities distinct", () => {
    const paths = [
      getTestCheckPath({ key: "a.b", variable: "settings", operator: "exists" }, 0),
      getTestCheckPath({ key: "b", variable: "settings", operator: "exists" }, 0, [["key", "a"]]),
      getTestCheckPath({ key: "2", variable: "settings", operator: "exists" }, 0),
      getTestCheckPath({ variable: "settings", operator: "exists" }, 1),
      getTestCheckPath({ key: "a.b", variable: "settings", operator: "exists" }, 0, [["child", 0]]),
    ];
    const permalinks = paths.map((checkPath) =>
      getTestCheckPermalink("checkout", "production", checkPath),
    );

    expect(new Set(permalinks).size).toBe(permalinks.length);
  });

  it("preserves global variable defaults and detailed expectations in matrix cases", () => {
    const test: TestVariable = {
      key: "support-email",
      variable: "supportEmail",
      assertions: [
        {
          matrix: { country: ["nl", "de"], at: [25] },
          environment: "production",
          at: "${{ at }}" as never,
          context: { country: "${{ country }}" },
          stickyFeatures: { checkout: { enabled: true } },
          defaultVariableValue: "fallback@example.com",
          expectedValue: "${{ country }}@example.com",
          expectedEvaluation: {
            reason: "variable_override_rule",
            variableOverrideIndex: 0,
          },
          children: [
            {
              context: { country: "${{ country }}" },
              stickyVariables: { supportEmail: "child-${{ country }}@example.com" },
              expectedValue: "child-${{ country }}@example.com",
            },
          ],
        },
      ],
    };

    expect(expandTestAssertions(test)[0]).toMatchObject({
      label: "1.1",
      assertion: {
        at: 25,
        context: { country: "nl" },
        stickyFeatures: { checkout: { enabled: true } },
        defaultVariableValue: "fallback@example.com",
        expectedValue: "nl@example.com",
        expectedEvaluation: {
          reason: "variable_override_rule",
          variableOverrideIndex: 0,
        },
        children: [
          {
            context: { country: "nl" },
            stickyVariables: { supportEmail: "child-nl@example.com" },
            expectedValue: "child-nl@example.com",
          },
        ],
      },
    });
  });

  it("matches the tester by producing no cases for an empty matrix", () => {
    const test: TestSegment = {
      segment: "everyone",
      assertions: [
        {
          matrix: {},
          context: {},
          expectedToMatch: true,
        },
      ],
    };

    expect(expandTestAssertions(test)).toEqual([]);
  });

  it("renders variable checks and scenario specs without treating them as segments", () => {
    const variableTest: TestVariable = {
      key: "support-email",
      variable: "supportEmail",
      assertions: [
        {
          checks: [
            {
              operator: "equals",
              compareTo: { variable: "backupEmail" },
            },
          ],
        },
      ],
    };
    const scenarioTest: TestScenario = {
      key: "checkout-readiness",
      scenario: "checkout readiness",
      assertions: [
        {
          checks: [
            {
              variable: "supportEmail",
              operator: "notEquals",
              value: "",
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        {},
        React.createElement(EntityTests, { tests: [variableTest, scenarioTest] }),
      ),
    );

    expect(html.match(/>Checks<\/h4>/g)).toHaveLength(2);
    expect(html).toContain("Scenario");
    expect(html).toContain("checkout readiness");
    expect(html).not.toContain("Does not match segment");
    expect(html).not.toContain(">Expected</h4>");
  });

  it("shows an explicitly empty expected value while omitting absent expectations", () => {
    const test: TestVariable = {
      key: "settings",
      variable: "settings",
      assertions: [{ checks: [{ operator: "exists" }] }, { expectedValue: "" }],
    };
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, {}, React.createElement(EntityTests, { tests: [test] })),
    );

    expect(html.match(/>Expected<\/h4>/g)).toHaveLength(1);
    expect(html).toContain("value");
  });

  it("presents scenario checks consistently without renaming payload fields", () => {
    const scenarioTest: TestScenario = {
      key: "checkout-readiness.spec",
      scenario: "checkout readiness",
      assertions: [
        {
          context: { checks: "root context checks" },
          checks: [{ feature: "checkout", enabled: true }],
          children: [
            {
              context: { checks: "child context checks" },
              checks: [{ feature: "pricing", variation: "control" }],
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        {},
        React.createElement(EntityTests, { tests: [scenarioTest] }),
      ),
    );

    expect(html.match(/>Checks<\/h4>/g)).toHaveLength(2);
    expect(html.match(/>checks<\/dt>/g)).toHaveLength(2);
    expect(html).toContain("root context checks");
    expect(html).toContain("child context checks");
    expect(scenarioTest.assertions[0]).toHaveProperty("checks");
    expect(scenarioTest.assertions[0].children?.[0]).toHaveProperty("checks");
  });

  it("renders named root and nested checks with stable permalinks", () => {
    const scenarioTest: TestScenario = {
      key: "checkout-readiness",
      scenario: "checkout readiness",
      assertions: [
        {
          key: "production",
          checks: [
            {
              key: "availability",
              description: "Checkout stays available",
              and: [
                { key: "enabled", feature: "checkout", enabled: true },
                { feature: "pricing", variation: "control" },
              ],
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        {},
        React.createElement(EntityTests, { tests: [scenarioTest] }),
      ),
    );

    // Named checks show their key beside the sentence. Unnamed ones are just the sentence.
    expect(html).toContain(">availability</span>");
    expect(html).toContain(">enabled</span>");
    expect(html).toContain("All of these hold");
    expect(html).toContain('aria-label="Link to check availability.2"');
    expect(html).not.toContain("check 2");
    expect(html).toContain(
      `assertion-${encodeURIComponent(
        getTestCheckPermalink("checkout-readiness", "production", [["key", "availability"]]),
      )}`,
    );
    expect(html).toContain(
      `assertion-${encodeURIComponent(
        getTestCheckPermalink("checkout-readiness", "production", [
          ["key", "availability"],
          ["key", "enabled"],
        ]),
      )}`,
    );
    expect(html).toContain('aria-label="Link to check availability"');
    expect(html).toContain('title="Link to this check"');
  });

  it.each(["quality/gate.spec", "constructor.spec"])(
    "disambiguates test and scenario permalinks for %s",
    (key) => {
      const featureTest: TestFeature = {
        key,
        feature: "checkout",
        assertions: [{ environment: "production", context: {}, at: 0, expectedToBeEnabled: true }],
      };
      const scenarioTest: TestScenario = {
        key,
        scenario: "Quality gate",
        assertions: [{ checks: [{ feature: "checkout", enabled: true }] }],
      };

      const html = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          {},
          React.createElement(EntityTests, { tests: [featureTest, scenarioTest] }),
        ),
      );

      expect(html).toContain(`assertion-${encodeURIComponent(`test:${key}:1`)}`);
      expect(html).toContain(`assertion-${encodeURIComponent(`scenario:${key}:1`)}`);
      expect(html).toContain("Assertion 1</button></h3>");
      expect(html).toContain("Case 1</button></h3>");
      expect(html).toContain('aria-label="Link to assertion 1"');
      expect(html).toContain('aria-label="Link to case 1"');
    },
  );
});
