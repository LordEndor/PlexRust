import { useEffect, useMemo, useState } from "react";

import { FeaturedBanner, featuredItems } from "@/components/FeaturedBanner";
import { HubRow } from "@/components/HubRow";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type Hub } from "@/lib/api";

export function HomeView() {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const featured = useMemo(() => (hubs ? featuredItems(hubs) : []), [hubs]);

  useEffect(() => {
    library
      .homeHubs()
      .then(setHubs)
      .catch((e) => {
        setError(errorMessage(e));
        setHubs([]);
      });
  }, []);

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
                <Skeleton key={j} className="aspect-[2/3] w-40 shrink-0 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      {hubs?.length === 0 && !error && <p className="text-muted-foreground text-sm">Nothing here yet.</p>}
      {hubs?.map((h) => <HubRow key={h.hubIdentifier} hub={h} />)}
    </div>
  );
}
