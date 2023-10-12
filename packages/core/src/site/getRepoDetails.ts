import { execSync } from "child_process";

import { getOwnerAndRepoFromUrl } from "./getOwnerAndRepoFromUrl";

export interface RepoDetails {
  branch: string;
  remoteUrl: string;
  blobUrl: string;
  commitUrl: string;
  topLevelPath: string;
}

export function getRepoDetails(): RepoDetails | undefined {
  try {
    const topLevelPathOutput = execSync(`git rev-parse --show-toplevel`);
    const topLevelPath = topLevelPathOutput.toString().trim();

    const remoteUrlOutput = execSync(`git remote get-url origin`);
    const remoteUrl = remoteUrlOutput.toString().trim();

    const branchOutput = execSync(`git rev-parse --abbrev-ref HEAD`);
    const branch = branchOutput.toString().trim();

    if (!remoteUrl || !branch) {
      return;
    }

    const { owner, repo } = getOwnerAndRepoFromUrl(remoteUrl);

    if (!owner || !repo) {
      return;
    }

    let blobUrl;
    let commitUrl;

    if (remoteUrl.indexOf("github.com") > -1) {
      blobUrl = `https://github.com/${owner}/${repo}/blob/${branch}/{{blobPath}}`;
      commitUrl = `https://github.com/${owner}/${repo}/commit/{{hash}}`;
    } else if (remoteUrl.indexOf("bitbucket.org") > -1) {
      blobUrl = `https://bitbucket.org/${owner}/${repo}/src/${branch}/{{blobPath}}`;
      commitUrl = `https://bitbucket.org/${owner}/${repo}/commits/{{hash}}`;
    }

    if (!blobUrl || !commitUrl) {
      return;
    }

    return {
      branch,
      remoteUrl,
      blobUrl,
      commitUrl,
      topLevelPath,
    };
  } catch (e) {
    console.error(e);
    return;
  }

  return;
}
