import { library, type Filters, type Hub, type LibrarySection } from "@/lib/api";

/** A Home row made on the settings page: one library in a picked order, optionally narrowed down. */
export interface CustomRow {
  id: string;
  title: string;
  /** Library section key. */
  section: string;
  /** Plex sort such as `audienceRating:desc`. */
  sort: string;
  filters: Filters;
}

/** Custom rows share the Home row order with Plex's rows, under this prefix. */
export const CUSTOM_PREFIX = "custom:";

/** Items fetched for each custom row. */
const ROW_SIZE = 20;

export function customHubId(row: CustomRow) {
  return CUSTOM_PREFIX + row.id;
}

export function newRowId() {
  return Math.random().toString(36).slice(2, 10);
}

/** One-click starting points for the libraries on this server. */
export function presets(sections: LibrarySection[]): Omit<CustomRow, "id">[] {
  const movies = sections.filter((s) => s.type === "movie");
  const shows = sections.filter((s) => s.type === "show");
  // With more than one library of a kind, say which one.
  const name = (base: string, s: LibrarySection, all: LibrarySection[]) =>
    all.length > 1 ? `${base} in ${s.title}` : base;
  return [
    ...movies.flatMap((s) => [
      { title: name("Highest rated movies", s, movies), section: s.key, sort: "audienceRating:desc", filters: {} },
      {
        title: name("Unwatched movies", s, movies),
        section: s.key,
        sort: "addedAt:desc",
        filters: { unwatched: true },
      },
      { title: name("Random movies", s, movies), section: s.key, sort: "random", filters: {} },
    ]),
    ...shows.flatMap((s) => [
      { title: name("Latest added TV shows", s, shows), section: s.key, sort: "episode.addedAt:desc", filters: {} },
      { title: name("Highest rated shows", s, shows), section: s.key, sort: "audienceRating:desc", filters: {} },
      { title: name("Shows to start", s, shows), section: s.key, sort: "addedAt:desc", filters: { unwatched: true } },
    ]),
  ];
}

/**
 * The custom rows as Home hubs, fetched side by side. Rows whose library is
 * gone, that fail to load or that come back empty are left out.
 */
export async function customHubs(rows: CustomRow[], sections: LibrarySection[]): Promise<Hub[]> {
  const loaded = await Promise.all(
    rows.map(async (row): Promise<Hub | null> => {
      const section = sections.find((s) => s.key === row.section);
      if (!section) return null;
      try {
        const page = await library.sectionItems(row.section, 0, ROW_SIZE, row.sort, row.filters);
        return { hubIdentifier: customHubId(row), title: row.title, type: section.type, Metadata: page.items };
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((h): h is Hub => !!h && h.Metadata.length > 0);
}
