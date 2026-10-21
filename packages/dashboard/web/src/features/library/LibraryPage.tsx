import { useState } from "react";
import { NavLink, Navigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Film, Music, UserRound } from "lucide-react";
import { cn } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useAvatars, useBroll, useMusic } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, SearchInput, Segmented, Skeleton } from "@/components/ui/primitives";
import { BrollBrowser } from "../studio/BrollBrowser";
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
        {tab === "broll" && <BrollBrowser />}
        {tab === "music" && <MusicLibrary />}
        {tab === "avatars" && <AvatarLibrary />}
      </div>
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
