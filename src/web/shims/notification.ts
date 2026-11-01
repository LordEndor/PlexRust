// Stands in for `@tauri-apps/plugin-notification` in the browser build, which doesn't notify.
export async function isPermissionGranted() {
  return false;
}
export async function requestPermission() {
  return "denied" as const;
}
export function sendNotification(_options: { title: string; body?: string }) {}
