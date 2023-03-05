import {
  Feature,
  Segment,
  DatafileContent,
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
  private attributes: Attribute[];
  private segments: Segment[];
  private features: Feature[];

  constructor(datafileJson: DatafileContent) {
    this.schemaVersion = datafileJson.schemaVersion;
    this.revision = datafileJson.revision;
    this.segments = datafileJson.segments;
    this.attributes = datafileJson.attributes;
    this.features = datafileJson.features;
  }

  getRevision(): string {
    return this.revision;
  }

  getSchemaVersion(): string {
    return this.schemaVersion;
  }

  getAllAttributes(): Attribute[] {
    return this.attributes;
  }

  getAttribute(attributeKey: AttributeKey): Attribute | undefined {
    return this.attributes.find((a) => a.key === attributeKey);
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    const segment = this.segments.find((s) => s.key === segmentKey);

    if (!segment) {
      return undefined;
    }

    return parseJsonConditionsIfStringified(segment, "conditions");
  }

  getFeature(featureKey: FeatureKey): Feature | undefined {
    const feature = this.features.find((s) => s.key === featureKey);

    if (!feature) {
      return undefined;
    }

    return feature;
  }
}
