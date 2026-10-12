import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Clapperboard,
  Compass,
  Film,
  Home as HomeIcon,
  Image,
  ListVideo,
  LogOut,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useCalendarEnabled } from "@/lib/calendar";
import { useSeerrEnabled } from "@/lib/seerr";
import { cn } from "@/lib/utils";
import { CalendarView } from "@/screens/CalendarView";
import { HomeView } from "@/screens/HomeView";
import { DiscoverView } from "@/screens/DiscoverView";
import { ItemView } from "@/screens/ItemView";
import { LibraryView } from "@/screens/LibraryView";
import { PlaylistsView, PlaylistView } from "@/screens/PlaylistView";
import { Player } from "@/screens/Player";
import { HAS_TITLE_BAR, WindowControls } from "@/components/TitleBar";
import { RequestsView } from "@/screens/RequestsView";
import { RequestView } from "@/screens/RequestView";
import { SearchView } from "@/screens/SearchView";
import { SettingsView } from "@/screens/SettingsView";

const sectionIcon = { movie: Film, show: Tv, artist: Music, photo: Image } as const;
const MAX_STACK = 15;
const SIDEBAR_KEY = "plexrust.sidebarCollapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const requestsEnabled = useSeerrEnabled();
  const calendarEnabled = useCalendarEnabled();

  function toggleSidebar() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        // Not remembered; it still toggles.
      }
      return !c;
    });
  }

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
  // The next episode replaces the current one, so Back still leads to where playback started.
  const playNext = useCallback(
    (ratingKey: string) =>
      setStack((s) => {
        const top = s[s.length - 1];
        const playlist = top.name === "player" ? top.playlist : undefined;
        return [...s.slice(0, -1), { name: "player", ratingKey, resume: false, playlist }];
      }),
    [],
  );

  useEffect(() => {
    const onMouse = (e: MouseEvent) => e.button === 3 && back();
    const onKey = (e: KeyboardEvent) => {
      if (document.documentElement.classList.contains("playing")) return;
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
  const top = stack[stack.length - 1];
  const video = sections?.filter((s) => s.type === "movie" || s.type === "show");

  return (
    <NavContext.Provider value={nav}>
      <div className="flex h-full">
        <aside
          className={cn(
            "bg-sidebar flex shrink-0 flex-col gap-1 overflow-hidden border-r p-3 transition-[width] duration-200",
            collapsed ? "w-[4.25rem]" : "w-60",
          )}
        >
          <div
            data-tauri-drag-region
            className={cn("flex items-center gap-2 py-2", collapsed ? "justify-center" : "pl-2")}
          >
            {!collapsed && (
              <span data-tauri-drag-region className="flex-1 truncate text-lg font-semibold">
                PlexRust
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-8"
              onClick={toggleSidebar}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
          <NavItem
            icon={HomeIcon}
            label="Home"
            collapsed={collapsed}
            active={root.name === "home"}
            onClick={() => goRoot({ name: "home" })}
          />
          {sections === null
            ? Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-9" />)
            : video?.map((s) => (
                <NavItem
                  key={s.key}
                  icon={iconFor(s.type)}
                  label={s.title}
                  collapsed={collapsed}
                  active={root.name === "library" && root.section.key === s.key}
                  onClick={() => goRoot({ name: "library", section: s })}
                />
              ))}
          <NavItem
            icon={ListVideo}
            label="Playlists"
            collapsed={collapsed}
            active={root.name === "playlists"}
            onClick={() => goRoot({ name: "playlists" })}
          />
          {requestsEnabled && (
            <NavItem
              icon={Compass}
              label="Discover"
              collapsed={collapsed}
              active={root.name === "discover"}
              onClick={() => goRoot({ name: "discover" })}
            />
          )}
          {calendarEnabled && (
            <NavItem
              icon={CalendarDays}
              label="Calendar"
              collapsed={collapsed}
              active={root.name === "calendar"}
              onClick={() => goRoot({ name: "calendar" })}
            />
          )}
          <div className="flex-1" />
          <NavItem
            icon={Settings}
            label="Settings"
            collapsed={collapsed}
            active={root.name === "settings"}
            onClick={() => goRoot({ name: "settings" })}
          />
          <div
            className={cn("mt-2 flex items-center gap-2 rounded-lg border p-2", collapsed && "flex-col border-0 p-0")}
            title={collapsed ? user.title || user.username : undefined}
          >
            <UserAvatar user={user} />
            {!collapsed && <div className="min-w-0 flex-1 truncate text-sm">{user.title || user.username}</div>}
            <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
              <LogOut />
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header data-tauri-drag-region className="flex items-center gap-3 border-b py-3 pl-6">
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
            <div data-tauri-drag-region className="flex-1" />
            <Button variant="outline" size="sm" onClick={onSwitchServer}>
              <Server /> {server.name}
              <Badge variant="secondary">{server.relay ? "Relay" : server.local ? "Local" : "Remote"}</Badge>
            </Button>
            {HAS_TITLE_BAR ? <WindowControls className="-mt-3 self-start" /> : <div className="w-3" />}
          </header>

          {error && <p className="text-destructive px-8 pt-4 text-sm">{error}</p>}

          <main className="relative min-h-0 flex-1">
            {stack.map((route, i) =>
              route.name === "player" ? null : (
                <div key={`${i}:${routeKey(route)}`} className={cn("absolute inset-0", route !== top && "hidden")}>
                  <Screen route={route} />
                </div>
              ),
            )}
          </main>
          {top.name === "player" && (
            <Player
              key={top.ratingKey}
              ratingKey={top.ratingKey}
              resume={top.resume}
              playlist={top.playlist}
              onClose={back}
              onPlayNext={playNext}
            />
          )}
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
      return <LibraryView section={route.section} sort={route.sort} filters={route.filters} />;
    case "item":
      return <ItemView ratingKey={route.ratingKey} />;
    case "search":
      return <SearchView query={route.query} />;
    case "settings":
      return <SettingsView />;
    case "discover":
      return <DiscoverView query={route.query} />;
    case "request":
      return <RequestView mediaType={route.mediaType} tmdbId={route.tmdbId} />;
    case "requests":
      return <RequestsView />;
    case "calendar":
      return <CalendarView />;
    case "playlists":
      return <PlaylistsView />;
    case "playlist":
      return <PlaylistView ratingKey={route.ratingKey} />;
    case "player":
      return null;
  }
}

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: typeof Film;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={cn(
        "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
        active && "bg-sidebar-accent text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
