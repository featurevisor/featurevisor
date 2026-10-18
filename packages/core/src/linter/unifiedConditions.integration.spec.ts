import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Datasource } from "../datasource";
import { getProjectConfig } from "../config";
import { lintProject } from "./lintProject";

describe("unified condition dependency lint", () => {
  let root: string;
  function write(file: string, value: unknown) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(value));
  }
  function feature(changes: object = {}) {
    return {
      description: "Feature",
      bucketBy: "identity",
      variablesSchema: { title: { type: "string", defaultValue: "Title" } },
      rules: { production: [{ key: "all", conditions: "*", percentage: 100 }] },
      ...changes,
    };
  }
  function lint(entityType?: string) {
    const projectConfig = getProjectConfig(root);
    return lintProject(
      {
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        options: {},
      } as any,
      { json: true, entityType },
    );
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-conditions-lint-"));
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      'module.exports = { parser: "json", environments: ["production"] };',
    );
    write("attributes/identity.json", { description: "Identity", type: "string" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  describe.each([
    "segment",
    "feature root",
    "rule",
    "force",
    "rule override",
    "variation override",
    "global root",
    "global override",
    "nested global override",
    "composition root",
  ])("empty conditions in %s", (placement) => {
    it.each(["list", "and", "or", "not"])(
      "retains the authored path and friendly %s diagnostic in lint output",
      async (kind) => {
        const conditions = kind === "list" ? [] : { or: [{ feature: "source" }, { [kind]: [] }] };
        write("features/source.json", feature());
        const rule = { key: "all", conditions: "*", percentage: 100 };
        const override = { key: "child", conditions, value: "Title" };
        let entityType = "feature";
        let prefix: (string | number)[] = [];
        if (placement === "segment") {
          entityType = "segment";
          write("segments/invalid.json", { description: "Segment", conditions });
        } else if (placement === "feature root") {
          write("features/invalid.json", feature({ conditions }));
        } else if (placement === "rule") {
          prefix = ["rules", "production", 0];
          write(
            "features/invalid.json",
            feature({ rules: { production: [{ ...rule, conditions }] } }),
          );
        } else if (placement === "force") {
          prefix = ["force", "production", 0];
          write(
            "features/invalid.json",
            feature({ force: { production: [{ conditions, enabled: true }] } }),
          );
        } else if (placement === "rule override") {
          prefix = ["rules", "production", 0, "variableOverrides", "title", 0];
          write(
            "features/invalid.json",
            feature({
              rules: { production: [{ ...rule, variableOverrides: { title: [override] } }] },
            }),
          );
        } else if (placement === "variation override") {
          prefix = ["variations", 0, "variableOverrides", "title", 0];
          write(
            "features/invalid.json",
            feature({
              variations: [
                { value: "control", weight: 100, variableOverrides: { title: [override] } },
              ],
            }),
          );
        } else {
          entityType = "variable";
          const ordinary = { description: "Title", type: "string", defaultValue: "Title" };
          if (placement === "global root")
            write("variables/invalid.json", { ...ordinary, conditions });
          else if (placement === "composition root") {
            write("variables/sourceValue.json", ordinary);
            write("variables/invalid.json", {
              description: "Alias",
              compose: "sourceValue",
              conditions,
            });
          } else {
            const nested = placement === "nested global override";
            prefix = ["overrides", "production", 0, ...(nested ? ["overrides", 0] : [])];
            write("variables/invalid.json", {
              ...ordinary,
              overrides: {
                production: [
                  nested
                    ? { key: "parent", conditions: "*", value: "Parent", overrides: [override] }
                    : override,
                ],
              },
            });
          }
        }
        const result = await lint();
        expect(result.hasError).toBe(true);
        expect(result.errors).toEqual([
          expect.objectContaining({
            entityType,
            key: "invalid",
            path: [...prefix, "conditions", ...(kind === "list" ? [] : ["or", 1, kind])],
            message:
              kind === "list"
                ? "conditions must not be empty. Use '*' to match everything."
                : `\`${kind}\` must contain at least one condition`,
          }),
        ]);
        expect(JSON.stringify(result)).not.toMatch(/Too small|expected array to have|>=1 items/);
      },
    );
  });

  it.each([false, true])("reports a missing feature dependency with nesting=%s", async (nested) => {
    write(
      "features/checkout.json",
      feature({ conditions: [{ feature: nested ? "pricing" : "missing" }] }),
    );
    if (nested) write("features/pricing.json", feature({ conditions: [{ feature: "missing" }] }));
    const result = await lint("feature");
    expect(result.errors).toEqual([
      expect.objectContaining({
        entityType: "feature",
        key: nested ? "pricing" : "checkout",
        path: ["conditions", 0, "feature"],
        message: 'Unknown feature "missing".',
      }),
    ]);
  });

  it("rejects a missing structural feature dependency under NOT", async () => {
    write("features/checkout.json", feature({ conditions: { not: [{ feature: "missing" }] } }));
    const result = await lint("feature");
    expect(result.errors).toEqual([
      expect.objectContaining({
        entityType: "feature",
        key: "checkout",
        path: ["conditions", "not", 0, "feature"],
        message: 'Unknown feature "missing".',
      }),
    ]);
  });

  it("reports every independent feature, variable, segment and mixed cycle in one pass", async () => {
    write("features/featureSelf.json", feature({ conditions: { feature: "featureSelf" } }));
    write("variables/variableSelf.json", {
      description: "Self",
      type: "boolean",
      defaultValue: true,
      conditions: { variable: "variableSelf", operator: "equals", value: true },
    });
    write("segments/segmentSelf.json", { description: "Self", conditions: "segmentSelf" });
    write(
      "features/checkout.json",
      feature({ rules: { production: [{ key: "beta", conditions: "beta", percentage: 100 }] } }),
    );
    write("segments/beta.json", {
      description: "Beta",
      conditions: { not: [{ feature: "checkout", enabled: false }] },
    });
    const result = await lint();
    const cycles = result.errors.filter((error) => error.code === "circular_dependency");
    expect(cycles).toHaveLength(4);
    expect(result.errors).toHaveLength(4);
    for (const cycle of cycles) {
      expect(cycle.message).toMatch(/^circular dependency found: /);
      expect(cycle.message).not.toContain("circular variable dependency");
    }
    expect(cycles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          key: "featureSelf",
          path: ["conditions"],
        }),
        expect.objectContaining({
          entityType: "variable",
          key: "variableSelf",
          path: ["conditions"],
        }),
        expect.objectContaining({
          entityType: "segment",
          key: "segmentSelf",
          path: ["conditions"],
        }),
      ]),
    );
    const mixed = cycles.find((error) => error.message.includes('feature "checkout"'))!;
    expect(mixed.message).toContain('segment "beta"');
    expect(mixed.message).toContain("rules.production[0].conditions");
  });
  it.each(["rule", "force", "rule override", "variation override"])(
    "detects a feature reading its own variable through %s",
    async (placement) => {
      const reference = { feature: "checkout", variable: "title", operator: "notNull" };
      const rule = { key: "all", conditions: "*", percentage: 100 };
      const changes =
        placement === "rule"
          ? { rules: { production: [{ ...rule, conditions: { or: [reference] } }] } }
          : placement === "force"
            ? { force: { production: [{ conditions: reference, enabled: true }] } }
            : placement === "rule override"
              ? {
                  rules: {
                    production: [
                      {
                        ...rule,
                        variableOverrides: {
                          title: [{ conditions: reference, value: "Override" }],
                        },
                      },
                    ],
                  },
                }
              : {
                  variations: [
                    {
                      value: "control",
                      weight: 100,
                      variableOverrides: { title: [{ conditions: reference, value: "Override" }] },
                    },
                  ],
                };
      write("features/checkout.json", feature(changes));
      const result = await lint("feature");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          code: "circular_dependency",
          entityType: "feature",
          key: "checkout",
        }),
      );
      expect(result.errors[0].message).toContain('feature "checkout"');
      expect(result.errors[0].message).toContain('variable "title"');
    },
  );
  it("finds cycles through nested global overrides and composition sources", async () => {
    write("variables/source.json", {
      description: "Source",
      type: "string",
      defaultValue: "Source",
      overrides: {
        production: [
          {
            key: "parent",
            conditions: "*",
            value: "Parent",
            overrides: [{ key: "child", conditions: "audience", value: "Child" }],
          },
        ],
      },
    });
    write("variables/alias.json", { description: "Alias", compose: "source" });
    write("segments/audience.json", {
      description: "Audience",
      conditions: { variable: "alias", operator: "notNull" },
    });
    const result = await lint();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("circular_dependency");
    expect(result.errors[0].message).toContain("overrides.production[0].overrides[0].conditions");
    expect(result.errors[0].message).toContain("compose");
  });
  it("loads complete entity context when linting only segments", async () => {
    write("features/checkout.json", feature());
    write("variables/policy.json", { description: "Policy", type: "boolean", defaultValue: true });
    write("segments/plain.json", { description: "Plain", conditions: "*" });
    write("segments/audience.json", {
      description: "Audience",
      conditions: [
        "plain",
        { feature: "checkout" },
        { variable: "policy", operator: "equals", value: true },
      ],
    });
    expect((await lint("segment")).errors).toEqual([]);
    write("segments/audience.json", {
      description: "Audience",
      conditions: ["plain", { feature: "checkout", variation: "absent" }],
    });
    expect((await lint("segment")).errors).toEqual([
      expect.objectContaining({
        entityType: "segment",
        key: "audience",
        path: ["conditions", 1, "variation"],
        message: expect.stringContaining("Unknown variation"),
      }),
    ]);
  });
});
