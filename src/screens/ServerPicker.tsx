import { useEffect, useState } from "react";
import { Check, Loader2, LogOut, RefreshCw, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { api, errorMessage, type ServerConnection, type ServerSummary, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  user: User;
  current: ServerConnection | null;
  onSelected: (server: ServerConnection) => void;
  onSignOut: () => void;
}

export function ServerPicker({ user, current, onSelected, onSignOut }: Props) {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setServers(null);
    setError(null);
    try {
      setServers(await api.listServers());
    } catch (e) {
      setError(errorMessage(e));
      setServers([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function choose(id: string) {
    setConnecting(id);
    setError(null);
    try {
      onSelected(await api.selectServer(id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 p-10">
      <header className="flex items-center gap-3">
        <UserAvatar user={user} className="size-10" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Choose a server</h1>
          <p className="text-muted-foreground text-sm">Signed in as {user.title || user.username}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="Refresh">
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
          <LogOut />
        </Button>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex flex-col gap-2">
        {servers === null &&
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
        {servers?.length === 0 && !error && (
          <p className="text-muted-foreground text-sm">No Plex Media Servers found on this account.</p>
        )}
        {servers?.map((s) => (
          <button
            key={s.machineId}
            disabled={connecting !== null}
            onClick={() => choose(s.machineId)}
            className={cn(
              "bg-card hover:bg-accent flex items-center gap-4 rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
              current?.machineId === s.machineId && "border-primary/60",
            )}
          >
            <div className="bg-secondary grid size-10 place-items-center rounded-lg">
              <Server className="size-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 font-medium">
                {s.name}
                {s.owned ? <Badge variant="secondary">Owned</Badge> : <Badge variant="outline">Shared</Badge>}
              </div>
              <div className="text-muted-foreground text-xs">
                {[s.platform, s.version && `v${s.version}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className={cn("size-2 rounded-full", s.online ? "bg-emerald-500" : "bg-zinc-600")} />
            {connecting === s.machineId ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              current?.machineId === s.machineId && <Check className="text-primary size-4" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
