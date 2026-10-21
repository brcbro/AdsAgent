import path from "node:path";
import dotenv from "dotenv";
import { REPO_ROOT } from "@ai-ads/core";

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing ${name} — copy .env.example to .env and fill it in.`);
  }
  return v;
}

export const config = {
  llmProvider: (): "anthropic" | "openrouter" => {
    const provider = process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openrouter");
    if (provider !== "anthropic" && provider !== "openrouter") {
      throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
    }
    return provider;
  },
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
  openRouterApiKey: () => required("OPENROUTER_API_KEY"),
  openRouterModel: () => process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
  elevenLabsApiKey: () => required("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: () => required("ELEVENLABS_VOICE_ID"),
  elevenLabsModel: () => process.env.ELEVENLABS_MODEL || "eleven_v4",
  elevenLabsLanguage: () => process.env.ELEVENLABS_LANGUAGE || "de",
  /** Per-request cap on spoken characters; stops a runaway script from spending credits. */
  elevenLabsMaxChars: () => Number(process.env.ELEVENLABS_MAX_CHARS) || 3000,
  heygenApiKey: () => required("HEYGEN_API_KEY"),
  heygenAvatarId: () => required("HEYGEN_AVATAR_ID"),
};
