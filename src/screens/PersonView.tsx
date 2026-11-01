import { useEffect, useState } from "react";

import { Poster } from "@/components/Poster";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl, library, type Metadata } from "@/lib/api";
import { useNav, type PersonRole } from "@/lib/nav";
import { posterSize, usePrefs } from "@/lib/prefs";

const ROLE_LABEL: Record<PersonRole, string> = {
  actor: "In your library",
  director: "Directed",
  writer: "Written",
};

/** Every movie and show in the libraries with one actor, director or writer. */
export function PersonView({
  role,
  id,
  title,
  thumb,
}: {
  role: PersonRole;
  id: number;
  title: string;
  thumb?: string | null;
}) {
  const { server } = useNav();
  const prefs = usePrefs();
  const [items, setItems] = useState<Metadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    setError(null);
    library
      .personItems(role, id)
      .then((i) => live && setItems(i))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [role, id]);

  const movies = items?.filter((i) => i.type === "movie") ?? [];
  const shows = items?.filter((i) => i.type !== "movie") ?? [];
  const grid = { gridTemplateColumns: `repeat(auto-fill,minmax(${posterSize(prefs).poster - 10}px,1fr))` };

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-8">
      <div className="flex items-center gap-5">
        <Avatar className="size-24">
          {thumb && <AvatarImage src={imageUrl(server, thumb, 96, 96)} alt="" className="object-cover" />}
          <AvatarFallback className="text-2xl">{title.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">
            {items === null
              ? ROLE_LABEL[role]
              : `${ROLE_LABEL[role]}: ${[
                  movies.length && `${movies.length} ${movies.length === 1 ? "movie" : "movies"}`,
                  shows.length && `${shows.length} ${shows.length === 1 ? "show" : "shows"}`,
                ]
                  .filter(Boolean)
                  .join(", ") || "nothing"}`}
          </p>
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {items === null && !error && (
        <div className="grid gap-5" style={grid}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
          ))}
        </div>
      )}
      {[
        ["Movies", movies],
        ["Shows", shows],
      ].map(
        ([label, list]) =>
          (list as Metadata[]).length > 0 && (
            <section key={label as string}>
              <h2 className="mb-3 text-lg font-semibold">{label as string}</h2>
              <div className="grid gap-5" style={grid}>
                {(list as Metadata[]).map((m) => (
                  <Poster key={m.ratingKey} item={m} />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}
