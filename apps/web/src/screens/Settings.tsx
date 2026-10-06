import type { SourceStatus, StatusResponse } from "@couch/core";
import { useMemo, useState } from "react";
import { api } from "../api.ts";
import { Tile } from "../components/Tile.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

const STATE_TEXT: Record<SourceStatus["state"], string> = {
  ok: "Connected",
  mock: "Mock data",
  degraded: "Needs attention",
  unreachable: "Can't reach it",
  not_configured: "Not set up",
};
const STATE_MARK: Record<SourceStatus["state"], string> = {
  ok: "●",
  mock: "●",
  degraded: "▲",
  unreachable: "✕",
  not_configured: "○",
};

function StatusCard({ title, s, lines }: { title: string; s: SourceStatus; lines: string[] }) {
  const good = s.state === "ok" || s.state === "mock";
  return (
    <div
      className="flex-1 rounded-2xl bg-slate px-8 py-6"
      data-testid={`status-${title.toLowerCase()}`}
      data-state={s.state}
    >
      <div className="flex items-center gap-4">
        <span className="text-[2.25rem] font-bold">{title}</span>
        <span className={good ? "text-text" : "text-danger"} aria-hidden="true">
          {STATE_MARK[s.state]}
        </span>
        <span className={good ? "text-text" : "font-semibold text-danger"}>{STATE_TEXT[s.state]}</span>
      </div>
      <div className="mt-2 truncate text-muted">{s.detail}</div>
      {lines.map((l) => (
        <div key={l} className="truncate text-muted">
          {l}
        </div>
      ))}
    </div>
  );
}

/** Health and options, all reachable by controller. Secrets are edited in the config file only. */
export function Settings() {
  const nav = useNav();
  const { data: status, reload } = useApi<StatusResponse>("status", api.status, nav.refreshToken);
  const { data: hidden } = useApi("hidden", api.hidden, nav.refreshToken);
  const [scale, setScale] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const uiScale = scale ?? status?.uiScale ?? 1;
  const hiddenItems = hidden?.items ?? [];

  const rows: FocusRow[] = useMemo(
    () => [
      { id: "actions", keys: ["set:rescan", "set:smaller", "set:larger", "set:profiles"] },
      { id: "hidden", keys: hiddenItems.map((i) => `hidden:${i.key}`) },
    ],
    [hiddenItems],
  );

  const applyScale = (v: number) =>
    api
      .setScale(v)
      .then((r) => {
        setScale(r.uiScale);
        document.documentElement.style.setProperty("--ui-scale", String(r.uiScale));
      })
      .catch((e: Error) => nav.message(e.message, "error"));

  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: "set:rescan",
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: status !== null && hidden !== null,
    onSelect: (k) => {
      if (k === "set:rescan" && !busy) {
        setBusy(true);
        api
          .rescan()
          .then(() => {
            nav.message("Library rescanned");
            nav.refresh();
            reload();
          })
          .catch((e: Error) => nav.message(e.message, "error"))
          .finally(() => setBusy(false));
      } else if (k === "set:smaller") void applyScale(Math.round((uiScale - 0.05) * 100) / 100);
      else if (k === "set:larger") void applyScale(Math.round((uiScale + 0.05) * 100) / 100);
      else if (k === "set:profiles") nav.push("profiles");
      else if (k.startsWith("hidden:")) {
        const key = k.slice("hidden:".length);
        const item = hiddenItems.find((i) => i.key === key);
        api
          .prefs({ key, hidden: false })
          .then(() => {
            nav.message(`${item?.title ?? "Item"} is visible again`);
            nav.refresh();
          })
          .catch((e: Error) => nav.message(e.message, "error"));
      }
    },
  });

  return (
    <FocusProvider focusedKey={focusedKey}>
      <div className="inset mt-6 flex gap-6">
        {status ? (
          <>
            <StatusCard
              title="Steam"
              s={status.steam}
              lines={[
                status.steam.root ?? "No Steam folder found",
                ...status.steam.libraries.slice(1).map((l) => `Also ${l}`),
              ]}
            />
            <StatusCard
              title="Jellyfin"
              s={status.jellyfin}
              lines={[
                status.jellyfin.server ?? "No server set",
                status.configFile ? `Settings file: ${status.configFile}` : "Mock mode",
              ]}
            />
          </>
        ) : (
          <div className="skeleton h-[13rem] flex-1 rounded-2xl" data-skeleton="true" />
        )}
      </div>
      <div className="inset mt-8 flex items-center gap-5">
        <Focusable fkey="set:rescan" className="btn rounded-xl bg-slate-2 px-8 py-4 font-semibold">
          {busy ? "Rescanning…" : "Rescan library"}
        </Focusable>
        <span className="ml-6 text-muted">Text size</span>
        <Focusable
          fkey="set:smaller"
          label="Smaller"
          className="btn rounded-xl bg-slate-2 px-8 py-4 font-semibold"
        >
          A−
        </Focusable>
        <span className="w-[6rem] text-center tabular-nums" data-testid="ui-scale">
          {Math.round(uiScale * 100)}%
        </span>
        <Focusable
          fkey="set:larger"
          label="Larger"
          className="btn rounded-xl bg-slate-2 px-8 py-4 font-semibold"
        >
          A+
        </Focusable>
        <Focusable fkey="set:profiles" className="btn ml-6 rounded-xl bg-slate-2 px-8 py-4 font-semibold">
          Profiles
        </Focusable>
        <span className="ml-auto text-muted">v{status?.version}</span>
      </div>
      <h2 className="inset mt-8 mb-4 text-[2.25rem] font-bold">
        Hidden for {nav.profile?.name ?? "this profile"}
      </h2>
      {hiddenItems.length === 0 ? (
        <div className="inset text-muted">Nothing hidden. Hide things with Y.</div>
      ) : (
        <div className="row-scroll" data-scroll-x="">
          {hiddenItems.map((i) => (
            <Tile key={i.key} item={i} fkey={`hidden:${i.key}`} width={10} />
          ))}
        </div>
      )}
    </FocusProvider>
  );
}
