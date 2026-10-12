import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeaturedBanner, featuredItems } from "@/components/FeaturedBanner";
import { HubRow } from "@/components/HubRow";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, library, type Hub, type LibrarySection, type Metadata } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { CUSTOM_PREFIX, customHubs } from "@/lib/customRows";
import { useNav } from "@/lib/nav";
import { arrangeHubs, posterSize, usePrefs } from "@/lib/prefs";

export function HomeView() {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [custom, setCustom] = useState<Hub[]>([]);
  const prefs = usePrefs();
  const nav = useNav();
  const [featured, setFeatured] = useState<Metadata[]>([]);
  const showFeatured = prefs?.showFeatured !== false;
  const rows = useMemo(() => (hubs ? arrangeHubs([...hubs, ...custom], prefs) : null), [hubs, custom, prefs]);
  const width = posterSize(prefs).poster;

  useEffect(() => {
    api.librarySections().then(setSections, () => setSections([]));
  }, []);

  // Custom rows reload when they're edited on the settings page, as well as with Plex's rows.
  const customRows = prefs?.customRows;
  const customLoad = useRef(0);
  const loadCustom = useCallback(() => {
    const n = ++customLoad.current;
    if (!customRows?.length || !sections.length) return setCustom([]);
    // A slower, older load mustn't replace a newer one.
    customHubs(customRows, sections).then((h) => n === customLoad.current && setCustom(h));
  }, [customRows, sections]);
  useEffect(loadCustom, [loadCustom]);
  useLibraryChanged(loadCustom);

  function showAll(hub: Hub) {
    const row = customRows?.find((r) => CUSTOM_PREFIX + r.id === hub.hubIdentifier);
    const section = row && sections.find((s) => s.key === row.section);
    if (row && section) nav.navigate({ name: "library", section, sort: row.sort, filters: row.filters });
  }

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
        <HubRow
          key={h.hubIdentifier}
          hub={h}
          onShowAll={h.hubIdentifier.startsWith(CUSTOM_PREFIX) ? () => showAll(h) : undefined}
        />
      ))}
    </div>
  );
}
