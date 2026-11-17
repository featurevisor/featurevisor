import { examplesFor, type ExampleSource } from "./examples";
import { lexFql, parseFql } from "./fql";
import { ROW_KEY, whoGetsThisQuery } from "./report";

const project = {
  environments: ["staging", "production"],
  features: { foo: ["bar", "settings"], allowSignup: [] },
  variables: ["checkoutSettings"],
  attributes: ["country", "device", "userId"],
};

const messages = (query: string) => parseFql(query, project).errors.map((error) => error.message);

describe("parseFql", () => {
  it("reads every clause", () => {
    const { report, errors } = parseFql(
      [
        "# Where is foo on?",
        "FROM features",
        "WHERE key == 'foo' and not archived == true",
        "CONTEXT { userId: 'user-1', country: 'nl' }",
        "VARY device ['mobile', 'desktop', OTHER], country",
        "ENVIRONMENT *",
        "SELECT key, feature(key), feature(key).variation AS 'Variation'",
        "ORDER BY owner DESC, key",
        "LIMIT 10",
        "AS MATRIX",
      ].join("\n"),
      project,
    );
    expect(errors).toEqual([]);
    expect(report).toMatchObject({
      subjects: ["feature"],
      person: { userId: "user-1", country: "nl" },
      vary: [
        { attribute: "device", values: ["mobile", "desktop", "(any other)"] },
        { attribute: "country", values: [] },
      ],
      environments: ["staging", "production"],
      columns: [
        { expr: { kind: "property", name: "key" } },
        { expr: { kind: "read", read: { kind: "flag", feature: ROW_KEY } } },
        {
          expr: { kind: "read", read: { kind: "variation", feature: ROW_KEY } },
          alias: "Variation",
        },
      ],
      sort: [
        { column: { expr: { kind: "property", name: "owner" } }, descending: true },
        { column: { expr: { kind: "property", name: "key" } }, descending: false },
      ],
      limit: 10,
      as: "matrix",
    });
    expect(report?.where).toBeDefined();
  });

  it("places everyone in every rollout with AT, a row each for several places", () => {
    expect(
      parseFql("FROM features\nCONTEXT { country: 'de' }\nAT 20", project).report,
    ).toMatchObject({
      person: { country: "de", at: 20 },
      vary: [],
    });
    expect(
      parseFql("AT 10, 90\nVARY country ['nl']\nSELECT feature('foo')", project).report?.vary,
    ).toEqual([
      { attribute: "country", values: ["nl"] },
      { attribute: "at", values: [10, 90] },
    ]);
    expect(messages("FROM features\nAT 120")).toEqual([
      "AT takes a place in the rollout from 0 to 100, such as AT 50.",
    ]);
    expect(messages("FROM features\nCONTEXT { country: 'de', at: 20 }")).toEqual([
      "A place in the rollout is a clause of its own, as test specs write it: AT 20.",
    ]);
    expect(messages("VARY at [10, 90]\nSELECT feature('foo')")).toEqual([
      "Places in the rollout are a clause of their own, a row each: AT 10, 50, 90.",
    ]);
  });

  it("varies people written out, each a combination, and puts them across a matrix", () => {
    const { report, errors } = parseFql(
      [
        "FROM features",
        "VARY [{ country: 'nl', city: 'amsterdam' }, { country: 'gb', city: 'london' }, OTHER]",
        "SELECT feature(key)",
        "AS MATRIX BY PERSON",
      ].join("\n"),
      project,
    );
    expect(errors).toEqual([]);
    expect(report).toMatchObject({
      vary: [
        {
          attribute: "",
          people: [
            { country: "nl", city: "amsterdam" },
            { country: "gb", city: "london" },
            "(any other)",
          ],
        },
      ],
      as: "matrix",
      across: "person",
    });
    expect(messages("FROM features\nVARY []")[0]).toMatch(/list of people is empty/);
    expect(messages("FROM features\nVARY ['nl']")[0]).toMatch(/holds people/);
    expect(messages("FROM features\nVARY [{ country: 'nl', at: 10 }]")[0]).toMatch(/AT 10, 50, 90/);
    expect(messages("FROM features\nSELECT feature(key)\nAS MATRIX BY country")).toEqual([
      "AS MATRIX BY PERSON puts each person across the top. Without BY, environments go across.",
    ]);
    expect(
      messages("VARY [{ country: 'nl' }]\nSELECT feature('foo')\nAS MATRIX BY PERSON"),
    ).toEqual([
      "AS MATRIX BY PERSON puts each person across the top, so it needs FROM for its rows, such as FROM features.",
    ]);
  });

  it("takes a person with CONTEXT, and says so for FOR", () => {
    expect(parseFql("FROM features\nCONTEXT { country: 'nl' }", project).report?.person).toEqual({
      country: "nl",
    });
    expect(messages("FROM features\nFOR { country: 'nl' }")).toEqual([
      "A person's attributes are written with CONTEXT, as the SDK and test specs name them, such as CONTEXT { country: 'nl' }.",
    ]);
    expect(messages("FROM features\nCONTEXT 'nl'")).toEqual([
      "CONTEXT takes a person's attributes, such as { country: 'nl' }.",
    ]);
  });

  it("orders with ORDER BY, and says so for SORT BY", () => {
    expect(parseFql("FROM features\nORDER BY key DESC", project).report?.sort).toEqual([
      { column: { expr: { kind: "property", name: "key" } }, descending: true },
    ]);
    expect(messages("FROM features\nSORT BY key")).toEqual([
      "Rows are ordered with ORDER BY, such as ORDER BY key.",
    ]);
  });

  it("writes a list's filter in WHERE as the condition it means", () => {
    expect(messages("FROM features\nWHERE tag:web")).toEqual([
      "tag:web is a list's filter. Here it is a condition: tags includes 'web'.",
    ]);
    expect(messages("FROM features\nWHERE uses:netherlands")).toEqual([
      "uses:netherlands is a list's filter, and FQL has no property for it.",
    ]);
    expect(messages("FROM features\nWHERE description == 'a:b'")).toEqual([]);
  });

  it("lists definitions without anyone to evaluate for", () => {
    const { report, errors } = parseFql("FROM variables", project);
    expect(errors).toEqual([]);
    expect(report).toMatchObject({ subjects: ["variable"], environments: ["production"] });
    expect(report?.person).toBeUndefined();
    expect(report?.columns.map((column) => column.expr)).toEqual(
      ["key", "description", "owner", "tags"].map((name) => ({ kind: "property", name })),
    );
  });

  it("evaluates for everyone once anything is read", () => {
    expect(parseFql("FROM features\nSELECT feature(key)", project).report?.person).toEqual({});
    expect(parseFql("FROM features\nWHERE feature(key)", project).report?.person).toEqual({});
  });

  it("reads in an environment of its own, and the details beside an answer", () => {
    const { report } = parseFql(
      "FROM features\nSELECT rollout(feature(key, 'staging')), rule(feature(key).variation)",
      project,
    );
    expect(report?.columns.map((column) => column.expr)).toEqual([
      {
        kind: "detail",
        detail: "rollout",
        read: { kind: "flag", feature: ROW_KEY, environment: "staging" },
      },
      { kind: "detail", detail: "rule", read: { kind: "variation", feature: ROW_KEY } },
    ]);
  });

  it("swaps WHERE's reads for names the row's answers fill", () => {
    const where = parseFql(
      "FROM features\nWHERE owner == 'growth' and rollout(feature(key)) < 100 and feature(key)",
      project,
    ).report!.where!;
    const [rollout, flag] = Object.keys(where.reads);
    expect(where.conditions).toEqual([
      { attribute: "owner", operator: "equals", value: "growth" },
      { attribute: rollout, operator: "lessThan", value: 100 },
      { attribute: flag, operator: "equals", value: true },
    ]);
    expect(where.names).toEqual(["owner"]);
  });

  it("groups and counts", () => {
    const { report, errors } = parseFql("FROM features\nGROUP BY owner", project);
    expect(errors).toEqual([]);
    expect(report?.columns.map((column) => column.expr)).toEqual([
      { kind: "property", name: "owner" },
      { kind: "count" },
    ]);
  });

  it("parses the Overview tab's link for features and variables", () => {
    for (const type of ["feature", "variable"] as const) {
      const { report, errors } = parseFql(whoGetsThisQuery(type, "it's", project.environments), {
        environments: project.environments,
      });
      expect(errors).toEqual([]);
      expect(report).toMatchObject({ vary: [{ attribute: "*", values: [] }], as: "matrix" });
    }
  });

  it("points at what is wrong", () => {
    expect(parseFql("enabled", project).errors[0]).toMatchObject({ line: 1, column: 1 });
    expect(parseFql("FROM flags", project).errors[0]).toMatchObject({ line: 1, column: 6 });
    expect(parseFql("FROM features\nENVIRONMENT qa", project).errors[0]).toMatchObject({
      line: 2,
    });
    expect(parseFql("FROM features\nWHERE key ==", project).errors[0]).toMatchObject({ line: 2 });
  });

  it("says how to read what someone gets, rather than naming it as a property", () => {
    expect(messages("FROM features\nSELECT key, enabled")).toEqual([
      "enabled is what someone gets, not a property. Read it with feature(key).",
    ]);
    expect(messages("FROM features\nSELECT variables.bar")).toEqual([
      "variables.bar is what someone gets, not a property. Read it with feature(key).bar.",
    ]);
    expect(messages("FROM variables\nSELECT bucketBy")).toEqual([
      "bucketBy is a property of features only.",
    ]);
    expect(messages("FROM variables\nSELECT feature(key)")).toEqual([
      "feature(key) reads each row's own feature, so it needs FROM features.",
    ]);
  });

  it("keeps groups, sorting and layouts to what makes sense", () => {
    expect(messages("FROM features\nSELECT key, count()\nGROUP BY owner")).toEqual([
      "key is not in GROUP BY. SELECT what GROUP BY names, and count().",
    ]);
    expect(messages("FROM features\nSELECT key\nORDER BY count()")).toEqual([
      "count() counts groups, so it orders a report with GROUP BY.",
    ]);
    expect(messages("FROM features\nSELECT key\nAS MATRIX")[0]).toMatch(/needs a read/);
    expect(messages("FROM features\nLIMIT 0")[0]).toMatch(/LIMIT takes/);
    expect(messages("FROM features\nSELECT rollout(variable('checkoutSettings'))")[0]).toMatch(
      /rollout\(\) reads/,
    );
  });
});

