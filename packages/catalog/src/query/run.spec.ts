import type { DatafileContent } from "@featurevisor/types";

import { encodeDeadline, getDeadlineClock } from "../metadata";
import type { CatalogIndex, EntitySummary } from "../types";

import { parseFql } from "./fql";
import { getComparedValues } from "./engine";
import { runReport, type ResultValue } from "./run";

const nl = JSON.stringify([{ attribute: "country", operator: "equals", value: "nl" }]);

/** One feature's traffic: a share for the Dutch, then a share for everyone */
const rollout = (forNl: number | undefined, forEveryone: number) => ({
  bucketBy: "userId",
  traffic: [
    ...(forNl === undefined
      ? []
      : [{ key: "nl", conditions: "nl", percentage: forNl * 1000, allocation: [] }]),
    { key: "everyone", conditions: "*", percentage: forEveryone * 1000, allocation: [] },
  ],
});

const pricing = {
  bucketBy: "userId",
  variations: [
    { value: "control", weight: 50 },
    { value: "treatment", weight: 50, variables: { label: "Buy now" } },
  ],
  variablesSchema: { label: { type: "string", defaultValue: "Purchase" } },
  traffic: [
    {
      key: "everyone",
      conditions: "*",
      percentage: 100000,
      allocation: [
        { variation: "control", range: [0, 50000] },
        { variation: "treatment", range: [50000, 100000] },
      ],
    },
  ],
};

const datafile = (features: Record<string, unknown>) =>
  ({
    schemaVersion: "4",
    revision: "1",
    segments: { nl: { conditions: nl } },
    features,
    variables: {
      supportEmail: {
        type: "string",
        defaultValue: "help@example.com",
        overrides: [{ key: "nl", value: "hulp@example.com", conditions: "nl" }],
      },
    },
  }) as unknown as DatafileContent;

const datafiles = new Map<string | null, DatafileContent>([
  [
    "staging",
    datafile({
      checkout: rollout(undefined, 100),
      search: rollout(undefined, 100),
      legacy: rollout(undefined, 100),
      pricing,
    }),
  ],
  [
    "production",
    datafile({
      checkout: rollout(100, 50),
      search: rollout(undefined, 100),
      legacy: rollout(undefined, 0),
      pricing,
    }),
  ],
]);

const summary = (key: string, extra: Partial<EntitySummary> = {}): EntitySummary => ({
  key,
  href: key,
  ...extra,
});

const index: CatalogIndex = {
  set: "",
  counts: {} as CatalogIndex["counts"],
  entities: {
    feature: [
      summary("checkout", {
        owners: ["growth-team"],
        tags: ["web", "checkout"],
        bucketBy: "userId",
        references: ["segment:nl", "attribute:country"],
        deadlines: [encodeDeadline({ type: "remove", by: "2026-11-01T09:00:00Z" })],
        metadataTerms: ["jira=GROWTH-42"],
        lastModified: { commit: "a", author: "Ada", timestamp: "2026-11-10T10:00:00Z" },
      }),
      summary("search", {
        owners: ["platform-team"],
        tags: ["web"],
        bucketBy: "deviceId",
        lastModified: { commit: "b", author: "Bo", timestamp: "2026-11-14T10:00:00Z" },
      }),
      summary("legacy", {
        owners: ["growth-team"],
        deprecated: true,
        bucketBy: "userId",
        deadlines: [encodeDeadline({ type: "review", by: "2027-01-20T09:00:00Z" })],
      }),
      summary("pricing", {
        owners: ["growth-team"],
        bucketBy: "userId",
        variationValues: ["control", "treatment"],
        variableKeys: ["label"],
      }),
    ],
    variable: [summary("supportEmail", { owners: ["platform-team"], variableType: "string" })],
    segment: [summary("nl", { usedByCount: 2 }), summary("unused", { usedByCount: 0 })],
    attribute: [summary("country", { attributeType: "string" }), summary("userId")],
    target: [],
    schema: [],
    test: [],
  } as unknown as CatalogIndex["entities"],
};

const project = {
  environments: ["staging", "production"],
  features: { checkout: [], search: [], legacy: [], pricing: ["label"] },
  variables: ["supportEmail"],
  attributes: ["country", "userId"],
};

const clock = getDeadlineClock("2026-11-15T12:00:00Z");

