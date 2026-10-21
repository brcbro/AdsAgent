import { z } from "zod";
import { config } from "./config.js";

interface ChatJsonOptions<T extends z.ZodType> {
  schema: T;
  schemaName: string;
  system: string;
  user: string;
}

/** Generate validated JSON through the configured provider; repair invalid output once. */
export async function chatJson<T extends z.ZodType>(opts: ChatJsonOptions<T>): Promise<z.infer<T>> {
  const provider = config.llmProvider();
  const jsonSchema = z.toJSONSchema(opts.schema);
  const system = [
    opts.system,
    "",
    "Antworte AUSSCHLIESSLICH mit einem einzelnen JSON-Objekt (kein Markdown, keine Erklärungen), das exakt diesem JSON-Schema entspricht:",
    JSON.stringify(jsonSchema),
  ].join("\n");

  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const anthropic = provider === "anthropic";
    const res = await fetch(
      anthropic ? "https://api.anthropic.com/v1/messages" : "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: anthropic
          ? { "x-api-key": config.anthropicApiKey(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
          : { Authorization: `Bearer ${config.openRouterApiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify(anthropic
          ? {
              model: config.anthropicModel(),
              max_tokens: 4096,
              thinking: { type: "disabled" },
              system,
              messages: [{ role: "user", content: opts.user + feedback }],
            }
          : {
              model: config.openRouterModel(),
              messages: [{ role: "system", content: system }, { role: "user", content: opts.user + feedback }],
              response_format: { type: "json_schema", json_schema: { name: opts.schemaName, schema: jsonSchema } },
            }),
      },
    );
    if (!res.ok) {
      // Authentication/billing failures are not fixed by sending the same request again.
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      const key = anthropic ? config.anthropicApiKey() : config.openRouterApiKey();
      const detail = (body.error?.message ?? res.statusText).replaceAll(key, "[redacted]");
      throw new Error(`${provider} ${res.status}: ${detail}`);
    }
    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (anthropic && (data.stop_reason === "max_tokens" || data.stop_reason === "refusal")) {
      throw new Error(`Anthropic response stopped: ${data.stop_reason}`);
    }
    const content = anthropic
      ? data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("")
      : data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider} returned an empty response`);
    try {
      return opts.schema.parse(JSON.parse(stripFences(content)));
    } catch (err) {
      if (attempt === 1) throw err;
      feedback = `\n\nDeine letzte Antwort war kein gültiges JSON nach Schema (${String(err).slice(0, 300)}). Antworte erneut, nur mit dem JSON-Objekt.`;
    }
  }
  throw new Error("JSON generation failed");
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)?.[1] ?? trimmed;
}
