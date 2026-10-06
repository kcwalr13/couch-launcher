/** Typed client for the local service. The UI only ever talks to these endpoints. */
import type {
  GameSort,
  GamesResponse,
  HomeResponse,
  ItemResponse,
  LaunchResponse,
  PrefsRequest,
  Profile,
  StatusResponse,
  TonightRequest,
  TonightResponse,
  UiState,
  WatchResponse,
} from "@couch/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("The Couch Launcher service is not responding.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new ApiError(data.message ?? data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export const api = {
  status: () => call<StatusResponse>("GET", "/api/status"),
  home: () => call<HomeResponse>("GET", "/api/home"),
  games: (sort: GameSort, coop: boolean, controller: boolean) =>
    call<GamesResponse>(
      "GET",
      `/api/games?sort=${sort}&coop=${coop ? 1 : 0}&controller=${controller ? 1 : 0}`,
    ),
  watch: () => call<WatchResponse>("GET", "/api/watch"),
  item: (key: string) => call<ItemResponse>("GET", `/api/items/${encodeURIComponent(key)}`),
  launch: (key: string, fromStart = false) =>
    call<LaunchResponse>("POST", `/api/launch/${encodeURIComponent(key)}${fromStart ? "?from=start" : ""}`),
  profiles: () => call<{ profiles: Profile[]; active: Profile }>("GET", "/api/profiles"),
  switchProfile: (id: number) =>
    call<{ profiles: Profile[]; active: Profile }>("POST", "/api/profiles", { id }),
  prefs: (p: PrefsRequest) => call<{ ok: boolean }>("POST", "/api/prefs", p),
  getUiState: () => call<{ state: UiState | null }>("GET", "/api/ui-state"),
  putUiState: (s: UiState) => call<{ ok: boolean }>("PUT", "/api/ui-state", s),
  tonight: (r: TonightRequest) => call<TonightResponse>("POST", "/api/tonight", r),
  tonightAccept: (key: string, profileId: number) =>
    call<{ ok: boolean }>("POST", "/api/tonight/accept", { key, profileId }),
  tonightDefaults: () =>
    call<{ answers: { time: TonightRequest["time"]; profileId: number; mode: TonightRequest["mode"] } }>(
      "GET",
      "/api/tonight/last",
    ),
  rescan: () => call<{ ok: boolean }>("POST", "/api/rescan"),
  setScale: (scale: number) => call<{ uiScale: number }>("POST", "/api/settings", { uiScale: scale }),
  hidden: () => call<{ items: import("@couch/core").UnifiedItem[] }>("GET", "/api/hidden"),
};
