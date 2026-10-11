import { Check } from "lucide-react";

import { imageUrl, type Metadata } from "@/lib/api";
import { isWatched, progress, subtitle, unwatchedCount } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const POSTER = { w: 180, h: 270 };
const WIDE = { w: 320, h: 180 };

function posterPath(m: Metadata) {
  return m.type === "episode" ? (m.grandparentThumb ?? m.thumb) : (m.thumb ?? m.parentThumb);
}

function widePath(m: Metadata) {
  return m.type === "episode" ? (m.thumb ?? m.grandparentArt) : (m.art ?? m.thumb);
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
}

export function Poster({ item, wide, className }: Props) {
  const { server, navigate } = useNav();
  const size = wide ? WIDE : POSTER;
  const src = imageUrl(server, wide ? widePath(item) : posterPath(item), size.w, size.h);

  return (
    <button
      onClick={() => navigate({ name: "item", ratingKey: item.ratingKey })}
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
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
        ) : (
          <div className="text-muted-foreground grid size-full place-items-center p-3 text-center text-sm">
            {item.title}
          </div>
        )}
        <Badges item={item} />
        <ProgressBar value={progress(item)} />
      </div>
      <div className="min-w-0 px-0.5">
        <div className="truncate text-sm font-medium">{item.type === "episode" && !wide ? item.grandparentTitle : item.title}</div>
        <div className="text-muted-foreground truncate text-xs">
          {item.type === "episode" && wide ? `${item.grandparentTitle} · S${item.parentIndex} · E${item.index}` : subtitle(item)}
        </div>
      </div>
    </button>
  );
}
