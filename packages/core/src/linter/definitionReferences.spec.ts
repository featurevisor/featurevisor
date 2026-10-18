import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getArchivedReferenceIssues, getDeprecatedReferenceWarnings } from "./definitionReferences";
import type { ReferenceIndex } from "./definitionReferences";
import { lintProject } from "./lintProject";

const index: ReferenceIndex = {
  attributes: {
    country: { description: "Country", type: "string" },
    oldPlan: { description: "Plan", type: "string", archived: true },
    account: {
      description: "Account",
      type: "object",
      properties: { tier: { type: "string" } },
      archived: true,
    },
  },
  segments: {
    netherlands: { description: "NL", conditions: "*" },
    blocked: { description: "Blocked", conditions: "*", archived: true },
  },
  features: {
    checkout: { key: "checkout", bucketBy: "userId", rules: [] } as any,
    retired: { key: "retired", bucketBy: "userId", rules: [], archived: true } as any,
  },
  variables: {
    supportEmail: { description: "Support", type: "string", defaultValue: "a" },
    oldLimit: { description: "Limit", type: "integer", defaultValue: 1, archived: true },
  },
};

const paths = (entityType: Parameters<typeof getArchivedReferenceIssues>[0], definition: unknown) =>
  getArchivedReferenceIssues(entityType, definition, index).map((issue) => issue.path);

