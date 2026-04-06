import { Octokit } from "@octokit/rest";
import {
  getPRDetails,
  getPRFiles,
  getPRDiff,
  postPRComment,
  updatePRDescription,
  submitReview,
  getLatestCommitId,
} from "./pr";
import { ensureRepoContext, buildGroupContext } from "../context/indexer";
import { generatePRDescription } from "../claude/describer";
import { reviewPR } from "../claude/reviewer";
import { generateDiagram } from "../claude/diagram";

export async function handlePROpened(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  console.log(`[orchestrator] Handling PR #${prNumber} opened in ${owner}/${repo}`);

  const repoFullName = `${owner}/${repo}`;

  // Post a "processing" comment immediately so the author knows it's running
  await postPRComment(
    octokit,
    owner,
    repo,
    prNumber,
    `> **Vigil** is analyzing this PR... ⏳`
  );

  try {
    // Fetch PR data and context in parallel
    const [pr, files, repoContext, groupContext] = await Promise.all([
      getPRDetails(octokit, owner, repo, prNumber),
      getPRFiles(octokit, owner, repo, prNumber),
      ensureRepoContext(octokit, owner, repo),
      buildGroupContext(octokit, repoFullName),
    ]);

    const diff = await getPRDiff(octokit, owner, repo, prNumber);
    const commitId = await getLatestCommitId(octokit, owner, repo, prNumber);

    // Run description, review, and diagram in parallel
    const [description, review, diagram] = await Promise.all([
      generatePRDescription(pr, files, diff, repoContext, groupContext),
      reviewPR(pr, files, diff, repoContext, groupContext),
      generateDiagram(pr, files, diff, repoContext),
    ]);

    // Update PR description if it was empty or very short
    if (!pr.body || pr.body.trim().length < 50) {
      await updatePRDescription(octokit, owner, repo, prNumber, description);
    }

    // Build the review summary comment
    const reviewComment = buildReviewComment(review.summary, diagram);

    // Submit review with inline comments
    const safeInlineComments = review.inlineComments.filter(
      (c) => c.line > 0 && c.path && c.body
    );

    if (safeInlineComments.length > 0) {
      try {
        await submitReview(
          octokit,
          owner,
          repo,
          prNumber,
          commitId,
          reviewComment,
          safeInlineComments
        );
      } catch (err) {
        // If inline comments fail (e.g. line numbers are off), fall back to just a comment
        console.warn("[orchestrator] Inline review failed, falling back to comment:", err);
        await postPRComment(octokit, owner, repo, prNumber, reviewComment);
      }
    } else {
      await postPRComment(octokit, owner, repo, prNumber, reviewComment);
    }

    // Delete the "processing" comment — we can't easily do this without tracking it,
    // so instead we update it. For now we just leave the analysis comment as the main one.
    console.log(`[orchestrator] Done with PR #${prNumber}`);
  } catch (err) {
    console.error(`[orchestrator] Error processing PR #${prNumber}:`, err);
    await postPRComment(
      octokit,
      owner,
      repo,
      prNumber,
      `> **Vigil** encountered an error while analyzing this PR. Please check the service logs.`
    );
  }
}

export async function handlePRSynchronize(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  // For pushes to existing PRs, do a focused re-review (no description update)
  console.log(`[orchestrator] Handling PR #${prNumber} updated in ${owner}/${repo}`);

  const repoFullName = `${owner}/${repo}`;

  try {
    const [pr, files, repoContext, groupContext] = await Promise.all([
      getPRDetails(octokit, owner, repo, prNumber),
      getPRFiles(octokit, owner, repo, prNumber),
      ensureRepoContext(octokit, owner, repo),
      buildGroupContext(octokit, repoFullName),
    ]);

    const diff = await getPRDiff(octokit, owner, repo, prNumber);
    const commitId = await getLatestCommitId(octokit, owner, repo, prNumber);

    const [review, diagram] = await Promise.all([
      reviewPR(pr, files, diff, repoContext, groupContext),
      generateDiagram(pr, files, diff, repoContext),
    ]);

    const reviewComment = buildReviewComment(review.summary, diagram, true);
    const safeInlineComments = review.inlineComments.filter(
      (c) => c.line > 0 && c.path && c.body
    );

    if (safeInlineComments.length > 0) {
      try {
        await submitReview(
          octokit,
          owner,
          repo,
          prNumber,
          commitId,
          reviewComment,
          safeInlineComments
        );
      } catch {
        await postPRComment(octokit, owner, repo, prNumber, reviewComment);
      }
    } else {
      await postPRComment(octokit, owner, repo, prNumber, reviewComment);
    }
  } catch (err) {
    console.error(`[orchestrator] Error processing PR update #${prNumber}:`, err);
  }
}

function buildReviewComment(
  summary: string,
  diagram: { hasDiagram: boolean; mermaidCode: string; description: string },
  isUpdate = false
): string {
  const header = isUpdate
    ? `## Vigil — Updated PR Analysis\n`
    : `## Vigil — PR Analysis\n`;

  let comment = header + "\n" + summary;

  if (diagram.hasDiagram) {
    comment += `\n\n---\n\n## Flow Diagram\n`;
    if (diagram.description) {
      comment += `_${diagram.description}_\n\n`;
    }
    comment += `\`\`\`mermaid\n${diagram.mermaidCode}\n\`\`\``;
  }

  comment += `\n\n---\n<sub>Generated by Vigil · Powered by Claude</sub>`;

  return comment;
}
