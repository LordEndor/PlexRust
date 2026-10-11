import { useEffect, useState } from "react";
import { Clapperboard, Film, Home as HomeIcon, Image, LogOut, Music, Server, Settings, Tv } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { api, errorMessage, type LibrarySection, type ServerConnection, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

const sectionIcon = { movie: Film, show: Tv, artist: Music, photo: Image } as const;

const sectionLabel: Record<string, string> = { movie: "Movies", show: "TV Shows", artist: "Music", photo: "Photos" };

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

  useEffect(() => {
    setSections(null);
    api
      .librarySections()
      .then(setSections)
      .catch((e) => {
        setError(errorMessage(e));
        setSections([]);
      });
  }, [server.machineId]);

  const video = sections?.filter((s) => s.type === "movie" || s.type === "show");

  return (
    <div className="flex h-full">
      <aside className="bg-sidebar flex w-60 flex-col gap-1 border-r p-3">
        <div className="flex items-center gap-2 px-2 py-3 text-lg font-semibold">PlexRust</div>
        <NavItem icon={HomeIcon} label="Home" active />
        {sections === null
          ? Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-9" />)
          : video?.map((s) => <NavItem key={s.key} icon={iconFor(s.type)} label={s.title} />)}
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

      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8 flex items-center gap-3">
          <h1 className="flex-1 text-2xl font-semibold">Home</h1>
          <Button variant="outline" size="sm" onClick={onSwitchServer}>
            <Server /> {server.name}
            <Badge variant="secondary">{server.relay ? "Relay" : server.local ? "Local" : "Remote"}</Badge>
          </Button>
        </header>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Libraries</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {sections === null
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : sections.map((s) => {
                const Icon = iconFor(s.type);
                return (
                  <Card key={s.key} className="hover:bg-accent cursor-pointer gap-0 py-5 transition-colors">
                    <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
                      <Icon className="text-primary row-span-2 size-6" />
                      <CardTitle>{s.title}</CardTitle>
                      <CardDescription>{sectionLabel[s.type] ?? s.type}</CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon: Icon, label, active }: { icon: typeof Film; label: string; active?: boolean }) {
  return (
    <button
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
