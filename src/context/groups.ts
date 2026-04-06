import repoGroupsConfig from "../../config/repo-groups.json";

export interface RepoGroup {
  name: string;
  description: string;
  repos: string[];
}

export function getAllGroups(): RepoGroup[] {
  return repoGroupsConfig.groups;
}

/** Returns the group a repo belongs to, or null if it's standalone */
export function getGroupForRepo(repoFullName: string): RepoGroup | null {
  return (
    repoGroupsConfig.groups.find((g) =>
      g.repos.includes(repoFullName)
    ) ?? null
  );
}

/** Returns sibling repos in the same group (excluding the given repo) */
export function getSiblingRepos(repoFullName: string): string[] {
  const group = getGroupForRepo(repoFullName);
  if (!group) return [];
  return group.repos.filter((r) => r !== repoFullName);
}
