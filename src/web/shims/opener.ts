// Stands in for `@tauri-apps/plugin-opener` in the browser build.
export async function openUrl(url: string) {
  window.open(url, "_blank", "noopener");
}
