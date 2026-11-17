import { completeFql, type CompletionSource } from "./complete";
import { PROPERTIES } from "./report";

const project: CompletionSource = {
  environments: ["staging", "production"],
  features: [
    { key: "foo", description: "Foo", variables: ["bar", "baz"] },
    { key: "allowSignup", variables: [] },
  ],
  variables: [{ key: "checkoutSettings" }, { key: "headerMessage" }],
  segments: ["nl", "eu"],
  attributes: [{ key: "country" }, { key: "device" }, { key: "userId" }],
  tags: ["web", "checkout"],
  owners: ["growth-team"],
  scenarios: [
    {
      key: "scenarios/writer",
      description: "A writer",
      context: { userId: "writer", permissions: ["read", "admin"], "plan.tier": "it's paid" },
      at: 50,
    },
  ],
};

/** The completion at `|` */
function complete(query: string) {
  const caret = query.indexOf("|");
  const source = query.replace("|", "");
  return completeFql(source, caret, project);
}

const labels = (query: string) => complete(query)?.items.map((item) => item.label) || [];

/** The query after choosing the item labelled `label` */
function choose(query: string, label: string) {
  const caret = query.indexOf("|");
  const source = query.replace("|", "");
  const completion = completeFql(source, caret, project)!;
  const item = completion.items.find((candidate) => candidate.label === label)!;
  return source.slice(0, completion.from) + item.insert + source.slice(completion.to);
}

const featureProperties = Object.entries(PROPERTIES)
  .filter(([, property]) => property.subjects.includes("feature"))
  .map(([name]) => name);