describe("parseFql without FROM", () => {
  it("makes a row per person, with columns read from anywhere", () => {
    const { report, errors } = parseFql(
      [
        "VARY country",
        "SELECT",
        "  country AS 'Country',",
        "  feature('foo') AS 'Foo on',",
        "  feature('foo').variation,",
        "  feature('foo').bar,",
        "  feature('foo').settings['limits.v2'][0],",
        "  variable('checkoutSettings').currency",
        "AS MATRIX",
      ].join("\n"),
      project,
    );
    expect(errors).toEqual([]);
    expect(report).toMatchObject({
      subjects: [],
      person: {},
      as: "matrix",
      columns: [
        { expr: { kind: "property", name: "country" }, alias: "Country" },
        { expr: { kind: "read", read: { kind: "flag", feature: "foo" } }, alias: "Foo on" },
        { expr: { kind: "read", read: { kind: "variation", feature: "foo" } } },
        {
          expr: {
            kind: "read",
            read: { kind: "variable", feature: "foo", variable: "bar", path: [] },
          },
        },
        {
          expr: {
            kind: "read",
            read: {
              kind: "variable",
              feature: "foo",
              variable: "settings",
              path: ["limits.v2", 0],
            },
          },
        },
        {
          expr: {
            kind: "read",
            read: { kind: "global", variable: "checkoutSettings", path: ["currency"] },
          },
        },
      ],
    });
  });

  it("checks the names it reads", () => {
    expect(messages("SELECT feature('fooo')")).toEqual(["No feature called fooo."]);
    expect(messages("SELECT feature('foo').baz")).toEqual([
      "foo has no variable called baz. It has bar, settings.",
    ]);
    expect(messages("SELECT variable('foo')")).toEqual([
      "No global variable called foo. foo is a feature, read with feature('foo').",
    ]);
    expect(messages("SELECT feature('foo').variation.x")).toEqual([
      "A variation is text, so nothing can follow `.variation`.",
    ]);
    expect(messages("SELECT feature('foo', 'qa')")[0]).toMatch(/^No environment called qa/);
    expect(messages("SELECT enabled, feature('foo')")[0]).toMatch(/^No attribute called enabled\./);
    expect(messages("SELECT feature(key)")[0]).toMatch(/a row per person has none/);
    expect(messages("VARY country")[0]).toMatch(/^SELECT what to read/);
  });
});

