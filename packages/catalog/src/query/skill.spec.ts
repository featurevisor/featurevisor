import fs from "node:fs";
import path from "node:path";

import { parseFql } from "./fql";

/** The Featurevisor skill teaches FQL to agents, so every query it shows must parse */
const reference = path.resolve(
  __dirname,
  "../../../../skills/featurevisor/references/catalog-query.md",
);

describe("the skill's FQL", () => {
  const queries = [...fs.readFileSync(reference, "utf8").matchAll(/```fql\n([\s\S]*?)```/g)].map(
    (match) => match[1].trim(),
  );

  it("has examples to check", () => {
    expect(queries.length).toBeGreaterThan(10);
  });

  it.each(queries)("parses %s", (query) => {
    expect(parseFql(query, { environments: ["staging", "production"] }).errors).toEqual([]);
  });
});
