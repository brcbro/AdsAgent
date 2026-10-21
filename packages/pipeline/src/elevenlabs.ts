import fs from "node:fs";
import { WordTimestamp } from "@ai-ads/core";
import { config } from "./config.js";
import { proportionalWords } from "./timing.js";
import { toSpokenGerman } from "./pronunciation.js";

const BASE = "https://api.elevenlabs.io";

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TtsResult {
  durationMs: number;
  words: WordTimestamp[];
  timestampSource: "elevenlabs" | "estimated";
}

// Audio first, avatar second: HeyGen is driven by this audio, so the German
// voice is always ElevenLabs and the avatar length always matches the audio.
export async function synthesize(text: string, outPath: string): Promise<TtsResult> {
  const apiKey = config.elevenLabsApiKey();
  const voiceId = config.elevenLabsVoiceId();
  const modelId = config.elevenLabsModel();
  const languageCode = config.elevenLabsLanguage();
  const spoken = toSpokenGerman(text);
  const maxChars = config.elevenLabsMaxChars();
  if (spoken.length > maxChars) {
    throw new Error(`Narration is ${spoken.length} characters; the limit per request is ${maxChars} (ELEVENLABS_MAX_CHARS). Shorten the script or raise the limit.`);
  }
  const requestBody = JSON.stringify({ text: spoken, model_id: modelId, language_code: languageCode });
  const persist = (result: TtsResult): TtsResult => {
    fs.writeFileSync(outPath.replace(/\.[^.]+$/, ".tts.json"), JSON.stringify({
      scriptDe: text, voiceId, modelId, languageCode, ...result,
    }, null, 2));
    return result;
  };

  const withTimestamps = await fetch(
    `${BASE}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: requestBody,
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (withTimestamps.ok) {
    const data = (await withTimestamps.json()) as {
      audio_base64: string;
      alignment?: Alignment | null;
      normalized_alignment?: Alignment | null;
    };
    fs.writeFileSync(outPath, Buffer.from(data.audio_base64, "base64"));
    const alignment = data.normalized_alignment ?? data.alignment;
    if (!alignment?.characters?.length) {
      const durationMs = await probeDurationMs(outPath);
      return persist({ durationMs, words: proportionalWords(spoken, durationMs), timestampSource: "estimated" });
    }
    const words = wordsFromAlignment(alignment);
    const durationMs = Math.round(
      (alignment.character_end_times_seconds.at(-1) ?? 0) * 1000,
    );
    return persist({ durationMs, words, timestampSource: "elevenlabs" });
  }

  if (![400, 404, 422].includes(withTimestamps.status)) {
    throw new Error(`ElevenLabs TTS failed: ${withTimestamps.status} ${await withTimestamps.text()}`);
  }

  // Some models/plans may not support the timestamps endpoint — fall back to
  // plain synthesis with proportional word timing. whisperX forced alignment
  // is the planned upgrade if this path is hit in practice.
  const plain = await fetch(
    `${BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: requestBody,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!plain.ok) {
    throw new Error(`ElevenLabs TTS failed: ${plain.status} ${await plain.text()}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await plain.arrayBuffer()));
  const durationMs = await probeDurationMs(outPath);
  return persist({ durationMs, words: proportionalWords(spoken, durationMs), timestampSource: "estimated" });
}

function wordsFromAlignment(alignment: Alignment): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let current = "";
  let startMs = 0;
  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (/\s/.test(ch)) {
      if (current) {
        words.push({
          word: current,
          startMs,
          endMs: Math.round(alignment.character_end_times_seconds[i - 1] * 1000),
        });
        current = "";
      }
    } else {
      if (!current) startMs = Math.round(alignment.character_start_times_seconds[i] * 1000);
      current += ch;
    }
  }
  if (current) {
    words.push({
      word: current,
      startMs,
      endMs: Math.round((alignment.character_end_times_seconds.at(-1) ?? 0) * 1000),
    });
  }
  return words;
}

async function probeDurationMs(file: string): Promise<number> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Math.round(parseFloat(stdout.trim()) * 1000);
}
