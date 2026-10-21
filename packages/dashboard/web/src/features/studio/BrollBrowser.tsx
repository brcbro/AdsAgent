import { useMemo, useRef, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, Clapperboard, FolderOpen, Pin, PinOff } from "lucide-react";
import { clipTitle, cn } from "@/lib/format";
import { useBroll } from "@/lib/queries";
import type { BrollClip } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Chip, EmptyState, KeyValue, SearchInput, Skeleton } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/tooltip";

/** Per-project clip choices; when given, cards can be pinned or excluded. */
export interface ClipChoices {
  pinned: string[];
  excluded: string[];
  /** Set one clip's state; implemented against the latest saved lists so rapid clicks never drop a choice. */
  setState: (file: string, next: ClipState) => void;
}

export type ClipState = "pinned" | "excluded" | null;
type Filter = "" | "@pinned" | "@excluded";

function stateOf(choices: ClipChoices | undefined, file: string): ClipState {
  if (choices?.pinned.includes(file)) return "pinned";
  if (choices?.excluded.includes(file)) return "excluded";
  return null;
}

/** Pinning removes an exclusion and vice versa; null clears both. */
export function applyClipState(lists: { pinned: string[]; excluded: string[] }, file: string, next: ClipState) {
  const pinned = lists.pinned.filter((f) => f !== file);
  const excluded = lists.excluded.filter((f) => f !== file);
  if (next === "pinned") pinned.push(file);
  if (next === "excluded") excluded.push(file);
  return { pinned, excluded };
}

function setClipState(choices: ClipChoices, file: string, next: ClipState) {
  choices.setState(file, next);
}

