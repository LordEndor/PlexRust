# Seerr in the browser version

The desktop app talks to Seerr from its Rust side, so nothing extra is needed
there. The browser version (<https://lordendor.github.io/PlexRust/>) calls
Seerr from the web page itself, and Seerr (like Overseerr and Jellyseerr)
doesn't send the CORS headers a browser needs before it lets a page on another
site read the answer. The Settings page says so when it happens:
"…answers, but the browser blocked the call".

The fix is a tiny proxy next to Seerr that adds those headers. Radarr and
Sonarr already send them, so the calendar needs no proxy.

## With Caddy (Docker)

Save this as `Caddyfile` on the machine that runs Seerr, changing the last
line if Seerr isn't at `192.168.1.109:5055`:

```
:5056 {
	header {
		Access-Control-Allow-Origin "https://lordendor.github.io"
		Access-Control-Allow-Headers "X-Api-Key, Content-Type, Accept"
		Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS"
		Access-Control-Allow-Private-Network "true"
		defer
	}
	@preflight method OPTIONS
	respond @preflight 204
	reverse_proxy 192.168.1.109:5055
}
```

Then start it next to the file:

```
docker run -d --name seerr-cors --restart unless-stopped \
  -p 5056:5056 -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" caddy:2
```

In the browser version, open Settings, Requests and enter
`http://192.168.1.109:5056` with Seerr's API key (Seerr, Settings, General).
Chrome and Edge ask once to access devices on your local network; allow it.

## Notes

- The browser version always uses the API key, because Seerr's sign-in cookie
  isn't sent to a page on another site. Requests are made as the Seerr admin,
  the same as the API key option in the desktop app.
- The key is kept in the browser's local storage. Disconnect in Settings on a
  shared computer.
- Any reverse proxy works (Nginx Proxy Manager, Traefik, a Seerr already
  behind HTTPS); it only has to add the headers above and answer `OPTIONS`.
