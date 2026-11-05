import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Star, UserRound, UserX } from "lucide-react";
import { cn } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { usePrefs, type SavedAvatar, type SavedVoice } from "@/lib/prefs";
import { useAvatars, useAvatarVoice } from "@/lib/queries";
import type { AvatarConfig, HeyGenAvatar } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Chip, EmptyState, SearchInput, Segmented, Skeleton } from "@/components/ui/primitives";
import { useStudio } from "./studio-context";
import { AvatarVoicePanel } from "./AvatarVoice";

type View = "mine" | "library" | "favorites" | "recent";
type Gender = "any" | "female" | "male";

export function toSaved(a: HeyGenAvatar): SavedAvatar {
  return { id: a.avatar_id, name: a.avatar_name, image: a.preview_image_url, gender: a.gender,
    ownership: a.ownership, defaultVoiceId: a.default_voice_id };
}

/**
 * Presenter for a HeyGen avatar video: your own avatars or HeyGen's library. The voice follows the
 * avatar automatically (all its looks share one voice); a different voice is optional.
 */
export function AvatarPickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { draft } = useStudio();
  const [prefs, setPrefs] = usePrefs();
  const current = draft.draft?.avatar;
  const [selection, setSelection] = useState<SavedAvatar | null>(null);
  const [voice, setVoice] = useState<SavedVoice | null>(null);
  const [view, setView] = useState<View>("mine");
  const [gender, setGender] = useState<Gender>("any");
  const [portrait, setPortrait] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 250);

  useEffect(() => {
    if (!open) return;
    setSelection(current?.heygenAvatarId ? { id: current.heygenAvatarId, name: current.name ?? "", image: current.previewImageUrl, gender: current.gender, ownership: current.ownership } : null);
    setVoice(current?.voiceId ? { id: current.voiceId, name: current.voiceName ?? current.voiceId, type: "private" } : null);
    setView(current?.ownership === "public" ? "library" : "mine");
    setPage(1);
  // Reset only when the dialog opens, not when the draft changes underneath it.
  }, [open]);
  useEffect(() => setPage(1), [q, gender, portrait, view]);

  const remote = view === "mine" || view === "library";
  const avatars = useAvatars({ page, q, portrait: view === "library" && portrait, gender: gender === "any" ? undefined : gender,
    ownership: view === "mine" ? "private" : "public" }, open && remote);
  const data = avatars.data;
  const autoVoice = useAvatarVoice(selection?.id);

  const list: SavedAvatar[] = remote
    ? (data?.avatars ?? []).map(toSaved)
    : (view === "favorites" ? prefs.favoriteAvatars : prefs.recentAvatars)
      .filter((a) => (gender === "any" || a.gender?.toLowerCase() === gender) && (!q || a.name.toLowerCase().includes(q.toLowerCase())));

  const isFav = (id: string) => prefs.favoriteAvatars.some((a) => a.id === id);
  const toggleFav = (a: SavedAvatar) => setPrefs((p) => ({
    favoriteAvatars: p.favoriteAvatars.some((x) => x.id === a.id) ? p.favoriteAvatars.filter((x) => x.id !== a.id) : [a, ...p.favoriteAvatars],
  }));

  function confirm() {
    if (selection && voice) {
      const g = selection.gender?.toLowerCase();
      const avatar: AvatarConfig = {
        heygenAvatarId: selection.id,
        name: selection.name,
        previewImageUrl: selection.image,
        gender: g === "female" || g === "male" ? g : undefined,
        ownership: selection.ownership,
        voiceId: voice.id,
        voiceName: voice.name,
      };
      // Avatar videos: presenter for the hook, B-roll for the body.
      draft.update({ avatar, avatarUntil: "hook", fullAvatar: false });
      setPrefs((p) => ({ recentAvatars: [selection, ...p.recentAvatars.filter((a) => a.id !== selection.id)].slice(0, 12) }));
    }
    onOpenChange(false);
  }

  function clear() {
    draft.update({ avatar: { heygenAvatarId: "", name: "" } });
    onOpenChange(false);
  }

  const voiceLoading = !!selection && autoVoice.isPending;
  const confirmLabel = !selection ? "Choose a presenter" : voiceLoading ? "Loading voice…" : !voice ? "Choose a voice" : `Use ${selection.name || "avatar"} · ${voice.name}`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Choose a presenter"
      description="Your own HeyGen avatars or the HeyGen library. The avatar's own voice is selected automatically; the presenter speaks the hook on screen, then B-roll takes over."
      bodyClassName="p-0"
      footer={<>
        {current?.heygenAvatarId && <Button variant="ghost" className="mr-auto" onClick={clear}><UserX /> No presenter</Button>}
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={!selection || !voice || voiceLoading} onClick={confirm} className="max-w-[22rem]"><span className="truncate">{confirmLabel}</span></Button>
      </>}
    >
      <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 md:border-r md:border-line">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
            <Segmented<View>
              label="Avatar list"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "mine", label: "My avatars" },
                { value: "library", label: "HeyGen library" },
                { value: "favorites", label: `Favorites${prefs.favoriteAvatars.length ? ` · ${prefs.favoriteAvatars.length}` : ""}` },
                { value: "recent", label: "Recent" },
              ]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name" className="min-w-40 flex-1" />
            <Segmented<Gender>
              label="Gender"
              size="sm"
              value={gender}
              onChange={setGender}
              options={[{ value: "any", label: "Any" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }]}
            />
            {view === "library" && <Chip active={portrait} onClick={() => setPortrait(!portrait)}>Talking-head 9:16</Chip>}
          </div>

          <div className="px-5 py-4">
            {remote && avatars.isPending ? (
              <Grid>{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-lg" />)}</Grid>
            ) : remote && avatars.isError ? (
              <EmptyState icon={<UserRound />} title="Couldn't load avatars" description={(avatars.error as Error).message}
                action={<Button variant="secondary" onClick={() => avatars.refetch()}>Try again</Button>} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<UserRound />}
                title={view === "favorites" ? "No favorite avatars yet" : view === "recent" ? "No recent avatars" : view === "mine" ? "No avatars of your own found" : "No avatars found"}
                description={view === "mine"
                  ? "Create a digital twin or photo avatar in HeyGen, then use Refresh avatars in Settings. Or pick one from the HeyGen library."
                  : view === "library" ? "Try a different search or filter. Refresh the catalog in Settings if it's out of date." : "Star avatars to keep them here."}
                action={view === "mine" ? <Button variant="secondary" onClick={() => setView("library")}>Browse HeyGen library</Button> : undefined}
              />
            ) : (
              <Grid>
                {list.map((a) => {
                  const selected = selection?.id === a.id;
                  return (
                    <div key={a.id} className={cn(
                      "group relative overflow-hidden rounded-lg border bg-surface transition-all duration-150",
                      selected ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-line-strong hover:shadow-md",
                    )}>
                      <button type="button" role="radio" aria-checked={selected} onClick={() => setSelection(a)} className="block w-full text-left">
                        <div className="aspect-[3/4] overflow-hidden bg-subtle">
                          <AvatarImage src={a.image} />
                        </div>
                        <div className="px-2.5 py-2">
                          <div className="truncate text-sm font-medium text-fg" title={a.name}>{a.name}</div>
                          <div className="truncate text-xs text-fg-muted capitalize">{[a.gender, a.ownership === "private" ? "Mine" : undefined].filter(Boolean).join(" · ") || " "}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFav(a)}
                        aria-label={isFav(a.id) ? `Remove ${a.name} from favorites` : `Add ${a.name} to favorites`}
                        aria-pressed={isFav(a.id)}
                        className={cn("absolute top-1.5 left-1.5 grid size-7 place-items-center rounded-md bg-surface/90 shadow-sm transition-opacity",
                          isFav(a.id) ? "text-warning" : "text-fg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                      >
                        <Star className={cn("size-3.5", isFav(a.id) && "fill-current")} />
                      </button>
                      {selected && <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-accent text-accent-fg shadow-md"><Check className="size-3.5" /></span>}
                    </div>
                  );
                })}
              </Grid>
            )}
          </div>

          {remote && data && data.pages > 1 && (
            <div className="sticky bottom-0 flex items-center justify-between border-t border-line bg-surface/95 px-5 py-2.5 backdrop-blur">
              <span className="tabular text-sm text-fg-muted">{data.total} avatars · page {data.page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /> Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <ChevronRight /></Button>
              </div>
            </div>
          )}
        </div>

        <aside aria-label="Voice" className="border-t border-line px-4 py-4 md:sticky md:top-0 md:self-start md:border-t-0">
          <div className="mb-2">
            <div className="text-sm font-semibold text-fg">Voice</div>
            <p className="text-xs text-fg-muted">Picked automatically with the avatar. Press play to hear it.</p>
          </div>
          <AvatarVoicePanel avatarId={selection?.id} value={voice} onChange={setVoice} initialVoiceId={current?.voiceId} />
        </aside>
      </div>
    </Dialog>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div role="radiogroup" aria-label="Avatars" className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-3">{children}</div>;
}

export function AvatarImage({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="grid size-full place-items-center text-fg-muted"><UserRound className="size-6" /></div>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />;
}
