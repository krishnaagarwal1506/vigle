import "dotenv/config";
import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { getApp, getInstallationOctokit } from "./github/app";
import { handlePROpened, handlePRSynchronize } from "./github/orchestrator";

const app = express();
const port = parseInt(process.env.PORT ?? "3000", 10);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// GitHub webhook handler
const githubApp = getApp();

githubApp.webhooks.on("pull_request.opened", async ({ payload }) => {
  const { installation, pull_request, repository } = payload;
  if (!installation) return;

  const octokit = await getInstallationOctokit(installation.id);
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;

  // Fire and forget — respond to GitHub immediately, process async
  handlePROpened(octokit, owner, repo, prNumber).catch((err) => {
    console.error(`[webhook] Unhandled error for PR #${prNumber}:`, err);
  });
});

githubApp.webhooks.on("pull_request.synchronize", async ({ payload }) => {
  const { installation, pull_request, repository } = payload;
  if (!installation) return;

  const octokit = await getInstallationOctokit(installation.id);
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;

  handlePRSynchronize(octokit, owner, repo, prNumber).catch((err) => {
    console.error(`[webhook] Unhandled error for PR update #${prNumber}:`, err);
  });
});

// Handle re-opened PRs the same as opened
githubApp.webhooks.on("pull_request.reopened", async ({ payload }) => {
  const { installation, pull_request, repository } = payload;
  if (!installation) return;

  const octokit = await getInstallationOctokit(installation.id);
  handlePROpened(
    octokit,
    repository.owner.login,
    repository.name,
    pull_request.number
  ).catch(console.error);
});

// Mount webhook middleware at /webhooks/github
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/webhooks/github", createNodeMiddleware(githubApp.webhooks as any, { path: "/" }));

app.listen(port, () => {
  console.log(`[cvt-reviewer] Server running on port ${port}`);
  console.log(`[cvt-reviewer] Webhook URL: http://localhost:${port}/webhooks/github`);
});