/** Searchable B-roll grid with hover-to-play cards and a full preview dialog. */
export function BrollBrowser({ compact, choices }: { compact?: boolean; choices?: ClipChoices }) {
  const broll = useBroll();
  const clips = broll.data ?? [];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const counts = useMemo(() => clips.reduce<Record<string, number>>((all, c) => ({ ...all, [c.category]: (all[c.category] ?? 0) + 1 }), {}), [clips]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const byCategory = (c: BrollClip) => {
      const filter = category as Filter | string;
      if (filter === "@pinned") return stateOf(choices, c.file) === "pinned";
      if (filter === "@excluded") return stateOf(choices, c.file) === "excluded";
      return !filter || c.category === filter;
    };
    return clips.filter((c) => byCategory(c) && (!q || [clipTitle(c.name), c.category, ...(c.tags ?? [])].join(" ").toLowerCase().includes(q)));
  }, [clips, query, category, choices]);

  if (broll.isPending) {
    return <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]")}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-video" />)}</div>;
  }
  if (!clips.length) {
    return (
      <EmptyState
        icon={<FolderOpen />}
        title="No B-roll clips yet"
        description={<>Copy MP4, MOV or WebM clips into <code className="font-mono">data/broll/clips/&lt;Category&gt;/</code>, then run <code className="font-mono">pnpm broll-catalog</code>.</>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className={cn("flex gap-2", compact ? "flex-col" : "flex-col sm:flex-row sm:items-center")}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search clips and tags" className={compact ? undefined : "sm:w-72"} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter clips">
          <Chip active={!category} onClick={() => setCategory("")} count={clips.length}>All</Chip>
          {choices && <Chip active={category === "@pinned"} onClick={() => setCategory(category === "@pinned" ? "" : "@pinned")} count={choices.pinned.length}>Pinned</Chip>}
          {choices && <Chip active={category === "@excluded"} onClick={() => setCategory(category === "@excluded" ? "" : "@excluded")} count={choices.excluded.length}>Excluded</Chip>}
          {Object.entries(counts).map(([name, n]) => (
            <Chip key={name} active={category === name} onClick={() => setCategory(category === name ? "" : name)} count={n}>{name}</Chip>
          ))}
        </div>
      </div>
      <p className="text-xs text-fg-muted" aria-live="polite">
        {filtered.length} clips · hover to play{choices ? ", pin to always use, exclude to never use" : ", click for details"}
      </p>
      {filtered.length ? (
        <ul className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3")}>
          {filtered.map((clip, i) => (
            <li key={clip.file} className="[content-visibility:auto] [contain-intrinsic-size:auto_160px]">
              <ClipCard clip={clip} choices={choices} onOpen={() => setOpenIndex(i)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-fg-muted">No clips match. Try another search or filter.</p>
      )}
      <ClipPreviewDialog clips={filtered} index={openIndex} onIndexChange={setOpenIndex} choices={choices} />
    </div>
  );
}

function ClipCard({ clip, onOpen, choices }: { clip: BrollClip; onOpen: () => void; choices?: ClipChoices }) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const title = clipTitle(clip.name);
  const state = stateOf(choices, clip.file);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-surface transition-all duration-150 hover:shadow-md",
        state === "pinned" ? "border-accent ring-2 ring-accent/20" : "border-line hover:border-line-strong",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); video.current?.pause(); }}
    >
      <button
        type="button"
        onClick={onOpen}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="block w-full text-left"
        aria-label={`Preview ${title}${state ? ` (${state})` : ""}`}
      >
        <div className={cn("relative aspect-video overflow-hidden bg-stage", state === "excluded" && "opacity-40 grayscale")}>
          {clip.previewUrl
            ? <img src={clip.previewUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            : <Clapperboard className="m-auto size-5 text-white/40" />}
          {hover && clip.clipUrl && state !== "excluded" && (
            <video ref={video} src={clip.clipUrl} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover animate-fade-in" aria-hidden />
          )}
          <Badge className="absolute top-1.5 left-1.5 border-transparent bg-black/60 text-white">{clip.category}</Badge>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={title}>{title}</span>
          {state === "pinned" && <Badge tone="accent"><Pin className="size-3" /> Pinned</Badge>}
          {state === "excluded" && <Badge tone="danger"><Ban className="size-3" /> Excluded</Badge>}
        </div>
      </button>
      {choices && (
        <div className={cn("absolute top-1.5 right-1.5 flex gap-1 transition-opacity", state ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <Tip content={state === "pinned" ? "Unpin" : "Pin — always use this clip"}>
            <button type="button" aria-pressed={state === "pinned"} aria-label={state === "pinned" ? `Unpin ${title}` : `Pin ${title}`}
              onClick={() => setClipState(choices, clip.file, state === "pinned" ? null : "pinned")}
              className={cn("grid size-7 place-items-center rounded-md shadow-sm", state === "pinned" ? "bg-accent text-accent-fg" : "bg-surface/90 text-fg hover:bg-surface")}>
              {state === "pinned" ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          </Tip>
          <Tip content={state === "excluded" ? "Allow this clip again" : "Exclude — never use this clip"}>
            <button type="button" aria-pressed={state === "excluded"} aria-label={state === "excluded" ? `Allow ${title}` : `Exclude ${title}`}
              onClick={() => setClipState(choices, clip.file, state === "excluded" ? null : "excluded")}
              className={cn("grid size-7 place-items-center rounded-md shadow-sm", state === "excluded" ? "bg-danger text-danger-fg" : "bg-surface/90 text-fg hover:bg-surface")}>
              <Ban className="size-3.5" />
            </button>
          </Tip>
        </div>
      )}
    </div>
  );
}

function ClipPreviewDialog({ clips, index, onIndexChange, choices }:
  { clips: BrollClip[]; index: number | null; onIndexChange: (i: number | null) => void; choices?: ClipChoices }) {
  const clip = index !== null ? clips[index] : undefined;
  const go = (delta: number) => { if (index !== null) onIndexChange((index + delta + clips.length) % clips.length); };
  const state = clip ? stateOf(choices, clip.file) : null;
  return (
    <Dialog
      open={!!clip}
      onOpenChange={(o) => { if (!o) onIndexChange(null); }}
      title={clip ? clipTitle(clip.name) : ""}
      description={clip ? `${clip.category} · ${index! + 1} of ${clips.length}` : undefined}
      size="lg"
      footer={<>
        {choices && clip && (
          <div className="mr-auto flex gap-2">
            <Button variant={state === "pinned" ? "primary" : "secondary"} aria-pressed={state === "pinned"}
              onClick={() => setClipState(choices, clip.file, state === "pinned" ? null : "pinned")}>
              <Pin /> {state === "pinned" ? "Pinned" : "Pin to project"}
            </Button>
            <Button variant={state === "excluded" ? "danger" : "secondary"} aria-pressed={state === "excluded"}
              onClick={() => setClipState(choices, clip.file, state === "excluded" ? null : "excluded")}>
              <Ban /> {state === "excluded" ? "Excluded" : "Exclude"}
            </Button>
          </div>
        )}
        <Button variant="secondary" onClick={() => go(-1)} disabled={clips.length < 2}><ChevronLeft /> Previous</Button>
        <Button variant="secondary" onClick={() => go(1)} disabled={clips.length < 2}>Next <ChevronRight /></Button>
      </>}
    >
      {clip && (
        <div
          className="grid gap-4 md:grid-cols-[1fr_220px]"
          onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }}
        >
          <div className="grid max-h-[60vh] place-items-center overflow-hidden rounded-lg bg-stage">
            {clip.clipUrl
              ? <video key={clip.file} src={clip.clipUrl} controls autoPlay muted playsInline className="max-h-[60vh] w-full" />
              : <p className="p-8 text-sm text-white/60">This clip is outside the data folder and can't be previewed.</p>}
          </div>
          <div className="space-y-3">
            <KeyValue items={[
              { label: "Category", value: clip.category },
              { label: "Source", value: clip.sourceFolder ?? "—" },
              { label: "File", value: <span title={clip.name}>{clip.name}</span> },
            ]} />
            {!!clip.tags?.length && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-fg-muted">Tags</div>
                <div className="flex flex-wrap gap-1">{clip.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
              </div>
            )}
            <p className="text-xs text-fg-muted">Use ← → to browse clips.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
