import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Checks GitHub Releases for a newer build on launch, downloads it in the
 * background, then offers a one-click restart to install it.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    (async () => {
      const found = await check();
      if (!found) return;
      await found.download();
      setUpdate(found);
    })().catch((e) => console.warn("Update check failed", e));
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    setInstalling(true);
    try {
      await update!.install();
      await relaunch();
    } catch (e) {
      console.error("Update install failed", e);
      setInstalling(false);
    }
  }

  return (
    <div className="bg-card animate-in fade-in slide-in-from-bottom-2 fixed right-4 bottom-4 z-50 flex w-80 items-start gap-3 rounded-xl border p-4 shadow-lg">
      <Download className="text-primary mt-0.5 size-5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium">Update ready</p>
        <p className="text-muted-foreground mb-3 text-xs">Version {update.version} has been downloaded.</p>
        <Button size="sm" onClick={install} disabled={installing}>
          {installing && <Loader2 className="animate-spin" />}
          Restart to update
        </Button>
      </div>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setDismissed(true)} title="Later">
        <X />
      </Button>
    </div>
  );
}
