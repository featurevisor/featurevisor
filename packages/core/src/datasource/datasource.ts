import {
  ParsedFeature,
  Segment,
  Attribute,
  Group,
  FeatureKey,
  Test,
  EnvironmentKey,
  ExistingState,
  SegmentKey,
  AttributeKey,
} from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { CustomParser } from "./parsers";

import { Adapter } from "./adapter";

export class Datasource {
  private adapter: Adapter;

  constructor(private config: ProjectConfig) {
    this.adapter = new config.adapter(config);
  }

  // @TODO: only site generator needs it, find a way to get it out of here later
  getExtension() {
    return (this.config.parser as CustomParser).extension;
  }

  /**
   * State
   */
  async readState(environment: EnvironmentKey): Promise<ExistingState> {
    return this.adapter.readState(environment);
  }

  async writeState(environment: EnvironmentKey, existingState: ExistingState) {
    return this.adapter.writeState(environment, existingState);
  }

  /**
   * Entity specific methods
   */

  // features
  async listFeatures() {
    return await this.adapter.listEntities("feature");
  }

  featureExists(featureKey: FeatureKey) {
    return this.adapter.entityExists("feature", featureKey);
  }

  readFeature(featureKey: FeatureKey) {
    return this.adapter.parseEntity<ParsedFeature>("feature", featureKey);
  }

  async getRequiredFeaturesChain(
    featureKey: FeatureKey,
    chain = new Set<FeatureKey>(),
  ): Promise<Set<FeatureKey>> {
    chain.add(featureKey);

    if (!this.adapter.entityExists("feature", featureKey)) {
      throw new Error(`Feature not found: ${featureKey}`);
    }

    const feature = await this.readFeature(featureKey);

    if (!feature.required) {
      return chain;
    }

    for (const r of feature.required) {
      const requiredKey = typeof r === "string" ? r : r.key;

      if (chain.has(requiredKey)) {
        throw new Error(`Circular dependency detected: ${chain.toString()}`);
      }

      await this.getRequiredFeaturesChain(requiredKey, chain);
    }

    return chain;
  }

  // segments
  listSegments() {
    return this.adapter.listEntities("segment");
  }

  segmentExists(segmentKey: SegmentKey) {
    return this.adapter.entityExists("segment", segmentKey);
  }

  readSegment(segmentKey: SegmentKey) {
    return this.adapter.parseEntity<Segment>("segment", segmentKey);
  }

  // attributes
  listAttributes() {
    return this.adapter.listEntities("attribute");
  }

  attributeExists(attributeKey: AttributeKey) {
    return this.adapter.entityExists("attribute", attributeKey);
  }

  readAttribute(attributeKey: AttributeKey) {
    return this.adapter.parseEntity<Attribute>("attribute", attributeKey);
  }

  // groups
  async listGroups() {
    return this.adapter.listEntities("group");
  }

  groupExists(groupKey: string) {
    return this.adapter.entityExists("group", groupKey);
  }

  readGroup(groupKey: string) {
    return this.adapter.parseEntity<Group>("group", groupKey);
  }

  // tests
  listTests() {
    return this.adapter.listEntities("test");
  }

  readTest(testKey: string) {
    return this.adapter.parseEntity<Test>("test", testKey);
  }

  getTestSpecName(testKey: string) {
    return `${testKey}.${this.getExtension()}`;
  }
}
