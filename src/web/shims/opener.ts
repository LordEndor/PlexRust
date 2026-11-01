// Stands in for `@tauri-apps/plugin-opener` in the browser build.
export async function openUrl(url: string) {
  window.open(url, "_blank", "noopener");
}

/** Files aren't saved in the browser build, so there's no folder to show. */
export async function revealItemInDir(_path: string) {}
