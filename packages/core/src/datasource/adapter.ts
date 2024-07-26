import {
  DatafileContent,
  EnvironmentKey,
  ExistingState,
  HistoryEntry,
  Commit,
  CommitHash,
  EntityType,
} from "@featurevisor/types";
import { Scope } from "../config";

export interface DatafileOptions {
  environment: EnvironmentKey;
  tag: string;
  scope?: Scope;
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

  // revision
  abstract readRevision(): Promise<string>;
  abstract writeRevision(revision: string): Promise<void>;

  // history
  abstract listHistoryEntries(entityType?: EntityType, entityKey?: string): Promise<HistoryEntry[]>;
  abstract readCommit(
    commit: CommitHash,
    entityType?: EntityType,
    entityKey?: string,
  ): Promise<Commit>;
}