/** The report's rows as text, each column's values joined by ` | ` */
function run(query: string) {
  const { report, errors } = parseFql(query, project);
  if (!report) throw new Error(errors.map((error) => error.message).join("\n"));
  const result = runReport({ report, index, datafiles, hasEnvironments: true, clock });
  const text = (value: ResultValue | ResultValue[]) =>
    Array.isArray(value) ? value.map((item) => item.text).join(" / ") : value.text;
  return {
    result,
    headings: result.columns.map((column) => column.heading.text),
    rows: result.rows.map((row) => row.values.map(text).join(" | ")),
  };
}

describe("runReport, definitions", () => {
  it("lists properties, bucketBy among them, sorted naturally with blanks last", () => {
    expect(
      run("FROM features\nSELECT key, owner, bucketBy\nORDER BY owner, key DESC").rows,
    ).toEqual([
      "pricing | growth-team | userId",
      "legacy | growth-team | userId",
      "checkout | growth-team | userId",
      "search | platform-team | deviceId",
    ]);
  });

  it("leads with the key when SELECT leaves it out, and reads metadata", () => {
    const { headings, rows } = run(
      "FROM features\nWHERE metadata.jira exists\nSELECT metadata.jira",
    );
    expect(headings).toEqual(["key", "metadata.jira"]);
    expect(rows).toEqual(["checkout | GROWTH-42"]);
  });

  it("counts by a property, a list counting once per item, most first", () => {
    expect(run("FROM features\nSELECT owner, count()\nGROUP BY owner").rows).toEqual([
      "growth-team | 3",
      "platform-team | 1",
    ]);
    expect(run("FROM features\nGROUP BY tags").rows).toEqual(["web | 2", " | 2", "checkout | 1"]);
    expect(run("FROM features\nSELECT count()").rows).toEqual(["4"]);
  });

  it("reads several kinds of rows at once", () => {
    expect(
      run("FROM features, variables\nWHERE owner == 'platform-team'\nSELECT kind, key").rows,
    ).toEqual(["feature | search", "variable | supportEmail"]);
    expect(run("FROM segments\nWHERE usedBy == 0").rows).toEqual(["unused |  |  | "]);
  });

  it("knows deadlines, overdue first, and when things changed", () => {
    expect(
      run(
        "FROM features\nWHERE deadline exists\nSELECT deadlineStatus, deadlineType\nORDER BY deadlineStatus",
      ).rows,
    ).toEqual(["checkout | overdue | remove", "legacy | later | review"]);
    expect(run("FROM features\nSELECT updatedBy\nORDER BY updated DESC\nLIMIT 1").rows).toEqual([
      "search | Bo",
    ]);
  });
});

