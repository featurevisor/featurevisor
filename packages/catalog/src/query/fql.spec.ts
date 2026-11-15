import { lexFql, parseFql } from "./fql";
import { whoGetsThisQuery } from "./report";

const project = { environments: ["staging", "production"] };

describe("parseFql", () => {
  it("reads every clause", () => {
    const { report, errors } = parseFql(
      [
        "# Where is foo on?",
        "FROM features",
        "WHERE key == 'foo' and not archived == true",
        "FOR { userId: 'user-1', country: 'nl' }",
        "VARY device ['mobile', 'desktop', OTHER], country",
        "ENVIRONMENT *",
        "SELECT enabled, variation",
        "AS MATRIX",
      ].join("\n"),
      project,
    );
    expect(errors).toEqual([]);
    expect(report).toMatchObject({
      of: "features",
      person: { userId: "user-1", country: "nl" },
      vary: [
        { attribute: "device", values: ["mobile", "desktop", "(any other)"] },
        { attribute: "country", values: [] },
      ],
      environments: ["staging", "production"],
      show: ["enabled", "variation"],
      as: "matrix",
    });
    expect(report?.where).toBeDefined();
  });

  it("defaults to the last environment and definition columns", () => {
    const { report, errors } = parseFql("FROM variables", project);
    expect(errors).toEqual([]);
    expect(report).toMatchObject({ of: "variables", environments: ["production"], as: "table" });
    expect(report?.person).toBeUndefined();
  });

  it("parses the Overview tab's link for features and variables", () => {
    for (const type of ["feature", "variable"] as const) {
      const { report, errors } = parseFql(
        whoGetsThisQuery(type, "it's", project.environments),
        project,
      );
      expect(errors).toEqual([]);
      expect(report).toMatchObject({ vary: [{ attribute: "*", values: [] }], as: "matrix" });
    }
  });

  it("points at what is wrong", () => {
    expect(parseFql("enabled", project).errors[0]).toMatchObject({ line: 1, column: 1 });
    expect(parseFql("FROM flags", project).errors[0]).toMatchObject({
      message: "FROM reads features or variables. Leave it out for a row per person.",
      line: 1,
      column: 6,
    });
    expect(parseFql("FROM features\nENVIRONMENT qa", project).errors[0]).toMatchObject({
      line: 2,
    });
    expect(parseFql("FROM features\nWHERE key ==", project).errors[0]).toMatchObject({ line: 2 });
  });
});

describe("parseFql without FROM", () => {
  const known = {
    ...project,
    features: { foo: ["bar", "settings"], allowSignup: [] },
    variables: ["checkoutSettings"],
    attributes: ["country", "device", "userId"],
  };

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
      known,
    );
    expect(errors).toEqual([]);
    expect(report).toMatchObject({
      of: "people",
      person: {},
      as: "matrix",
      columns: [
        { read: { kind: "attribute", attribute: "country" }, alias: "Country" },
        { read: { kind: "flag", feature: "foo" }, alias: "Foo on" },
        { read: { kind: "variation", feature: "foo" } },
        { read: { kind: "variable", feature: "foo", variable: "bar", path: [] } },
        {
          read: { kind: "variable", feature: "foo", variable: "settings", path: ["limits.v2", 0] },
        },
        { read: { kind: "variable", variable: "checkoutSettings", path: ["currency"] } },
      ],
    });
  });

  it("checks the names it reads", () => {
    const errors = (query: string) => parseFql(query, known).errors.map((error) => error.message);
    expect(errors("SELECT feature('fooo')")).toEqual(["No feature called fooo."]);
    expect(errors("SELECT feature('foo').baz")).toEqual([
      "foo has no variable called baz. It has bar, settings.",
    ]);
    expect(errors("SELECT variable('foo')")).toEqual([
      "No global variable called foo. foo is a feature, read with feature('foo').",
    ]);
    expect(errors("SELECT feature('foo').variation.x")).toEqual([
      "A variation is text, so nothing can follow `.variation`.",
    ]);
    expect(errors("SELECT enabled, feature('foo')")[0]).toMatch(/^No attribute called enabled\./);
    expect(errors("SELECT country")[0]).toMatch(/^SELECT what to read/);
    expect(errors("FROM features\nFOR {}\nSELECT feature('foo')")[0]).toMatch(
      /reads one thing for every row/,
    );
  });
});

describe("lexFql", () => {
  it("keeps every character, so highlighting can colour the source as it is", () => {
    const source = "FROM features\n# a comment\nWHERE tags contains 'web'\nFOR { at: 50 }";
    expect(
      lexFql(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
  });
});
