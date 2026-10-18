import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getProjectConfig } from "../config";
import type { AllowedConditions } from "../config";
import { Datasource } from "../datasource";
import { getConditionKindIssues } from "./conditionKinds";
import { lintProject } from "./lintProject";

const paths = (
  entityType: Parameters<typeof getConditionKindIssues>[0],
  definition: unknown,
  allowed: AllowedConditions,
) => getConditionKindIssues(entityType, definition, allowed).map((issue) => issue.path);

const mixed = [
  "netherlands",
  { attribute: "country", operator: "equals", value: "nl" },
  { feature: "checkout" },
  { or: [{ feature: "checkout", variable: "label", operator: "exists" }] },
  { not: [{ variable: "maintenanceMode", operator: "equals", value: true }] },
];

describe("allowed condition kinds", () => {
  it("checks nothing until a location is configured", () => {
    const feature = { conditions: mixed, rules: [{ key: "all", conditions: mixed }] };
    expect(getConditionKindIssues("feature", feature, undefined)).toEqual([]);
    expect(paths("feature", feature, { segments: [] })).toEqual([]);
  });

  it("classifies every kind through groups, and always allows the catch-all", () => {
    const rule = (conditions: unknown) => ({ rules: [{ key: "all", conditions }] });
    expect(paths("feature", rule(mixed), { rules: ["segment"] })).toEqual([
      ["rules", 0, "conditions", 1],
      ["rules", 0, "conditions", 2],
      ["rules", 0, "conditions", 3, "or", 0],
      ["rules", 0, "conditions", 4, "not", 0],
    ]);
    expect(paths("feature", rule(mixed), { rules: ["attribute", "feature"] })).toEqual([
      ["rules", 0, "conditions", 0],
      ["rules", 0, "conditions", 4, "not", 0],
    ]);
    expect(paths("feature", rule("*"), { rules: [] })).toEqual([]);
  });

  it("checks each feature location against its own key", () => {
    const override = (conditions: unknown) => ({ conditions, value: "x" });
    const feature = {
      conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
      rules: {
        production: [
          {
            key: "all",
            conditions: { feature: "checkout" },
            variableOverrides: { label: [override("netherlands"), override({ feature: "x" })] },
          },
        ],
      },
      force: [{ conditions: { attribute: "userId", operator: "equals", value: "qa" } }],
      variations: [
        {
          value: "a",
          variableOverrides: { label: [override({ variable: "v", operator: "exists" })] },
        },
      ],
    };
    expect(
      paths("feature", feature, {
        features: ["feature"],
        rules: ["segment"],
        force: ["segment"],
        featureVariableOverrides: ["attribute", "segment"],
      }),
    ).toEqual([
      ["conditions", 0],
      ["rules", "production", 0, "conditions"],
      ["rules", "production", 0, "variableOverrides", "label", 1, "conditions"],
      ["force", 0, "conditions"],
      ["variations", 0, "variableOverrides", "label", 0, "conditions"],
    ]);
  });

  it("checks segments, global variable gates and nested overrides", () => {
    expect(
      paths(
        "segment",
        { conditions: ["netherlands", { attribute: "plan", operator: "exists" }] },
        {
          segments: ["attribute"],
        },
      ),
    ).toEqual([["conditions", 0]]);
    expect(
      paths(
        "variable",
        {
          conditions: { attribute: "country", operator: "exists" },
          compose: { flag: { feature: "checkout" } },
          overrides: [
            {
              key: "parent",
              conditions: "netherlands",
              value: "x",
              overrides: [{ key: "child", conditions: { feature: "checkout" }, value: "y" }],
            },
          ],
        },
        { variables: ["feature"], variableOverrides: ["attribute", "segment"] },
      ),
    ).toEqual([["conditions"], ["overrides", 0, "overrides", 0, "conditions"]]);
  });

  it("explains each case with a fix the configuration allows", () => {
    const messages = (definition: unknown, allowed: AllowedConditions) =>
      getConditionKindIssues("feature", definition, allowed).map((issue) => issue.message);
    const attributeRule = {
      rules: [{ key: "nl", conditions: { attribute: "country", operator: "equals", value: "nl" } }],
    };
    expect(messages(attributeRule, { rules: ["segment"] })).toEqual([
      'Attribute conditions are not allowed in rules. Move this condition into a segment and reference the segment, or allow "attribute" in allowedConditions.rules.',
    ]);
    expect(messages(attributeRule, { rules: ["segment"], segments: ["segment"] })).toEqual([
      'Attribute conditions are not allowed in rules. Remove this condition, or allow "attribute" in allowedConditions.rules.',
    ]);
    expect(
      messages({ rules: [{ key: "a", conditions: { feature: "x" } }] }, { rules: [] }),
    ).toEqual([
      'Feature conditions are not allowed in rules. Move it to the feature\'s root conditions if it should gate the whole feature, or allow "feature" in allowedConditions.rules.',
    ]);
    expect(
      getConditionKindIssues("segment", { conditions: "netherlands" }, { segments: ["attribute"] }),
    ).toEqual([
      {
        path: ["conditions"],
        message:
          'Segment references are not allowed in segments. Use the segment\'s own conditions here instead, or allow "segment" in allowedConditions.segments.',
      },
    ]);
  });

  it("leaves archived definitions alone", () => {
    expect(
      paths("feature", { archived: true, rules: [{ key: "a", conditions: mixed }] }, { rules: [] }),
    ).toEqual([]);
  });

  it("keeps a project in the v3 shape through lint", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-condition-kinds-"));
    const write = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), JSON.stringify(value));
    };
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        `module.exports = {
          parser: "json",
          allowedConditions: {
            segments: ["attribute"],
            features: ["feature"],
            rules: ["segment"],
            force: ["attribute", "segment"],
            featureVariableOverrides: ["attribute", "segment", "feature"],
            variables: ["feature"],
            variableOverrides: ["attribute", "segment", "feature"],
          },
        };`,
      );
      write("attributes/userId.json", { description: "User", type: "string" });
      write("attributes/country.json", { description: "Country", type: "string" });
      write("segments/netherlands.json", {
        description: "NL",
        conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
      });
      write("segments/dutchCheckout.json", {
        description: "Dutch checkout users",
        conditions: ["netherlands", { feature: "checkout" }],
      });
      write("features/checkout.json", {
        description: "Checkout",
        bucketBy: "userId",
        rules: [{ key: "nl", conditions: "netherlands", percentage: 100 }],
      });
      write("features/promo.json", {
        description: "Promo",
        bucketBy: "userId",
        conditions: [{ feature: "checkout" }],
        force: [
          { conditions: [{ attribute: "userId", operator: "equals", value: "qa" }], enabled: true },
        ],
        rules: [
          {
            key: "nl",
            conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
            percentage: 100,
          },
          { key: "everyone", conditions: "*", percentage: 0 },
        ],
      });
      const projectConfig = getProjectConfig(root);
      const result = await lintProject(
        {
          rootDirectoryPath: root,
          projectConfig,
          datasource: new Datasource(projectConfig, root),
          options: {},
        } as any,
        { json: true },
      );

      expect(result.errors).toEqual([
        expect.objectContaining({
          entityType: "segment",
          key: "dutchCheckout",
          code: "disallowed_condition",
          path: ["conditions", 0],
        }),
        expect.objectContaining({
          entityType: "segment",
          key: "dutchCheckout",
          code: "disallowed_condition",
          path: ["conditions", 1],
        }),
        expect.objectContaining({
          entityType: "feature",
          key: "promo",
          code: "disallowed_condition",
          path: ["rules", 0, "conditions", 0],
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