describe("archived references", () => {
  it("names the kind and how to fix it", () => {
    expect(getArchivedReferenceIssues("segment", { conditions: "blocked" }, index)).toEqual([
      {
        path: ["conditions"],
        message:
          'Archived segment "blocked" cannot be referenced. Remove the reference, or unarchive the segment.',
      },
    ]);
  });

  it("finds every leaf kind in every branch, including negated ones", () => {
    expect(
      paths("segment", {
        conditions: [
          { not: ["blocked"] },
          { or: [{ attribute: "oldPlan", operator: "equals", value: "x" }, "netherlands"] },
          { attribute: "account.tier", operator: "equals", value: "gold" },
          { feature: "retired" },
          { variable: "oldLimit", operator: "exists" },
          { feature: "retired", variable: "label", operator: "exists" },
          { attribute: "country", operator: "equals", value: "nl" },
        ],
      }),
    ).toEqual([
      ["conditions", 0, "not", 0],
      ["conditions", 1, "or", 0, "attribute"],
      ["conditions", 2, "attribute"],
      ["conditions", 3, "feature"],
      ["conditions", 4, "variable"],
      ["conditions", 5, "feature"],
    ]);
  });

  it("checks every condition location and bucketBy in a feature", () => {
    const override = (conditions: unknown) => ({ key: "o", conditions, value: "x" });
    expect(
      paths("feature", {
        bucketBy: { or: ["userId", "oldPlan"] },
        conditions: "blocked",
        force: { production: [{ conditions: "blocked", enabled: true }] },
        rules: {
          production: [
            {
              key: "all",
              conditions: { feature: "retired" },
              percentage: 100,
              variableOverrides: { label: [override("blocked")] },
            },
          ],
        },
        variations: [
          { value: "a", weight: 100, variableOverrides: { label: [override("blocked")] } },
        ],
      }),
    ).toEqual([
      ["conditions"],
      ["bucketBy", "or", 1],
      ["rules", "production", 0, "conditions", "feature"],
      ["rules", "production", 0, "variableOverrides", "label", 0, "conditions"],
      ["force", "production", 0, "conditions"],
      ["variations", 0, "variableOverrides", "label", 0, "conditions"],
    ]);
    expect(paths("feature", { bucketBy: "oldPlan", rules: [] })).toEqual([["bucketBy"]]);
    expect(paths("feature", { bucketBy: ["oldPlan"], rules: [] })).toEqual([["bucketBy", 0]]);
  });

  it("checks gates, compositions and nested overrides of global variables", () => {
    expect(
      paths("variable", {
        conditions: { variable: "oldLimit", operator: "exists" },
        compose: { flag: { feature: "retired" }, limit: { variable: "oldLimit" } },
        overrides: [
          {
            key: "parent",
            conditions: "netherlands",
            value: "x",
            overrides: [{ key: "child", conditions: "blocked", value: "y" }],
          },
        ],
      }),
    ).toEqual([
      ["conditions", "variable"],
      ["compose", "flag", "feature"],
      ["compose", "limit", "variable"],
      ["overrides", 0, "overrides", 0, "conditions"],
    ]);
    expect(paths("variable", { compose: "oldLimit" })).toEqual([["compose"]]);
  });

  it("checks spec owners, checks, comparisons and children", () => {
    expect(
      getArchivedReferenceIssues("test", { feature: "retired", assertions: [] }, index),
    ).toEqual([
      {
        path: ["feature"],
        message:
          'Archived feature "retired" cannot be referenced. Delete this spec, or unarchive the feature.',
      },
    ]);
    expect(
      paths("test", {
        variable: "supportEmail",
        assertions: [
          {
            checks: [
              { or: [{ segment: "blocked", matches: true }] },
              { operator: "equals", compareTo: { variable: "oldLimit" } },
            ],
            children: [{ checks: [{ feature: "retired", enabled: false }] }],
          },
        ],
      }),
    ).toEqual([
      ["assertions", 0, "checks", 0, "or", 0, "segment"],
      ["assertions", 0, "checks", 1, "compareTo", "variable"],
      ["assertions", 0, "children", 0, "checks", 0, "feature"],
    ]);
    expect(
      paths("scenario", {
        checks: [{ feature: "retired", variable: "label", operator: "exists" }],
      }),
    ).toEqual([["checks", 0, "feature"]]);
  });

  it("checks exact target keys and sticky keys in specs", () => {
    expect(
      paths("target", {
        includeFeatures: ["checkout", "retired", "ret*"],
        includeVariables: "*",
        excludeVariables: ["oldLimit"],
      }),
    ).toEqual([
      ["includeFeatures", 1],
      ["excludeVariables", 0],
    ]);
    expect(
      paths("test", {
        feature: "checkout",
        assertions: [
          {
            stickyFeatures: { retired: { enabled: true }, checkout: { enabled: true } },
            stickyVariables: { oldLimit: 2 },
            children: [{ stickyFeatures: { retired: { enabled: false } } }],
          },
        ],
      }),
    ).toEqual([
      ["assertions", 0, "stickyFeatures", "retired"],
      ["assertions", 0, "stickyVariables", "oldLimit"],
      ["assertions", 0, "children", 0, "stickyFeatures", "retired"],
    ]);
  });

  it("lets archived definitions refer to each other", () => {
    expect(paths("segment", { archived: true, conditions: "blocked" })).toEqual([]);
    expect(
      paths("feature", { archived: true, bucketBy: "oldPlan", conditions: { feature: "retired" } }),
    ).toEqual([]);
    expect(paths("variable", { archived: true, compose: "oldLimit" })).toEqual([]);
  });

  it("rejects an archived segment under not, which would otherwise match everyone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-archived-"));
    const write = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), JSON.stringify(value));
    };
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports={parser:"json"};',
      );
      write("attributes/userId.json", { description: "User", type: "string" });
      write("attributes/country.json", { description: "Country", type: "string" });
      write("segments/blocked.json", {
        description: "Blocked",
        archived: true,
        conditions: [{ attribute: "country", operator: "equals", value: "us" }],
      });
      const rules = [{ key: "allowed", conditions: { not: ["blocked"] }, percentage: 100 }];
      write("features/promo.json", { description: "Promo", bucketBy: "userId", rules });
      write("features/oldPromo.json", {
        description: "Retired promo",
        archived: true,
        bucketBy: "userId",
        rules,
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

      expect(result.hasError).toBe(true);
      expect(result.errors).toEqual([
        expect.objectContaining({
          entityType: "feature",
          key: "promo",
          code: "archived_reference",
          path: ["rules", 0, "conditions", "not", 0],
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks archived definitions for their shape alone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-archived-shape-"));
    const write = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), JSON.stringify(value));
    };
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports={parser:"json"};',
      );
      write("attributes/userId.json", { description: "User", type: "string" });
      // Everything this feature uses has been deleted, which is fine once it is archived.
      write("features/oldPromo.json", {
        description: "Retired promo",
        archived: true,
        bucketBy: "accountId",
        conditions: [
          { not: ["blocked"] },
          { attribute: "plan", operator: "equals", value: "paid" },
          { feature: "ghost", variation: "treatment" },
          { variable: "gone", path: "limit", operator: "greaterThan", value: 1 },
        ],
        rules: [{ key: "all", conditions: "blocked", percentage: 100 }],
      });
      write("variables/oldAlias.json", {
        description: "Retired alias",
        archived: true,
        compose: "gone",
      });
      // Its shape is still checked.
      write("features/broken.json", {
        description: "Retired and malformed",
        archived: true,
        bucketBy: "userId",
        rules: [{ key: "all", conditions: "blocked", percentage: 200 }],
      });
      write("features/legacy.json", {
        description: "Legacy",
        deprecated: true,
        bucketBy: "userId",
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write("features/promo.json", {
        description: "Promo",
        bucketBy: "userId",
        conditions: [{ feature: "legacy" }],
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write("targets/web.json", { description: "Web", includeFeatures: ["promo", "oldPromo"] });
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
          entityType: "feature",
          key: "broken",
          path: ["rules", 0, "percentage"],
        }),
        expect.objectContaining({
          entityType: "target",
          key: "web",
          code: "archived_reference",
          path: ["includeFeatures", 1],
        }),
      ]);
      expect(result.warnings).toEqual([
        expect.objectContaining({
          entityType: "feature",
          key: "promo",
          code: "deprecated_reference",
          path: ["conditions", 0, "feature"],
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("deprecated references", () => {
  const deprecatedIndex: ReferenceIndex = {
    ...index,
    features: {
      ...index.features,
      legacy: { key: "legacy", bucketBy: "userId", rules: [], deprecated: true } as any,
      theme: {
        key: "theme",
        bucketBy: "userId",
        rules: [],
        variablesSchema: {
          color: { type: "string", defaultValue: "red", deprecated: true },
          size: { type: "string", defaultValue: "m" },
        },
      } as any,
    },
    variables: {
      ...index.variables,
      oldSupport: { description: "Old", type: "string", defaultValue: "a", deprecated: true },
    },
  };
  const warnings = (
    entityType: Parameters<typeof getDeprecatedReferenceWarnings>[0],
    definition: unknown,
  ) => getDeprecatedReferenceWarnings(entityType, definition, deprecatedIndex);

  it("warns for each reference to a deprecated feature, feature variable or global variable", () => {
    expect(
      warnings("feature", {
        conditions: [
          { feature: "legacy" },
          { feature: "theme", variable: "color", operator: "equals", value: "red" },
          { feature: "theme", variable: "size", operator: "exists" },
        ],
      }).map((warning) => warning.path),
    ).toEqual([
      ["conditions", 0, "feature"],
      ["conditions", 1, "variable"],
    ]);
    expect(
      warnings("variable", {
        compose: { a: { variable: "oldSupport" }, b: { feature: "legacy" } },
      }),
    ).toEqual([
      {
        path: ["compose", "a", "variable"],
        message:
          'Deprecated global variable "oldSupport" is referenced. Remove or replace the reference before the global variable is archived.',
      },
      {
        path: ["compose", "b", "feature"],
        message:
          'Deprecated feature "legacy" is referenced. Remove or replace the reference before the feature is archived.',
      },
    ]);
    expect(
      warnings("segment", {
        conditions: { feature: "theme", variable: "color", operator: "exists" },
      }),
    ).toEqual([
      {
        path: ["conditions", "variable"],
        message:
          'Deprecated variable "color" of feature "theme" is referenced. Remove or replace the reference before the variable is removed.',
      },
    ]);
  });

  it("leaves deprecated and archived definitions alone", () => {
    expect(warnings("feature", { deprecated: true, conditions: { feature: "legacy" } })).toEqual(
      [],
    );
    expect(warnings("variable", { archived: true, compose: "oldSupport" })).toEqual([]);
  });
});
