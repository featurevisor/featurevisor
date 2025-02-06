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
  DatafileContent,
  EntityType,
} from "@featurevisor/types";

import { ProjectConfig, CustomParser } from "../config";

import { Adapter, DatafileOptions } from "./adapter";

export class Datasource {
  private adapter: Adapter;

  constructor(
    private config: ProjectConfig,
    private rootDirectoryPath?: string,
  ) {
    this.adapter = new config.adapter(config, rootDirectoryPath);
  }

  // @TODO: only site generator needs it, find a way to get it out of here later
  getExtension() {
    return (this.config.parser as CustomParser).extension;
  }

  /**
   * State
   */
  readState(environment: EnvironmentKey): Promise<ExistingState> {
    return this.adapter.readState(environment);
  }

  writeState(environment: EnvironmentKey, existingState: ExistingState) {
    return this.adapter.writeState(environment, existingState);
  }

  /**
   * Revision
   */
  readRevision() {
    return this.adapter.readRevision();
  }

  writeRevision(revision: string) {
    return this.adapter.writeRevision(revision);
  }

  /**
   * Datafile
   */
  readDatafile(options: DatafileOptions) {
    return this.adapter.readDatafile(options);
  }

  writeDatafile(datafileContent: DatafileContent, options: DatafileOptions) {
    return this.adapter.writeDatafile(datafileContent, options);
  }

  /**
   * Entity specific methods
   */

  // features
  listFeatures() {
    return this.adapter.listEntities("feature");
  }

  featureExists(featureKey: FeatureKey) {
    return this.adapter.entityExists("feature", featureKey);
  }

  readFeature(featureKey: FeatureKey) {
    return this.adapter.readEntity<ParsedFeature>("feature", featureKey);
  }

  writeFeature(featureKey: FeatureKey, feature: ParsedFeature) {
    return this.adapter.writeEntity<ParsedFeature>("feature", featureKey, feature);
  }

  deleteFeature(featureKey: FeatureKey) {
    return this.adapter.deleteEntity("feature", featureKey);
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
    return this.adapter.readEntity<Segment>("segment", segmentKey);
  }

  writeSegment(segmentKey: SegmentKey, segment: Segment) {
    return this.adapter.writeEntity<Segment>("segment", segmentKey, segment);
  }

  deleteSegment(segmentKey: SegmentKey) {
    return this.adapter.deleteEntity("segment", segmentKey);
  }

  // attributes
  listAttributes() {
    return this.adapter.listEntities("attribute");
  }

  attributeExists(attributeKey: AttributeKey) {
    return this.adapter.entityExists("attribute", attributeKey);
  }

  readAttribute(attributeKey: AttributeKey) {
    return this.adapter.readEntity<Attribute>("attribute", attributeKey);
  }

  writeAttribute(attributeKey: AttributeKey, attribute: Attribute) {
    return this.adapter.writeEntity<Attribute>("attribute", attributeKey, attribute);
  }

  deleteAttribute(attributeKey: AttributeKey) {
    return this.adapter.deleteEntity("attribute", attributeKey);
  }

  // groups
  listGroups() {
    return this.adapter.listEntities("group");
  }

  groupExists(groupKey: string) {
    return this.adapter.entityExists("group", groupKey);
  }

  readGroup(groupKey: string) {
    return this.adapter.readEntity<Group>("group", groupKey);
  }

  writeGroup(groupKey: string, group: Group) {
    return this.adapter.writeEntity<Group>("group", groupKey, group);
  }

  deleteGroup(groupKey: string) {
    return this.adapter.deleteEntity("group", groupKey);
  }

  // tests
  listTests() {
    return this.adapter.listEntities("test");
  }

  readTest(testKey: string) {
    return this.adapter.readEntity<Test>("test", testKey);
  }

  writeTest(testKey: string, test: Test) {
    return this.adapter.writeEntity<Test>("test", testKey, test);
  }

  deleteTest(testKey: string) {
    return this.adapter.deleteEntity("test", testKey);
  }

  getTestSpecName(testKey: string) {
    return `${testKey}.${this.getExtension()}`;
  }

  // history
  listHistoryEntries(entityType?: EntityType, entityKey?: string) {
    return this.adapter.listHistoryEntries(entityType, entityKey);
  }

  readCommit(commitHash: string, entityType?: EntityType, entityKey?: string) {
    return this.adapter.readCommit(commitHash, entityType, entityKey);
  }
}
