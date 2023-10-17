import { EnvironmentKey, ExistingState } from "@featurevisor/types";

export type EntityType = "feature" | "group" | "segment" | "attribute" | "test";

export abstract class Adapter {
  // entities
  abstract listEntities(entityType: EntityType): Promise<string[]>;
  abstract entityExists(entityType: EntityType, entityKey: string): Promise<boolean>;
  abstract readEntity(entityType: EntityType, entityKey: string): Promise<string>;
  abstract parseEntity<T>(entityType: EntityType, entityKey: string): Promise<T>;

  // state
  abstract readState(environment: EnvironmentKey): Promise<ExistingState>;
  abstract writeState(environment: EnvironmentKey, existingState: ExistingState): Promise<void>;
}
