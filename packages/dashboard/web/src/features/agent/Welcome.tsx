import { setPrefs } from "@/lib/prefs";
import { appendToBrief, focusBrief, setBriefDraft } from "./brief-draft";
import { Ideas } from "./Ideas";

const STARTERS: Array<{ title: string; note: string; seconds: "10" | "20" | "30" | "45"; brief: string }> = [
  { title: "Disciplined trading", note: "Calm, educational · 20 s", seconds: "20",
    brief: "Create a 20-second German video about disciplined trading. Calm and educational, end with an invitation to learn more." },
  { title: "FOMO for beginners", note: "Punchy hook · 30 s", seconds: "30",
    brief: "Write a punchy 30-second ad about FOMO in trading for beginners, with a strong hook in the first sentence." },
  { title: "Risk in three rules", note: "Explainer · 20 s", seconds: "20",
    brief: "Make a 20-second video explaining risk management in three simple rules." },
];

/** Empty chat: one question and three ways to start. The message box below does the rest. */
export function Welcome({ sessionId }: { sessionId?: string }) {
  function start(s: (typeof STARTERS)[number]) {
    if (!sessionId) return;
    setBriefDraft(sessionId, s.brief);
    // The card promises a length, so the length chip follows it.
    setPrefs((p) => ({ agentComposer: { ...p.agentComposer, duration: s.seconds } }));
    focusBrief();
  }
  return (
    <div className="mx-auto max-w-2xl py-12 text-center animate-fade-in">
      <h2 className="text-2xl font-semibold tracking-tight text-fg">What video do you want to make?</h2>
      <p className="mt-2 text-sm text-fg-muted">Pick a starting point, or describe your own below.</p>
      <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
        {STARTERS.map((s) => (
          <button key={s.title} type="button" onClick={() => start(s)}
            className="press rounded-xl border border-line bg-surface p-3.5 text-left shadow-xs transition-all duration-150 hover:border-line-strong hover:shadow-md">
            <div className="text-sm font-medium text-fg">{s.title}</div>
            <div className="mt-0.5 text-xs text-fg-muted">{s.note}</div>
          </button>
        ))}
      </div>
      {sessionId && (
        <div className="mt-4 flex justify-center">
          <Ideas label="Ideas from winning ads" onPick={(line) => { appendToBrief(sessionId, line); focusBrief(); }} />
        </div>
      )}
    </div>
  );
}
