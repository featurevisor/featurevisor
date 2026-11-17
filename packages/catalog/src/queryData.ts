/**
 * Where the export writes each datafile the Query page evaluates with, beside its Set's index.
 * Shared by the exporter and the page, so the two always agree.
 */
export function getDatafileName(environment: string | null) {
  return environment === null
    ? "datafiles/project.json"
    : `datafiles/environments/${encodeURIComponent(environment)}.json`;
}
