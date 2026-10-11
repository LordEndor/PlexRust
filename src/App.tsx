import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { api, type Session } from "@/lib/api";
import { useAccent } from "@/lib/prefs";
import { SignIn } from "@/screens/SignIn";
import { ServerPicker } from "@/screens/ServerPicker";
import { Home } from "@/screens/Home";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [picking, setPicking] = useState(false);
  useAccent();

  useEffect(() => {
    api.getSession().then((s) => {
      setSession(s);
      // Re-pick the best address in the background: the saved one may be
      // stale, or worse than what's reachable now.
      if (s.user && s.server) {
        api
          .selectServer(s.server.machineId)
          .then((server) => setSession((cur) => (cur?.server?.machineId === server.machineId ? { ...cur, server } : cur)))
          .catch(() => {});
      }
    });
  }, []);

  if (!session) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!session.user) {
    return <SignIn onSignedIn={(user) => setSession({ user, server: null })} />;
  }

  if (!session.server || picking) {
    return (
      <ServerPicker
        user={session.user}
        current={session.server}
        onSelected={(server) => {
          setSession({ ...session, server });
          setPicking(false);
        }}
        onSignOut={async () => {
          await api.signOut();
          setSession({ user: null, server: null });
        }}
      />
    );
  }

  return (
    <Home
      user={session.user}
      server={session.server}
      onSwitchServer={() => setPicking(true)}
      onSignOut={async () => {
        await api.signOut();
        setSession({ user: null, server: null });
      }}
    />
  );
}
