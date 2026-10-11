import { useEffect, useState } from "react";

import { HubRow } from "@/components/HubRow";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type Hub } from "@/lib/api";

export function SearchView({ query }: { query: string }) {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setHubs(null);
    setError(null);
    library
      .search(query)
      .then((h) => live && setHubs(h))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col gap-10 overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold">
        Results for <span className="text-primary">“{query}”</span>
      </h1>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {hubs === null && !error && <Skeleton className="h-72 rounded-xl" />}
      {hubs?.length === 0 && <p className="text-muted-foreground text-sm">No matches.</p>}
      {hubs?.map((h) => <HubRow key={h.hubIdentifier} hub={h} />)}
    </div>
  );
}
