import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { FeaturevisorCLIError } from "../error";

/** Reads Git without a shell or optional lock writes, as the diff command does */
function git(directory: string, args: string[]): string {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: directory,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

function sinceError(message: string, ref: string): FeaturevisorCLIError {
  return new FeaturevisorCLIError(message, { code: "since_error", details: { ref } });
}

/**
 * The real paths of the files changed since HEAD left `ref`: committed since the commit they
 * share, staged, unstaged and untracked. Deleted files are left out. Compare them with
 * fs.realpathSync.native, which writes a path as Git does, also on Windows.
 */
export function getChangedFiles(directory: string, ref: string): Set<string> {
  let root: string;
  try {
    root = fs.realpathSync.native(git(directory, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    throw sinceError("fmt --since needs the project in a Git working tree.", ref);
  }

  let base: string;
  try {
    const commit = git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
    base = git(root, ["merge-base", commit.trim(), "HEAD"]).trim();
  } catch {
    throw sinceError(
      `Cannot find where HEAD left ${JSON.stringify(ref)}. Check the reference, and fetch its history in CI.`,
      ref,
    );
  }

  const files = [
    ...git(root, ["diff", "--name-only", "-z", "--diff-filter=d", base]).split("\0"),
    ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ];
  return new Set(files.filter(Boolean).map((file) => path.join(root, file)));
}
