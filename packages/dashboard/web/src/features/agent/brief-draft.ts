import { setPrefs } from "@/lib/prefs";

export const BRIEF_INPUT_ID = "agent-brief";
export const BRIEF_MAX = 4000;

/** The unsent brief of one chat lives in prefs, so it survives switching chats and reloading the page. */
export function setBriefDraft(sessionId: string, v: string | ((t: string) => string)) {
  setPrefs((p) => {
    const current = p.agentDrafts[sessionId] ?? "";
    const value = (typeof v === "function" ? v(current) : v).slice(0, BRIEF_MAX);
    const next = { ...p.agentDrafts };
    if (value) next[sessionId] = value; else delete next[sessionId];
    return { agentDrafts: next };
  });
}

/** Adds a line under whatever is already typed. */
export const appendToBrief = (sessionId: string, line: string) =>
  setBriefDraft(sessionId, (t) => (t.trim() ? `${t.trimEnd()}\n${line}` : line));

export const focusBrief = () => document.getElementById(BRIEF_INPUT_ID)?.focus();
