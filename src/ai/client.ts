import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// ── Provider detection ───────────────────────────────────────────────

export type AIProvider = "anthropic" | "openai";

export function getProvider(): AIProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "anthropic") return "anthropic";

  // Auto-detect from whichever key is set
  if (process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return "openai";
  return "anthropic"; // default
}

function getModel(): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  return getProvider() === "openai" ? "gpt-4o" : "claude-sonnet-4-6";
}

// ── Singleton clients ────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (_anthropic) return _anthropic;
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

function getOpenAIClient(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

// ── Shared interface ─────────────────────────────────────────────────

export type CacheableTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export interface CreateMessageParams {
  cachedSystemBlocks: Array<{ text: string; cache: boolean }>;
  userPrompt: string;
  maxTokens?: number;
}

/**
 * Creates a message using the configured AI provider.
 *
 * For Anthropic: uses prompt caching on blocks marked with `cache: true`.
 * For OpenAI: cache hints are ignored (OpenAI handles caching automatically
 * for prefix-matching prompts — no manual control needed).
 */
export async function createMessage(params: CreateMessageParams): Promise<string> {
  const provider = getProvider();
  return provider === "openai"
    ? createOpenAIMessage(params)
    : createAnthropicMessage(params);
}

// ── Anthropic implementation ─────────────────────────────────────────

async function createAnthropicMessage(params: CreateMessageParams): Promise<string> {
  const client = getAnthropicClient();

  const systemBlocks: CacheableTextBlock[] = params.cachedSystemBlocks.map(
    (block) => ({
      type: "text",
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" } } : {}),
    })
  );

  const response = await client.messages.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 4096,
    system: systemBlocks as Anthropic.Messages.TextBlockParam[],
    messages: [{ role: "user", content: params.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Anthropic response");
  }
  return textBlock.text;
}

// ── OpenAI implementation ────────────────────────────────────────────

async function createOpenAIMessage(params: CreateMessageParams): Promise<string> {
  const client = getOpenAIClient();

  // Combine all system blocks into a single system message
  const systemContent = params.cachedSystemBlocks
    .map((block) => block.text)
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 4096,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: params.userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("No text in OpenAI response");
  }
  return text;
}
