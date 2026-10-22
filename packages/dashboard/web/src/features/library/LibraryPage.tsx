import { useEffect, useRef, useState, type DragEvent } from "react";
import { NavLink, Navigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, ChevronRight, Film, Music, Plus, Sparkles, UserRound } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { keys, useAvatars, useBroll, useBrollIngest, useMusic } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, SearchInput, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { BROLL_CATEGORIES, BrollBrowser, categoryOptions } from "../studio/BrollBrowser";
import { AddClipsDialog, isVideoFile } from "./AddClipsDialog";
import { TrackRow, useTrackPreview } from "../studio/panels/AudioPanel";
import { AvatarImage } from "../studio/AvatarPickerDialog";

const TABS = [
  { id: "broll", label: "B-roll", icon: Film },
  { id: "music", label: "Music", icon: Music },
  { id: "avatars", label: "Avatars", icon: UserRound },
] as const;

export default function LibraryPage() {
  const { tab } = useParams();
  const broll = useBroll().data;
  const music = useMusic().data;
  if (!TABS.some((t) => t.id === tab)) return <Navigate to="/library/broll" replace />;

  const counts: Record<string, number | undefined> = { broll: broll?.length, music: music?.filter((t) => t.available).length };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Library</h1>
          <p className="mt-1 text-sm text-fg-muted">Footage, music and presenters available to every project.</p>
        </header>
        <nav aria-label="Library sections" className="mb-6 flex gap-1 border-b border-line">
          {TABS.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={`/library/${id}`} className={({ isActive }) => cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
              isActive ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}>
              <Icon className="size-4" aria-hidden /> {label}
              {counts[id] !== undefined && <Badge>{counts[id]}</Badge>}
            </NavLink>
          ))}
        </nav>
        {tab === "broll" && <BrollLibrary />}
        {tab === "music" && <MusicLibrary />}
        {tab === "avatars" && <AvatarLibrary />}
      </div>
    </div>
  );
}

/** B-roll tab: the browser plus Add clips, Classify unclassified and the live classifier status. Dropping files anywhere here opens the dialog. */
function BrollLibrary() {
  const queryClient = useQueryClient();
  const broll = useBroll();
  const ingest = useBrollIngest();
  const [addOpen, setAddOpen] = useState(false);
  const [dropped, setDropped] = useState<File[] | undefined>();
  const [dragging, setDragging] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const dragDepth = useRef(0);
  const state = ingest.data;
  const fromCatalog = categoryOptions(broll.data ?? []);
  const categories = state?.categories?.length ? state.categories : fromCatalog.length ? fromCatalog : BROLL_CATEGORIES;
  const pending = (broll.data ?? []).filter((c) => c.pending).length;
  const needsReview = (broll.data ?? []).filter((c) => c.needsReview && !c.pending).length;

  // While the classifier works, clips move from the inbox into their folders: keep the grid in step.
  const progress = `${state?.running}-${state?.done}-${state?.lastRunAt}`;
  useEffect(() => { void queryClient.invalidateQueries({ queryKey: keys.broll }); }, [progress, queryClient]);

  const onDragEnter = (e: DragEvent) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault(); dragDepth.current = 0; setDragging(false);
    const files = [...e.dataTransfer.files].filter(isVideoFile);
    if (!files.length) { toast.error("Drop MP4, MOV or WebM clips"); return; }
    setDropped(files); setAddOpen(true);
  };
  const classifyNow = async () => {
    setTriggering(true);
    try { await api.runBrollIngest(); void queryClient.invalidateQueries({ queryKey: keys.brollIngest }); toast.success("Classification started"); }
    catch (err) { toast.error("Couldn't start the classifier", { description: errorMessage(err) }); }
    finally { setTriggering(false); }
  };
  const lastError = state?.errors?.[state.errors.length - 1];
  const errorCount = state?.errors?.length ?? 0;

  return (
    <div className={cn("relative space-y-4 rounded-lg transition-shadow", dragging && "ring-2 ring-accent ring-offset-4 ring-offset-bg")}
      onDragEnter={onDragEnter} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => { setDropped(undefined); setAddOpen(true); }}><Plus /> Add clips</Button>
        <Button variant="secondary" size="sm" onClick={classifyNow} disabled={triggering || !!state?.running} loading={triggering}><Sparkles /> Classify unclassified</Button>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-fg-muted" aria-live="polite" data-testid="broll-ingest-status">
          {state?.running ? (
            <><Spinner className="size-3.5" /> <span className="truncate">{state.paused ? "Paused while a render runs" : `Classifying ${Math.min(state.done + 1, Math.max(state.total, 1))} of ${state.total}`}{state.current ? ` · ${state.current}` : ""}</span></>
          ) : pending > 0 ? (
            <span>{pending} clip{pending === 1 ? "" : "s"} waiting for the classifier</span>
          ) : state?.lastResult ? (
            <span className="truncate" title={state.lastRunAt}>Last run: {state.lastResult}</span>
          ) : null}
          {needsReview > 0 && <Badge tone="warning">{needsReview} to review</Badge>}
        </div>
      </div>
      {lastError && !state?.running && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{errorCount} clip{errorCount === 1 ? "" : "s"} could not be classified and {errorCount === 1 ? "stays" : "stay"} in the inbox.</p>
            <p className="truncate text-xs"><span className="font-mono">{lastError.file.split(/[\\/]/).pop()}</span> — {lastError.message}</p>
          </div>
        </div>
      )}
      <BrollBrowser />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-accent-subtle/80">
          <p className="rounded-md bg-surface px-4 py-2 text-sm font-medium text-accent shadow-md">Drop clips to add them to the library</p>
        </div>
      )}
      <AddClipsDialog open={addOpen} onOpenChange={setAddOpen} categories={categories} initialFiles={dropped} />
    </div>
  );
}

