import { durationText, playtimeText, relativeDay, remainingMinutes, type UnifiedItem } from "@couch/core";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

const tz = () => -new Date().getTimezoneOffset();

export function metaLine(item: UnifiedItem, now: Date): string[] {
  const out: string[] = [];
  if (item.kind === "game") {
    const last = relativeDay(item.lastActivityAt, now, tz());
    out.push(last ? `Last played ${last}` : "Never played");
    const pt = playtimeText(item.playtimeMin);
    if (pt) out.push(pt);
  } else {
    const left = remainingMinutes(item.progress);
    if (item.progress && item.progress.positionSec > 0 && left !== null)
      out.push(`${durationText(left)} left`);
    else if (item.progress) out.push(durationText(Math.round(item.progress.durationSec / 60)));
    const last = relativeDay(item.lastActivityAt, now, tz());
    if (last) out.push(`Watched ${last}`);
  }
  return out;
}

export function tagLine(item: UnifiedItem): string[] {
  const t: string[] = [];
  if (item.tags.couchCoop) t.push("Couch co-op");
  if (item.tags.controller === "full") t.push("Full controller support");
  else if (item.tags.controller === "partial") t.push("Partial controller support");
  if (item.kind === "game" && item.tags.sessionLength)
    t.push(
      `${item.tags.sessionLength[0]?.toUpperCase()}${item.tags.sessionLength.slice(1)} sessions${item.tags.sessionLengthOverridden ? " (set by you)" : ""}`,
    );
  t.push(...item.tags.genres.slice(0, 3));
  return t;
}

export function Detail() {
  const nav = useNav();
  const key = nav.entry.params.key ?? "";
  const { data, error } = useApi(`item:${key}`, () => api.item(key), nav.refreshToken);
  const item = data?.item;
  const [posterFailed, setPosterFailed] = useState(false);

  const actions = useMemo(() => {
    if (!item) return [];
    const a: { key: string; label: string; primary?: boolean }[] = [];
    const resumable = item.kind !== "game" && (item.progress?.positionSec ?? 0) > 0;
    a.push({ key: "act:play", label: resumable ? "Resume" : "Play", primary: true });
    if (resumable) a.push({ key: "act:start", label: "Play from start" });
    a.push({ key: "act:favourite", label: item.favourite ? "★ Favourite" : "☆ Favourite" });
    a.push({ key: "act:hide", label: item.hidden ? "Unhide" : "Hide" });
    if (item.kind === "game") a.push({ key: "act:session", label: "Session length…" });
    return a;
  }, [item]);
  const rows: FocusRow[] = useMemo(() => [{ id: "actions", keys: actions.map((a) => a.key) }], [actions]);

  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: "act:play",
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: data !== null || error !== null,
    onSelect: (k) => {
      if (!item) return;
      if (k === "act:play") nav.launch(item);
      else if (k === "act:start") nav.launch(item, true);
      else if (k === "act:favourite")
        api
          .prefs({ key: item.key, favourite: !item.favourite })
          .then(() => {
            nav.message(
              item.favourite
                ? "Removed from favourites"
                : `Added to favourites for ${nav.profile?.name ?? "this profile"}`,
            );
            nav.refresh();
          })
          .catch((e: Error) => nav.message(e.message, "error"));
      else if (k === "act:hide")
        api
          .prefs({ key: item.key, hidden: !item.hidden })
          .then(() => {
            nav.message(
              item.hidden
                ? `${item.title} is visible again`
                : `${item.title} is hidden for ${nav.profile?.name ?? "this profile"}`,
            );
            nav.refresh();
          })
          .catch((e: Error) => nav.message(e.message, "error"));
      else if (k === "act:session") nav.openOptions(item);
    },
    onOptions: () => {
      if (item) nav.openOptions(item);
    },
  });
  useEffect(() => nav.setBackdrop(item ? item.art.hero : null), [item, nav.setBackdrop]);

  if (error && !data) return <EmptyState title="This item is no longer available" detail={error} />;
  if (!item)
    return (
      <div className="mt-10 flex gap-12">
        <div className="skeleton h-[33rem] w-[22rem] rounded-2xl" />
        <div className="skeleton h-[4rem] w-[40rem] rounded" />
      </div>
    );

  return (
    <FocusProvider focusedKey={focusedKey}>
      <div className="mt-8 flex gap-14" data-testid="detail">
        <div className="h-[33rem] w-[22rem] shrink-0 overflow-hidden rounded-2xl bg-slate shadow-2xl">
          {posterFailed ? (
            <div
              className="flex h-full items-center justify-center p-6 text-center text-[2.5rem] font-bold"
              data-fallback="true"
            >
              {item.title}
            </div>
          ) : (
            <img
              src={item.art.poster}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setPosterFailed(true)}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[4rem] font-extrabold leading-tight" data-testid="detail-title">
            {item.title}
          </h1>
          {item.subtitle && <div className="mt-1 text-[2.25rem] text-muted">{item.subtitle}</div>}
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2" data-testid="detail-meta">
            {metaLine(item, nav.now).map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
          {item.progress && item.progress.positionSec > 0 && (
            <div className="mt-4 h-[0.6rem] w-[30rem] rounded bg-slate-2">
              <div
                className="h-full rounded bg-lamp"
                style={{ width: `${(100 * item.progress.positionSec) / item.progress.durationSec}%` }}
              />
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-4">
            {tagLine(item).map((t) => (
              <span key={t} className="rounded-full bg-slate-2 px-5 py-1 text-muted">
                {t}
              </span>
            ))}
          </div>
          {item.summary && <p className="mt-6 line-clamp-4 max-w-[70rem] text-muted">{item.summary}</p>}
          <div className="mt-auto flex gap-5 pt-8">
            {actions.map((a) => (
              <Focusable
                key={a.key}
                fkey={a.key}
                className={`btn rounded-xl px-9 py-4 text-[2rem] font-semibold ${a.primary ? "bg-lamp text-lamp-ink" : "bg-slate-2 text-text"}`}
              >
                {a.label}
              </Focusable>
            ))}
          </div>
        </div>
      </div>
    </FocusProvider>
  );
}
