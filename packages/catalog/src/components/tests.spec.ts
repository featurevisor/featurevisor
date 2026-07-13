import type { TestFeature, TestSegment } from "@featurevisor/types";

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
