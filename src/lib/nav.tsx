import { createContext, useContext } from "react";

import type { Filters, LibrarySection, ServerConnection } from "@/lib/api";
import type { DiscoverRowKey, MediaType } from "@/lib/seerr";

export type Route =
  | { name: "home" }
  /** `sort` and `filters` open the library already sorted and narrowed down, as a custom Home row is. */
  | { name: "library"; section: LibrarySection; sort?: string; filters?: Filters }
  | { name: "item"; ratingKey: string }
  | { name: "search"; query: string }
  | { name: "settings" }
  | { name: "discover"; query?: string }
  /** A Discover row's Show all page. */
  | { name: "discoverAll"; row: DiscoverRowKey }
  | { name: "request"; mediaType: MediaType; tmdbId: number }
  | { name: "requests" }
  | { name: "calendar" }
  | { name: "playlists" }
  | { name: "playlist"; ratingKey: string }
  /** `playlist` plays on through that playlist rather than the show. */
  | { name: "player"; ratingKey: string; resume: boolean; playlist?: string };

export interface Nav {
  server: ServerConnection;
  navigate: (route: Route) => void;
  back: () => void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav() {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavContext");
  return nav;
}

export function routeKey(r: Route) {
  switch (r.name) {
    case "home":
      return "home";
    case "library":
      return r.sort
        ? `library:${r.section.key}:${r.sort}:${JSON.stringify(r.filters ?? {})}`
        : `library:${r.section.key}`;
    case "item":
      return `item:${r.ratingKey}`;
    case "search":
      return `search:${r.query}`;
    case "settings":
      return "settings";
    case "discover":
      return `discover:${r.query ?? ""}`;
    case "discoverAll":
      return `discover-all:${r.row}`;
    case "request":
      return `request:${r.mediaType}:${r.tmdbId}`;
    case "requests":
      return "requests";
    case "calendar":
      return "calendar";
    case "playlists":
      return "playlists";
    case "playlist":
      return `playlist:${r.ratingKey}`;
    case "player":
      return `player:${r.ratingKey}`;
  }
}
