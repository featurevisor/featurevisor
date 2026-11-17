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
    // Bucketed by devices, and a feature for users that requires it
    devices: { bucketBy: "deviceId", traffic: everyone(50) },
    gated: {
      bucketBy: "userId",
      conditions: JSON.stringify([{ feature: "devices" }]),
      traffic: everyone(100),
    },
    // Half on, with a message for that half alone
    promo: {
      bucketBy: "userId",
      variablesSchema: { message: { type: "string", defaultValue: "" } },
      traffic: [{ ...everyone(50)[0], variables: { message: "Next day" } }],
    },
    // Bucketed by a user and their organization together
    both: { bucketBy: ["userId", "organizationId"], traffic: everyone(30) },
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

  it("reads a variable where its rule's share is on, and says the share", () => {
    expect(featureVariableCell(datafile, "promo", "message", {})).toMatchObject({
      text: "Next day 50%",
      tone: "partial",
      value: null,
      why: { lens: "audience", percentage: 50 },
    });
    // One context gets one answer, whichever side of the rollout it falls on
    expect(featureVariableCell(datafile, "promo", "message", { at: 10 }).text).toBe("Next day");
    expect(featureVariableCell(datafile, "promo", "message", { at: 90 }).text).toBe("");
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
      why: { lens: "context", at: 1.5 },
    });
    expect(globalVariableCell(datafile, "supportEmail", { at: 50 }).text).toBe("help@example.com");
    expect(globalVariableCell(datafile, "supportEmail", { userId: "user-1" }).why.depends).toBe(
      undefined,
    );
  });

  it("is one person's exact answer once the context has what the feature buckets by", () => {
    for (const userId of ["user-1", "user-2", "user-3", "user-4"]) {
      const cell = flagCell(datafile, "chat", { userId });
      expect(["On", "Off"]).toContain(cell.text);
      expect(cell.why).toMatchObject({ lens: "context", bucketBy: "userId" });
      expect(cell.why.depends).toBe(undefined);
    }
  });

  it("says what the context lacks, naming only the missing part", () => {
    expect(flagCell(datafile, "both", { userId: "user-1" })).toMatchObject({
      text: "30%",
      why: { lens: "audience", bucketBy: "userId and organizationId", missing: "organizationId" },
    });
    expect(flagCell(datafile, "both", { userId: "user-1", organizationId: "org-1" }).why.lens).toBe(
      "context",
    );
  });

  it("says one person's answer varies with a required feature the context cannot place them in", () => {
    // Placed in gated's rollout by userId, but not in devices', which buckets by deviceId
    expect(flagCell(datafile, "gated", { userId: "user-1" }).why).toMatchObject({
      lens: "audience",
      depends: ["devices"],
    });
    // With deviceId too, it is exact
    const placed = flagCell(datafile, "gated", { userId: "user-1", deviceId: "device-1" });
    expect(placed.why.lens).toBe("context");
    expect(placed.why.depends).toBe(undefined);
  });

  it("gives one person their own answer, at their own bucket", () => {
    expect(flagCell(datafile, "beta", { at: 0.5 }).text).toBe("On");
    expect(flagCell(datafile, "beta", { at: 50 }).text).toBe("Off");
    expect(flagCell(datafile, "upload", { at: 20 }).text).toBe("On");
    expect(flagCell(datafile, "upload", { at: 80 }).text).toBe("Off");
  });
});
