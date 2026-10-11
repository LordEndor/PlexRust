import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Clapperboard,
  Film,
  Home as HomeIcon,
  Image,
  LogOut,
  Music,
  Search,
  Server,
  Settings,
  Tv,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { api, errorMessage, type LibrarySection, type ServerConnection, type User } from "@/lib/api";
import { NavContext, routeKey, type Nav, type Route } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { HomeView } from "@/screens/HomeView";
import { ItemView } from "@/screens/ItemView";
import { LibraryView } from "@/screens/LibraryView";
import { SearchView } from "@/screens/SearchView";

const sectionIcon = { movie: Film, show: Tv, artist: Music, photo: Image } as const;
const MAX_STACK = 15;

function iconFor(type: string) {
  return sectionIcon[type as keyof typeof sectionIcon] ?? Clapperboard;
}

interface Props {
  user: User;
  server: ServerConnection;
  onSwitchServer: () => void;
  onSignOut: () => void;
}

export function Home({ user, server, onSwitchServer, onSignOut }: Props) {
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every screen in the stack stays mounted (just hidden), so going back is
  // instant and keeps its scroll position.
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setSections(null);
    setStack([{ name: "home" }]);
    api
      .librarySections()
      .then(setSections)
      .catch((e) => {
        setError(errorMessage(e));
        setSections([]);
      });
  }, [server.machineId]);

  const navigate = useCallback((route: Route) => {
    setStack((s) => {
      const top = s[s.length - 1];
      if (routeKey(top) === routeKey(route)) return s;
      const base = route.name === "search" && top.name === "search" ? s.slice(0, -1) : s;
      return [...base, route].slice(-MAX_STACK);
    });
  }, []);

  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const goRoot = (route: Route) => setStack([route]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => e.button === 3 && back();
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if ((e.altKey && e.key === "ArrowLeft") || (e.key === "Backspace" && !typing) || (e.key === "Escape" && !typing)) back();
    };
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("keydown", onKey);
    };
  }, [back]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => navigate({ name: "search", query: q }), 300);
    return () => clearTimeout(t);
  }, [query, navigate]);

  const nav = useMemo<Nav>(() => ({ server, navigate, back }), [server, navigate, back]);
  const root = stack[0];
  const video = sections?.filter((s) => s.type === "movie" || s.type === "show");

  return (
    <NavContext.Provider value={nav}>
      <div className="flex h-full">
        <aside className="bg-sidebar flex w-60 shrink-0 flex-col gap-1 border-r p-3">
          <div className="flex items-center gap-2 px-2 py-3 text-lg font-semibold">PlexRust</div>
          <NavItem icon={HomeIcon} label="Home" active={root.name === "home"} onClick={() => goRoot({ name: "home" })} />
          {sections === null
            ? Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-9" />)
            : video?.map((s) => (
                <NavItem
                  key={s.key}
                  icon={iconFor(s.type)}
                  label={s.title}
                  active={root.name === "library" && root.section.key === s.key}
                  onClick={() => goRoot({ name: "library", section: s })}
                />
              ))}
          <div className="flex-1" />
          <NavItem icon={Settings} label="Settings" />
          <div className="mt-2 flex items-center gap-2 rounded-lg border p-2">
            <UserAvatar user={user} />
            <div className="min-w-0 flex-1 truncate text-sm">{user.title || user.username}</div>
            <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
              <LogOut />
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b px-6 py-3">
            <Button variant="ghost" size="icon" onClick={back} disabled={stack.length < 2} title="Back">
              <ArrowLeft />
            </Button>
            <div className="relative max-w-md flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies, shows, episodes"
                className="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px]"
              />
            </div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={onSwitchServer}>
              <Server /> {server.name}
              <Badge variant="secondary">{server.relay ? "Relay" : server.local ? "Local" : "Remote"}</Badge>
            </Button>
          </header>

          {error && <p className="text-destructive px-8 pt-4 text-sm">{error}</p>}

          <main className="relative min-h-0 flex-1">
            {stack.map((route, i) => (
              <div key={`${i}:${routeKey(route)}`} className={cn("absolute inset-0", i !== stack.length - 1 && "hidden")}>
                <Screen route={route} />
              </div>
            ))}
          </main>
        </div>
      </div>
    </NavContext.Provider>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomeView />;
    case "library":
      return <LibraryView section={route.section} />;
    case "item":
      return <ItemView ratingKey={route.ratingKey} />;
    case "search":
      return <SearchView query={route.query} />;
  }
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Film;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
