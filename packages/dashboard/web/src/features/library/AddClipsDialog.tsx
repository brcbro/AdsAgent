import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, FolderInput, Upload, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { keys } from "@/lib/queries";
import type { BrollImportResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Hint, Label, ProgressBar, Segmented, Select, Textarea } from "@/components/ui/primitives";

/*
 * Add clips to the B-roll library: pick or drop files (uploaded one by one with progress), or
 * paste local file / folder paths for big batches on this machine. "Auto-classify" sends clips
 * to the inbox where the classifier decides the category; choosing a category stores them there
 * directly as confirmed.
 */

const VIDEO = /\.(mp4|mov|webm)$/i;
const PARALLEL_UPLOADS = 2;
export const AUTO = "auto";

type UploadStatus = "queued" | "uploading" | "done" | "error";
interface UploadItem { id: string; file: File; progress: number; status: UploadStatus; error?: string; storedAs?: string }

export function isVideoFile(file: File): boolean { return VIDEO.test(file.name); }

export function AddClipsDialog({ open, onOpenChange, categories, initialFiles }:
  { open: boolean; onOpenChange: (open: boolean) => void; categories: string[]; initialFiles?: File[] }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"files" | "paths">("files");
  const [category, setCategory] = useState(AUTO);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [paths, setPaths] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BrollImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (open && initialFiles?.length) addFiles(initialFiles); }, [open, initialFiles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { abort.current?.abort(); setItems([]); setImportResult(null); setPaths(""); } }, [open]);

  function addFiles(list: Iterable<File>) {
    const next: UploadItem[] = [];
    let rejected = 0;
    for (const file of list) {
      if (!isVideoFile(file)) { rejected++; continue; }
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file, progress: 0, status: "queued" });
    }
    if (rejected) toast.error(`${rejected} file${rejected === 1 ? " is" : "s are"} not MP4, MOV or WebM and ${rejected === 1 ? "was" : "were"} skipped`);
    if (next.length) setItems((prev) => [...prev, ...next]);
  }

  async function startUploads() {
    const controller = new AbortController();
    abort.current = controller;
    setUploading(true);
    const queue = items.filter((i) => i.status === "queued" || i.status === "error");
    const update = (id: string, patch: Partial<UploadItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    let done = 0, failed = 0;
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item || controller.signal.aborted) return;
        update(item.id, { status: "uploading", progress: 0, error: undefined });
        try {
          const result = await api.uploadBroll(item.file, category, (p) => update(item.id, { progress: p * 100 }), controller.signal);
          update(item.id, { status: "done", progress: 100, storedAs: result.name });
          done++;
          void queryClient.invalidateQueries({ queryKey: keys.broll });
        } catch (err) {
          update(item.id, { status: "error", error: errorMessage(err) });
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
    setUploading(false);
    void queryClient.invalidateQueries({ queryKey: keys.broll });
    void queryClient.invalidateQueries({ queryKey: keys.brollIngest });
    if (controller.signal.aborted) return;
    if (failed && !done) toast.error(`${failed} upload${failed === 1 ? "" : "s"} failed`);
    else if (failed) toast.warning(`${done} added, ${failed} failed`);
    else if (done) toast.success(category === AUTO ? `${done} clip${done === 1 ? "" : "s"} added · classifying in the background` : `${done} clip${done === 1 ? "" : "s"} added to ${category}`);
  }

  async function runImport() {
    const list = paths.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
    if (!list.length) return;
    setImporting(true); setImportResult(null);
    try {
      const result = await api.importBroll(list, category);
      setImportResult(result);
      void queryClient.invalidateQueries({ queryKey: keys.broll });
      void queryClient.invalidateQueries({ queryKey: keys.brollIngest });
      if (result.imported.length) toast.success(`${result.imported.length} clip${result.imported.length === 1 ? "" : "s"} imported${category === AUTO ? " · classifying in the background" : ""}`);
      else toast.error("Nothing imported");
    } catch (err) {
      toast.error("Import failed", { description: errorMessage(err) });
    } finally { setImporting(false); }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); };
  const summary = useMemo(() => ({
    done: items.filter((i) => i.status === "done").length, error: items.filter((i) => i.status === "error").length,
  }), [items]);
  const canStart = items.some((i) => i.status === "queued" || i.status === "error") && !uploading;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!uploading || !o) onOpenChange(o); }} title="Add clips" size="lg"
      description="Clips are stored in data/broll/clips and classified automatically unless you choose a category."
      footer={<>
        {uploading && <Button variant="secondary" onClick={() => abort.current?.abort()}><X /> Stop</Button>}
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={uploading}>{summary.done ? "Done" : "Cancel"}</Button>
        {mode === "files"
          ? <Button variant="primary" onClick={startUploads} disabled={!canStart} loading={uploading}><Upload /> Upload {items.filter((i) => i.status !== "done").length || ""}</Button>
          : <Button variant="primary" onClick={runImport} disabled={!paths.trim() || importing} loading={importing}><FolderInput /> Import</Button>}
      </>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented label="Source" size="sm" value={mode} onChange={setMode} disabled={uploading}
            options={[{ value: "files", label: "Files" }, { value: "paths", label: "Local paths" }]} />
          <div className="ml-auto min-w-48">
            <Label htmlFor="add-clips-category">Category</Label>
            <Select id="add-clips-category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={uploading}>
              <option value={AUTO}>Auto-classify (recommended)</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        </div>

        {mode === "files" ? (
          <>
            <div
              role="button" tabIndex={0} aria-label="Drop clips here or click to choose files"
              onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
              className={cn("grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragging ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong hover:bg-subtle")}
            >
              <Upload className="mb-2 size-6 text-fg-muted" aria-hidden />
              <p className="text-sm font-medium text-fg">Drop MP4, MOV or WebM clips here</p>
              <p className="mt-0.5 text-xs text-fg-muted">or click to choose files · several at once is fine</p>
              <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" multiple className="sr-only" aria-label="Choose clips"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {items.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Upload queue">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-fg" title={item.file.name}>{item.file.name}</span>
                        <span className="tabular shrink-0 text-xs text-fg-muted">{(item.file.size / 1_048_576).toFixed(1)} MB</span>
                      </div>
                      {item.status === "uploading" && <ProgressBar value={item.progress} className="mt-1.5" />}
                      {item.status === "error" && <p className="mt-0.5 text-xs text-danger">{item.error}</p>}
                      {item.status === "done" && item.storedAs && item.storedAs !== item.file.name && <p className="mt-0.5 text-xs text-fg-muted">Stored as {item.storedAs}</p>}
                    </div>
                    {item.status === "done" && <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Uploaded" />}
                    {item.status === "error" && <AlertCircle className="size-4 shrink-0 text-danger" aria-label="Failed" />}
                    {item.status === "queued" && (
                      <button type="button" aria-label={`Remove ${item.file.name}`} className="text-fg-muted hover:text-fg"
                        onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}><X className="size-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="add-clips-paths" hint="One per line. Folders are searched for video files. Files are copied; the originals stay where they are.">Files or folders on this computer</Label>
            <Textarea id="add-clips-paths" rows={6} value={paths} onChange={(e) => setPaths(e.target.value)} disabled={importing}
              placeholder={"C:\\Users\\me\\Downloads\\B-Roll\\Trading\nD:\\footage\\desk-typing.mp4"} className="font-mono text-xs" />
            {importResult && (
              <div className="space-y-1 rounded-lg border border-line bg-bg p-3 text-xs">
                <p className="font-medium text-fg">{importResult.imported.length} imported, {importResult.skipped.length} skipped</p>
                {importResult.skipped.slice(0, 20).map((s) => <p key={s.path} className="text-danger"><span className="font-mono">{s.path}</span> — {s.reason}</p>)}
              </div>
            )}
            <Hint>Useful for large batches: nothing is sent through the browser.</Hint>
          </div>
        )}
      </div>
    </Dialog>
  );
}
