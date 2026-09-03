import OpenAI from "openai";

/** Requires OPENAI_API_KEY in environment — never commit keys to the repo. */
export function getOpenAiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return new OpenAI({ apiKey: key });
}

/** Override via OPENAI_MODEL (default gpt-4o-mini). */
export function openAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
