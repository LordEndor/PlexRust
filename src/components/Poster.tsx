import { useState } from "react";
import { Check, Play } from "lucide-react";

import { ItemContextMenu } from "@/components/ItemMenu";
import { imageUrl, type Metadata } from "@/lib/api";
import { isWatched, progress, subtitle, unwatchedCount } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const POSTER = { w: 180, h: 270 };
const WIDE = { w: 320, h: 180 };

function posterPath(m: Metadata) {
  return m.type === "episode" ? (m.grandparentThumb ?? m.thumb) : (m.thumb ?? m.parentThumb ?? m.composite);
}

function widePath(m: Metadata) {
  return m.type === "episode" ? (m.thumb ?? m.grandparentArt) : (m.art ?? m.thumb ?? m.composite);
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  if (value <= 0) return null;
  return (
    <div className={cn("absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/60", className)}>
      <div className="bg-primary h-full rounded-full" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function Badges({ item }: { item: Metadata }) {
  const unwatched = unwatchedCount(item);
  if (unwatched > 0) {
    return (
      <span className="bg-primary text-primary-foreground absolute top-2 right-2 min-w-6 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold shadow">
        {unwatched}
      </span>
    );
  }
  if (isWatched(item)) {
    return (
      <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-black/70 shadow">
        <Check className="size-3.5" />
      </span>
    );
  }
  return null;
}

interface Props {
  item: Metadata;
  wide?: boolean;
  className?: string;
  /** Shown in Continue Watching or On Deck: its menu can take it off, and it gets a Play button. */
  continueWatching?: boolean;
}

/** Starts the item straight from its thumbnail, skipping its page. */
function PlayButton({ item }: { item: Metadata }) {
  const { navigate } = useNav();
  const resume = progress(item) > 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 grid aspect-video place-items-center">
      <button
        type="button"
        aria-label={`${resume ? "Resume" : "Play"} ${item.title}`}
        title={resume ? "Resume" : "Play"}
        onClick={() => navigate({ name: "player", ratingKey: item.ratingKey, resume })}
        className={cn(
          "bg-primary text-primary-foreground pointer-events-auto grid size-12 place-items-center rounded-full shadow-lg outline-none",
          "scale-90 opacity-0 transition-all duration-200 group-hover/poster:scale-100 group-hover/poster:opacity-100",
          "hover:bg-primary/90 focus-visible:ring-ring/50 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:ring-[3px]",
        )}
      >
        <Play className="ml-0.5 size-5 fill-current" />
      </button>
    </div>
  );
}

export function Poster({ item, wide, className, continueWatching }: Props) {
  const { server, navigate } = useNav();
  const size = wide ? WIDE : POSTER;
  const src = imageUrl(server, wide ? widePath(item) : posterPath(item), size.w, size.h);
  const [failed, setFailed] = useState(false);

  return (
    <ItemContextMenu item={item} continueWatching={continueWatching}>
      <div className="group/poster relative">
        <button
          onClick={() =>
            navigate(
              item.type === "playlist"
                ? { name: "playlist", ratingKey: item.ratingKey }
                : { name: "item", ratingKey: item.ratingKey },
            )
          }
          className={cn("group flex w-full flex-col gap-2 text-left outline-none", className)}
        >
          <div
            className={cn(
              "bg-card relative w-full overflow-hidden rounded-xl border shadow-sm transition-all duration-200",
              "group-hover:ring-primary group-hover:scale-[1.03] group-hover:shadow-lg group-hover:ring-2",
              "group-focus-visible:ring-primary group-focus-visible:ring-2",
              wide ? "aspect-video" : "aspect-[2/3]",
            )}
          >
            {src && !failed ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setFailed(true)}
                className="size-full object-cover"
              />
            ) : (
              <div className="text-muted-foreground grid size-full place-items-center p-3 text-center text-sm">
                {item.title}
              </div>
            )}
            <Badges item={item} />
            <ProgressBar value={progress(item)} />
          </div>
          <div className="min-w-0 px-0.5">
            <div className="truncate text-sm font-medium">
              {item.type === "episode" && !wide ? item.grandparentTitle : item.title}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {item.type === "episode" && wide
                ? `${item.grandparentTitle} · S${item.parentIndex} · E${item.index}`
                : subtitle(item)}
            </div>
          </div>
        </button>
        {wide && continueWatching && (item.type === "movie" || item.type === "episode") && <PlayButton item={item} />}
      </div>
    </ItemContextMenu>
  );
}
