import { parseFql } from "../query/fql";

import { CHEAT_SHEET_EXAMPLES } from "./QueryCheatSheet";

describe("the FQL cheat sheet", () => {
  it("offers examples that parse in any project", () => {
    for (const example of CHEAT_SHEET_EXAMPLES) {
      expect({
        title: example.title,
        errors: parseFql(example.query, { environments: ["staging", "production"] }).errors,
      }).toEqual({ title: example.title, errors: [] });
    }
  });
});
