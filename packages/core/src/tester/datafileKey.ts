/** Keep base and Target selections distinct, even when names contain delimiters. */
export function getTestDatafileKey(
  environment?: string | false | null,
  target?: string | null,
): string {
  return JSON.stringify([environment === false ? null : (environment ?? null), target ?? null]);
}

/** Explain a missing test datafile, including the common case of a spec without its environment. */
export function getMissingDatafileMessage(
  environment?: string | false | null,
  target?: string | null,
): string {
  if (!environment) {
    return target
      ? `datafile not found for target "${target}"`
      : "No datafile without an environment. When the project configures environments, add environment to the assertion.";
  }
  return `datafile not found for environment "${environment}"${target ? ` and target "${target}"` : ""}`;
}
