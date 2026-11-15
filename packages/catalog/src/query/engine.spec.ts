import type { DatafileContent } from "@featurevisor/types";

import { featureVariableCell, flagCell, globalVariableCell, variationCell } from "./engine";

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
    // Its variations split evenly, and an override requires chat, which is half on
    button: {
      bucketBy: "userId",
      variations: [
        { value: "control", weight: 50 },
        { value: "treatment", weight: 50 },
      ],
      variablesSchema: { max: { type: "integer", defaultValue: 5 } },
      traffic: [
        {
          ...everyone(100, [
            { variation: "control", range: [0, 50000] },
            { variation: "treatment", range: [50000, 100000] },
          ])[0],
          variableOverrides: {
            max: [{ key: "chatting", conditions: JSON.stringify([{ feature: "chat" }]), value: 8 }],
          },
        },
      ],
    },
  },
  variables: {
    supportEmail: {
      type: "string",
      defaultValue: "help@example.com",
      overrides: [
        {
          key: "treated",
          value: "vip@example.com",
          conditions: JSON.stringify([{ feature: "trial", variation: "treatment" }]),
        },
      ],
    },
  },
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

  it("says when a variable's value changes with where someone falls in a required rollout", () => {
    expect(globalVariableCell(datafile, "supportEmail", {}).why).toMatchObject({
      lens: "audience",
      depends: ["trial"],
    });
    expect(featureVariableCell(datafile, "button", "max", {}).why.depends).toEqual(["chat"]);
    // One place in every rollout, or a person bucketed in it, is one exact answer
    expect(globalVariableCell(datafile, "supportEmail", { at: 1.5 })).toMatchObject({
      text: "vip@example.com",
      why: { lens: "person", at: 1.5 },
    });
    expect(globalVariableCell(datafile, "supportEmail", { at: 50 }).text).toBe("help@example.com");
    expect(globalVariableCell(datafile, "supportEmail", { userId: "user-1" }).why.depends).toBe(
      undefined,
    );
  });

  it("gives one person their own answer, at their own bucket", () => {
    expect(flagCell(datafile, "beta", { at: 0.5 }).text).toBe("On");
    expect(flagCell(datafile, "beta", { at: 50 }).text).toBe("Off");
    expect(flagCell(datafile, "upload", { at: 20 }).text).toBe("On");
    expect(flagCell(datafile, "upload", { at: 80 }).text).toBe("Off");
  });
});
