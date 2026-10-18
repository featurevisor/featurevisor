import type { DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";

describe("datafile refresh isolation", () => {
  it.each([false, true])(
    "resets parse diagnostics and removed readers with replace=%s",
    (replace) => {
      const source: DatafileContent = {
        schemaVersion: "4",
        revision: "first",
        segments: { gate: { conditions: "{broken" } },
        features: {
          flag: {
            hash: "same",
            bucketBy: "userId",
            conditions: "{broken",
            traffic: [{ key: "all", percentage: 100000, conditions: "*" }],
          },
          viaSegment: {
            hash: "same",
            bucketBy: "userId",
            conditions: "gate",
            traffic: [{ key: "all", percentage: 100000, conditions: "*" }],
          },
        },
        variables: {
          bad: { type: "string", defaultValue: "no", hash: "same", conditions: "{broken" },
        },
      };
      const report = jest.fn();
      const f = createFeaturevisor({ datafile: source, logLevel: "warn", onDiagnostic: report });
      // Build the dependency index independently of normalized entity readers.
      f.setDatafile({
        schemaVersion: "4",
        revision: "warm-index",
        segments: {},
        features: {},
        variables: {
          changed: { type: "string", defaultValue: "value" },
        },
      });
      for (const revision of ["one", "two", "three"]) {
        const next = { ...structuredClone(source), revision };
        expect(f.setDatafile(next, replace)).toBe(true);
        expect(f.isEnabled("flag")).toBe(false);
        expect(f.isEnabled("viaSegment")).toBe(false);
        expect(f.getVariable("bad")).toBeNull();
        f.isEnabled("flag");
        f.getVariable("bad");
      }
      expect(report.mock.calls.filter(([d]) => d.code === "conditions_parse_error")).toHaveLength(
        9,
      );
      expect(
        f.setDatafile(
          { schemaVersion: "4", revision: "removed", segments: {}, features: {}, variables: {} },
          true,
        ),
      ).toBe(true);
      expect(f.getFeatureKeys()).toEqual([]);
      expect(f.getVariableKeys()).toEqual([]);
      expect(f.isEnabled("flag")).toBe(false);
      expect(f.getVariable("bad")).toBeNull();
      f.close();
    },
  );
});
