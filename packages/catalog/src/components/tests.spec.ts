import type { TestFeature, TestSegment, TestVariable } from "@featurevisor/types";

import { expandTestAssertions, getTestAssertionPermalink } from "../testModel";

describe("catalog test presentation", () => {
  it("keeps authored assertions without matrices as one numbered assertion", () => {
    const test: TestFeature = {
      key: "checkout-primary",
      feature: "checkout",
      assertions: [
        {
          environment: "staging",
          context: { country: "nl" },
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
});
