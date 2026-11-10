import {
  getDeadlines,
  getDeadlineStatus,
  isPlainObject,
  toMetadataJson,
  type DeadlineClock,
} from "../metadata";

export interface DeadlineWarning {
  code: "deadline_overdue" | "deadline_due_today";
  path: string[];
  message: string;
}

/**
 * The open deadlines a definition's owner should act on now: those overdue and those due today.
 * They warn without failing lint, since a passing date changes nothing users get. Archived
 * definitions have none, as in Catalog.
 */
export function getDeadlineWarnings(definition: unknown, clock: DeadlineClock): DeadlineWarning[] {
  if (!isPlainObject(definition) || definition.archived === true) return [];

  const warnings: DeadlineWarning[] = [];
  for (const { type, deadline } of getDeadlines(toMetadataJson(definition.metadata))) {
    const status = getDeadlineStatus(deadline, clock);
    const path = ["metadata", "deadlines", type];

    if (status === "overdue") {
      warnings.push({
        code: "deadline_overdue",
        path,
        message: `The "${type}" deadline was due by ${deadline.by} and is not done. Set \`done\` once the work is done, or move \`by\` later.`,
      });
    } else if (status === "today") {
      warnings.push({
        code: "deadline_due_today",
        path,
        message: `The "${type}" deadline is due today, by ${deadline.by}. Set \`done\` once the work is done.`,
      });
    }
  }

  return warnings;
}
