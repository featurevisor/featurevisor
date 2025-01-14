import {
  Feature,
  Segment,
  DatafileContentV1,
  DatafileContentV2,
  Attribute,
  AttributeKey,
  SegmentKey,
  FeatureKey,
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

  // v1
  private attributes: Attribute[];
  private segments: Segment[];
  private features: Feature[];

  // v2
  private attributesV2: Record<AttributeKey, Attribute>;
  private segmentsV2: Record<SegmentKey, Segment>;
  private featuresV2: Record<FeatureKey, Feature>;

  constructor(datafileJson: DatafileContentV1 | DatafileContentV2) {
    this.schemaVersion = datafileJson.schemaVersion;
    this.revision = datafileJson.revision;

    if (this.schemaVersion === "2") {
      const datafileJsonV2 = datafileJson as DatafileContentV2;

      this.attributesV2 = datafileJsonV2.attributes;
      this.segmentsV2 = datafileJsonV2.segments;
      this.featuresV2 = datafileJsonV2.features;
    } else {
      const datafileJsonV1 = datafileJson as DatafileContentV1;

      this.segments = datafileJsonV1.segments;
      this.attributes = datafileJsonV1.attributes;
      this.features = datafileJsonV1.features;
    }
  }

  getRevision(): string {
    return this.revision;
  }

  getSchemaVersion(): string {
    return this.schemaVersion;
  }

  getAllAttributes(): Attribute[] {
    if (this.schemaVersion !== "2") {
      return this.attributes;
    }

    // v2
    const result: Attribute[] = [];

    for (const key in this.attributesV2) {
      result.push(this.attributesV2[key]);
    }

    return result;
  }

  getAttribute(attributeKey: AttributeKey): Attribute | undefined {
    if (this.schemaVersion === "2") {
      return this.attributesV2[attributeKey];
    }

    return this.attributes.find((a) => a.key === attributeKey);
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    const segment =
      this.schemaVersion === "2"
        ? this.segmentsV2[segmentKey]
        : this.segments.find((s) => s.key === segmentKey);

    if (!segment) {
      return undefined;
    }

    return parseJsonConditionsIfStringified(segment, "conditions");
  }

  getFeature(featureKey: FeatureKey): Feature | undefined {
    const feature =
      this.schemaVersion === "2"
        ? this.featuresV2[featureKey]
        : this.features.find((f) => f.key === featureKey);

    if (!feature) {
      return undefined;
    }

    return feature;
  }
}
