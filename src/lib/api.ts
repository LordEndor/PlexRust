import { invoke } from "@tauri-apps/api/core";

export interface User {
  id: number;
  uuid: string;
  username: string;
  title: string;
  email?: string | null;
  thumb?: string | null;
}

export interface ServerConnection {
  machineId: string;
  name: string;
  uri: string;
  token: string;
  local: boolean;
  relay: boolean;
}

export interface Session {
  user: User | null;
  server: ServerConnection | null;
}

export interface AuthStart {
  pinId: number;
  code: string;
  url: string;
}

export interface ServerSummary {
  machineId: string;
  name: string;
  owned: boolean;
  online: boolean;
  version: string;
  platform?: string | null;
}

export interface LibrarySection {
  key: string;
  type: "movie" | "show" | "artist" | "photo" | string;
  title: string;
}

/** Typed wrappers around the Rust commands in `src-tauri/src/commands.rs`. */
export const api = {
  getSession: () => invoke<Session>("get_session"),
  authStart: () => invoke<AuthStart>("auth_start"),
  authWait: (pinId: number, code: string) => invoke<User>("auth_wait", { pinId, code }),
  signOut: () => invoke<void>("sign_out"),
  listServers: () => invoke<ServerSummary[]>("list_servers"),
  selectServer: (machineId: string) => invoke<ServerConnection>("select_server", { machineId }),
  librarySections: () => invoke<LibrarySection[]>("library_sections"),
};

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
