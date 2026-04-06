# CVT Reviewer — Setup Guide

Self-hosted AI code reviewer for the CVT-TPRM org, powered by Claude.

## What it does
- **Auto-generates PR descriptions** when an empty/minimal description is submitted
- **Code reviews** every PR with inline comments and a summary
- **Flow diagrams** (Mermaid) for PRs that add/change data flows or API routes
- **Cross-repo context** — `tprm-backend` + `tenant-frontend` share context so Claude understands how they interact
- **Context caching** — repo structure is indexed once and reused (saves ~90% on Claude tokens)

---

## Step 1 — Create the GitHub App

1. Go to: `https://github.com/organizations/CVT-TPRM/settings/apps/new`
2. Fill in:
   - **App name**: `CVT Reviewer`
   - **Homepage URL**: (your server URL, or `http://localhost:3000` for now)
   - **Webhook URL**: `https://your-server.com/webhooks/github`
   - **Webhook secret**: Generate a random string (e.g. `openssl rand -hex 32`)
3. **Permissions** (Repository):
   - `Contents`: Read
   - `Pull requests`: Read & Write
   - `Issues`: Read & Write (for comments)
   - `Metadata`: Read
4. **Subscribe to events**:
   - `Pull request`
5. Click **Create GitHub App**
6. After creation, generate a **Private key** (download the `.pem` file)
7. **Install** the app on the `CVT-TPRM` org (or specific repos)

---

## Step 2 — Configure environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

```env
GITHUB_APP_ID=<your app ID from step 1>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n<key content with \n for newlines>\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<your webhook secret>
ANTHROPIC_API_KEY=<your Anthropic API key>
PORT=3000
DB_PATH=./data/context.db
```

**Formatting the private key**: The `.pem` file has real newlines. Convert them to `\n` literals:
```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.pem
```
Wrap the result in double quotes in `.env`.

---

## Step 3 — Run locally (development)

```bash
npm install
npm run dev
```

To test webhooks locally, use [smee.io](https://smee.io):
```bash
npx smee-client --url https://smee.io/YOUR_CHANNEL --target http://localhost:3000/webhooks/github
```
Set your GitHub App's webhook URL to the smee.io channel URL during development.

---

## Step 4 — Deploy (production)

### Railway (recommended)
1. Create a new project at [railway.app](https://railway.app)
2. Connect your GitHub repo
3. Add all env vars in the Railway dashboard
4. Set start command: `npm run build && npm start`
5. Update the GitHub App's webhook URL to your Railway URL

### Render / Fly.io / VPS
Same process — build with `npm run build`, start with `npm start`.

---

## Adding more repo groups

Edit [config/repo-groups.json](config/repo-groups.json):

```json
{
  "groups": [
    {
      "name": "tprm",
      "description": "TPRM product — backend API and tenant frontend",
      "repos": [
        "CVT-TPRM/tprm-backend",
        "CVT-TPRM/tenant-frontend"
      ]
    },
    {
      "name": "another-product",
      "description": "Description of this product",
      "repos": [
        "CVT-TPRM/repo-a",
        "CVT-TPRM/repo-b"
      ]
    }
  ]
}
```

---

## How context caching works

1. On the first PR in a repo, the service fetches the file tree + key files and asks Claude to summarize the repo
2. That summary is stored in SQLite (`data/context.db`) and passed as a **cached system prompt** to Claude
3. Cached tokens cost ~90% less — so after the first PR, repo context is nearly free
4. The cache refreshes automatically every 24h or when the main branch SHA changes
5. For grouped repos (like `tprm-backend` + `tenant-frontend`), a combined group summary is built and cached separately

---

## Architecture

```
GitHub PR event
      │
      ▼
Express webhook server (src/index.ts)
      │
      ▼
Orchestrator (src/github/orchestrator.ts)
      │
      ├── ensureRepoContext() ──► SQLite cache ──► Claude (cached system prompt)
      ├── buildGroupContext() ──► SQLite cache ──► Claude (cached system prompt)
      │
      ├── generatePRDescription() ──► Claude ──► updates PR body
      ├── reviewPR()              ──► Claude ──► inline review comments
      └── generateDiagram()       ──► Claude ──► Mermaid diagram in comment
```
