import { createMessage } from "./client";
import { PRDetails, PRFile } from "../github/pr";
import { z } from "zod";

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface ReviewResult {
  summary: string;
  inlineComments: InlineComment[];
  severity: "APPROVED" | "NEEDS_WORK" | "COMMENT";
}

const InlineCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  body: z.string(),
});

const ReviewOutputSchema = z.object({
  summary: z.string(),
  severity: z.enum(["APPROVED", "NEEDS_WORK", "COMMENT"]),
  inline_comments: z.array(InlineCommentSchema),
});

function parseReviewOutput(raw: string): ReviewResult {
  // Extract JSON block from response
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    // Fallback: treat the whole response as a summary
    return { summary: raw, inlineComments: [], severity: "COMMENT" };
  }
  try {
    const parsed = ReviewOutputSchema.parse(JSON.parse(jsonMatch[1]));
    return {
      summary: parsed.summary,
      inlineComments: parsed.inline_comments,
      severity: parsed.severity,
    };
  } catch {
    return { summary: raw, inlineComments: [], severity: "COMMENT" };
  }
}

export async function reviewPR(
  pr: PRDetails,
  files: PRFile[],
  diff: string,
  repoContext: string,
  groupContext: string
): Promise<ReviewResult> {
  const systemBlocks = [
    ...(groupContext
      ? [
          {
            text: `You are an expert code reviewer with deep knowledge of this product.\n\n## Product context (related repos)\n${groupContext}`,
            cache: true,
          },
        ]
      : []),
    {
      text: `## Repository context\n${repoContext}`,
      cache: true,
    },
    {
      text: `You are a senior software engineer performing a thorough code review. You care about:
- Correctness and logic errors
- Security vulnerabilities (OWASP top 10, injection, auth issues)
- Performance issues
- Code quality, readability, and maintainability
- Consistency with existing patterns in the codebase
- Missing error handling at system boundaries
- Type safety issues

Be direct and constructive. Don't nitpick style unless it's a real problem.
Only comment on lines that exist in the diff (added lines).`,
      cache: false,
    },
  ];

  const changedFiles = files
    .map((f) => `- \`${f.filename}\` (${f.status}, +${f.additions} -${f.deletions})`)
    .join("\n");

  const truncatedDiff =
    diff.length > 25000 ? diff.slice(0, 25000) + "\n\n...(diff truncated)" : diff;

  const userPrompt = `Review this pull request.

## PR: ${pr.title}
- Author: ${pr.author}
- Branch: \`${pr.head}\` → \`${pr.base}\`

## Changed files
${changedFiles}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

Respond with a JSON block in this exact format:
\`\`\`json
{
  "severity": "APPROVED" | "NEEDS_WORK" | "COMMENT",
  "summary": "Overall review summary in markdown. Include: what the PR does, overall assessment, key concerns if any.",
  "inline_comments": [
    {
      "path": "src/some/file.ts",
      "line": 42,
      "body": "**Issue**: Description of the problem\\n\\n**Suggestion**: How to fix it"
    }
  ]
}
\`\`\`

Rules:
- "line" must be a line number that exists in the diff for that file (added lines only)
- Limit inline comments to real issues (bugs, security, performance) — max 10 comments
- If the PR looks good, say so in the summary and return empty inline_comments
- Use severity APPROVED only if you have no concerns`;

  const raw = await createMessage({
    cachedSystemBlocks: systemBlocks,
    userPrompt,
    maxTokens: 4096,
  });

  return parseReviewOutput(raw);
}
