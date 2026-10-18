import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";

const cases: Array<{ name: string; datafile: DatafileContent }> = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v4-cases.json"), "utf8"),
).cases;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const context = { region: "eu", country: "nl", eligible: true };
const childValue = {
  stage: "parent",
  rows: [
    { id: 0, tags: [] },
    { id: 1, tags: ["parent", "child"] },
  ],
  flags: ["a"],
};
const parentValue = { stage: "parent", rows: [{ id: 1, tags: ["parent"] }], flags: ["a"] };

describe("first match mutation representation changes", () => {
  test.each(["parsed", "stringified"])(
    "keeps live children and dependencies correct with %s selectors",
    async (encoding) => {
      const representation = (mode: string) => {
        const fixture = cases.find(
          (entry) => entry.name === `first match ${mode} ${encoding}: child`,
        );
        if (!fixture) throw new Error("Missing first match conformance fixture");
        return clone(fixture.datafile);
      };
      const f = createFeaturevisor({ datafile: representation("precomputed"), logLevel: "fatal" });
      const child = f.spawn(context);
      const disabled = f.spawn(context, { stickyVariables: { permission: false } });
      try {
        for (const [mode, replace] of [
          ["runtime", false],
          ["precomputed", false],
          ["runtime", true],
        ] as const) {
          expect(child.getVariable("subject")).toEqual(childValue);
          expect(disabled.getVariable("subject")).toEqual(parentValue);
          const next = representation(mode);
          f.setDatafile(
            replace
              ? next
              : {
                  schemaVersion: "2",
                  revision: mode,
                  features: {},
                  segments: {},
                  variables: { subject: next.variables!.subject },
                },
            replace,
          );
          expect(child.getVariable("subject")).toEqual(childValue);
          expect(disabled.getVariable("subject")).toEqual(parentValue);
          expect(child.getVariable("subject", { reset: true })).toEqual({
            stage: "reset",
            rows: [],
            flags: [],
          });
          expect(child.getVariable("subject")).toEqual(childValue);
        }
        // A partial dependency update is visible to already spawned children.
        f.setDatafile({
          schemaVersion: "2",
          revision: "permission-denied",
          features: {},
          segments: {},
          variables: { permission: { type: "boolean", defaultValue: false } },
        });
        expect(child.getVariable("subject")).toEqual(parentValue);
        child.setStickyVariables({ permission: true });
        expect(child.getVariable("subject")).toEqual(childValue);
        expect(f.getVariable("subject", context)).toEqual(parentValue);
        expect(disabled.getVariable("subject")).toEqual(parentValue);

        // Mutating a program result must not change defaults, literals or another evaluation.
        const value = child.getVariable<typeof childValue>("subject")!;
        value.rows[1].tags.push("caller");
        value.flags.length = 0;
        expect(child.getVariable("subject")).toEqual(childValue);
        expect(child.getVariable("subject", { region: "us" })).toEqual({
          stage: "default",
          rows: [{ id: 1, tags: [] }],
          flags: [null, "a"],
        });
      } finally {
        child.close();
        disabled.close();
        await f.close();
      }
    },
  );
});
