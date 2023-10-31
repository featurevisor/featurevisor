import { DatafileContent, EnvironmentKey, ExistingState } from "@featurevisor/types";

export type EntityType = "feature" | "group" | "segment" | "attribute" | "test";

export interface DatafileOptions {
  environment: EnvironmentKey;
  tag: string;
}

export abstract class Adapter {
  // entities
  abstract listEntities(entityType: EntityType): Promise<string[]>;
  abstract entityExists(entityType: EntityType, entityKey: string): Promise<boolean>;
  abstract readEntity<T>(entityType: EntityType, entityKey: string): Promise<T>;
  abstract writeEntity<T>(entityType: EntityType, entityKey: string, entity: T): Promise<T>;
  abstract deleteEntity(entityType: EntityType, entityKey: string): Promise<void>;

  // state
  abstract readState(environment: EnvironmentKey): Promise<ExistingState>;
  abstract writeState(environment: EnvironmentKey, existingState: ExistingState): Promise<void>;

  // datafile
  abstract readDatafile(options: DatafileOptions): Promise<DatafileContent>;
  abstract writeDatafile(datafileContent: DatafileContent, options: DatafileOptions): Promise<void>;
}