describe("examplesFor", () => {
  const source: ExampleSource = {
    features: [
      { key: "checkout", variations: [], variables: [], segments: ["netherlands"], requires: [] },
      {
        key: "buyButton",
        variations: ["control", "treatment"],
        variables: ["label"],
        segments: ["germany"],
        requires: ["pricing"],
      },
    ],
    variables: ["supportEmail"],
    attributes: ["userId", "country", "plan"],
    owners: ["platform-team", "growth-team"],
    bucketBy: ["userId"],
  };
  const titles = (groups: ReturnType<typeof examplesFor>) =>
    groups.flatMap((group) => group.examples.map((example) => example.title));

  it.each(
    examplesFor(source)
      .flatMap((group) => group.examples)
      .map((example) => [example.title, example.query]),
  )("%s parses against the project it names", (_, query) => {
    const known = {
      environments: ["staging", "production"],
      features: { checkout: [], buyButton: ["label"] },
      variables: ["supportEmail"],
      attributes: ["userId", "country", "plan"],
    };
    expect(parseFql(query, known).errors).toEqual([]);
  });

  it("names the project's own team, attribute, experiment and feature", () => {
    const queries = examplesFor(source)
      .flatMap((group) => group.examples)
      .map((example) => example.query)
      .join("\n");
    expect(queries).toContain("WHERE owners includes 'platform-team'");
    expect(queries).toContain("VARY country");
    expect(queries).toContain("WHERE feature('buyButton').variation == 'treatment'");
    expect(queries).toContain("WHERE key == 'checkout'");
    expect(titles(examplesFor(source))).toContain("Who gets treatment");
  });

  it("leaves out examples a project has nothing for", () => {
    const empty = examplesFor({
      ...source,
      features: [],
      variables: [],
      owners: [],
      attributes: [],
    });
    expect(titles(empty)).not.toContain("Everything a team owns");
    expect(titles(empty)).not.toContain("Where a feature is on");
    expect(titles(empty)).not.toContain("Columns from anywhere");
    expect(titles(empty)).toContain("Features and their owners");
  });
});

describe("lexFql", () => {
  it("keeps every character, so highlighting can colour the source as it is", () => {
    const source = "FROM features\n# a comment\nWHERE tags includes 'web'\nAT 50";
    expect(
      lexFql(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
  });
});
