import {
  Feature,
  Segment,
  DatafileContentV1,
  DatafileContentV2,
  Attribute,
  AttributeKey,
  SegmentKey,
  FeatureKey,
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

  // fully parsed
  private segmentsCache: Record<SegmentKey, Segment>;
  private featureTrafficCache: Record<FeatureKey, Traffic[]>;

  constructor(datafileJson: DatafileContentV1 | DatafileContentV2) {
    this.schemaVersion = datafileJson.schemaVersion;
    this.revision = datafileJson.revision;

    this.segmentsCache = {};
    this.featureTrafficCache = {};

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

    if (this.featureTrafficCache[featureKey]) {
      feature.traffic = this.featureTrafficCache[featureKey];

      return feature;
    }

    if (Array.isArray(feature.traffic)) {
      feature.traffic = feature.traffic.map((t) => {
        if (
          typeof t.segments === "string" &&
          (t.segments.startsWith("{") || t.segments.startsWith("["))
        ) {
          return JSON.parse(t.segments);
        }

        return t.segments;
      });

      this.featureTrafficCache[featureKey] = feature.traffic;
    }

    return feature;
  }
}
