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

  private attributes: Record<AttributeKey, Attribute>;
  private segments: Record<SegmentKey, Segment>;
  private features: Record<FeatureKey, Feature>;

  constructor(datafileJson: DatafileContentV1 | DatafileContentV2) {
    this.schemaVersion = datafileJson.schemaVersion;
    this.revision = datafileJson.revision;

    const datafileJsonV2 = datafileJson as DatafileContentV2;

    this.attributes = datafileJsonV2.attributes;
    this.segments = datafileJsonV2.segments;
    this.features = datafileJsonV2.features;
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

    return parseJsonConditionsIfStringified(segment, "conditions");
  }

  getFeature(featureKey: FeatureKey): Feature | undefined {
    return this.features[featureKey];
  }
}
