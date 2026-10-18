import type { FeatureAssertion, TestFeature, TestVariable } from "@featurevisor/types";

it("types authored flat, environment and matrix feature assertions without requiring an environment", () => {
  const flat: TestFeature = {
    feature: "checkout",
    assertions: [{ at: 50, expectedToBeEnabled: true }],
  };
  const environment: FeatureAssertion = { environment: "production", at: 50 };
  const matrix: FeatureAssertion = {
    at: 50,
    matrix: { country: ["nl", "gb"] },
    context: { country: "${{ country }}" },
  };
  // @ts-expect-error Feature assertions require a bucket position.
  const missingAt: FeatureAssertion = { expectedToBeEnabled: true };
  const variable: TestVariable = { variable: "policy", assertions: [{ expectedValue: 1 }] };
  expect(flat.assertions[0].environment).toBeUndefined();
  expect([environment, matrix, missingAt, variable]).toHaveLength(4);
});
