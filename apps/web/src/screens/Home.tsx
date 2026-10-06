import { useEffect, useMemo } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import { SkeletonTile, Tile } from "../components/Tile.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

export function Home() {
  const nav = useNav();
  const { data, error } = useApi("home", api.home, nav.refreshToken);
  const items = data?.continueRow ?? [];
  const rows: FocusRow[] = useMemo(
    () => [
      { id: "actions", keys: ["btn:tonight", "btn:play", "btn:watch", "btn:profile"] },
      { id: "continue", keys: items.map((i) => `tile:${i.key}`) },
    ],
    [items],
  );
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: "btn:tonight",
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: data !== null || error !== null,
    onSelect: (k) => {
      if (k === "btn:tonight") nav.push("tonight");
      else if (k === "btn:play") nav.push("play");
      else if (k === "btn:watch") nav.push("watch");
      else if (k === "btn:profile") nav.push("profiles");
      else if (k.startsWith("tile:")) nav.push("detail", { key: k.slice(5) });
    },
    onOptions: (k) => {
      const item = items.find((i) => `tile:${i.key}` === k);
      if (item) nav.openOptions(item);
    },
  });
  const focusedItem = items.find((i) => `tile:${i.key}` === focusedKey);
  useEffect(() => nav.setBackdrop(focusedItem ? focusedItem.art.hero : null), [focusedItem, nav.setBackdrop]);

  return (
    <FocusProvider focusedKey={focusedKey}>
      <section className="inset mt-8 flex items-stretch gap-6" aria-label="Start">
        <Focusable
          fkey="btn:tonight"
          testId="tonight-button"
          className="btn flex w-[30rem] flex-col justify-center rounded-2xl bg-lamp px-10 py-7 text-lamp-ink"
        >
          <span className="text-[3rem] font-extrabold leading-tight">Tonight</span>
          <span className="text-[1.75rem] font-medium">Three picks in three questions</span>
        </Focusable>
        {[
          ["btn:play", "Play", "Games"],
          ["btn:watch", "Watch", "Jellyfin"],
        ].map(([k, t, s]) => (
          <Focusable
            key={k}
            fkey={k as string}
            className="btn flex w-[17rem] flex-col justify-center rounded-2xl bg-slate-2 px-8"
          >
            <span className="text-[2.5rem] font-bold">{t}</span>
            <span className="text-muted">{s}</span>
          </Focusable>
        ))}
        <Focusable
          fkey="btn:profile"
          testId="profile-chip"
          className="btn ml-auto flex flex-col justify-center rounded-2xl bg-slate-2 px-8"
        >
          <span className="text-muted">On the couch</span>
          <span className="text-[2.25rem] font-bold">{nav.profile?.name ?? "…"}</span>
        </Focusable>
      </section>

      <section className="mt-10" aria-label="Continue">
        <h2 className="inset mb-5 text-[2.25rem] font-bold">Continue</h2>
        {error && !data ? (
          <div className="inset">
            <EmptyState title="Could not load the Continue row" detail={error} />
          </div>
        ) : !data ? (
          <div className="row-scroll">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonTile key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing in progress yet"
            detail="Games you play and shows you start appear here."
          />
        ) : (
          <div className="row-scroll" data-row="continue" data-scroll-x="">
            {items.map((i) => (
              <Tile key={i.key} item={i} fkey={`tile:${i.key}`} />
            ))}
          </div>
        )}
      </section>
    </FocusProvider>
  );
}
