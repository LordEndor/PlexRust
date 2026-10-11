// Stands in for `@tauri-apps/api/core` in the browser build (see vite.config.ts).
import { invokeWeb } from "@/web/plex";

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invokeWeb<T>(cmd, args);
}

export function convertFileSrc(path: string, protocol = "asset") {
  return `${protocol}://${path}`;
}
