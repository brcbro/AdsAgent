import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ListTodo, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn, relativeTime } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";
import { usePref } from "@/lib/prefs";
import { keys, useAgentState } from "@/lib/queries";
import type { AgentState } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, EmptyState, SearchInput, Skeleton } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { Menu, RightClickMenu, type MenuEntry } from "@/components/ui/menu";
import { ChatThread } from "./ChatThread";
import { Composer } from "./Composer";
import { JobQueue } from "./JobQueue";
import { ScriptReviewPanel } from "./ScriptReviewPanel";

export default function AgentPage() {
  const { sessionId: routeId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = useAgentState(true);
  const [savedId, setSavedId] = usePref("agentSessionId");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<"chats" | "queue" | null>(null);
  const wide = useMediaQuery("(min-width: 1280px)");
  const creating = useRef(false);

  const sessions = state.data?.sessions ?? [];
  const sessionId = routeId ?? (savedId && sessions.some((s) => s.id === savedId) ? savedId : sessions[0]?.id);
  const session = sessions.find((s) => s.id === sessionId);

  useEffect(() => { if (sessionId && sessionId !== savedId) setSavedId(sessionId); }, [sessionId, savedId, setSavedId]);
  useEffect(() => { if (!routeId && sessionId) navigate(`/agent/${sessionId}${location.search}`, { replace: true }); }, [routeId, sessionId, navigate]);
  useEffect(() => setPanel(null), [sessionId]);

  async function newChat() {
    try {
      const s = await api.newSession();
      client.setQueryData<AgentState>(keys.agent, (prev) => prev ? { ...prev, sessions: [s, ...prev.sessions] } : prev);
      navigate(`/agent/${s.id}`);
    } catch (err) {
      toast.error("Couldn't start a new chat", { description: errorMessage(err) });
    }
  }

  // First visit: make sure there is a conversation to type into.
  useEffect(() => {
    if (state.isSuccess && !sessions.length && !creating.current) {
      creating.current = true;
      void newChat().finally(() => { creating.current = false; });
    }
  // newChat is recreated each render; this should only fire when the list becomes empty.
  }, [state.isSuccess, sessions.length]);

  const jobs = state.data?.jobs ?? [];
  const sessionJobs = useMemo(() => jobs.filter((j) => j.sessionId === sessionId), [jobs, sessionId]);
  const reviewJob = sessionJobs.find((j) => j.status === "script_review");
  const busy = sessionJobs.some((j) => j.status === "queued" || j.status === "running");

  const conversations = <ConversationList sessions={sessions} jobs={jobs} activeId={sessionId} onNew={newChat} loading={state.isPending} />;
  const queue = <JobQueue jobs={jobs} sessionId={sessionId} liveSessions={sessions} edits={edits} setEdits={setEdits} workerRunning={!!state.data?.workerRunning} />;

  return (
    <div className="flex h-full min-h-0">
      {wide ? conversations : panel === "chats" && <Drawer side="left" onClose={() => setPanel(null)}>{conversations}</Drawer>}

      <section className="flex min-w-0 flex-1 flex-col bg-bg" aria-label="Conversation">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
          {!wide && <IconButton label="Conversations" size="icon-sm" onClick={() => setPanel("chats")}><MessagesSquare /></IconButton>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-fg">{session?.title || "New conversation"}</h1>
            {session && <p className="text-xs text-fg-muted">Started {relativeTime(session.createdAt)} · {session.messages.length} messages</p>}
          </div>
          {busy && <Badge tone="accent" dot pulse>Working</Badge>}
          {!wide && (
            <Button size="sm" variant="secondary" onClick={() => setPanel("queue")}>
              <ListTodo /> Queue {jobs.filter((j) => j.status === "queued" || j.status === "running").length > 0 && <Badge tone="accent">{jobs.filter((j) => j.status === "queued" || j.status === "running").length}</Badge>}
            </Button>
          )}
        </div>

        {state.isSuccess && routeId && !session ? (
          <EmptyState
            className="flex-1"
            icon={<MessageSquareOff />}
            title="This chat isn't available"
            description="It was archived or the link is out of date. Its jobs and videos are still in the queue history."
            action={<Button variant="primary" onClick={() => navigate("/agent")}>Open latest chat</Button>}
          />
        ) : state.isPending ? (
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6"><Skeleton className="h-20 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /><Skeleton className="h-24 w-3/4" /></div>
        ) : (
          <ChatThread session={session} jobs={sessionJobs} busy={busy} />
        )}

        {reviewJob && <ScriptReviewPanel job={reviewJob} edits={edits} setEdits={setEdits} />}
        {session && <Composer sessionId={session.id} busy={busy} hasMessages={!!session?.messages.length} />}
      </section>

      {wide ? queue : panel === "queue" && <Drawer side="right" onClose={() => setPanel(null)}>{queue}</Drawer>}
    </div>
  );
}

function Drawer({ side, onClose, children }: { side: "left" | "right"; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 top-14 z-40 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-overlay/30 animate-fade-in" onClick={onClose} />
      <div className={cn("relative h-full max-w-[90vw] shadow-lg animate-fade-in", side === "right" && "ml-auto")}>{children}</div>
    </div>
  );
}

function ConversationList({ sessions, jobs, activeId, onNew, loading }: {
  sessions: AgentState["sessions"]; jobs: AgentState["jobs"]; activeId?: string; onNew: () => void; loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = sessions.filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.title.toLowerCase().includes(q) || s.messages.some((m) => m.text.toLowerCase().includes(q));
  });
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface" aria-label="Conversations">
      <div className="space-y-3 border-b border-line p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Conversations <span className="tabular ml-1 font-normal text-fg-muted">{sessions.length}</span></h2>
        </div>
        <Button variant="primary" className="w-full" onClick={onNew}><Plus /> New chat</Button>
        <SearchInput value={query} onChange={setQuery} placeholder="Search conversations" />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mb-2 h-14" />)}
        {!loading && !filtered.length && <p className="px-3 py-8 text-center text-sm text-fg-muted">No conversations match.</p>}
        <ul className="space-y-0.5">
          {filtered.map((s) => (
            <ConversationRow key={s.id} session={s} jobs={jobs} active={s.id === activeId} sessions={sessions} />
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function ConversationRow({ session: s, jobs, active, sessions }: {
  session: AgentState["sessions"][number]; jobs: AgentState["jobs"]; active: boolean; sessions: AgentState["sessions"];
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const running = jobs.some((j) => j.sessionId === s.id && (j.status === "queued" || j.status === "running"));
  const review = jobs.some((j) => j.sessionId === s.id && j.status === "script_review");
  const last = s.messages[s.messages.length - 1];

  async function rename(title: string) {
    setRenaming(false);
    if (!title.trim() || title.trim() === s.title) return;
    try {
      const saved = await api.renameSession(s.id, title);
      client.setQueryData<AgentState>(keys.agent, (prev) => prev && { ...prev, sessions: prev.sessions.map((x) => (x.id === s.id ? saved : x)) });
    } catch (err) {
      toast.error("Couldn't rename the chat", { description: errorMessage(err) });
    }
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive "${s.title || "this chat"}"?`,
      description: "The chat disappears from the list. Its jobs, videos and approvals stay in the queue history and the Studio.",
      confirmLabel: "Archive chat",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.archiveSession(s.id);
      client.setQueryData<AgentState>(keys.agent, (prev) => prev && { ...prev, sessions: prev.sessions.filter((x) => x.id !== s.id) });
      toast.success("Chat archived");
      if (active) {
        const next = sessions.find((x) => x.id !== s.id);
        navigate(next ? `/agent/${next.id}` : "/agent");
      }
    } catch (err) {
      toast.error("Couldn't archive the chat", { description: errorMessage(err) });
    }
  }

  const items: MenuEntry[] = [
    { label: "Rename", icon: <Pencil />, onSelect: () => setRenaming(true), keepFocus: true },
    {
      label: "Archive", icon: <Archive />, onSelect: archive, danger: true, disabled: running || review, separatorBefore: true,
      description: running || review ? "Finish or cancel the active job first" : undefined,
    },
  ];

  return (
    <RightClickMenu items={items}>
      <li className={cn("group relative rounded-lg transition-colors", active ? "bg-accent-subtle" : "hover:bg-subtle")}>
        {renaming ? (
          <div className="px-2 py-2">
            <input
              autoFocus
              defaultValue={s.title}
              maxLength={120}
              aria-label="Chat name"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => void rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { e.currentTarget.value = s.title; e.currentTarget.blur(); }
              }}
              className="h-8 w-full rounded-md border border-accent bg-surface px-2 text-sm text-fg ring-3 ring-accent/15 outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate(`/agent/${s.id}`)}
            onDoubleClick={() => setRenaming(true)}
            aria-current={active ? "page" : undefined}
            className="w-full px-3 py-2.5 pr-9 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.title || "New conversation"}</span>
              {running && <span className="size-2 shrink-0 rounded-full bg-accent animate-pulse-soft" aria-label="Working" />}
              {review && <Badge tone="warning">Review</Badge>}
            </div>
            <div className="mt-0.5 flex gap-1.5 text-xs text-fg-muted">
              <span className="min-w-0 flex-1 truncate">{last ? last.text : "No messages yet"}</span>
              <span className="shrink-0">{relativeTime(last?.at ?? s.createdAt)}</span>
            </div>
          </button>
        )}
        {!renaming && (
          <div className={cn("absolute top-2 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", active && "opacity-100")}>
            <Menu trigger={<IconButton label="Chat actions" size="icon-sm" tooltip={false}><MoreHorizontal /></IconButton>} items={items} />
          </div>
        )}
      </li>
    </RightClickMenu>
  );
}
