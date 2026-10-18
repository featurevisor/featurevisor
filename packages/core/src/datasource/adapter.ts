import type {
  DatafileContent,
  EnvironmentKey,
  ExistingState,
  HistoryEntry,
  Commit,
  CommitHash,
  EntityType,
} from "@featurevisor/types";

export interface DatafileOptions {
  environment: EnvironmentKey | false;
  target?: string;
  datafilesDir?: string;
}

export interface DatafileFile {
  path: string;
  size: number;
  gzipSize: number;
}

export abstract class Adapter {
  abstract listSets(): Promise<string[]>;

  // entities
  abstract listEntities(entityType: EntityType): Promise<string[]>;
  abstract entityExists(entityType: EntityType, entityKey: string): Promise<boolean>;
  abstract readEntity<T>(entityType: EntityType, entityKey: string): Promise<T>;
  abstract writeEntity<T>(entityType: EntityType, entityKey: string, entity: T): Promise<T>;
  abstract deleteEntity(entityType: EntityType, entityKey: string): Promise<void>;
  getScenarioSourcePath?(scenarioKey: string): string;
  getTestSourcePath?(testKey: string): string;
  getEntityPath?(entityType: EntityType, entityKey: string): string;
  /**
   * A cheap identity for an entity's source, which changes whenever its parsed value can.
   * Long running processes such as Catalog watch mode reuse parsed entities while it is
   * unchanged. Adapters that cannot promise this leave it out, and nothing is reused.
   */
  getEntityFingerprint?(entityType: EntityType, entityKey: string): Promise<string | undefined>;

  // state
  abstract readState(environment: EnvironmentKey | false): Promise<ExistingState>;
  abstract writeState(
    environment: EnvironmentKey | false,
    existingState: ExistingState,
  ): Promise<void>;

  // datafile
  listDatafiles?(): Promise<DatafileFile[]>;
  abstract readDatafile(options: DatafileOptions): Promise<DatafileContent>;
  abstract writeDatafile(datafileContent: DatafileContent, options: DatafileOptions): Promise<void>;

  // revision
  abstract readRevision(): Promise<string>;
  abstract writeRevision(revision: string, datafilesDir?: string): Promise<void>;

  // history
  abstract listHistoryEntries(entityType?: EntityType, entityKey?: string): Promise<HistoryEntry[]>;
  abstract readCommit(
    commit: CommitHash,
    entityType?: EntityType,
    entityKey?: string,
  ): Promise<Commit>;
}
