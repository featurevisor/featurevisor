import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FeaturevisorCLIError } from "../error";

export interface DiffEndpoint {
  ref: string;
  commit?: string;
}

export interface DiffSelection {
  from: DiffEndpoint;
  to: DiffEndpoint;
  reason: "explicit" | "uncommitted" | "primary" | "branch";
}

export interface GitFile {
  path: string;
  oid?: string;
  mode?: string;
}

export function diffError(message: string): never {
  throw new FeaturevisorCLIError(message, { code: "diff_error" });
}

/** Read Git without a shell, network access, or optional index refresh writes. */
export class DiffGit {
  readonly root: string;

  constructor(directory: string) {
    try {
      this.root = this.run(directory, ["rev-parse", "--show-toplevel"]).toString().trim();
    } catch {
      diffError("The diff command requires a Featurevisor project in a Git working tree.");
    }
  }

  private run(directory: string, args: string[], input?: string): Buffer {
    return execFileSync("git", ["--literal-pathspecs", ...args], {
      cwd: directory,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  read(args: string[], input?: string): Buffer {
    try {
      return this.run(this.root, args, input);
    } catch {
      diffError(
        `Could not read Git data (${args[0]}). Check the repository and available history.`,
      );
    }
  }

  private optional(args: string[]): string | undefined {
    try {
      return this.run(this.root, args).toString().trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private resolve(ref: string): DiffEndpoint {
    if (typeof ref !== "string") diffError("Pass a single string for each diff reference.");
    if (ref === "working-tree") return { ref };
    if (!ref.trim()) diffError("Diff references must not be empty.");
    const commit = this.optional(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
    if (!commit) diffError(`Cannot resolve Git reference ${JSON.stringify(ref)} to a commit.`);
    return { ref, commit };
  }

  select(from?: string, to?: string): DiffSelection {
    if (from !== undefined || to !== undefined) {
      return {
        from: this.resolve(from ?? "HEAD"),
        to: this.resolve(to ?? "working-tree"),
        reason: "explicit",
      };
    }
    const head = this.resolve("HEAD");
    if (this.read(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length) {
      return { from: head, to: { ref: "working-tree" }, reason: "uncommitted" };
    }
    const branch = this.optional(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const upstream = branch && this.optional(["config", "--get", `branch.${branch}.remote`]);
    const remotes = this.read(["remote"]).toString().trim().split("\n").filter(Boolean);
    const orderedRemotes = Array.from(new Set([upstream, "origin", ...remotes])).filter(
      (remote): remote is string => !!remote && remote !== ".",
    );
    let primary: string | undefined;
    let primaryRef: string | undefined;
    for (const remote of orderedRemotes) {
      const prefix = `refs/remotes/${remote}/`;
      const remoteHead = this.optional(["symbolic-ref", "--quiet", `${prefix}HEAD`]);
      if (!remoteHead?.startsWith(prefix)) continue;
      primary = remoteHead.slice(prefix.length);
      primaryRef = this.optional(["show-ref", "--verify", `refs/heads/${primary}`])
        ? `refs/heads/${primary}`
        : remoteHead;
      break;
    }
    if (!primaryRef) {
      const configured = this.optional(["config", "--get", "init.defaultBranch"]);
      for (const candidate of ["main", "master", configured]) {
        if (candidate && this.optional(["show-ref", "--verify", `refs/heads/${candidate}`])) {
          primary = candidate;
          primaryRef = `refs/heads/${candidate}`;
          break;
        }
      }
    }
    if (!primaryRef) {
      for (const remote of orderedRemotes) {
        for (const candidate of ["main", "master"]) {
          const ref = `refs/remotes/${remote}/${candidate}`;
          if (this.optional(["show-ref", "--verify", ref])) {
            primary = candidate;
            primaryRef = ref;
            break;
          }
        }
        if (primaryRef) break;
      }
    }
    if (!primaryRef) {
      diffError("Cannot identify the primary branch. Specify --from and --to explicitly.");
    }
    return branch === primary
      ? { from: head, to: head, reason: "primary" }
      : { from: this.resolve(primaryRef), to: head, reason: "branch" };
  }

  files(endpoint: DiffEndpoint): GitFile[] {
    if (endpoint.commit) {
      return this.read(["ls-tree", "-r", "-z", "--full-tree", endpoint.commit])
        .toString()
        .split("\0")
        .filter(Boolean)
        .map((record) => {
          const tab = record.indexOf("\t");
          const [mode, , oid] = record.slice(0, tab).split(" ");
          return { path: record.slice(tab + 1), mode, oid };
        });
    }
    if (this.read(["ls-files", "--unmerged", "-z"]).length) {
      diffError("Resolve Git merge conflicts before comparing the working tree.");
    }
    return Array.from(
      new Set(
        this.read(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
          .toString()
          .split("\0")
          .filter(Boolean),
      ),
    ).map((filePath) => ({ path: filePath }));
  }

  /** Read selected blobs in one process, not one Git process per definition. */
  contents(files: GitFile[], endpoint: DiffEndpoint): Map<string, string> {
    const result = new Map<string, string>();
    if (!endpoint.commit) {
      for (const file of files) {
        const absolutePath = path.join(this.root, file.path);
        try {
          let current = this.root;
          for (const part of file.path.split("/")) {
            current = path.join(current, part);
            if (fs.lstatSync(current).isSymbolicLink()) {
              diffError(`Cannot compare symbolic link: ${file.path}`);
            }
          }
          if (!fs.statSync(absolutePath).isFile()) {
            diffError(`Not a regular definition file: ${file.path}`);
          }
          result.set(file.path, fs.readFileSync(absolutePath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          if (error instanceof FeaturevisorCLIError) throw error;
          diffError(`Cannot read definition file: ${file.path}`);
        }
      }
      return result;
    }
    if (!files.length) return result;
    for (const file of files) {
      if (file.mode !== "100644" && file.mode !== "100755") {
        diffError(`Cannot compare nonregular definition file: ${file.path}`);
      }
    }
    const output = this.read(
      ["cat-file", "--batch"],
      files.map((file) => file.oid).join("\n") + "\n",
    );
    let offset = 0;
    for (const file of files) {
      const end = output.indexOf(10, offset);
      const [, type, length] = output.subarray(offset, end).toString().split(" ");
      const size = Number(length);
      if (end < 0 || type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
        diffError(`Cannot read Git blob: ${file.path}`);
      }
      offset = end + 1;
      result.set(file.path, output.subarray(offset, offset + size).toString("utf8"));
      offset += size + 1;
    }
    return result;
  }
}
