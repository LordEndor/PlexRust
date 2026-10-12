import { useCallback, useEffect, useMemo, useState } from "react";

import { FeaturedBanner, featuredItems } from "@/components/FeaturedBanner";
import { HubRow } from "@/components/HubRow";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type Hub, type Metadata } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { arrangeHubs, posterSize, usePrefs } from "@/lib/prefs";

export function HomeView() {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = usePrefs();
  const [featured, setFeatured] = useState<Metadata[]>([]);
  const showFeatured = prefs?.showFeatured !== false;
  const rows = useMemo(() => (hubs ? arrangeHubs(hubs, prefs) : null), [hubs, prefs]);
  const width = posterSize(prefs).poster;

  const load = useCallback(() => {
    library
      .homeHubs()
      .then((h) => {
        setHubs(h);
        setError(null);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setHubs((prev) => prev ?? []);
      });
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!hubs || !showFeatured) return setFeatured([]);
    let live = true;
    featuredItems(hubs)
      .then((items) => live && setFeatured(items))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hubs, showFeatured]);
  useLibraryChanged(load);

  return (
    <div className="flex h-full flex-col gap-10 overflow-y-auto p-8">
      <FeaturedBanner items={featured} />
      {error && <p className="text-destructive text-sm">{error}</p>}
      {hubs === null &&
        Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="h-6 w-48" />
            <div className="flex gap-4">
              {Array.from({ length: 7 }, (_, j) => (
                <Skeleton key={j} className="aspect-[2/3] shrink-0 rounded-xl" style={{ width }} />
              ))}
            </div>
          </div>
        ))}
      {hubs?.length === 0 && !error && <p className="text-muted-foreground text-sm">Nothing here yet.</p>}
      {rows?.map((h) => (
        <HubRow key={h.hubIdentifier} hub={h} />
      ))}
    </div>
  );
}
