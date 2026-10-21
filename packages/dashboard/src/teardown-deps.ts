import { STRUCTURE_SYSTEM_PROMPT, TeardownStructure, type StructureClassifier, type TeardownDeps } from "@ai-ads/performance";
import { config, loadMetadata } from "@ai-ads/pipeline";
import { chatJson } from "../../pipeline/src/llm.js";
import { resolveFfmpegBin } from "../../pipeline/src/ffmpeg-render.js";

/** Wires the teardown pipeline to the studio's configured LLM, ffmpeg and project store. */
export function teardownDeps(): TeardownDeps {
  const classify: StructureClassifier = async ({ transcript, adName, durationS }) => {
    const structure = await chatJson({
      schema: TeardownStructure, schemaName: "ad_teardown", system: STRUCTURE_SYSTEM_PROMPT,
      user: JSON.stringify({ adName, durationSeconds: durationS, transcript }),
    });
    const model = config.llmProvider() === "anthropic" ? config.anthropicModel() : config.openRouterModel();
    return { structure, model };
  };
  const ffmpeg = resolveFfmpegBin();
  return {
    classify,
    loadProject: (id) => loadMetadata(id),
    ffmpegBin: ffmpeg,
    ffprobeBin: ffmpeg === "ffmpeg" ? "ffprobe" : ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"),
    whisperCmd: process.env.WHISPER_CMD?.trim() || undefined,
  };
}

export function llmConfigured(): boolean {
  return config.llmProvider() === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENROUTER_API_KEY;
}
