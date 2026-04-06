import { createMessage } from "./client";
import { PRDetails, PRFile } from "../github/pr";

export interface DiagramResult {
  hasDiagram: boolean;
  mermaidCode: string;
  description: string;
}

/**
 * Determines if a PR warrants a flow diagram and generates one if so.
 * Diagrams are generated for PRs that:
 * - Add/modify API endpoints or routes
 * - Change data flow, business logic, or service interactions
 * - Modify authentication/authorization flows
 * - Add new major features with multiple interacting parts
 */
export async function generateDiagram(
  pr: PRDetails,
  files: PRFile[],
  diff: string,
  repoContext: string
): Promise<DiagramResult> {
  // Quick heuristic — skip diagrams for tiny PRs
  const totalChanges = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (totalChanges < 20 && files.length <= 2) {
    return { hasDiagram: false, mermaidCode: "", description: "" };
  }

  const truncatedDiff =
    diff.length > 15000 ? diff.slice(0, 15000) + "\n...(truncated)" : diff;

  const changedFiles = files
    .map((f) => `- \`${f.filename}\` (+${f.additions} -${f.deletions})`)
    .join("\n");

  const raw = await createMessage({
    cachedSystemBlocks: [
      {
        text: `## Repository context\n${repoContext}`,
        cache: true,
      },
      {
        text: `You are a software architect who creates clear, accurate Mermaid diagrams to visualize code changes.`,
        cache: false,
      },
    ],
    userPrompt: `Analyze this PR and decide if a flow diagram would help reviewers understand the changes.

## PR: ${pr.title}
## Changed files
${changedFiles}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

A diagram is useful when the PR:
- Adds or modifies API routes/endpoints
- Changes data flow between services or modules
- Modifies auth/permission logic
- Adds a multi-step business process
- Introduces new service-to-service communication

Respond in this format:

DIAGRAM_NEEDED: yes|no
DESCRIPTION: (one sentence about what the diagram shows, or "none" if not needed)
MERMAID:
\`\`\`mermaid
(your mermaid diagram here, or leave empty if not needed)
\`\`\`

Diagram rules:
- Use flowchart TD or sequenceDiagram depending on what's clearer
- Keep it focused on the changes in this PR, not the entire system
- Max ~20 nodes — clarity over completeness
- Use descriptive labels on arrows
- If not needed, output DIAGRAM_NEEDED: no and leave MERMAID empty`,
    maxTokens: 1024,
  });

  return parseDiagramOutput(raw);
}

function parseDiagramOutput(raw: string): DiagramResult {
  const needed = /DIAGRAM_NEEDED:\s*(yes|no)/i.exec(raw);
  if (!needed || needed[1].toLowerCase() === "no") {
    return { hasDiagram: false, mermaidCode: "", description: "" };
  }

  const descMatch = /DESCRIPTION:\s*(.+)/i.exec(raw);
  const mermaidMatch = /```mermaid\s*([\s\S]*?)\s*```/i.exec(raw);

  const description = descMatch?.[1]?.trim() ?? "";
  const mermaidCode = mermaidMatch?.[1]?.trim() ?? "";

  if (!mermaidCode) {
    return { hasDiagram: false, mermaidCode: "", description: "" };
  }

  return { hasDiagram: true, mermaidCode, description };
}
