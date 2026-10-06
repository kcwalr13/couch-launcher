import { useEffect, useMemo } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import { SkeletonTile, Tile } from "../components/Tile.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

export function Watch() {
  const nav = useNav();
  const { data, error } = useApi("watch", api.watch, nav.refreshToken);
  const rowsData = data?.rows ?? [];
  const all = rowsData.flatMap((r) => r.items);
  const problem = data?.status === "unreachable" || data?.status === "not_configured";
  const rows: FocusRow[] = useMemo(
    () => [
      // When Jellyfin has a problem there is always something to focus: retry, or open Settings.
      { id: "banner", keys: problem ? ["btn:retry", "btn:settings"] : [] },
      ...rowsData.map((r) => ({ id: r.id, keys: r.items.map((i) => `tile:${r.id}:${i.key}`) })),
    ],
    [rowsData, problem],
  );
  const itemFor = (k: string | null) => {
    if (!k) return undefined;
    const [, rowId, ...rest] = k.split(":");
    const key = rest.join(":");
    return rowsData.find((r) => r.id === rowId)?.items.find((i) => i.key === key);
  };
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: rows.find((r) => r.id !== "banner" && r.keys.length)?.keys[0] ?? "btn:retry",
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: data !== null || error !== null,
    onSelect: (k) => {
      if (k === "btn:retry") {
        nav.refresh();
        return;
      }
      if (k === "btn:settings") {
        nav.push("settings");
        return;
      }
      const item = itemFor(k);
      // One press hands off to playback (resuming where it stopped). Details are in the Y menu.
      if (item) nav.launch(item);
    },
    onOptions: (k) => {
      const item = itemFor(k);
      if (item) nav.openOptions(item);
    },
  });
  const focusedItem = itemFor(focusedKey);
  useEffect(() => nav.setBackdrop(focusedItem ? focusedItem.art.hero : null), [focusedItem, nav.setBackdrop]);

  let banner: { title: string; detail: string } | null = null;
  if (data?.status === "not_configured")
    banner = {
      title: "Jellyfin is not set up",
      detail: "Add the server URL and API key to config.toml, then restart Couch Launcher.",
    };
  else if (data?.status === "unreachable")
    banner = data.cached
      ? {
          title: "Can't reach Jellyfin",
          detail: "Showing what was saved last time. Playback needs the server.",
        }
      : { title: "Can't reach Jellyfin", detail: "Check that the NAS is on. Nothing has been saved yet." };

  return (
    <FocusProvider focusedKey={focusedKey}>
      {banner && (
        <div className="inset mt-6 flex items-center gap-6" data-testid="watch-banner">
          <div className="flex-1">
            <EmptyState title={banner.title} detail={banner.detail} />
          </div>
          <Focusable fkey="btn:retry" className="btn rounded-xl bg-slate-2 px-8 py-4 font-semibold">
            Try again
          </Focusable>
          <Focusable fkey="btn:settings" className="btn rounded-xl bg-slate-2 px-8 py-4 font-semibold">
            Settings
          </Focusable>
        </div>
      )}
      {error && !data && <EmptyState title="Could not load Watch" detail={error} />}
      <div
        className={`mt-4 overflow-hidden ${banner ? "h-[calc(100%-10rem)]" : "h-[calc(100%-1rem)]"} px-6 pt-4`}
        data-scroll-y="start"
      >
        <div className="flex flex-col gap-8 pb-8">
          {!data
            ? ["Continue Watching", "Next Up"].map((t) => (
                <section key={t}>
                  <h2 className="inset mb-4 text-[2.25rem] font-bold">{t}</h2>
                  <div className="row-scroll">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <SkeletonTile key={i} width={14} />
                    ))}
                  </div>
                </section>
              ))
            : rowsData.map((r) => (
                <section key={r.id} aria-label={r.title} data-row={r.id} data-scroll-anchor="">
                  <h2 className="inset mb-4 text-[2.25rem] font-bold">{r.title}</h2>
                  {r.items.length === 0 ? (
                    <div className="inset text-muted" data-testid={`empty-${r.id}`}>
                      Nothing here right now.
                    </div>
                  ) : (
                    <div className="row-scroll" data-scroll-x="">
                      {r.items.map((i) => (
                        <Tile key={i.key} item={i} fkey={`tile:${r.id}:${i.key}`} width={14} anchor={false} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
          {data && all.length === 0 && !banner && (
            <EmptyState
              title="Your Jellyfin library is empty"
              detail="New movies and episodes appear here."
            />
          )}
        </div>
      </div>
    </FocusProvider>
  );
}
