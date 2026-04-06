import { createMessage } from "./client";
import { PRDetails, PRFile } from "../github/pr";

export async function generatePRDescription(
  pr: PRDetails,
  files: PRFile[],
  diff: string,
  repoContext: string,
  groupContext: string
): Promise<string> {
  const systemBlocks = [
    ...(groupContext
      ? [
          {
            text: `You are an expert code reviewer with deep knowledge of this product.\n\n## Product context (related repos)\n${groupContext}`,
            cache: true, // Cache the large group context — reused across all PRs in this product
          },
        ]
      : []),
    {
      text: `## Repository context\n${repoContext}`,
      cache: true, // Cache per-repo context
    },
    {
      text: `You write clear, structured PR descriptions in GitHub Markdown. Be concise but comprehensive. Use bullet points and headers.`,
      cache: false,
    },
  ];

  const changedFiles = files
    .map((f) => `- \`${f.filename}\` (${f.status}, +${f.additions} -${f.deletions})`)
    .join("\n");

  // Truncate diff if too large
  const truncatedDiff =
    diff.length > 20000 ? diff.slice(0, 20000) + "\n\n...(diff truncated for brevity)" : diff;

  const userPrompt = `Generate a PR description for this pull request.

## PR Info
- **Title**: ${pr.title}
- **Author**: ${pr.author}
- **Branch**: \`${pr.head}\` → \`${pr.base}\`
- **Existing description**: ${pr.body ? `\n${pr.body}` : "(none)"}

## Changed files (${files.length} files)
${changedFiles}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

Write a description with these sections:
## Summary
(2-4 sentences describing what this PR does and why)

## Changes
(bullet list of specific changes grouped by area)

## Type of change
(Bug fix / New feature / Refactor / Chore — pick one or combine)

## Testing
(What should reviewers test or what was tested)

## Notes for reviewer
(anything tricky, decisions made, context needed for review)`;

  return createMessage({ cachedSystemBlocks: systemBlocks, userPrompt, maxTokens: 2048 });
}
