import { Octokit } from "@octokit/rest";
import { createMessage } from "../ai/client";
import {
  getRepoContext,
  setRepoContext,
  getGroupContext,
  setGroupContext,
} from "./cache";
import { getGroupForRepo } from "./groups";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Recursively fetches the file tree of a repo (up to reasonable depth).
 * Returns a compact string representation.
 */
async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<string> {
  try {
    const { data } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "1",
    });

    const lines = data.tree
      .filter((item) => item.type === "blob")
      .map((item) => item.path ?? "")
      .filter(
        (p) =>
          !p.includes("node_modules") &&
          !p.includes(".git") &&
          !p.startsWith("dist/") &&
          !p.startsWith("build/") &&
          !p.endsWith(".lock") &&
          !p.endsWith(".png") &&
          !p.endsWith(".jpg") &&
          !p.endsWith(".svg") &&
          !p.endsWith(".ico")
      );

    return lines.join("\n");
  } catch {
    return "(could not fetch tree)";
  }
}

/**
 * Fetches key files (README, package.json, key config files) to build context.
 */
async function fetchKeyFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<string> {
  const candidates = [
    "README.md",
    "package.json",
    "tsconfig.json",
    "src/index.ts",
    "src/app.ts",
    "src/main.ts",
    "src/app.module.ts",
    ".env.example",
  ];

  const results: string[] = [];
  for (const filePath of candidates) {
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref,
      });
      if ("content" in data && typeof data.content === "string") {
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        // Truncate large files
        const truncated =
          content.length > 3000 ? content.slice(0, 3000) + "\n...(truncated)" : content;
        results.push(`### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return results.join("\n\n");
}

/**
 * Ensures repo context is fresh. Re-indexes if SHA changed or stale.
 * Returns the cached summary string.
 */
export async function ensureRepoContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<string> {
  const repoFullName = `${owner}/${repo}`;

  // Get current HEAD SHA
  let headSha: string;
  try {
    const { data } = await octokit.repos.getBranch({ owner, repo, branch });
    headSha = data.commit.sha;
  } catch {
    try {
      const { data } = await octokit.repos.getBranch({ owner, repo, branch: "master" });
      headSha = data.commit.sha;
    } catch {
      return "(could not fetch repo info)";
    }
  }

  const cached = getRepoContext(repoFullName);
  const now = Date.now();

  // Return cached if SHA unchanged and not stale
  if (
    cached &&
    cached.indexedSha === headSha &&
    now - cached.updatedAt < STALE_THRESHOLD_MS
  ) {
    return cached.summary;
  }

  // Re-index
  console.log(`[indexer] Indexing ${repoFullName} at ${headSha.slice(0, 7)}...`);
  const [tree, keyFiles] = await Promise.all([
    fetchRepoTree(octokit, owner, repo, headSha),
    fetchKeyFiles(octokit, owner, repo, headSha),
  ]);

  const summary = await createMessage({
    cachedSystemBlocks: [
      {
        text: "You are a code analysis assistant. Summarize the provided repository so a code reviewer can understand it quickly. Focus on: tech stack, architecture, main modules, key patterns, and anything notable about code style or conventions. Be concise but thorough.",
        cache: false,
      },
    ],
    userPrompt: `Repo: ${repoFullName}

## File tree
\`\`\`
${tree}
\`\`\`

## Key files
${keyFiles}

Write a structured summary covering:
1. **Tech stack** — languages, frameworks, major libraries
2. **Architecture** — how the codebase is organized
3. **Key modules** — what each main folder/module does
4. **Patterns & conventions** — coding patterns, naming conventions, notable practices
5. **Integration points** — APIs, databases, external services`,
    maxTokens: 2048,
  });

  setRepoContext({
    repo: repoFullName,
    summary,
    tree,
    indexedSha: headSha,
    updatedAt: now,
  });

  return summary;
}

/**
 * Builds a combined context string for all repos in a group.
 * Uses cached summaries where available, re-indexes where needed.
 */
export async function buildGroupContext(
  octokit: Octokit,
  repoFullName: string
): Promise<string> {
  const group = getGroupForRepo(repoFullName);
  if (!group) return "";

  // Check group-level cache freshness (24h)
  const cachedGroup = getGroupContext(group.name);
  if (cachedGroup && Date.now() - cachedGroup.updatedAt < STALE_THRESHOLD_MS) {
    return cachedGroup.summary;
  }

  // Fetch fresh summaries for all repos in group
  const summaries = await Promise.all(
    group.repos.map(async (r) => {
      const [o, repo] = r.split("/");
      try {
        const summary = await ensureRepoContext(octokit, o, repo);
        return `## ${r}\n${summary}`;
      } catch {
        return `## ${r}\n(could not index)`;
      }
    })
  );

  const groupSummary = summaries.join("\n\n---\n\n");

  setGroupContext({
    groupName: group.name,
    summary: groupSummary,
    updatedAt: Date.now(),
  });

  return groupSummary;
}
