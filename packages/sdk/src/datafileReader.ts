import type {
  Feature,
  Segment,
  DatafileContent,
  SegmentKey,
  FeatureKey,
  Context,
  Traffic,
  Allocation,
  GroupSegment,
  Condition,
  Force,
} from "@featurevisor/types";

import { conditionIsMatched } from "./conditions";
import { Logger } from "./logger";

export type GetRegex = (regexString: string, regexFlags: string) => RegExp;

export interface DatafileReaderOptions {
  datafile: DatafileContent;
  logger: Logger;
}

export interface ForceResult {
  force?: Force;
  forceIndex?: number;
}

export class DatafileReader {
  private schemaVersion: string;
  private revision: string;

  private segments: Record<SegmentKey, Segment>;
  private features: Record<FeatureKey, Feature>;

  private logger: Logger;

  // done to avoid creating new RegExp objects for the same regex string and flags.
  // kept here to avoid memory leaks.
  // if datafile is reset, this cache will be cleared.
  private regexCache: Record<string, RegExp>;

  constructor(options: DatafileReaderOptions) {
    const { datafile, logger } = options;

    this.logger = logger;

    this.schemaVersion = datafile.schemaVersion;
    this.revision = datafile.revision;

    this.segments = datafile.segments;
    this.features = datafile.features;

    this.regexCache = {};
  }

  getRevision(): string {
    return this.revision;
  }

  getSchemaVersion(): string {
    return this.schemaVersion;
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    const segment = this.segments[segmentKey];

    if (!segment) {
      return undefined;
    }

    segment.conditions = this.parseConditionsIfStringified(segment.conditions);

    return segment;
  }

  getFeatureKeys(): string[] {
    return Object.keys(this.features);
  }

  getFeature(featureKey: FeatureKey): Feature | undefined {
    return this.features[featureKey];
  }

  getVariableKeys(featureKey: FeatureKey): string[] {
    const feature = this.getFeature(featureKey);

    if (!feature) {
      return [];
    }

    return Object.keys(feature.variablesSchema || {});
  }

  hasVariations(featureKey: FeatureKey): boolean {
    const feature = this.getFeature(featureKey);

    if (!feature) {
      return false;
    }

    return Array.isArray(feature.variations) && feature.variations.length > 0;
  }

  getRegex(regexString: string, regexFlags?: string): RegExp {
    const flags = regexFlags || "";
    const cacheKey = `${regexString}-${flags}`;

    if (this.regexCache[cacheKey]) {
      return this.regexCache[cacheKey];
    }

    const regex = new RegExp(regexString, flags);
    this.regexCache[cacheKey] = regex;

    return regex;
  }

  allConditionsAreMatched(conditions: Condition[] | Condition, context: Context): boolean {
    if (typeof conditions === "string") {
      if (conditions === "*") {
        return true;
      }

      return false;
    }

    const getRegex = (regexString: string, regexFlags: string) =>
      this.getRegex(regexString, regexFlags);

    if ("attribute" in conditions) {
      try {
        return conditionIsMatched(conditions, context, getRegex);
      } catch (e) {
        this.logger.warn(e.message, {
          error: e,
          details: {
            condition: conditions,
            context,
          },
        });

        return false;
      }
    }

    if ("and" in conditions && Array.isArray(conditions.and)) {
      return conditions.and.every((c) => this.allConditionsAreMatched(c, context));
    }

    if ("or" in conditions && Array.isArray(conditions.or)) {
      return conditions.or.some((c) => this.allConditionsAreMatched(c, context));
    }

    if ("not" in conditions && Array.isArray(conditions.not)) {
      return conditions.not.every(
        () =>
          this.allConditionsAreMatched(
            {
              and: conditions.not,
            },
            context,
          ) === false,
      );
    }

    if (Array.isArray(conditions)) {
      return conditions.every((c) => this.allConditionsAreMatched(c, context));
    }

    return false;
  }

  segmentIsMatched(segment: Segment, context: Context): boolean {
    return this.allConditionsAreMatched(segment.conditions as Condition | Condition[], context);
  }

  allSegmentsAreMatched(
    groupSegments: GroupSegment | GroupSegment[] | "*",
    context: Context,
  ): boolean {
    if (groupSegments === "*") {
      return true;
    }

    if (typeof groupSegments === "string") {
      const segment = this.getSegment(groupSegments);

      if (segment) {
        return this.segmentIsMatched(segment, context);
      }

      return false;
    }

    if (typeof groupSegments === "object") {
      if ("and" in groupSegments && Array.isArray(groupSegments.and)) {
        return groupSegments.and.every((groupSegment) =>
          this.allSegmentsAreMatched(groupSegment, context),
        );
      }

      if ("or" in groupSegments && Array.isArray(groupSegments.or)) {
        return groupSegments.or.some((groupSegment) =>
          this.allSegmentsAreMatched(groupSegment, context),
        );
      }

      if ("not" in groupSegments && Array.isArray(groupSegments.not)) {
        return groupSegments.not.every(
          (groupSegment) => this.allSegmentsAreMatched(groupSegment, context) === false,
        );
      }
    }

    if (Array.isArray(groupSegments)) {
      return groupSegments.every((groupSegment) =>
        this.allSegmentsAreMatched(groupSegment, context),
      );
    }

    return false;
  }

  getMatchedTraffic(traffic: Traffic[], context: Context): Traffic | undefined {
    return traffic.find((t) => {
      if (!this.allSegmentsAreMatched(this.parseSegmentsIfStringified(t.segments), context)) {
        return false;
      }

      return true;
    });
  }

  getMatchedAllocation(traffic: Traffic, bucketValue: number): Allocation | undefined {
    if (!traffic.allocation) {
      return undefined;
    }

    for (const allocation of traffic.allocation) {
      const [start, end] = allocation.range;

      if (allocation.range && start <= bucketValue && end >= bucketValue) {
        return allocation;
      }
    }

    return undefined;
  }

  getMatchedForce(featureKey: FeatureKey | Feature, context: Context): ForceResult {
    const result: ForceResult = {
      force: undefined,
      forceIndex: undefined,
    };

    const feature = typeof featureKey === "string" ? this.getFeature(featureKey) : featureKey;

    if (!feature || !feature.force) {
      return result;
    }

    for (let i = 0; i < feature.force.length; i++) {
      const currentForce = feature.force[i];

      if (
        currentForce.conditions &&
        this.allConditionsAreMatched(
          this.parseConditionsIfStringified(currentForce.conditions),
          context,
        )
      ) {
        result.force = currentForce;
        result.forceIndex = i;
        break;
      }

      if (
        currentForce.segments &&
        this.allSegmentsAreMatched(this.parseSegmentsIfStringified(currentForce.segments), context)
      ) {
        result.force = currentForce;
        result.forceIndex = i;
        break;
      }
    }

    return result;
  }

  parseConditionsIfStringified(conditions: Condition | Condition[]): Condition | Condition[] {
    if (typeof conditions !== "string") {
      // already parsed
      return conditions;
    }

    if (conditions === "*") {
      // everyone
      return conditions;
    }

    try {
      return JSON.parse(conditions);
    } catch (e) {
      this.logger.error("Error parsing conditions", {
        error: e,
        details: {
          conditions,
        },
      });

      return conditions;
    }
  }

  parseSegmentsIfStringified(
    segments: GroupSegment | GroupSegment[],
  ): GroupSegment | GroupSegment[] {
    if (typeof segments === "string" && (segments.startsWith("{") || segments.startsWith("["))) {
      return JSON.parse(segments);
    }

    return segments;
  }
}
