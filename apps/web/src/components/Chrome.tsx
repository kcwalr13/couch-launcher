import type { Profile } from "@couch/core";
import type { ReactNode } from "react";

export const TABS = [
  { id: "home", label: "Home" },
  { id: "play", label: "Play" },
  { id: "watch", label: "Watch" },
] as const;

/** Top bar: tabs (switched with LB / RB), profile and clock. Not focusable itself. */
export function Header({
  tab,
  profile,
  now,
  extra,
}: {
  tab: string;
  profile: Profile | null;
  now: Date;
  extra?: ReactNode;
}) {
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <header className="flex h-[4.5rem] items-center gap-8">
      <span className="rounded-md border-2 border-muted px-2 text-muted" aria-hidden="true">
        LB
      </span>
      <nav className="flex gap-8" aria-label="Sections">
        {TABS.map((t) => (
          <span
            key={t.id}
            data-tab={t.id}
            aria-current={t.id === tab ? "page" : undefined}
            className={
              t.id === tab
                ? "border-b-[0.3rem] border-lamp pb-1 text-[2.25rem] font-bold text-text"
                : "pb-1 text-[2.25rem] text-muted"
            }
          >
            {t.label}
          </span>
        ))}
      </nav>
      <span className="rounded-md border-2 border-muted px-2 text-muted" aria-hidden="true">
        RB
      </span>
      <div className="ml-auto flex items-center gap-8">
        {extra}
        {profile && (
          <span className="text-muted" data-testid="header-profile">
            {profile.name}
          </span>
        )}
        <span className="tabular-nums text-muted">{time}</span>
      </div>
    </header>
  );
}

const HINTS: [string, string][] = [
  ["A", "Select"],
  ["B", "Back"],
  ["X", "Tonight"],
  ["Y", "Options"],
  ["Start", "Settings"],
];

export function HintBar({ hints = HINTS }: { hints?: [string, string][] }) {
  return (
    <footer
      className="absolute inset-x-0 bottom-0 flex h-[3rem] items-center gap-10 text-muted"
      aria-hidden="true"
    >
      {hints.map(([k, v]) => (
        <span key={k} className="flex items-center gap-3">
          <span className="rounded-md bg-slate-2 px-3 font-semibold text-text">{k}</span>
          {v}
        </span>
      ))}
    </footer>
  );
}

/** Full-screen art behind the UI, dimmed so text over it keeps its contrast. */
export function Backdrop({ url }: { url: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30 blur-[0.15rem]"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/70" />
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-slate px-8 py-6" data-testid="empty-state">
      <div className="font-semibold">{title}</div>
      {detail && <div className="mt-2 text-muted">{detail}</div>}
    </div>
  );
}
