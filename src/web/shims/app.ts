// Stands in for `@tauri-apps/api/app` in the browser build.
export async function getVersion() {
  return `${import.meta.env.VITE_APP_VERSION || "dev"} (browser)`;
}
