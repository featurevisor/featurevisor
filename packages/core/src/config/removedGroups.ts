import * as fs from "node:fs";
import * as path from "node:path";

export const REMOVED_GROUPS_MESSAGE =
  "Groups were removed in v4. Convert them to conditions before upgrading SDKs: https://featurevisor.com/docs/migrations/v4/#groups-removed";

/** Reject legacy definitions instead of silently building unrestricted features. */
export function assertNoGroupDefinitions(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) assertNoGroupDefinitions(path.join(directory, entry.name));
    else throw new Error(`${REMOVED_GROUPS_MESSAGE} Found ${path.join(directory, entry.name)}.`);
  }
}

/** Custom datasource implementations may still expose the removed API. */
export async function assertNoLegacyDatasourceGroups(datasource: object): Promise<void> {
  const legacy = datasource as { listGroups?: () => Promise<string[]> };
  if (typeof legacy.listGroups === "function" && (await legacy.listGroups()).length > 0) {
    throw new Error(REMOVED_GROUPS_MESSAGE);
  }
}
