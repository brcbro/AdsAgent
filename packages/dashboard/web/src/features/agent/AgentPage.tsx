import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog as D, Popover } from "radix-ui";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronDown, ListTodo, MessageSquareOff, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn, dateTime, relativeTime } from "@/lib/format";
import { useDebounced, useHotkeys } from "@/lib/hooks";
import { usePref } from "@/lib/prefs";
import { keys, useAgentSession, useAgentState, useArchivedSessions, useSessionSearch } from "@/lib/queries";
import type { AgentJob, AgentSessionSummary, AgentState } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { Badge, EmptyState, SearchInput, Skeleton } from "@/components/ui/primitives";
import { Menu, RightClickMenu, type MenuEntry } from "@/components/ui/menu";
import { ChatThread } from "./ChatThread";
import { BRIEF_INPUT_ID, Composer } from "./Composer";
import { JobQueue } from "./JobQueue";
import { ScriptReviewPanel } from "./ScriptReviewPanel";

const isActive = (j: AgentJob) => j.status === "queued" || j.status === "running";

export default function AgentPage() {
  const { sessionId: routeId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = useAgentState();
  const [savedId, setSavedId] = usePref("agentSessionId");
  // The chat list (a dropdown under the title) and the Jobs panel open from the header at every width,
  // so the conversation keeps the whole width.
  const [chatsOpen, setChatsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const creating = useRef(false);

  const sessions = state.data?.sessions ?? [];
  const sessionId = routeId ?? (savedId && sessions.some((s) => s.id === savedId) ? savedId : sessions[0]?.id);
  const summary = sessions.find((s) => s.id === sessionId);

  const jobs = state.data?.jobs ?? [];
  const sessionJobs = useMemo(() => jobs.filter((j) => j.sessionId === sessionId), [jobs, sessionId]);
  const reviewJob = sessionJobs.find((j) => j.status === "script_review");
  const busy = sessionJobs.some(isActive);
  const detail = useAgentSession(summary ? sessionId : undefined, busy);
  const session = detail.data;

  useEffect(() => { if (sessionId && sessionId !== savedId) setSavedId(sessionId); }, [sessionId, savedId, setSavedId]);
  useEffect(() => { if (!routeId && sessionId) navigate(`/agent/${sessionId}${location.search}`, { replace: true }); }, [routeId, sessionId, navigate]);
  useEffect(() => { setChatsOpen(false); setJobsOpen(false); }, [sessionId]);

  async function newChat() {
    // The server hands back an existing empty chat instead of piling up blank ones.
    const empty = sessions.find((s) => s.messageCount === 0 && !jobs.some((j) => j.sessionId === s.id && (isActive(j) || j.status === "script_review")));
    if (empty) { navigate(`/agent/${empty.id}`); return; }
    try {
      const s = await api.newSession();
      client.setQueryData<AgentState>(keys.agent, (prev) => prev && !prev.sessions.some((x) => x.id === s.id)
        ? { ...prev, sessions: [{ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.createdAt, messageCount: 0 }, ...prev.sessions] } : prev);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isSuccess, sessions.length]);

  useHotkeys({
    "alt+c": () => void newChat(),
    "/": () => document.getElementById(BRIEF_INPUT_ID)?.focus(),
  });

  const activeCount = jobs.filter(isActive).length;
  // Another chat is working or waiting for a script review: the title button shows a dot so it is not missed.
  const elsewhere = jobs.some((j) => j.sessionId !== sessionId && (isActive(j) || j.status === "script_review"));
  const conversations = (
    <ConversationList sessions={sessions} jobs={jobs} activeId={sessionId} loading={state.isPending}
      onNew={() => { setChatsOpen(false); void newChat(); }}
      onOpenArchived={() => { setChatsOpen(false); setArchivedOpen(true); }} />
  );
  const queue = <JobQueue jobs={jobs} totalJobs={state.data?.totalJobs ?? jobs.length} sessionId={sessionId} liveSessions={sessions} workerRunning={!!state.data?.workerRunning} />;

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col bg-bg" aria-label="Conversation">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
          <Popover.Root open={chatsOpen} onOpenChange={setChatsOpen}>
            {/* The heading holds the button, so the title stays a real h1 and the button carries aria-expanded. */}
            <h1 className="min-w-0 flex-1">
              <Popover.Trigger asChild>
                <button type="button" title="Switch chat" className="flex max-w-full items-center gap-1.5 rounded-lg py-1 pr-2 pl-2 text-left transition-colors hover:bg-subtle data-[state=open]:bg-subtle">
                  <span className="truncate text-base font-semibold text-fg">{summary?.title || "New chat"}</span>
                  <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  {elsewhere && <span className="size-2 shrink-0 rounded-full bg-warning" title="Another chat needs attention" aria-hidden />}
                </button>
              </Popover.Trigger>
            </h1>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={4} aria-label="Chats"
                className="z-50 flex max-h-[min(72vh,34rem)] w-[min(94vw,24rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-fade-in">
                {conversations}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button size="sm" variant="ghost" aria-label="New chat" title="New chat (Alt+C)" onClick={() => void newChat()}>
            <Plus /> <span className="hidden sm:inline">New chat</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setJobsOpen(true)}>
            <ListTodo /> Jobs {activeCount > 0 && <Badge tone="accent" dot pulse>{activeCount}</Badge>}
          </Button>
        </div>

        {state.isSuccess && routeId && !summary ? (
          <EmptyState
            className="flex-1"
            icon={<MessageSquareOff />}
            title="This chat isn't available"
            description="It was archived or the link is out of date. Its jobs and videos are still in the queue history; archived chats can be restored from the chat list."
            action={<Button variant="primary" onClick={() => navigate("/agent")}>Open latest chat</Button>}
          />
        ) : state.isPending || (summary && detail.isPending) ? (
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6"><Skeleton className="h-20 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /><Skeleton className="h-24 w-3/4" /></div>
        ) : (
          <ChatThread session={session} jobs={sessionJobs} busy={busy} />
        )}

        {reviewJob && <ScriptReviewPanel job={reviewJob} />}
        {summary && <Composer sessionId={summary.id} busy={busy} hasMessages={summary.messageCount > 0} reviewPending={!!reviewJob} />}
      </section>

      <Drawer side="right" label="Jobs" open={jobsOpen} onOpenChange={setJobsOpen}>{queue}</Drawer>
      <ArchivedChatsDialog open={archivedOpen} onOpenChange={setArchivedOpen} />
    </div>
  );
}

