import { runVariableChecks } from "./checks";

describe("core: structured check presence evidence", () => {
  it("distinguishes missing paths, null and a literal missing display string", () => {
    const value = { present: null, literal: "<missing>" };
    expect(
      runVariableChecks(
        [{ variable: "settings", path: "present", operator: "isNull" }],
        () => value,
      ),
    ).toEqual([]);
    const missing = runVariableChecks(
      [{ variable: "settings", path: "absent", operator: "isNull" }],
      () => value,
    );
    const literal = runVariableChecks(
      [{ variable: "settings", path: "literal", operator: "isNull" }],
      () => value,
    );
    expect(missing[0].details!.evaluated[0]).toMatchObject({
      actual: "<missing>",
      actualMissing: true,
    });
    expect(literal[0].details!.evaluated[0]).toMatchObject({
      actual: "<missing>",
      actualMissing: false,
    });
    const rightMissing = runVariableChecks(
      [
        {
          variable: "settings",
          path: "present",
          operator: "equals",
          compareTo: { variable: "settings", path: "absent" },
        },
      ],
      () => value,
    );
    expect(rightMissing[0].details!.evaluated[0]).toMatchObject({
      actual: null,
      actualMissing: false,
      expectedMissing: true,
    });
  });
});
