import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { cn } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { SavedAvatar } from "@/lib/prefs";
import { useAvatars } from "@/lib/queries";
import type { HeyGenAvatar } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";

export const toSaved = (a: HeyGenAvatar): SavedAvatar => ({ id: a.avatar_id, name: a.avatar_name, image: a.preview_image_url, gender: a.gender });

/** One combobox for the HeyGen presenter: search, thumbnails, and paging through the whole catalog. */
export function PresenterPicker({ value, onChange, disabled, className }:
  { value: SavedAvatar | null; onChange: (a: SavedAvatar) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<HeyGenAvatar[]>([]);
  const q = useDebounced(query.trim(), 250);
  const avatars = useAvatars({ page, q }, open);

  useEffect(() => { setPage(1); setLoaded([]); }, [q]);
  useEffect(() => {
    if (!avatars.data || avatars.isPlaceholderData) return;
    const incoming = avatars.data.avatars;
    setLoaded((prev) => {
      const base = avatars.data!.page === 1 ? [] : prev;
      const seen = new Set(base.map((a) => a.avatar_id));
      return [...base, ...incoming.filter((a) => !seen.has(a.avatar_id))];
    });
  }, [avatars.data, avatars.isPlaceholderData]);

  const more = !!avatars.data && avatars.data.page < avatars.data.pages;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" disabled={disabled} aria-label="Presenter" data-testid="presenter-picker"
          className={cn("flex h-8 min-w-0 items-center gap-2 rounded-md border border-line bg-surface pr-2 pl-1 text-xs text-fg shadow-xs transition-colors hover:border-line-strong disabled:opacity-50", className)}>
          <Thumb avatar={value} size="size-6" />
          <span className="min-w-0 flex-1 truncate text-left">{value?.name ?? "Choose a presenter"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg animate-fade-in">
          <Command label="Presenters" shouldFilter={false} loop>
            <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search presenters…"
              className="h-10 w-full border-b border-line bg-transparent px-3 text-sm text-fg outline-none placeholder:text-fg-muted" />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {avatars.isError && <p className="px-3 py-6 text-center text-xs text-danger">Presenter list unavailable. Check the HeyGen settings.</p>}
              {!avatars.isError && !loaded.length && (avatars.isPending ? <div className="grid place-items-center py-6"><Spinner /></div>
                : <Command.Empty className="px-3 py-6 text-center text-xs text-fg-muted">No presenters match.</Command.Empty>)}
              {loaded.map((a) => (
                <Command.Item key={a.avatar_id} value={a.avatar_id} onSelect={() => { onChange(toSaved(a)); setOpen(false); }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg data-[selected=true]:bg-subtle">
                  <Thumb avatar={toSaved(a)} size="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.avatar_name}</span>
                    {a.gender && <span className="block text-xs text-fg-muted capitalize">{a.gender}</span>}
                  </span>
                  {value?.id === a.avatar_id && <Check className="size-4 text-accent" aria-hidden />}
                </Command.Item>
              ))}
              {more && (
                <div className="p-1">
                  <Button size="sm" variant="ghost" className="w-full" loading={avatars.isFetching} onClick={() => setPage(page + 1)}>
                    Load more ({loaded.length} of {avatars.data?.total})
                  </Button>
                </div>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Thumb({ avatar, size }: { avatar: SavedAvatar | null; size: string }) {
  return avatar?.image
    ? <img src={avatar.image} alt="" className={cn("shrink-0 rounded-md object-cover", size)} loading="lazy" />
    : <span className={cn("grid shrink-0 place-items-center rounded-md bg-subtle text-fg-muted", size)} aria-hidden><UserRound className="size-3.5" /></span>;
}