function MusicLibrary() {
  const music = useMusic();
  const preview = useTrackPreview(0.6);
  if (music.isPending) return <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  const tracks = music.data ?? [];
  const missing = tracks.filter((t) => !t.available).length;
  return (
    <div className="max-w-2xl space-y-3">
      {missing > 0 && (
        <div className="rounded-lg border border-warning/25 bg-warning-subtle p-3 text-sm text-warning">
          {missing} track{missing === 1 ? " is" : "s are"} not downloaded yet. Run <code className="font-mono">pnpm music-sync</code> in the project folder.
        </div>
      )}
      {tracks.map((t) => <TrackRow key={t.file} track={t} playing={preview.playing === t.file} progress={preview.progress} onSeek={preview.seek} onTogglePlay={() => preview.toggle(t)} />)}
    </div>
  );
}

function AvatarLibrary() {
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState<"any" | "female" | "male">("any");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 250);
  const avatars = useAvatars({ page, q, gender: gender === "any" ? undefined : gender });
  const data = avatars.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search avatars" className="w-72" />
        <Segmented label="Gender" size="sm" value={gender} onChange={(v) => { setGender(v); setPage(1); }}
          options={[{ value: "any", label: "Any" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
        {data && <span className="tabular ml-auto text-sm text-fg-muted">{data.total} avatars</span>}
      </div>
      {avatars.isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">{Array.from({ length: 18 }, (_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
      ) : !data?.avatars.length ? (
        <EmptyState icon={<UserRound />} title="No avatars found" description="Try another search. Run pnpm avatars to refresh the HeyGen catalog." />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {data.avatars.map((a) => (
            <li key={a.avatar_id} className="group overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
              <div className="aspect-[3/4] overflow-hidden bg-subtle"><AvatarImage src={a.preview_image_url} /></div>
              <div className="px-2.5 py-2">
                <div className="truncate text-sm font-medium text-fg" title={a.avatar_name}>{a.avatar_name}</div>
                {a.gender && <div className="text-xs text-fg-muted capitalize">{a.gender}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /> Previous</Button>
          <span className="tabular text-sm text-fg-muted">Page {data.page} of {data.pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}
