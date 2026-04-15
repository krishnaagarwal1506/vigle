# Vigil

A self-hosted GitHub App that automatically reviews pull requests using **Claude** or **GPT**. It posts inline comments, a structured summary, and a Mermaid flow diagram on every PR — with deep awareness of your repository's architecture and, optionally, related repos in the same product group.

---

## Why self-hosted instead of a GitHub Action?

| | GitHub Action | Vigil (this) |
|---|---|---|
| **Context per review** | Starts fresh every run — no memory of the codebase | Indexes each repo once, caches the summary, reuses it on every PR |
| **Multi-repo awareness** | One workflow per repo, siloed | Group related repos: a backend PR gets frontend context automatically |
| **Token cost** | Full repo context re-sent on every run | Prompt caching means stable context (repo summaries) is charged at ~10% of normal input cost |
| **Trigger** | Runs inside GitHub's infrastructure | Runs on your own server — full control over model, prompts, rate limits |
| **Secrets** | Per-repo or org secrets | Single `.env` on your server |
| **Customisation** | Edit YAML per repo | Edit TypeScript prompts once, applies everywhere |

The core savings come from two design choices described below.

---

## How it works

### 1. Repo indexing and context caching

When a PR is opened, the service checks whether the target repository has been indexed recently (within 24 hours and at the same HEAD SHA). If not, it:

1. Fetches the full file tree (excluding `node_modules`, `dist`, images, lock files).
2. Fetches key files (`README.md`, `package.json`, entry points, `.env.example`).
3. Asks Claude to write a structured summary covering tech stack, architecture, key modules, patterns, and integration points.
4. Stores that summary in a local SQLite database.

On the next PR — or on any subsequent call within 24 hours at the same SHA — the cached summary is used directly. Claude never re-reads the full repo.

### 2. Prompt caching (Anthropic API)

Large, stable blocks passed in the system prompt (repo summaries, group context) are marked with `cache_control: { type: "ephemeral" }`. Anthropic's API caches these between calls, reducing the effective input token cost of repeated context by ~90%. Each review only pays full price for the diff and the PR metadata.

### 3. Multi-repo project groups

You can declare that several repos belong to the same logical product in `config/repo-groups.json`:

```json
{
  "groups": [
    {
      "name": "my-product",
      "description": "Backend API and frontend for my product",
      "repos": [
        "my-org/my-backend",
        "my-org/my-frontend"
      ]
    }
  ]
}
```

When a PR is opened in `my-org/my-backend`, the reviewer automatically fetches (or uses the cached summary of) `my-org/my-frontend` and injects it as additional context. Claude can then catch cross-repo issues — for example, a backend API change that would break the frontend contract.

The group-level combined context is also cached (24 hours), so sibling repo summaries are not re-fetched on every PR.

### 4. What gets posted on a PR

- **PR description** — if the PR body is empty or very short, Claude writes one.
- **Review summary** — overall assessment, severity (`APPROVED` / `NEEDS_WORK` / `COMMENT`), and key findings in markdown.
- **Inline comments** — filed as a GitHub review on the specific diff lines where issues were found (bugs, security, performance). Falls back to a single comment if line numbers cannot be matched.
- **Mermaid diagram** — a flow or sequence diagram generated from the diff, rendered inline in GitHub.

---

## Setup

### 1. Create a GitHub App

Go to the GitHub App creation page for your account type:

- **Personal account**: `https://github.com/settings/apps/new`
- **Organization**: `https://github.com/organizations/<YOUR_ORG>/settings/apps/new`

Create a new app with:

- **Webhook URL**: `https://<your-server>/webhook`
- **Permissions**: Pull requests (read & write), Contents (read), Metadata (read)
- **Events**: Pull request

Download the private key and note the App ID and webhook secret.

### 2. Install the app on your repos

Install the GitHub App on every repository you want reviewed.

### 3. Configure environment

Copy `.env.example` to `.env` and fill in:

```
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=
PORT=3000
DB_PATH=./data/context.db
```

#### AI provider

Vigil supports **Anthropic (Claude)** and **OpenAI (GPT)**. Set one API key — the provider is auto-detected:

| Provider | Env var | Default model | Prompt caching |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | Yes — stable context charged at ~10% |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` | Automatic (prefix caching, no manual control) |

```bash
# Pick one:
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

To force a specific provider or model:

```bash
AI_PROVIDER=openai          # "anthropic" or "openai"
AI_MODEL=gpt-4o-mini        # any model the provider supports
```

### 4. Configure repo groups (optional)

Edit `config/repo-groups.json` to declare which repos belong together. Repos not listed in any group are reviewed standalone.

### 5. Run

```bash
npm install
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

The server listens on the configured `PORT` and exposes a single `POST /webhook` endpoint.

---

## Project structure

```
src/
  github/
    app.ts          — GitHub App initialisation, Octokit factory
    pr.ts           — PR data fetching (details, files, diff, commits)
    orchestrator.ts — Webhook handler: coordinates indexing, AI calls, posting
  ai/
    client.ts       — Provider-agnostic AI client (Anthropic + OpenAI)
    reviewer.ts     — Core review prompt and structured output parsing
    describer.ts    — PR description generation
    diagram.ts      — Mermaid diagram generation
  context/
    cache.ts        — SQLite read/write for repo and group summaries
    groups.ts       — Repo group config loader and lookup helpers
    indexer.ts      — Repo tree fetching, key file fetching, summary generation
config/
  repo-groups.json  — Declare multi-repo project groups here
```

---

## Requirements

- Node.js 18+
- An **Anthropic API key** (Claude) or an **OpenAI API key** (GPT) — either works
- A publicly reachable server (or a tunnel like ngrok for development) for GitHub webhook delivery
