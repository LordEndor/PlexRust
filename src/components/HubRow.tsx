import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Poster } from "@/components/Poster";
import type { Hub } from "@/lib/api";
import { posterSize, usePrefs } from "@/lib/prefs";

/** Hubs that read better as wide thumbnails with progress, like Infuse. */
function isWide(hub: Hub) {
  return /continue|ondeck|inprogress/i.test(hub.hubIdentifier);
}

export function HubRow({ hub }: { hub: Hub }) {
  const scroller = useRef<HTMLDivElement>(null);
  const wide = isWide(hub);
  const size = posterSize(usePrefs());

  function scroll(dir: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <section className="group/row">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">{hub.title}</h2>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => scroll(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => scroll(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={scroller}
        className="-mx-4 -mt-2 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pt-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {hub.Metadata.map((m) => (
          <div key={m.ratingKey} className="shrink-0 snap-start" style={{ width: wide ? size.wide : size.poster }}>
            <Poster item={m} wide={wide} continueWatching={wide} />
          </div>
        ))}
      </div>
    </section>
  );
}
