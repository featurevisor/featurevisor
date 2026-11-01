import * as path from "path";

import type {
  ParsedFeature,
  Segment,
  Attribute,
  FeatureKey,
  Test,
  EnvironmentKey,
  ExistingState,
  SegmentKey,
  AttributeKey,
  DatafileContent,
  EntityType,
  SchemaKey,
  Schema,
  Target,
  TargetKey,
  ParsedVariable,
  VariableKey,
  Scenario,
} from "@featurevisor/types";

import { getProjectConfigForSet, ProjectConfig } from "../config";
import type { CustomParser } from "@featurevisor/parsers";

import { Adapter, DatafileFile, DatafileOptions } from "./adapter";
import {
  collectDependencyClosure,
  buildDependencyGraph,
  findDependencyCycles,
  featureFlagNode,
  variableNode,
} from "./dependencies";
import { assertFlatAttributeKeys } from "./attributeNamespaces";
import { expandConditionExpressions } from "./expressions";

export class Datasource {
  private adapter: Adapter;
  private rootConfig: ProjectConfig;

  constructor(
    private config: ProjectConfig,
    private rootDirectoryPath?: string,
    private set?: string,
  ) {
    this.rootConfig = config;
    this.config = set ? getProjectConfigForSet(this.rootConfig, set) : config;
    this.adapter = new this.config.adapter(this.config, rootDirectoryPath);
  }

  getConfig() {
    return this.config;
  }

  getRootDirectoryPath() {
    return this.rootDirectoryPath;
  }

  getSet() {
    return this.set;
  }

  forSet(set: string) {
    return new Datasource(this.rootConfig, this.rootDirectoryPath, set);
  }

  listSets() {
    return this.adapter.listSets();
  }

  getExpressionOptions() {
    return { namespaceCharacter: this.config.namespaceCharacter };
  }

