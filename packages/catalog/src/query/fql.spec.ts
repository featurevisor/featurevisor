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
    expect(parseFql("SELECT enabled", project).errors[0]).toMatchObject({ line: 1, column: 1 });
    expect(parseFql("FROM flags", project).errors[0]).toMatchObject({
      message: "FROM reads features or variables.",
      line: 1,
      column: 6,
    });
    expect(parseFql("FROM features\nENVIRONMENT qa", project).errors[0]).toMatchObject({
      line: 2,
    });
    expect(parseFql("FROM features\nWHERE key ==", project).errors[0]).toMatchObject({ line: 2 });
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
