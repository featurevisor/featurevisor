import type { ParsedFeature } from "@featurevisor/types";
import { getConditionsZodSchema } from "./conditionSchema";
import type { ProjectConfig } from "../config";
const config = {} as ProjectConfig;
const getFeatureConditions = (features: Record<string, ParsedFeature>) =>
  getConditionsZodSchema(config, {}, {}, features);

const features = {
  a: { key: "a", description: "A", bucketBy: "userId", variations: [{ value: "control" }] },
  b: { key: "b", description: "B", bucketBy: "userId" },
  archived: { key: "archived", description: "Archived", bucketBy: "userId", archived: true },
} as Record<string, ParsedFeature>;
const schema = getFeatureConditions(features);

describe("feature leaves in unified conditions", () => {
  test("accepts a standalone disabled variation fallback and rejects unknown values", () => {
    const schema = getFeatureConditions({
      off: { ...features.b, disabledVariationValue: "off" },
    });
    expect(schema.safeParse({ feature: "off", enabled: false, variation: "off" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ feature: "off", enabled: false, variation: "unknown" }).success).toBe(
      false,
    );
  });
  test.each(
    [
      { feature: "a" },
      [{ feature: "a" }, { feature: "b" }],
      { feature: "a", enabled: false, variation: "control" },
      { and: [{ feature: "a" }, { feature: "b" }] },
      { or: [{ feature: "a" }, { not: [{ feature: "b" }] }] },
      [{ not: [{ or: [{ feature: "a" }, { feature: "b" }] }] }],
    ].map((value) => [value]),
  )("accepts and preserves %j", (value) => {
    expect(schema.parse(value)).toEqual(value);
  });

  test.each(
    [
      [],
      { and: [] },
      { or: [] },
      { not: [] },
      { and: [{ feature: "a" }], or: [{ feature: "b" }] },
      { not: [{ feature: "a" }], feature: "b" },
      { or: [{ feature: "a" }, { feature: "missing" }] },
      { or: [{ feature: "a", variation: "missing" }] },
      { or: [{ feature: "a", enabled: "false" }] },
      { not: { feature: "a" } },
      { and: [[{ feature: "a" }]] },
      { xor: [{ feature: "a" }, { feature: "b" }] },
    ].map((value) => [value]),
  )("rejects %j", (value) => expect(schema.safeParse(value).success).toBe(false));
});
