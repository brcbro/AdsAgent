import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useRenderStatus } from "@/lib/queries";
import { Button } from "../ui/button";

/** Shown while the server can't be reached; polling keeps retrying with back-off in the background. */
export function ConnectionBanner() {
  const status = useRenderStatus();
  const client = useQueryClient();
  if (!status.isError) return null;
  return (
    <div role="alert" className="flex items-center justify-center gap-3 border-b border-danger/20 bg-danger-subtle px-4 py-2 text-sm text-danger animate-fade-in">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>Connection to the studio server lost. Retrying automatically… Make sure <code className="font-mono">pnpm dashboard</code> is running.</span>
      <Button size="sm" variant="secondary" onClick={() => client.invalidateQueries()}>Retry now</Button>
    </div>
  );
}
