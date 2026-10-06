import type { UnifiedItem } from "@couch/core";
import { useState } from "react";
import { Focusable, useIsFocused } from "../focus/scope.tsx";

/** Poster tile with a text fallback for missing art. Size is set by the parent (width in rem). */
export function Tile({
  item,
  fkey,
  width = 14,
  anchor = true,
}: {
  item: UnifiedItem;
  fkey: string;
  width?: number;
  /** Whether this tile is the unit that vertical scrolling keeps in view (false inside Watch rows). */
  anchor?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const focused = useIsFocused(fkey);
  const pct = item.progress?.durationSec
    ? Math.min(100, (100 * item.progress.positionSec) / item.progress.durationSec)
    : 0;
  return (
    <div
      className="shrink-0"
      style={{ width: `${width}rem` }}
      data-item-key={item.key}
      data-scroll-anchor={anchor ? "" : undefined}
    >
      <Focusable
        fkey={fkey}
        label={item.title}
        className="tile relative overflow-hidden rounded-xl bg-slate"
        style={{ width: `${width}rem`, height: `${width * 1.5}rem` }}
      >
        {failed ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-slate-2 to-slate p-4 text-center"
            data-fallback="true"
          >
            <span className="text-[2rem] font-semibold leading-tight">{item.title}</span>
            {item.subtitle && <span className="text-muted">{item.subtitle}</span>}
          </div>
        ) : (
          <img
            src={item.art.poster}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setFailed(true)}
          />
        )}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[0.6rem] bg-ink/80">
            <div className="h-full bg-lamp" style={{ width: `${pct}%` }} />
          </div>
        )}
        {item.favourite && (
          <div
            className="absolute top-3 right-3 rounded-full bg-ink/90 px-3 text-lamp"
            role="img"
            aria-label="Favourite"
          >
            ★
          </div>
        )}
      </Focusable>
      <div className={`mt-[1.75rem] truncate ${focused ? "font-semibold text-text" : "text-muted"}`}>
        {item.title}
      </div>
    </div>
  );
}

export function SkeletonTile({ width = 14 }: { width?: number }) {
  return (
    <div className="shrink-0" style={{ width: `${width}rem` }} data-skeleton="true">
      <div className="skeleton rounded-xl" style={{ width: `${width}rem`, height: `${width * 1.5}rem` }} />
      <div className="skeleton mt-[1.75rem] h-[1.75rem] w-3/4 rounded" />
    </div>
  );
}
