import { useEffect, useState } from "react";
import { Compass } from "lucide-react";

import { HubRow } from "@/components/HubRow";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type Hub } from "@/lib/api";
import { useNav } from "@/lib/nav";
import { useSeerrEnabled } from "@/lib/seerr";

export function SearchView({ query }: { query: string }) {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestsEnabled = useSeerrEnabled();
  const { navigate } = useNav();

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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">
          Results for <span className="text-primary">“{query}”</span>
        </h1>
        {requestsEnabled && (
          <Button variant="outline" onClick={() => navigate({ name: "discover", query })}>
            <Compass /> Find it to request
          </Button>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {hubs === null && !error && <Skeleton className="h-72 rounded-xl" />}
      {hubs?.length === 0 && <p className="text-muted-foreground text-sm">No matches.</p>}
      {hubs?.map((h) => <HubRow key={h.hubIdentifier} hub={h} />)}
    </div>
  );
}
