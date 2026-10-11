import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage, type AuthStart, type User } from "@/lib/api";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [pending, setPending] = useState<AuthStart | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const auth = await api.authStart();
      setPending(auth);
      await openUrl(auth.url);
      onSignedIn(await api.authWait(auth.pinId, auth.code));
    } catch (e) {
      setError(errorMessage(e));
      setPending(null);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-[radial-gradient(ellipse_at_top,var(--color-card),transparent_60%)] p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="bg-primary text-primary-foreground mx-auto mb-2 grid size-12 place-items-center rounded-2xl">
            <Play className="size-6 fill-current" />
          </div>
          <CardTitle className="text-2xl">PlexRust</CardTitle>
          <CardDescription>Sign in with your Plex account to get started.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pending ? (
            <>
              <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Waiting for you to approve in your browser
              </div>
              <Button variant="outline" onClick={() => openUrl(pending.url)}>
                <ExternalLink /> Open sign-in page again
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={start}>
              Sign in with Plex
            </Button>
          )}
          {error && <p className="text-destructive text-center text-sm">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
