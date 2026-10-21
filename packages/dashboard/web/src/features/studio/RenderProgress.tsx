import { useRef } from "react";
import { Check } from "lucide-react";
import { cn, elapsed } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useRenderStatus } from "@/lib/queries";
import { useStudio } from "./studio-context";
import { StopButton } from "./Stage";

type Step = { id: string; label: string; match: RegExp };

const LOCAL_STEPS: Step[] = [
  { id: "voice", label: "Voice", match: /elevenlabs|narration|tts|voice/i },
  { id: "broll", label: "B-roll", match: /b-?roll|beat|clip|semantic/i },
  { id: "render", label: "Render", match: /render|ffmpeg|remotion|caption|subtitle|encod/i },
  { id: "publish", label: "Finish", match: /final export|done|publish|→/i },
];

const AVATAR_STEPS: Step[] = [
  { id: "voice", label: "Voice", match: /elevenlabs|tts|narration/i },
  { id: "avatar", label: "Avatar", match: /heygen|avatar|lip-?sync/i },
  ...LOCAL_STEPS.slice(1),
];

const APPLY_STEPS: Step[] = [
  { id: "source", label: "Saved source", match: /reusing|saved source/i },
  ...LOCAL_STEPS.slice(1),
];

/** Best-effort current step from the pipeline's latest log line, never moving backwards. */
function currentStep(steps: Step[], line: string | null | undefined, status: string): number {
  let index = 0;
  if (line) steps.forEach((s, i) => { if (s.match.test(line)) index = Math.max(index, i); });
  if (status === "rendering") index = Math.max(index, steps.findIndex((s) => s.id === "render"));
  return index;
}

export function RenderProgress() {
  const { project } = useStudio();
  const render = useRenderStatus().data;
  const now = useNow(1000);
  const mine = render?.rendering && render.projectId === project.id;
  const isLocal = project.id.startsWith("local_") || project.avatar?.name === "Local waveform preview";
  // "Apply edits" announces the reused source once; remember it for the rest of the render.
  const applyLatch = useRef(false);
  if (mine && /reusing saved source/i.test(render?.lastLine ?? "")) applyLatch.current = true;
  const isApply = !isLocal && applyLatch.current;
  const steps = isApply ? APPLY_STEPS : isLocal || !project.avatar?.heygenAvatarId ? LOCAL_STEPS : AVATAR_STEPS;
  const active = currentStep(steps, mine ? render?.lastLine : null, project.status);
  const pct = Math.round(((active + 0.5) / steps.length) * 100);

  return (
    <div className="m-auto w-full max-w-lg p-6 text-white animate-fade-in" role="status" aria-live="polite">
      <div className="rounded-xl border border-white/10 bg-stage-raised p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{project.status === "generating" ? "Generating your video" : "Rendering your video"}</h2>
            <p className="mt-1 text-sm text-white/60">
              {isLocal ? "Local previews usually take about a minute." : project.avatar?.heygenAvatarId ? "Avatar videos usually take 2–5 minutes." : "This usually takes a minute or two."}
              {" "}You can keep working on other projects.
            </p>
          </div>
          {mine && render?.startedAt && (
            <span className="tabular shrink-0 rounded-md bg-white/10 px-2 py-1 text-sm font-medium">{elapsed(render.startedAt, now)}</span>
          )}
        </div>

        <ol className="mt-6 flex items-center" aria-label="Render steps">
          {steps.map((step, i) => {
            const state = i < active ? "done" : i === active ? "active" : "todo";
            return (
              <li key={step.id} className="flex flex-1 items-center last:flex-none" aria-current={state === "active" ? "step" : undefined}>
                <div className="flex flex-col items-center gap-1.5">
                  <span className={cn(
                    "grid size-7 place-items-center rounded-full text-xs font-semibold transition-colors",
                    state === "done" && "bg-accent text-accent-fg",
                    state === "active" && "bg-white text-stage ring-4 ring-white/15",
                    state === "todo" && "bg-white/10 text-white/50",
                  )}>
                    {state === "done" ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn("text-xs", state === "todo" ? "text-white/40" : "text-white/85")}>{step.label}</span>
                </div>
                {i < steps.length - 1 && <span className={cn("mx-2 mb-5 h-px flex-1", i < active ? "bg-accent" : "bg-white/15")} />}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="relative h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }}>
            <div className="absolute inset-0 overflow-hidden"><div className="h-full w-1/3 bg-white/30 animate-indeterminate" /></div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-mono text-xs text-white/50" title={mine ? render?.lastLine ?? undefined : undefined}>
            {mine ? render?.lastLine || "Starting…" : render?.rendering ? "Waiting for the render slot…" : "Finishing up…"}
          </p>
          <StopButton />
        </div>
      </div>
    </div>
  );
}