  /**
   * A definition exactly as authored, expressions included. Use it only to write a definition
   * back, so authored expressions survive. Everything else reads the expanded form.
   */
  readAuthoredEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
    return this.adapter.readEntity<T>(entityType, entityKey);
  }

  getExtension() {
    return (this.config.parser as CustomParser).extension;
  }

  /**
   * State
   */
  readState(environment: EnvironmentKey | false): Promise<ExistingState> {
    return this.adapter.readState(environment);
  }

  writeState(environment: EnvironmentKey | false, existingState: ExistingState) {
    // Persist only the current state contract, including entries not visited by
    // a selected build. Preserve their assignments without retaining unknown metadata.
    const state: ExistingState = {
      features: Object.fromEntries(
        Object.entries(existingState.features).map(([key, feature]) => [
          key,
          {
            ...(feature.hash !== undefined ? { hash: feature.hash } : {}),
            ...(feature.variations !== undefined
              ? { variations: feature.variations.map(({ value, weight }) => ({ value, weight })) }
              : {}),
            traffic: feature.traffic.map(({ key, percentage, allocation }) => ({
              key,
              percentage,
              ...(allocation !== undefined
                ? {
                    allocation: allocation.map(({ variation, range }) => ({
                      variation,
                      range: [range[0], range[1]],
                    })),
                  }
                : {}),
            })),
          },
        ]),
      ),
    };
    return this.adapter.writeState(environment, state);
  }

  /**
   * Revision
   */
  readRevision() {
    return this.adapter.readRevision();
  }

  writeRevision(revision: string, datafilesDir?: string) {
    return this.adapter.writeRevision(revision, datafilesDir);
  }

  /**
   * Datafile
   */
  listDatafiles(): Promise<DatafileFile[]> {
    return this.adapter.listDatafiles ? this.adapter.listDatafiles() : Promise.resolve([]);
  }

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

  /** See `Adapter.getEntityFingerprint`. Undefined when the adapter cannot provide one. */
  async getEntityFingerprint(entityType: EntityType, entityKey: string) {
    return this.adapter.getEntityFingerprint
      ? this.adapter.getEntityFingerprint(entityType, entityKey)
      : undefined;
  }

  /** The feature with expressions in its conditions expanded into trees, as everything downstream reads it. */
  async readFeature(featureKey: FeatureKey) {
    return expandConditionExpressions(
      "feature",
      featureKey,
      await this.adapter.readEntity<ParsedFeature>("feature", featureKey),
      this.getExpressionOptions(),
    );
  }

  writeFeature(featureKey: FeatureKey, feature: ParsedFeature) {
    return this.adapter.writeEntity<ParsedFeature>("feature", featureKey, feature);
  }

  deleteFeature(featureKey: FeatureKey) {
    return this.adapter.deleteEntity("feature", featureKey);
  }

  async getRequiredFeaturesChain(featureKey: FeatureKey): Promise<Set<FeatureKey>> {
    if (!(await this.featureExists(featureKey))) {
      throw new Error(`Feature not found: ${featureKey}`);
    }

    const graph = await buildDependencyGraph(this);
    const cycles = await findDependencyCycles(this, graph);
    if (cycles.length) throw cycles[0];
    const structural = await collectDependencyClosure(this, [featureFlagNode(featureKey)], {
      graph,
    });
    for (const key of structural.features) {
      if (!(await this.featureExists(key))) throw new Error(`required feature "${key}" not found`);
    }
    return structural.features;
  }

  // segments
  listSegments() {
    return this.adapter.listEntities("segment");
  }

  segmentExists(segmentKey: SegmentKey) {
    return this.adapter.entityExists("segment", segmentKey);
  }

  async readSegment(segmentKey: SegmentKey) {
    return expandConditionExpressions(
      "segment",
      segmentKey,
      await this.adapter.readEntity<Segment>("segment", segmentKey),
      this.getExpressionOptions(),
    );
  }

  writeSegment(segmentKey: SegmentKey, segment: Segment) {
    return this.adapter.writeEntity<Segment>("segment", segmentKey, segment);
  }

  deleteSegment(segmentKey: SegmentKey) {
    return this.adapter.deleteEntity("segment", segmentKey);
  }

  // attributes
  private assertAttributeKeys(keys: string[]) {
    assertFlatAttributeKeys(
      keys,
      this.config.attributesDirectoryPath,
      this.config.namespaceCharacter,
      this.getExtension(),
    );
  }

  async listAttributes() {
    const keys = await this.adapter.listEntities("attribute");
    this.assertAttributeKeys(keys);
    return keys;
  }

  async listFlattenedAttributes() {
    const attributes = await this.listAttributes();
    const result: string[] = [];

    for (const key of attributes) {
      const attribute = await this.readAttribute(key);

      result.push(key);

      if (attribute.type === "object") {
        // @NOTE: in future, this can be recursive
        const propertyKeys = Object.keys(attribute.properties || {});
        for (const propertyKey of propertyKeys) {
          result.push(`${key}.${propertyKey}`);
        }
      }
    }

    return result;
  }

  async attributeExists(attributeKey: AttributeKey) {
    this.assertAttributeKeys([attributeKey]);
    return this.adapter.entityExists("attribute", attributeKey);
  }

  async readAttribute(attributeKey: AttributeKey) {
    this.assertAttributeKeys([attributeKey]);
    return this.adapter.readEntity<Attribute>("attribute", attributeKey);
  }

  async writeAttribute(attributeKey: AttributeKey, attribute: Attribute) {
    this.assertAttributeKeys([attributeKey]);
    return this.adapter.writeEntity<Attribute>("attribute", attributeKey, attribute);
  }

  async deleteAttribute(attributeKey: AttributeKey) {
    this.assertAttributeKeys([attributeKey]);
    return this.adapter.deleteEntity("attribute", attributeKey);
  }

  // schemas
  listSchemas() {
    return this.adapter.listEntities("schema");
  }

  schemaExists(schemaKey: SchemaKey) {
    return this.adapter.entityExists("schema", schemaKey);
  }

  readSchema(schemaKey: SchemaKey) {
    return this.adapter.readEntity<Schema>("schema", schemaKey);
  }

  writeSchema(schemaKey: SchemaKey, schema: Schema) {
    return this.adapter.writeEntity<Schema>("schema", schemaKey, schema);
  }

  deleteSchema(schemaKey: SchemaKey) {
    return this.adapter.deleteEntity("schema", schemaKey);
  }

  // global variables
  listVariables() {
    return this.adapter.listEntities("variable");
  }

  variableExists(variableKey: VariableKey) {
    return this.adapter.entityExists("variable", variableKey);
  }

  async readVariable(variableKey: VariableKey) {
    return expandConditionExpressions(
      "variable",
      variableKey,
      await this.adapter.readEntity<ParsedVariable>("variable", variableKey),
      this.getExpressionOptions(),
    );
  }

  writeVariable(variableKey: VariableKey, variable: ParsedVariable) {
    return this.adapter.writeEntity<ParsedVariable>("variable", variableKey, variable);
  }

  deleteVariable(variableKey: VariableKey) {
    return this.adapter.deleteEntity("variable", variableKey);
  }

  async getRequiredFeaturesChainForVariable(variableKey: VariableKey): Promise<Set<FeatureKey>> {
    if (!(await this.variableExists(variableKey))) {
      throw new Error(`Variable not found: ${variableKey}`);
    }

    const structural = await collectDependencyClosure(this, [variableNode(variableKey)]);
    return structural.features;
  }

  // targets
  listTargets() {
    return this.adapter.listEntities("target");
  }

  targetExists(targetKey: TargetKey) {
    return this.adapter.entityExists("target", targetKey);
  }

  readTarget(targetKey: TargetKey) {
    return this.adapter.readEntity<Target>("target", targetKey);
  }

  writeTarget(targetKey: TargetKey, target: Target) {
    return this.adapter.writeEntity<Target>("target", targetKey, target);
  }

  deleteTarget(targetKey: TargetKey) {
    return this.adapter.deleteEntity("target", targetKey);
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

  getTestSourcePath(testKey: string) {
    if (this.adapter.getTestSourcePath) return this.adapter.getTestSourcePath(testKey);
    if (this.adapter.getEntityPath) return this.adapter.getEntityPath("test", testKey);
    const parts = this.config.namespaceCharacter
      ? testKey.split(this.config.namespaceCharacter)
      : [testKey];
    if (parts.length > 1 && ["spec", "feature", "segment"].includes(parts[parts.length - 1])) {
      const suffix = parts.pop();
      parts[parts.length - 1] += `.${suffix}`;
    }
    return path.join(this.config.testsDirectoryPath, ...parts) + `.${this.getExtension()}`;
  }

  /** The file an entity is read from, when the adapter keeps entities in files. */
  getEntitySourcePath(entityType: EntityType, entityKey: string): string | undefined {
    if (entityType === "test") return this.getTestSourcePath(entityKey);
    if (entityType === "scenario") return this.adapter.getScenarioSourcePath?.(entityKey);
    return this.adapter.getEntityPath?.(entityType, entityKey);
  }

  // scenarios
  getScenarioSourcePath(scenarioKey: string) {
    if (!this.adapter.getScenarioSourcePath) {
      throw new Error("This datasource adapter does not expose scenario source paths");
    }
    return this.adapter.getScenarioSourcePath(scenarioKey);
  }

  listScenarios() {
    return this.adapter.listEntities("scenario");
  }

  scenarioExists(scenarioKey: string) {
    return this.adapter.entityExists("scenario", scenarioKey);
  }

  readScenario(scenarioKey: string) {
    return this.adapter.readEntity<Scenario>("scenario", scenarioKey);
  }

  writeScenario(scenarioKey: string, scenario: Scenario) {
    return this.adapter.writeEntity<Scenario>("scenario", scenarioKey, scenario);
  }

  deleteScenario(scenarioKey: string) {
    return this.adapter.deleteEntity("scenario", scenarioKey);
  }

  // history
  listHistoryEntries(entityType?: EntityType, entityKey?: string) {
    return this.adapter.listHistoryEntries(entityType, entityKey);
  }

  readCommit(commitHash: string, entityType?: EntityType, entityKey?: string) {
    return this.adapter.readCommit(commitHash, entityType, entityKey);
  }
}