describe("completeFql", () => {
  it("offers clauses to start with, then those yet to be written", () => {
    expect(labels("|")).toEqual([
      "FROM",
      "WHERE",
      "CONTEXT",
      "AT",
      "VARY",
      "ENVIRONMENT",
      "SELECT",
      "GROUP BY",
      "ORDER BY",
      "LIMIT",
      "AS TABLE",
      "AS MATRIX BY ENVIRONMENT",
      "AS MATRIX BY CONTEXT",
    ]);
    expect(choose("or|", "ORDER BY")).toBe("ORDER BY ");
    expect(labels("FROM features\nSELECT key\n|")).not.toContain("SELECT");
    expect(labels("FROM |")).toEqual(["features", "variables", "segments", "attributes"]);
    expect(labels("FROM features, |")).toEqual(["variables", "segments", "attributes"]);
  });

  it("offers the rows' properties and reads of the row's own feature", () => {
    const items = labels("FROM features\nSELECT |");
    expect(items.slice(0, featureProperties.length)).toEqual(featureProperties);
    expect(items).toEqual(
      expect.arrayContaining([
        "metadata.…",
        "feature(key)",
        "feature(key).variation",
        "rollout(…)",
        "count()",
      ]),
    );
    expect(items).not.toContain("variable(key)");
    expect(labels("FROM variables\nSELECT bu|")).not.toContain("bucketBy");
    expect(labels("FROM features\nSELECT buc|")).toEqual(["bucketBy"]);
  });

  it("completes a read's key, its environment, and what follows its dot", () => {
    expect(labels("FROM features\nSELECT feature(|")).toEqual(["key", "'…'"]);
    expect(choose("FROM features\nSELECT feature(|", "key")).toBe(
      "FROM features\nSELECT feature(key)",
    );
    expect(labels("SELECT feature(|")).toEqual(["'…'"]);
    expect(labels("SELECT feature('|")).toEqual(["foo", "allowSignup"]);
    expect(choose("SELECT feature('f|oo'), country", "foo")).toBe("SELECT feature('foo'), country");
    expect(labels("FROM features\nSELECT feature(key, |")).toEqual(["'staging'", "'production'"]);
    expect(labels("SELECT feature('foo', 'p|")).toEqual(["production"]);
    expect(labels("SELECT feature('foo').|")).toEqual(["variation", "bar", "baz"]);
    expect(labels("FROM features\nSELECT feature(key).|")).toEqual(["variation", "bar", "baz"]);
    expect(labels("SELECT variable('checkoutSettings').|")).toEqual([]);
  });

  it("offers what a detail reads inside its brackets", () => {
    expect(labels("FROM features\nSELECT rollout(|")).toEqual(["feature(key)", "feature('…')"]);
    expect(labels("FROM variables\nSELECT override(|")).toEqual(
      expect.arrayContaining(["variable(key)", "variable('…')"]),
    );
  });

  it("offers a heading after a column, and a direction after a sort", () => {
    const heading = complete("SELECT feature('foo') |")!.items[0];
    expect(heading).toMatchObject({ label: "AS '…'", insert: "AS ''", cursor: 4 });
    expect(labels("SELECT feature('foo') AS |")).toEqual([
      "TABLE",
      "MATRIX BY ENVIRONMENT",
      "MATRIX BY CONTEXT",
    ]);
    expect(labels("FROM features\nSELECT feature(key)\nAS MATRIX |")).toEqual([
      "BY ENVIRONMENT",
      "BY CONTEXT",
    ]);
    expect(labels("FROM features\nSELECT feature(key)\nAS MATRIX BY C|")).toEqual(["CONTEXT"]);
    expect(labels("FROM features\nORDER BY owner |").slice(0, 2)).toEqual(["DESC", "ASC"]);
    expect(labels("FROM features\nGROUP BY owner\nORDER BY c|")).toContain("count()");
  });

  it("offers attributes, environments, contexts and limits where clauses take them", () => {
    expect(labels("VARY |")).toEqual(["*", "[{ … }]", "country", "device", "userId"]);
    // A person in VARY's list takes attribute keys, as CONTEXT's does
    expect(choose("VARY [{ country: 'nl', dev|", "device")).toBe("VARY [{ country: 'nl', device: ");
    // A context in the list takes a name for its column
    expect(complete("VARY [{ country: 'nl' } |")!.items[0]).toMatchObject({
      label: "AS '…'",
      insert: "AS ''",
      cursor: 4,
    });
    expect(labels("VARY [{ country: 'nl' }, OTHER |")).toEqual(["AS '…'"]);
    expect(labels("VARY [{ country: 'nl' }, OTHER] , [{ plan: 'pro' } |")).toEqual(["AS '…'"]);
    // An attribute's values, and lists inside a context, take no names
    expect(labels("VARY country ['nl', OTHER |")).toEqual([]);
    expect(labels("VARY [{ tags: ['web'] |")).toEqual([]);
    expect(labels("VARY country, d|")).toEqual(["device"]);
    expect(labels("ENVIRONMENT staging, |")).toEqual(["*", "staging", "production"]);
    expect(labels("CONTEXT |")).toEqual(["{}", "{ … }", "scenarios/writer"]);
    expect(choose("CONTEXT { country: 'nl', dev|", "device")).toBe(
      "CONTEXT { country: 'nl', device: ",
    );
    expect(labels("FROM features\nLIMIT |")).toEqual(["10", "20", "50", "100"]);
  });

  it("completes WHERE by each property's type, and values from the project", () => {
    expect(labels("FROM features\nWHERE tags |")).toEqual([
      "includes",
      "notIncludes",
      "includesAny",
      "empty",
      "notEmpty",
    ]);
    expect(labels("FROM features\nWHERE usedBy |")).toEqual(["==", "!=", ">", ">=", "<", "<="]);
    expect(labels("FROM features\nWHERE deadline |")).toEqual([
      "before",
      "after",
      "exists",
      "notExists",
    ]);
    expect(labels("FROM features\nWHERE rollout(feature(key)) |").slice(0, 2)).toEqual([
      "==",
      "!=",
    ]);
    expect(labels("FROM features\nWHERE feature(key) |").slice(0, 2)).toEqual([
      "== true",
      "== false",
    ]);
    expect(labels("FROM features\nWHERE key == '|")).toEqual(["foo", "allowSignup"]);
    expect(labels("FROM segments\nWHERE key in ['nl', '|")).toEqual(["nl", "eu"]);
    expect(labels("FROM features\nWHERE deadlineStatus == '|")).toEqual([
      "overdue",
      "today",
      "upcoming",
      "later",
      "done",
    ]);
    expect(choose("FROM features\nWHERE tags includes 'w|", "web")).toBe(
      "FROM features\nWHERE tags includes 'web'",
    );
    expect(labels("FROM features\nWHERE archived == true |")).toEqual(
      expect.arrayContaining(["and", "or", "SELECT", "ORDER BY"]),
    );
  });

  it("offers test scenarios as contexts, with their place in the rollout", () => {
    expect(labels("FROM features\nCONTEXT |")).toEqual(["{}", "{ … }", "scenarios/writer"]);
    expect(choose("FROM features\nCONTEXT |", "scenarios/writer")).toBe(
      "FROM features\nCONTEXT { userId: 'writer', permissions: ['read', 'admin'], 'plan.tier': 'it\\'s paid' }\nAT 50",
    );
    expect(choose("FROM features\nAT 20\nCONTEXT |", "scenarios/writer")).toBe(
      "FROM features\nAT 20\nCONTEXT { userId: 'writer', permissions: ['read', 'admin'], 'plan.tier': 'it\\'s paid' }",
    );
    expect(labels("FROM features\nAT |")).toEqual(["0", "25", "50", "75", "100"]);
  });

  it("offers nothing where it has no names to give", () => {
    expect(labels("CONTEXT { country: '|")).toEqual([]);
  });
});
