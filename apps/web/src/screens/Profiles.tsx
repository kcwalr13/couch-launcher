import type { Profile } from "@couch/core";
import { useMemo } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

const sizeText = (p: Profile) =>
  p.size === 1 ? "Just one" : p.size === 2 ? "Two people" : `${p.size} or more people`;

/** Who is on the couch: switch the active profile (its favourites, hidden items and picks). */
export function Profiles({ onChanged }: { onChanged: () => void }) {
  const nav = useNav();
  const { data, error } = useApi("profiles", api.profiles, nav.refreshToken);
  const profiles = data?.profiles ?? [];
  const rows: FocusRow[] = useMemo(
    () => [{ id: "profiles", keys: profiles.map((p) => `profile:${p.id}`) }],
    [profiles],
  );
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: data ? `profile:${data.active.id}` : null,
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready: data !== null,
    onSelect: (k) => {
      const id = Number(k.slice("profile:".length));
      api
        .switchProfile(id)
        .then((r) => {
          onChanged();
          nav.refresh();
          nav.message(`${r.active.name} is on the couch.`);
          nav.pop();
        })
        .catch((e: Error) => nav.message(e.message, "error"));
    },
  });

  if (error && !data) return <EmptyState title="Could not load profiles" detail={error} />;
  return (
    <FocusProvider focusedKey={focusedKey}>
      <p className="inset mt-6 text-muted">
        Favourites, hidden items and Tonight picks belong to the active profile.
      </p>
      <div className="inset mt-10 flex gap-8">
        {profiles.map((p) => (
          <Focusable
            key={p.id}
            fkey={`profile:${p.id}`}
            testId={`profile-${p.name}`}
            className={`btn flex w-[26rem] flex-col gap-3 rounded-3xl px-10 py-10 ${p.isDefault ? "bg-slate-2" : "bg-slate"}`}
          >
            <span className="text-[3rem] font-extrabold">{p.name}</span>
            <span className="text-muted">{sizeText(p)}</span>
            {p.isDefault && <span className="mt-2 font-semibold text-lamp">✓ On the couch now</span>}
          </Focusable>
        ))}
      </div>
    </FocusProvider>
  );
}
