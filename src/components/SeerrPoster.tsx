import { useState } from "react";

import { useNav } from "@/lib/nav";
import { availability, resultTitle, resultYear, TONE_CLASS, tmdbImage, type SeerrResult } from "@/lib/seerr";
import { cn } from "@/lib/utils";

/** A poster from Seerr's catalogue, with a badge when it's already available or requested. */
export function SeerrPoster({ item, className }: { item: SeerrResult; className?: string }) {
  const { navigate } = useNav();
  const [failed, setFailed] = useState(false);
  const src = tmdbImage(item.posterPath, "w342");
  const status = availability(item.mediaInfo);
  if (item.mediaType === "person") return null;
  const mediaType = item.mediaType;

  return (
    <button
      onClick={() => navigate({ name: "request", mediaType, tmdbId: item.id })}
      className={cn("group flex w-full flex-col gap-2 text-left outline-none", className)}
    >
      <div
        className={cn(
          "bg-card relative aspect-[2/3] w-full overflow-hidden rounded-xl border shadow-sm transition-all duration-200",
          "group-hover:ring-primary group-hover:scale-[1.03] group-hover:shadow-lg group-hover:ring-2",
          "group-focus-visible:ring-primary group-focus-visible:ring-2",
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
            {resultTitle(item)}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-white uppercase">
          {mediaType === "tv" ? "Show" : "Movie"}
        </span>
        {status && (
          <span
            className={cn("absolute right-2 bottom-2 rounded-md px-1.5 py-0.5 text-xs font-semibold shadow", TONE_CLASS[status.tone])}
          >
            {status.label}
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <div className="truncate text-sm font-medium">{resultTitle(item)}</div>
        <div className="text-muted-foreground truncate text-xs">{resultYear(item) || " "}</div>
      </div>
    </button>
  );
}
