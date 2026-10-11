import { createContext, useContext } from "react";

import type { LibrarySection, ServerConnection } from "@/lib/api";

export type Route =
  | { name: "home" }
  | { name: "library"; section: LibrarySection }
  | { name: "item"; ratingKey: string }
  | { name: "search"; query: string }
  | { name: "player"; ratingKey: string; resume: boolean };

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
      return `library:${r.section.key}`;
    case "item":
      return `item:${r.ratingKey}`;
    case "search":
      return `search:${r.query}`;
    case "player":
      return `player:${r.ratingKey}`;
  }
}
