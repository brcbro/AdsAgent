import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { keys } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";

type Result = Awaited<ReturnType<typeof api.performanceScripts>>;

export function ScriptSuggestions({ llmConfigured, winners }: { llmConfigured: boolean; winners: number }) {
  const [context, setContext] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [generating, setGenerating] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const [prefs] = usePrefs();
  const navigate = useNavigate();
  const client = useQueryClient();

  async function generate() {
    setGenerating(true);
    try { setResult(await api.performanceScripts(context)); }
    catch (err) { toast.error("Couldn't generate scripts", { description: errorMessage(err) }); }
    finally { setGenerating(false); }
  }

  async function openInStudio(script: Result["scripts"][number], index: number) {
    setOpening(index);
    try {
      const project = await api.createProject({ title: script.title, scriptDe: script.script,
        aspectRatio: prefs.defaultAspectRatio, captions: { presetId: prefs.defaultPresetId, fontSize: 32 } });
      client.setQueryData<Project[]>(keys.projects, (list) => [project, ...(list ?? [])]);
      client.setQueryData(keys.project(project.id), project);
      navigate(`/studio/${project.id}`);
    } catch (err) { toast.error("Couldn't create the project", { description: errorMessage(err) }); }
    finally { setOpening(null); }
  }

  return (
    <section className="mt-8" data-testid="performance-scripts">
      <h2 className="text-base font-semibold text-fg">Scripts inspired by winners</h2>
      <p className="mt-1 text-xs text-fg-muted">Generate German scripts using the hooks, angles and creative details of analysed winning ads. Open a winner and run its teardown first.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Textarea aria-label="Creative direction" value={context} onChange={(e) => setContext(e.target.value)} maxLength={1000}
          placeholder="Optional product, audience or creative direction" className="min-h-16 min-w-0 flex-1" />
        <Button variant="primary" loading={generating} disabled={!llmConfigured || !winners} onClick={generate}><Sparkles /> Suggest scripts</Button>
      </div>
      {!winners && <p className="mt-2 text-xs text-fg-muted">Sync performance data to identify winning ads.</p>}
      {!llmConfigured && <p className="mt-2 text-xs text-fg-muted">Configure an LLM key to generate scripts.</p>}
      {result && <div className="mt-3 grid gap-3 lg:grid-cols-3">{result.scripts.map((script, index) => (
        <article key={index} className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="text-sm font-semibold text-fg">{script.title}</h3>
          <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{script.script}</p>
          <p className="mt-3 text-xs text-fg-muted">{script.rationale}</p>
          <p className="mt-2 text-xs text-fg-muted">Inspired by {script.sourceAdIds.map((id) => result.sources.find((source) => source.id === id)?.name ?? id).join(", ")}</p>
          <Button className="mt-4" variant="secondary" size="sm" loading={opening === index} disabled={opening !== null} onClick={() => openInStudio(script, index)}>Open in Studio</Button>
        </article>
      ))}</div>}
    </section>
  );
}
