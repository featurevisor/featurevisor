export function getOwnerAndRepoFromUrl(url: string): { owner: string; repo: string } {
  let owner;
  let repo;

  if (url.startsWith("https://")) {
    const parts = url.split("/");
    repo = (parts.pop() as string).replace(".git", "");
    owner = parts.pop();
  } else if (url.startsWith("git@")) {
    const urlParts = url.split(":");
    const parts = urlParts[1].split("/");
    repo = (parts.pop() as string).replace(".git", "");
    owner = parts.pop();
  }

  return { owner, repo };
}
