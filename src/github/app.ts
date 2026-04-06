import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

let _app: App | null = null;

export function getApp(): App {
  if (_app) return _app;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  _app = new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey,
    webhooks: { secret: process.env.GITHUB_WEBHOOK_SECRET! },
  });
  return _app;
}

export async function getInstallationOctokit(
  installationId: number
): Promise<Octokit> {
  const app = getApp();
  return app.getInstallationOctokit(installationId) as unknown as Octokit;
}
