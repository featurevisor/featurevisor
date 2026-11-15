import type { DatafileContent } from "@featurevisor/types";

import { featureVariableCell, flagCell, variationCell } from "./engine";

const everyone = (percentage: number, allocation?: unknown[]) => [
  {
    key: "everyone",
    conditions: "*",
    percentage: percentage * 1000,
    ...(allocation && { allocation }),
  },
];

const datafile = {
  schemaVersion: "4",
  revision: "1",
  segments: {},
  features: {
    // A share too small to reach an anonymous person's own bucket
    beta: { bucketBy: "userId", traffic: everyone(1) },
    chat: { bucketBy: "userId", traffic: everyone(50) },
    upload: {
      bucketBy: "userId",
      conditions: JSON.stringify([{ feature: "chat" }]),
      traffic: everyone(100),
    },
    trial: {
      bucketBy: "userId",
      variations: [
        { value: "control", weight: 50 },
        { value: "treatment", weight: 50, variables: { label: "Buy now" } },
      ],
      variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
      traffic: everyone(2, [
        { variation: "control", range: [0, 1000] },
        { variation: "treatment", range: [1000, 2000] },
      ]),
    },
  },
  variables: {},
} as unknown as DatafileContent;

describe("the audience lens", () => {
  it("reads a rule's share however small, not only where an anonymous bucket lands", () => {
    expect(flagCell(datafile, "beta", {})).toMatchObject({
      text: "1%",
      tone: "partial",
      why: { lens: "audience", reason: "rule", ruleKey: "everyone", percentage: 1 },
    });
    expect(variationCell(datafile, "trial", {}).text).toBe("control 1% · treatment 1%");
    expect(featureVariableCell(datafile, "trial", "label", {}).text).toBe(
      "control: Buy · treatment: Buy now",
    );
  });

  it("names the override every variation's value came from", () => {
    const paid = {
      ...datafile,
      features: {
        ...datafile.features,
        trial: {
          ...(datafile.features as Record<string, object>).trial,
          traffic: [
            {
              ...everyone(2, [
                { variation: "control", range: [0, 1000] },
                { variation: "treatment", range: [1000, 2000] },
              ])[0],
              variableOverrides: {
                label: [
                  {
                    key: "paid",
                    conditions: JSON.stringify([
                      { attribute: "plan", operator: "equals", value: "paid" },
                    ]),
                    value: "Upgrade",
                  },
                ],
              },
            },
          ],
        },
      },
    } as unknown as DatafileContent;
    expect(featureVariableCell(paid, "trial", "label", { plan: "paid" })).toMatchObject({
      text: "Upgrade",
      why: { overrideKey: "paid" },
    });
  });

  it("narrows a feature by the share of a feature it requires", () => {
    expect(flagCell(datafile, "upload", {})).toMatchObject({
      text: "50%",
      tone: "partial",
      why: { percentage: 50, requires: [{ feature: "chat", percentage: 50 }] },
    });
  });

  it("gives one person their own answer, at their own bucket", () => {
    expect(flagCell(datafile, "beta", { at: 0.5 }).text).toBe("On");
    expect(flagCell(datafile, "beta", { at: 50 }).text).toBe("Off");
    expect(flagCell(datafile, "upload", { at: 20 }).text).toBe("On");
    expect(flagCell(datafile, "upload", { at: 80 }).text).toBe("Off");
  });
});
