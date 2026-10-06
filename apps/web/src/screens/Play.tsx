import type { GameSort } from "@couch/core";
import { useEffect, useMemo } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import { SkeletonTile, Tile } from "../components/Tile.tsx";
import { type FocusRow, gridRows } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";
import { metaLine } from "./Detail.tsx";

export const PLAY_COLUMNS = 6;
const SORTS: { id: GameSort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "az", label: "A to Z" },
  { id: "playtime", label: "Playtime" },
];

export function Play() {
  const nav = useNav();
  const sort = (nav.entry.params.sort as GameSort | undefined) ?? "recent";
  const coop = nav.entry.params.coop === "1";
  const controller = nav.entry.params.controller === "1";
  const { data, error } = useApi(
    `games:${sort}:${coop}:${controller}`,
    () => api.games(sort, coop, controller),
    nav.refreshToken,
  );
  const items = data?.items ?? [];
  const rows: FocusRow[] = useMemo(
    () => [
      { id: "controls", keys: [...SORTS.map((s) => `sort:${s.id}`), "filter:coop", "filter:controller"] },
      ...gridRows(
        "grid",
        items.map((i) => `tile:${i.key}`),
        PLAY_COLUMNS,
      ),
    ],
    [items],
  );
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: items[0] ? `tile:${items[0].key}` : "sort:recent",
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: data !== null || error !== null,
    onSelect: (k) => {
      if (k.startsWith("sort:")) nav.setParams({ ...nav.entry.params, sort: k.slice(5) });
      else if (k === "filter:coop") nav.setParams({ ...nav.entry.params, coop: coop ? "0" : "1" });
      else if (k === "filter:controller")
        nav.setParams({ ...nav.entry.params, controller: controller ? "0" : "1" });
      else if (k.startsWith("tile:")) {
        // One press launches. Details are in the Y menu.
        const item = items.find((i) => `tile:${i.key}` === k);
        if (item) nav.launch(item);
      }
    },
    onOptions: (k) => {
      const item = items.find((i) => `tile:${i.key}` === k);
      if (item) nav.openOptions(item);
    },
  });
  const focusedItem = items.find((i) => `tile:${i.key}` === focusedKey);
  useEffect(() => nav.setBackdrop(focusedItem ? focusedItem.art.hero : null), [focusedItem, nav.setBackdrop]);

  const chip = (k: string, label: string, on: boolean) => (
    <Focusable
      key={k}
      fkey={k}
      className={`chip rounded-full px-7 py-2 ${on ? "bg-text font-semibold text-ink" : "bg-slate-2 text-text"}`}
    >
      {on && k.startsWith("filter:") ? "✓ " : ""}
      {label}
    </Focusable>
  );

  return (
    <FocusProvider focusedKey={focusedKey}>
      <div className="flex h-full flex-col">
        <div className="inset mt-6 flex items-center gap-5">
          <span className="text-muted">Sort</span>
          {SORTS.map((s) => chip(`sort:${s.id}`, s.label, sort === s.id))}
          <span className="ml-6 text-muted">Show only</span>
          {chip("filter:coop", "Couch co-op", coop)}
          {chip("filter:controller", "Full controller", controller)}
          <span className="ml-auto text-muted" data-testid="game-count">
            {data ? `${items.length} games` : ""}
          </span>
        </div>
        <div className="inset mt-4 h-[2.5rem] truncate" data-testid="focused-meta">
          {focusedItem ? (
            <>
              <span className="font-semibold">{focusedItem.title}</span>
              <span className="text-muted"> · {metaLine(focusedItem, nav.now).join(" · ")}</span>
            </>
          ) : null}
        </div>
        <div
          className="mt-2 min-h-0 flex-1 overflow-hidden px-6 pt-6"
          data-testid="games-grid"
          data-scroll-y=""
        >
          {error && !data ? (
            <EmptyState title="Could not load games" detail={error} />
          ) : !data ? (
            <div className="grid grid-cols-6 gap-x-8 gap-y-8">
              {Array.from({ length: 12 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
                <SkeletonTile key={i} width={15} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={coop || controller ? "No games match these filters" : "No installed games found"}
              detail={coop || controller ? "Turn a filter off to see more." : "Check Steam in Settings."}
            />
          ) : (
            <div className="grid grid-cols-6 gap-x-8 gap-y-8 pb-8">
              {items.map((i) => (
                <Tile key={i.key} item={i} fkey={`tile:${i.key}`} width={15} />
              ))}
            </div>
          )}
        </div>
      </div>
    </FocusProvider>
  );
}
