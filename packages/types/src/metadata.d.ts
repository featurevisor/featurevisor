/** The name of a kind of deadline, such as `review` or `remove` */
export type DeadlineType = string;

/** When something should happen to a definition. It never changes evaluation. */
export interface Deadline {
  /** The moment it is due, as an ISO 8601 timestamp with a timezone, such as `2027-03-01T09:00:00Z` */
  by: string;
  /** `true`, or the timestamp it was done. `false` means not done. */
  done?: boolean | string;
  description?: string;
  /** Fields of the deadline's type, declared in `metadataSchema` */
  [field: string]: unknown;
}

/**
 * Anything a team records about a definition, for people. It never reaches a datafile.
 * `owner` and `deadlines` are Featurevisor's own keys. Every other key is the project's.
 */
export interface Metadata {
  owner?: string | string[];
  deadlines?: Record<DeadlineType, Deadline>;
  [key: string]: unknown;
}

/** The kinds of definition that can carry metadata, as `requireMetadataIn` names them */
export type MetadataKind =
  | "features"
  | "variables"
  | "segments"
  | "attributes"
  | "targets"
  | "schemas";