describe("runReport, what people get", () => {
  it("reads each row's own feature, for everyone when CONTEXT says nobody", () => {
    const { headings, rows } = run("FROM features\nENVIRONMENT production\nSELECT feature(key)");
    expect(headings).toEqual(["key", "enabled"]);
    expect(rows).toEqual(["checkout | 50%", "search | On", "legacy | Off", "pricing | On"]);
  });

  it("filters by evaluations: rollouts in progress, and ready to ship", () => {
    expect(
      run(
        "FROM features\nWHERE rollout(feature(key)) > 0 and rollout(feature(key)) < 100\nENVIRONMENT production\nSELECT rollout(feature(key))",
      ).rows,
    ).toEqual(["checkout | 50%"]);
    expect(
      run(
        "FROM features\nWHERE rollout(feature(key, 'staging')) == 100 and rollout(feature(key, 'production')) < 100\nSELECT feature(key, 'staging'), feature(key, 'production')",
      ).rows,
    ).toEqual(["checkout | On | 50%", "legacy | On | Off"]);
    expect(
      run("FROM features\nWHERE deprecated == true and feature(key)\nENVIRONMENT staging").rows,
    ).toEqual(["legacy | On"]);
  });

  it("says what an evaluation says beside its answer, each detail as itself", () => {
    const { result, headings, rows } = run(
      "FROM features\nWHERE key in ['checkout', 'search']\nENVIRONMENT production\nSELECT feature(key), rollout(feature(key)), rule(feature(key)), reason(feature(key))",
    );
    expect(headings).toEqual(["key", "enabled", "rollout", "rule", "reason"]);
    expect(rows).toEqual([
      "checkout | 50% | 50% | everyone | rule",
      "search | On | 100% | everyone | rule",
    ]);
    expect(result.rows[1].values[2]).toMatchObject({ text: "100%", detail: "rollout" });
    expect(
      run(
        "VARY country ['nl', 'de']\nENVIRONMENT production\nSELECT country, override(variable('supportEmail')), rollout(feature('checkout', 'staging'))",
      ),
    ).toMatchObject({
      headings: ["country", "supportEmail override", "checkout rollout in staging"],
      rows: ["nl | nl | 100%", "de |  | 100%"],
    });
  });

  it("sorts a flag by how much of its audience it is on for", () => {
    expect(
      run("FROM features\nENVIRONMENT production\nSELECT feature(key)\nORDER BY feature(key) DESC")
        .rows,
    ).toEqual(["search | On", "pricing | On", "checkout | 50%", "legacy | Off"]);
  });

  it("counts features by how they are rolled out, per environment", () => {
    expect(
      run(
        "FROM features\nENVIRONMENT staging, production\nSELECT feature(key), count()\nGROUP BY feature(key)",
      ).rows,
    ).toEqual([
      "staging | On | 4",
      "production | On | 2",
      "production | 50% | 1",
      "production | Off | 1",
    ]);
  });

  it("varies people into a matrix, environments across the top", () => {
    const { headings, rows } = run(
      "FROM features\nWHERE key == 'checkout'\nVARY country ['nl', OTHER]\nENVIRONMENT staging, production\nSELECT feature(key)\nAS MATRIX BY ENVIRONMENT",
    );
    expect(headings).toEqual(["key", "country", "enabled"]);
    expect(rows).toEqual(["checkout | nl | On / On", "checkout | (any other) | On / 50%"]);
  });

  it("reads an experiment's split and its variable for each variation", () => {
    expect(
      run(
        "FROM features\nWHERE variations notEmpty\nENVIRONMENT production\nSELECT feature(key).variation, feature(key).label",
      ).rows,
    ).toEqual(["pricing | control 50% · treatment 50% | control: Purchase · treatment: Buy now"]);
  });

  it("varies a rollout position, and keeps numbers and true or false as written", () => {
    expect(
      run(
        "AT 10, 90\nCONTEXT { country: 'de' }\nENVIRONMENT production\nSELECT at, feature('checkout')",
      ),
    ).toMatchObject({ rows: ["10 | On", "90 | Off"] });
    const compared = getComparedValues([
      datafile({
        members: {
          bucketBy: "userId",
          traffic: [
            {
              key: "members",
              conditions: JSON.stringify([
                { attribute: "loggedIn", operator: "equals", value: true },
                { attribute: "seats", operator: "in", value: [10, 50] },
              ]),
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      }),
    ]);
    expect(compared.get("loggedIn")).toEqual([true]);
    expect(compared.get("seats")).toEqual([10, 50]);
  });

  it("picks rows by their properties before VARY finds values", () => {
    // checkout compares country, search compares nothing, so only search's own rows remain
    expect(
      run(
        "FROM features\nWHERE key == 'search' and country != 'de'\nVARY country\nSELECT feature(key)",
      ).rows,
    ).toEqual(["search | (any other) | On"]);
  });

  it("leaves out of VARY * what the features a report requires bucket by", () => {
    const required = datafile({
      pricing: {
        ...pricing,
        force: [
          {
            conditions: JSON.stringify([
              { attribute: "userId", operator: "equals", value: "qa-user-1" },
            ]),
            variation: "treatment",
          },
        ],
      },
    });
    const supportEmail = required.variables!.supportEmail as unknown as {
      overrides: unknown[];
    };
    supportEmail.overrides.push({
      key: "treated",
      value: "vip@example.com",
      conditions: JSON.stringify([{ feature: "pricing", variation: "treatment" }]),
    });
    const { report } = parseFql("FROM variables\nVARY *\nSELECT variable(key)", project);
    const result = runReport({
      report: report!,
      index,
      datafiles: new Map([
        ["staging", required],
        ["production", required],
      ]),
      hasEnvironments: true,
      clock,
    });
    expect(result.columns.map((column) => column.heading.text)).toEqual([
      "key",
      "country",
      "value",
    ]);
    // An audience falls on both sides of pricing's split, which the value says it varies with
    expect(result.lenses.has("audience")).toBe(true);
  });

  it("evaluates only the contexts written out, OTHER as everyone else", () => {
    const { result, headings, rows } = run(
      [
        "FROM features",
        "WHERE key == 'checkout'",
        "VARY [{ country: 'nl', plan: 'pro' }, { country: 'de' }, OTHER]",
        "ENVIRONMENT production",
        "SELECT feature(key)",
      ].join("\n"),
    );
    expect(headings).toEqual(["key", "country", "plan", "enabled"]);
    expect(rows).toEqual([
      "checkout | nl | pro | On",
      "checkout | de |  | 50%",
      "checkout | (any other) | (any other) | 50%",
    ]);
    expect(result.evaluations).toBe(3);
  });

  it("puts each context across the top of a matrix BY CONTEXT, a row per environment", () => {
    const { result, headings, rows } = run(
      [
        "FROM features",
        "WHERE key in ['checkout', 'legacy']",
        "VARY [{ country: 'nl' }, { country: 'de' }]",
        "ENVIRONMENT staging, production",
        "SELECT feature(key)",
        "AS MATRIX BY CONTEXT",
      ].join("\n"),
    );
    expect(result).toMatchObject({ across: ["nl", "de"], acrossKind: "context" });
    // OTHER is named once across the top, whatever the contexts name
    const other = run(
      "FROM features\nWHERE key == 'checkout'\nVARY [{ country: 'nl', plan: 'pro' }, OTHER]\nSELECT feature(key)\nAS MATRIX BY CONTEXT",
    );
    expect(other.result.across).toEqual(["nl · pro", "(any other)"]);
    expect(headings).toEqual(["key", "environment", "enabled"]);
    expect(rows).toEqual([
      "checkout | staging | On / On",
      "checkout | production | On / 50%",
      "legacy | staging | On / On",
      "legacy | production | Off / Off",
    ]);
  });

  it("shows the names AS gives contexts, in a column of their own and across a matrix", () => {
    const list =
      "VARY [{ country: 'nl', plan: 'pro' } AS 'Dutch pros', { country: 'de' }, OTHER AS 'Elsewhere']";
    const table = run(
      [
        "FROM features",
        "WHERE key == 'checkout'",
        list,
        "ENVIRONMENT production",
        "SELECT feature(key)",
      ].join("\n"),
    );
    expect(table.headings).toEqual(["key", "context", "enabled"]);
    expect(table.rows).toEqual([
      "checkout | Dutch pros | On",
      "checkout | de | 50%",
      "checkout | Elsewhere | 50%",
    ]);
    // An attribute varied beside the list keeps its own column
    expect(
      run(
        [
          "FROM features",
          "WHERE key == 'checkout'",
          list,
          "VARY device ['mobile']",
          "ENVIRONMENT production",
          "SELECT feature(key)",
        ].join("\n"),
      ).headings,
    ).toEqual(["key", "context", "device", "enabled"]);
    const matrix = run(
      [
        "FROM features",
        "WHERE key == 'checkout'",
        list,
        "ENVIRONMENT production",
        "SELECT feature(key)",
        "AS MATRIX BY CONTEXT",
      ].join("\n"),
    );
    expect(matrix.result.across).toEqual(["Dutch pros", "de", "Elsewhere"]);
    expect(matrix.rows).toEqual(["checkout | On / 50% / 50%"]);
  });

  it("names places in the rollout as at, and a single context by its attributes", () => {
    expect(
      run(
        "FROM features\nWHERE key == 'checkout'\nENVIRONMENT production\nAT 10, 90\nSELECT feature(key)\nAS MATRIX BY CONTEXT",
      ).result.across,
    ).toEqual(["at 10", "at 90"]);
    expect(run("CONTEXT { country: 'nl' }\nSELECT feature('checkout')").rows).toEqual(["nl | On"]);
    expect(run("SELECT feature('checkout')").rows).toEqual(["everyone | 50%"]);
  });

  it("makes a row per person, filtered by what they get", () => {
    const query =
      "VARY country ['nl', 'de']\nENVIRONMENT production\nSELECT country, feature('checkout'), variable('supportEmail')";
    expect(run(query).rows).toEqual(["nl | On | hulp@example.com", "de | 50% | help@example.com"]);
    expect(run(`${query}\nWHERE feature('checkout')`).rows).toEqual(["nl | On | hulp@example.com"]);
  });
});
