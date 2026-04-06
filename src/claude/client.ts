import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export type CacheableTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * Creates a message with Claude, optionally using prompt caching.
 * Large, stable content (like repo context) should be passed as
 * cachedSystemBlocks so Claude can cache them between calls.
 */
export async function createMessage(params: {
  cachedSystemBlocks: Array<{ text: string; cache: boolean }>;
  userPrompt: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getClient();

  const systemBlocks: CacheableTextBlock[] = params.cachedSystemBlocks.map(
    (block) => ({
      type: "text",
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" } } : {}),
    })
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: params.maxTokens ?? 4096,
    system: systemBlocks as Anthropic.Messages.TextBlockParam[],
    messages: [{ role: "user", content: params.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }
  return textBlock.text;
}
