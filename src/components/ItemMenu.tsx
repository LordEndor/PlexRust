import { useState } from "react";
import {
  Eye,
  EyeOff,
  FileSearch,
  Image,
  Info,
  Layers,
  Pencil,
  Play,
  RefreshCw,
  ScanSearch,
  Trash2,
  Tv,
  X,
} from "lucide-react";

import { InfoDialog } from "@/components/InfoDialog";
import { ManageDialogs } from "@/components/ManageDialogs";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { errorMessage, library, type Metadata } from "@/lib/api";
import { notifyLibraryChanged } from "@/lib/changes";
import { isWatched, progress, unwatchedCount } from "@/lib/format";
import { manage, type ManageDialog } from "@/lib/manage";
import { useNav, type Nav } from "@/lib/nav";

export interface ItemAction {
  label: string;
  icon: React.ComponentType;
  run: () => void;
  /** Starts a new group in the menu. */
  separated?: boolean;
}

async function act(task: Promise<void>) {
  try {
    await task;
  } catch (e) {
    window.alert(errorMessage(e));
  } finally {
    notifyLibraryChanged();
  }
}

/** What can be done to an item from its menu. */
export function itemActions(
  item: Metadata,
  nav: Nav,
  opts: { continueWatching?: boolean; onInfo?: () => void; onManage?: (dialog: ManageDialog) => void } = {},
): ItemAction[] {
  const actions: ItemAction[] = [];
  const playable = item.type === "movie" || item.type === "episode";
  if (playable) {
    const resume = progress(item) > 0;
    actions.push({
      label: resume ? "Resume" : "Play",
      icon: Play,
      run: () => nav.navigate({ name: "player", ratingKey: item.ratingKey, resume }),
    });
  }
  if (playable || item.type === "show" || item.type === "season") {
    const what = item.type === "show" ? " show" : item.type === "season" ? " season" : "";
    const group = item.type === "show" || item.type === "season";
    // Part way through counts as both: it can be finished, or reset to unwatched.
    const canWatch = !isWatched(item);
    const canUnwatch = group
      ? (item.viewedLeafCount ?? 0) > 0 || unwatchedCount(item) === 0
      : (item.viewCount ?? 0) > 0 || progress(item) > 0;
    if (canWatch) {
      actions.push({
        label: `Mark${what} as watched`,
        icon: Eye,
        run: () => act(library.setWatched(item.ratingKey, true)),
        separated: actions.length > 0,
      });
    }
    if (canUnwatch) {
      actions.push({
        label: `Mark${what} as unwatched`,
        icon: EyeOff,
        run: () => act(library.setWatched(item.ratingKey, false)),
        separated: !canWatch && actions.length > 0,
      });
    }
  }
  if (opts.continueWatching) {
    actions.push({
      label: "Remove from Continue Watching",
      icon: X,
      run: () => act(library.removeFromContinueWatching(item.ratingKey)),
    });
  }
  if (item.type === "episode" && item.grandparentRatingKey) {
    const show = item.grandparentRatingKey;
    actions.push({
      label: "Go to show",
      icon: Tv,
      run: () => nav.navigate({ name: "item", ratingKey: show }),
      separated: true,
    });
  }
  if (item.type === "episode" && item.parentRatingKey) {
    const season = item.parentRatingKey;
    actions.push({
      label: "Go to season",
      icon: Layers,
      run: () => nav.navigate({ name: "item", ratingKey: season }),
    });
  }
  if (opts.onInfo) {
    actions.push({ label: "Get info", icon: Info, run: opts.onInfo, separated: true });
  }
  // Server housekeeping; Plex only lets the owner (or an admin) do these.
  const manageable = ["movie", "show", "season", "episode"].includes(item.type);
  if (opts.onManage && manageable) {
    const open = opts.onManage;
    actions.push(
      { label: "Refresh metadata", icon: RefreshCw, run: () => act(manage.refresh(item.ratingKey)), separated: true },
      { label: "Analyze", icon: FileSearch, run: () => act(manage.analyze(item.ratingKey)) },
    );
    if (item.type === "movie" || item.type === "show") {
      actions.push({ label: "Fix match…", icon: ScanSearch, run: () => open("match") });
    }
    actions.push(
      { label: "Edit details…", icon: Pencil, run: () => open("edit") },
      { label: "Change poster…", icon: Image, run: () => open("poster") },
      { label: "Delete…", icon: Trash2, run: () => open("delete") },
    );
  }
  return actions;
}

/** Right-click menu around a poster or row. */
export function ItemContextMenu({
  item,
  continueWatching,
  children,
}: {
  item: Metadata;
  continueWatching?: boolean;
  children: React.ReactNode;
}) {
  const nav = useNav();
  const [info, setInfo] = useState(false);
  const [dialog, setDialog] = useState<ManageDialog | null>(null);
  const actions = itemActions(item, nav, { continueWatching, onInfo: () => setInfo(true), onManage: setDialog });
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>
            {item.type === "episode" ? `${item.grandparentTitle} · ${item.title}` : item.title}
          </ContextMenuLabel>
          {actions.map((a) => (
            <div key={a.label}>
              {a.separated && <ContextMenuSeparator />}
              <ContextMenuItem onSelect={a.run}>
                <a.icon />
                {a.label}
              </ContextMenuItem>
            </div>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      {info && <InfoDialog item={item} open={info} onOpenChange={setInfo} />}
      <ManageDialogs item={item} dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
