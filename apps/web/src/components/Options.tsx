import type { SessionLength, UnifiedItem } from "@couch/core";
import { useMemo, useState } from "react";
import { api } from "../api.ts";
import type { FocusRow, FocusState } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";

const LENGTHS: (SessionLength | null)[] = [null, "short", "medium", "long"];
const LENGTH_LABEL = (s: SessionLength | null) =>
  s === null
    ? "Automatic"
    : s === "short"
      ? "Short (about 30 min)"
      : s === "medium"
        ? "Medium (about 1 hour)"
        : "Long (2 hours or more)";

/** The Y menu: favourite, hide and (games) session length for one item, for the active profile. */
export function OptionsMenu({
  item,
  onClose,
  onChanged,
}: {
  item: UnifiedItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const nav = useNav();
  const [state, setState] = useState<FocusState>({ key: "opt:favourite", col: 0 });
  const [fav, setFav] = useState(Boolean(item.favourite));
  const [hidden, setHidden] = useState(Boolean(item.hidden));
  const [len, setLen] = useState<SessionLength | null>(
    item.tags.sessionLengthOverridden ? item.tags.sessionLength : null,
  );

  const rows: FocusRow[] = useMemo(
    () => [
      { id: "fav", keys: ["opt:favourite"] },
      { id: "hide", keys: ["opt:hide"] },
      ...(item.kind === "game" ? [{ id: "len", keys: LENGTHS.map((l) => `len:${l ?? "auto"}`) }] : []),
      { id: "close", keys: ["opt:close"] },
    ],
    [item.kind],
  );

  const save = (change: { favourite?: boolean; hidden?: boolean; sessionLength?: SessionLength | null }) =>
    api
      .prefs({ key: item.key, ...change })
      .then(() => onChanged())
      .catch((e: Error) => nav.message(e.message, "error"));

  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: "opt:favourite",
    state,
    setState,
    modal: true,
    onBack: () => {
      onClose();
      return true;
    },
    onSelect: (k) => {
      if (k === "opt:favourite") {
        setFav(!fav);
        void save({ favourite: !fav });
      } else if (k === "opt:hide") {
        setHidden(!hidden);
        void save({ hidden: !hidden }).then(() => {
          nav.message(
            hidden
              ? `${item.title} is visible again`
              : `${item.title} is hidden for ${nav.profile?.name ?? "this profile"}`,
          );
        });
        onClose();
      } else if (k.startsWith("len:")) {
        const v = k.slice(4) === "auto" ? null : (k.slice(4) as SessionLength);
        setLen(v);
        void save({ sessionLength: v });
      } else if (k === "opt:close") onClose();
    },
  });

  return (
    <FocusProvider focusedKey={focusedKey}>
      <div
        className="absolute inset-0 z-30 flex items-center justify-center bg-ink/90"
        role="dialog"
        aria-label="Options"
        data-testid="options"
      >
        <div className="w-[62rem] rounded-3xl bg-slate p-12">
          <div className="text-muted">Options for {nav.profile?.name ?? "this profile"}</div>
          <div className="mb-8 text-[3rem] font-bold">{item.title}</div>
          <div className="flex flex-col gap-5">
            <Focusable fkey="opt:favourite" className="btn rounded-xl bg-slate-2 px-8 py-4">
              {fav ? "★ Remove from favourites" : "☆ Add to favourites"}
            </Focusable>
            <Focusable fkey="opt:hide" className="btn rounded-xl bg-slate-2 px-8 py-4">
              {hidden ? "Unhide" : "Hide from this profile"}
            </Focusable>
            {item.kind === "game" && (
              <div>
                <div className="mt-3 mb-3 text-muted">Session length: {LENGTH_LABEL(len)}</div>
                <div className="flex gap-4">
                  {LENGTHS.map((l) => (
                    <Focusable
                      key={l ?? "auto"}
                      fkey={`len:${l ?? "auto"}`}
                      className={`chip rounded-full px-6 py-2 ${len === l ? "bg-text font-semibold text-ink" : "bg-slate-2"}`}
                    >
                      {l === null ? "Auto" : l[0]?.toUpperCase() + l.slice(1)}
                    </Focusable>
                  ))}
                </div>
              </div>
            )}
            <Focusable fkey="opt:close" className="btn mt-4 rounded-xl bg-slate-2 px-8 py-4 text-muted">
              Close
            </Focusable>
          </div>
        </div>
      </div>
    </FocusProvider>
  );
}
