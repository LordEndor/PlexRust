// WP1 owns this file.
import type { BrowserCaps } from "./types";

/** Probes what this browser decodes. Cached after the first call. */
export async function detectCaps(): Promise<BrowserCaps> {
  throw new Error("WP1: not implemented");
}
