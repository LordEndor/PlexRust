import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** The browser build has no window of its own to draw controls for. */
export const HAS_TITLE_BAR = import.meta.env.MODE !== "web";

/**
 * The app draws its own title bar (the native one is turned off in
 * tauri.conf.json) so the top of the window blends into the app. Home builds
 * it into its header; the sign-in and server screens use this bare one that
 * floats over the page. Drag it to move the window, double-click to maximize.
 */
export function TitleBar() {
  if (!HAS_TITLE_BAR) return null;
  return (
    <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 flex h-8 justify-end">
      <WindowControls />
    </div>
  );
}

/** Minimize, maximize/restore and close, styled like Windows 11's. */
export function WindowControls({ className }: { className?: string }) {
  if (!HAS_TITLE_BAR) return null;
  return <Controls className={className} />;
}

function Controls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className={cn("flex h-8", className)}>
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <Minus className="size-4" strokeWidth={1.25} />
      </ControlButton>
      <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.25} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.25} />
        )}
      </ControlButton>
      <ControlButton label="Close" onClick={() => win.close()} danger>
        <X className="size-4" strokeWidth={1.25} />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground grid h-8 w-11 place-items-center transition-colors",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
