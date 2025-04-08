import {
  Feature,
  Segment,
  DatafileContentV1,
  DatafileContentV2,
  Attribute,
  AttributeKey,
  SegmentKey,
  FeatureKey,
  FeatureSegments,
  Traffic,
} from "@featurevisor/types";

export function parseJsonConditionsIfStringified<T>(record: T, key: string): T {
  if (typeof record[key] === "string" && record[key] !== "*") {
    try {
      record[key] = JSON.parse(record[key]);
    } catch (e) {
      console.error("Error parsing JSON", e);
    }
  }

  return record;
}

export class DatafileReader {
  private schemaVersion: string;
  private revision: string;

  private attributes: Record<AttributeKey, Attribute>;
  private segments: Record<SegmentKey, Segment>;
  private features: Record<FeatureKey, Feature>;

  // fully parsed conditions
  private segmentsCache: Record<SegmentKey, Segment>;

  // key: featureKey.ruleKey
  private featureSegmentsCache: Record<string, FeatureSegments>;

  constructor(datafileJson: DatafileContentV1 | DatafileContentV2) {
    this.schemaVersion = datafileJson.schemaVersion;
    this.revision = datafileJson.revision;

    this.segmentsCache = {};
    this.featureSegmentsCache = {}; // Traffic.segments

    if (this.schemaVersion === "2") {
      // v2
      const datafileJsonV2 = datafileJson as DatafileContentV2;

      this.attributes = datafileJsonV2.attributes;
      this.segments = datafileJsonV2.segments;
      this.features = datafileJsonV2.features;
    } else {
      // v1
      const datafileJsonV1 = datafileJson as DatafileContentV1;

      this.attributes = {};
      datafileJsonV1.attributes.forEach((a) => {
        this.attributes[a.key] = a;
      });

      this.segments = {};
      datafileJsonV1.segments.forEach((s) => {
        this.segments[s.key] = s;
      });

      this.features = {};
      datafileJsonV1.features.forEach((f) => {
        if (Array.isArray(f.variablesSchema)) {
          f.variablesSchema = f.variablesSchema.reduce((acc, variable) => {
            acc[variable.key] = variable;
            return acc;
          }, {});
        }

        this.features[f.key] = f;
      });
    }
  }

  getRevision(): string {
    return this.revision;
  }

  getSchemaVersion(): string {
    return this.schemaVersion;
  }

  getAllAttributes(): Attribute[] {
    const result: Attribute[] = [];

    Object.keys(this.attributes).forEach((key) => {
      result.push(this.attributes[key]);
    });

    return result;
  }

  getAttribute(attributeKey: AttributeKey): Attribute | undefined {
    return this.attributes[attributeKey];
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    const segment = this.segments[segmentKey];

    if (!segment) {
      return undefined;
    }

    if (this.segmentsCache[segmentKey]) {
      return this.segmentsCache[segmentKey];
    }

    this.segmentsCache[segmentKey] = parseJsonConditionsIfStringified(segment, "conditions");

    return this.segmentsCache[segmentKey];
  }

  getFeature(featureKey: FeatureKey): Feature | undefined {
    const feature = this.features[featureKey];

    if (!feature) {
      return undefined;
    }

    // rules
    feature.traffic = feature.traffic.map((t) => {
      const featureSegmentsKey = `${featureKey}.rule.${t.key}`;

      if (this.featureSegmentsCache[featureSegmentsKey]) {
        t.segments = this.featureSegmentsCache[featureSegmentsKey];
      } else {
        if (
          typeof t.segments === "string" &&
          (t.segments.startsWith("{") || t.segments.startsWith("["))
        ) {
          const parsed = JSON.parse(t.segments);
          this.featureSegmentsCache[featureSegmentsKey] = parsed;
          t.segments = parsed;
        }
      }

      return t;
    });

    // force
    if (feature.force) {
      feature.force = feature.force.map((f, fIndex) => {
        const featureSegmentsKey = `${featureKey}.force.${fIndex}`;

        if (this.featureSegmentsCache[featureSegmentsKey]) {
          f.segments = this.featureSegmentsCache[featureSegmentsKey];
        } else {
          if (
            typeof f.segments === "string" &&
            (f.segments.startsWith("{") || f.segments.startsWith("["))
          ) {
            const parsed = JSON.parse(f.segments);
            this.featureSegmentsCache[featureSegmentsKey] = parsed;
            f.segments = parsed;
          }
        }

        // @TODO: handle conditions

        return f;
      });
    }

    // variable overrides
    if (feature.variations) {
      feature.variations = feature.variations.map((variation) => {
        if (variation.variables) {
          variation.variables = variation.variables.map((variable) => {
            if (variable.overrides) {
              variable.overrides = variable.overrides.map((override, oIndex) => {
                // @TODO: handle conditions

                if (override.segments) {
                  const featureSegmentsKey = `${featureKey}.variable.${variable.key}.${oIndex}`;

                  if (this.featureSegmentsCache[featureSegmentsKey]) {
                    override.segments = this.featureSegmentsCache[featureSegmentsKey];
                  } else {
                    if (
                      typeof override.segments === "string" &&
                      (override.segments.startsWith("{") || override.segments.startsWith("["))
                    ) {
                      const parsed = JSON.parse(override.segments);
                      this.featureSegmentsCache[featureSegmentsKey] = parsed;
                      override.segments = parsed;
                    }
                  }
                }

                return override;
              });
            }

            return variable;
          });
        }

        return variation;
      });
    }

    return feature;
  }
}
