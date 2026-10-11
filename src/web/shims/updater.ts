// Stands in for `@tauri-apps/plugin-updater` in the browser build: the page
// is always the latest deploy, so there is never an update to install.
export interface Update {
  version: string;
  download: () => Promise<void>;
  install: () => Promise<void>;
  downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
}

export async function check(): Promise<Update | null> {
  return null;
}
