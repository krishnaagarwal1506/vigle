import { Octokit } from "@octokit/rest";

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PRDetails {
  number: number;
  title: string;
  body: string | null;
  base: string;
  head: string;
  author: string;
  repo: string;
  owner: string;
}

export async function getPRDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRDetails> {
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return {
    number: prNumber,
    title: data.title,
    body: data.body,
    base: data.base.ref,
    head: data.head.ref,
    author: data.user?.login ?? "unknown",
    repo,
    owner,
  };
}

export async function getPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFile[]> {
  const files: PRFile[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    files.push(
      ...data.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      }))
    );
    if (data.length < 100) break;
    page++;
  }
  return files;
}

export async function getPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const files = await getPRFiles(octokit, owner, repo, prNumber);
  return files
    .filter((f) => f.patch)
    .map(
      (f) =>
        `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${f.patch}`
    )
    .join("\n\n");
}

export async function postPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
}

export async function updatePRDescription(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  await octokit.pulls.update({ owner, repo, pull_number: prNumber, body });
}

export async function postInlineReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  path: string,
  line: number,
  body: string
): Promise<void> {
  await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitId,
    path,
    line,
    body,
  });
}

export async function submitReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  body: string,
  comments: Array<{ path: string; line: number; body: string }>
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitId,
    body,
    event: "COMMENT",
    comments: comments.map((c) => ({ path: c.path, line: c.line, body: c.body, side: "RIGHT" })),
  });
}

export async function getLatestCommitId(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return data.head.sha;
}

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}