/** Side sheet below the top bar. Radix supplies the focus trap, initial focus, Esc and focus return. */
function Drawer({ side, label, open, onOpenChange, children }:
  { side: "left" | "right"; label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 top-14 z-40 bg-overlay/30 data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn("fixed top-14 bottom-0 z-40 flex max-w-[90vw] shadow-lg outline-none data-[state=open]:animate-fade-in", side === "left" ? "left-0" : "right-0")}
          // Focus a plain field or button rather than an icon button, whose tooltip would otherwise open and take the first Escape.
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label])")?.focus(); }}
        >
          <D.Title className="sr-only">{label}</D.Title>
          <D.Description className="sr-only">{label} panel</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The body of the chat dropdown: search, New chat, the list, and a button for archived chats. */
function ConversationList({ sessions, jobs, activeId, onNew, onOpenArchived, loading }: {
  sessions: AgentSessionSummary[]; jobs: AgentJob[]; activeId?: string; onNew: () => void; onOpenArchived: () => void; loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // Titles and previews match instantly; the server searches full message histories.
  const remote = useSessionSearch(useDebounced(query, 250));
  const filtered = sessions.filter((s) => !q || s.title.toLowerCase().includes(q) || s.lastMessage?.text.toLowerCase().includes(q) || remote.data?.ids.includes(s.id));
  return (
    <>
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <SearchInput value={query} onChange={setQuery} placeholder="Search chats" className="min-w-0 flex-1" />
          <IconButton label="Archived chats" size="icon-sm" onClick={onOpenArchived}><Archive /></IconButton>
        </div>
        <Button variant="secondary" className="w-full" onClick={onNew}><Plus /> New chat</Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Chats">
        {loading && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mb-2 h-14" />)}
        {!loading && !filtered.length && <p className="px-3 py-8 text-center text-sm text-fg-muted">{q ? "No chats match." : "No chats yet."}</p>}
        <ul className="space-y-0.5">
          {filtered.map((s) => (
            <ConversationRow key={s.id} session={s} jobs={jobs} active={s.id === activeId} sessions={sessions} />
          ))}
        </ul>
      </nav>
    </>
  );
}

function ArchivedChatsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const archived = useArchivedSessions(open);
  const [pending, setPending] = useState<string | null>(null);
  async function restore(s: AgentSessionSummary) {
    setPending(s.id);
    try {
      await api.unarchiveSession(s.id);
      await Promise.all([client.invalidateQueries({ queryKey: keys.agent }), client.invalidateQueries({ queryKey: keys.agentArchived })]);
      toast.success("Chat restored");
      onOpenChange(false);
      navigate(`/agent/${s.id}`);
    } catch (err) {
      toast.error("Couldn't restore the chat", { description: errorMessage(err) });
    } finally {
      setPending(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Archived chats" description="Restoring a chat puts it back in the list with its full history.">
      {archived.isPending && <Skeleton className="h-14" />}
      {archived.isSuccess && !archived.data.length && <p className="py-6 text-center text-sm text-fg-muted">Nothing archived.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {archived.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{s.title}</div>
              <div className="truncate text-xs text-fg-muted">{s.messageCount} messages · archived {relativeTime(s.archivedAt)}</div>
            </div>
            <Button size="sm" variant="secondary" loading={pending === s.id} onClick={() => restore(s)}><ArchiveRestore /> Restore</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ConversationRow({ session: s, jobs, active, sessions }: {
  session: AgentSessionSummary; jobs: AgentJob[]; active: boolean; sessions: AgentSessionSummary[];
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const running = jobs.some((j) => j.sessionId === s.id && isActive(j));
  const review = jobs.some((j) => j.sessionId === s.id && j.status === "script_review");
  const last = s.lastMessage;

  async function rename(title: string) {
    setRenaming(false);
    if (!title.trim() || title.trim() === s.title) return;
    try {
      const saved = await api.renameSession(s.id, title);
      client.setQueryData<AgentState>(keys.agent, (prev) => prev && { ...prev, sessions: prev.sessions.map((x) => (x.id === s.id ? { ...x, title: saved.title, titleLocked: true } : x)) });
    } catch (err) {
      toast.error("Couldn't rename the chat", { description: errorMessage(err) });
    }
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive "${s.title || "this chat"}"?`,
      description: "The chat leaves the list; restore it any time from Archived chats. Its jobs, videos and approvals stay in the queue history and the Studio.",
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
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.title || "New chat"}</span>
              {running && <span className="size-2 shrink-0 rounded-full bg-accent animate-pulse-soft" aria-label="Working" />}
              {review && <Badge tone="warning">Review</Badge>}
            </div>
            <div className="mt-0.5 flex gap-1.5 text-xs text-fg-muted">
              <span className="min-w-0 flex-1 truncate">{last ? last.text : "No messages yet"}</span>
              <span className="shrink-0" title={dateTime(last?.at ?? s.createdAt)}>{relativeTime(last?.at ?? s.createdAt)}</span>
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
