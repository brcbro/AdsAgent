import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, RectangleHorizontal, RectangleVertical, Sparkles } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { titleFromScript } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { keys, usePresets } from "@/lib/queries";
import type { AspectRatio, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Hint, Input, Label, Segmented, Select } from "@/components/ui/primitives";

const SAMPLE_SCRIPT = "Trading ohne System ist wie Fahren ohne Lenkrad — irgendwann crasht es. In unserem Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Klare Regeln, Risikomanagement, diszipliniertes Handeln. Kein Hype — nur Methodik, die funktioniert. Melde dich an und starte heute mit Struktur statt Bauchgefühl.";

type Start = "blank" | "sample";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const presets = usePresets().data ?? [];
  const [prefs] = usePrefs();
  const [name, setName] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>(prefs.defaultAspectRatio);
  const [start, setStart] = useState<Start>("blank");
  const [presetId, setPresetId] = useState(prefs.defaultPresetId);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAspect(prefs.defaultAspectRatio);
    setPresetId(prefs.defaultPresetId);
    setStart("blank");
  }, [open, prefs.defaultAspectRatio, prefs.defaultPresetId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    const script = start === "sample" ? SAMPLE_SCRIPT : "";
    const preset = presets.find((p) => p.id === presetId);
    try {
      const project = await api.createProject({
        id: `video_${Date.now()}`,
        title: name.trim() || (script ? titleFromScript(script) : `Untitled video · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`),
        scriptDe: script,
        aspectRatio: aspect,
        captions: { presetId, fontSize: preset?.fontSize ?? 32, bottomPercent: preset?.bottomPercent },
      });
      client.setQueryData<Project[]>(keys.projects, (list) => [project, ...(list ?? [])]);
      client.setQueryData(keys.project(project.id), project);
      onOpenChange(false);
      navigate(`/studio/${project.id}`);
    } catch (err) {
      toast.error("Couldn't create the project", { description: errorMessage(err) });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New video"
      description="Set the basics — everything can be changed later."
      size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" type="submit" form="new-project" loading={creating}>Create video</Button>
      </>}
    >
      <form id="new-project" onSubmit={create} className="space-y-5">
        <div>
          <Label htmlFor="np-name" hint="Optional">Name</Label>
          <Input id="np-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trading FOMO — Hook A" maxLength={120} />
          <Hint>Leave empty to name it after the first words of the script.</Hint>
        </div>
        <div>
          <Label>Format</Label>
          <Segmented<AspectRatio>
            label="Format"
            className="w-full"
            value={aspect}
            onChange={setAspect}
            options={[
              { value: "9:16", label: <><RectangleVertical /> Vertical 9:16</> },
              { value: "16:9", label: <><RectangleHorizontal /> Horizontal 16:9</> },
            ]}
          />
        </div>
        <div>
          <Label>Start with</Label>
          <Segmented<Start>
            label="Start with"
            className="w-full"
            value={start}
            onChange={setStart}
            options={[
              { value: "blank", label: <><FileText /> Blank script</> },
              { value: "sample", label: <><Sparkles /> Sample script</> },
            ]}
          />
        </div>
        <div>
          <Label htmlFor="np-preset">Caption style</Label>
          <Select id="np-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.mode === "word" ? "word by word" : "phrase"}</option>)}
          </Select>
        </div>
      </form>
    </Dialog>
  );
}
