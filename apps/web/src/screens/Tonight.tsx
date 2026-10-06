import type { Pick, Profile, TonightMode, TonightResponse, TonightTime } from "@couch/core";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { EmptyState } from "../components/Chrome.tsx";
import type { FocusRow } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { useApi } from "../useApi.ts";

const TIMES: { v: TonightTime; label: string }[] = [
  { v: 30, label: "30 minutes" },
  { v: 60, label: "1 hour" },
  { v: 120, label: "2 hours" },
  { v: "evening", label: "All evening" },
];
const MODES: { v: TonightMode; label: string }[] = [
  { v: "play", label: "Play" },
  { v: "watch", label: "Watch" },
  { v: "either", label: "Either" },
];
const SLOT_LABEL: Record<Pick["slot"], string> = {
  best: "Best match",
  finish: "Finish what you started",
  runnerUp: "Also good",
  wildcard: "Wildcard",
};

type Step = "time" | "who" | "mode" | "results";
const STEPS: Step[] = ["time", "who", "mode", "results"];

/** Three questions (one press each, last answer preselected), then three cards and a reroll. */
export function Tonight() {
  const nav = useNav();
  const p = nav.entry.params;
  const step = (STEPS.includes(p.step as Step) ? p.step : "time") as Step;
  // Keyed by this visit, so the previous answers are always fresh (never a cached copy).
  const { data: last } = useApi(`tonight-last:${nav.entry.id}`, api.tonightDefaults);
  const { data: profilesData } = useApi("profiles", api.profiles, nav.refreshToken);
  const profiles: Profile[] = profilesData?.profiles ?? [];

  const time = (p.time === "evening" ? "evening" : p.time ? Number(p.time) : last?.answers.time) as
    | TonightTime
    | undefined;
  const profileId = p.profile ? Number(p.profile) : last?.answers.profileId;
  const mode = (p.mode ?? last?.answers.mode) as TonightMode | undefined;

  const [result, setResult] = useState<TonightResponse | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const go = (next: Partial<Record<string, string>>) =>
    nav.setParams({ ...p, ...next } as Record<string, string>);

  // Fetch picks when the results step is reached (and on reroll, via `page`).
  const page = Number(p.page ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch once per results page
  useEffect(() => {
    if (step !== "results" || time === undefined || profileId === undefined || !mode) return;
    let alive = true;
    const prev = result?.picks.map((x) => x.item.key) ?? [];
    const exclude = page > 0 ? [...new Set([...shown, ...prev])] : [];
    api
      .tonight({ time, profileId, mode, page, exclude, skipped: page > 0 ? prev : [] })
      .then((r) => {
        if (!alive) return;
        setResult(r);
        setShown(exclude);
        setError(null);
        // The answer to "Who is here?" became the active profile: refresh everything else.
        if (r.answers.profileId !== nav.profile?.id) nav.refresh();
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [step, page]);

  const rows: FocusRow[] = useMemo(() => {
    if (step === "time") return [{ id: "q", keys: TIMES.map((t) => `time:${t.v}`) }];
    if (step === "who") return [{ id: "q", keys: profiles.map((x) => `who:${x.id}`) }];
    if (step === "mode") return [{ id: "q", keys: MODES.map((m) => `mode:${m.v}`) }];
    return [
      { id: "cards", keys: (result?.picks ?? []).map((x) => `pick:${x.item.key}`) },
      { id: "actions", keys: [...(result?.picks.length ? ["btn:reroll"] : []), "btn:restart"] },
    ];
  }, [step, profiles, result]);

  const defaultKey =
    step === "time"
      ? `time:${time ?? 60}`
      : step === "who"
        ? `who:${profileId ?? nav.profile?.id ?? 1}`
        : step === "mode"
          ? `mode:${mode ?? "either"}`
          : result?.picks[0]
            ? `pick:${result.picks[0].item.key}`
            : "btn:restart";

  const ready =
    last !== null &&
    (step !== "who" || profiles.length > 0) &&
    (step !== "results" || result !== null || error !== null);
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey,
    // A key from the previous step is stale here, so each question starts on its preselected answer.
    state: nav.entry.focus,
    setState: nav.setFocus,
    ready,
    onBack: () => {
      const i = STEPS.indexOf(step);
      if (i === 0) return false;
      setResult(null);
      setShown([]);
      go({ step: STEPS[i - 1] as string, page: "0" });
      return true;
    },
    onSelect: (k) => {
      if (k.startsWith("time:")) go({ step: "who", time: k.slice(5) });
      else if (k.startsWith("who:")) go({ step: "mode", profile: k.slice(4) });
      else if (k.startsWith("mode:")) {
        setResult(null);
        go({ step: "results", mode: k.slice(5), page: "0" });
      } else if (k === "btn:reroll") go({ page: String(page + 1) });
      else if (k === "btn:restart") {
        setResult(null);
        setShown([]);
        go({ step: "time", page: "0" });
      } else if (k.startsWith("pick:")) {
        const pick = result?.picks.find((x) => `pick:${x.item.key}` === k);
        if (!pick) return;
        api.tonightAccept(pick.item.key, profileId ?? 1).catch(() => {});
        nav.launch(pick.item);
      }
    },
  });

  const focusedPick = result?.picks.find((x) => `pick:${x.item.key}` === focusedKey);
  useEffect(
    () => nav.setBackdrop(focusedPick ? focusedPick.item.art.hero : null),
    [focusedPick, nav.setBackdrop],
  );

  const question = (
    n: number,
    title: string,
    options: { key: string; label: string; sub?: string; selected: boolean }[],
  ) => (
    <div className="inset mt-10" data-testid={`question-${n}`}>
      <div className="text-muted">Question {n} of 3</div>
      <h2 className="mt-2 mb-10 text-[3.5rem] font-extrabold">{title}</h2>
      <div className="flex flex-wrap gap-6">
        {options.map((o) => (
          <Focusable
            key={o.key}
            fkey={o.key}
            className={`btn flex min-w-[18rem] flex-col rounded-2xl px-10 py-7 ${o.selected ? "bg-slate-2" : "bg-slate"}`}
          >
            <span className="text-[2.5rem] font-bold">{o.label}</span>
            {o.sub && <span className="text-muted">{o.sub}</span>}
            {o.selected && <span className="mt-1 text-lamp">✓ Last time</span>}
          </Focusable>
        ))}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (step === "time")
    body = question(
      1,
      "How long do you have?",
      TIMES.map((t) => ({ key: `time:${t.v}`, label: t.label, selected: last?.answers.time === t.v })),
    );
  else if (step === "who")
    body = question(
      2,
      "Who is here?",
      profiles.map((x) => ({
        key: `who:${x.id}`,
        label: x.name,
        sub: x.size === 1 ? "Just one" : `${x.size === 2 ? "Two" : `${x.size} or more`} people`,
        selected: last?.answers.profileId === x.id,
      })),
    );
  else if (step === "mode")
    body = question(
      3,
      "Play, watch, or either?",
      MODES.map((m) => ({ key: `mode:${m.v}`, label: m.label, selected: last?.answers.mode === m.v })),
    );
  else if (error) body = <EmptyState title="Could not pick" detail={error} />;
  else if (!result)
    body = (
      <div className="inset mt-10 flex gap-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[30rem] w-[34rem] rounded-3xl" data-skeleton="true" />
        ))}
      </div>
    );
  else
    body = (
      <div className="inset mt-8" data-testid="tonight-results">
        <div className="mb-6 text-muted">
          {TIMES.find((t) => t.v === result.answers.time)?.label} ·{" "}
          {profiles.find((x) => x.id === result.answers.profileId)?.name} ·{" "}
          {MODES.find((m) => m.v === result.answers.mode)?.label}
          {result.page > 0 ? ` · set ${result.page + 1}` : ""}
        </div>
        {result.picks.length === 0 ? (
          <EmptyState
            title={result.page > 0 ? "That's everything that fits" : "Nothing fits those answers"}
            detail="Start over with more time or a different choice."
          />
        ) : (
          <div className="flex gap-8">
            {result.picks.map((x) => (
              <Focusable
                key={x.item.key}
                fkey={`pick:${x.item.key}`}
                testId={`pick-${x.slot}`}
                className="tile flex h-[30rem] w-[34rem] gap-6 overflow-hidden rounded-3xl bg-slate p-6"
              >
                <img
                  src={x.item.art.poster}
                  alt=""
                  className="h-full w-[12rem] shrink-0 rounded-xl bg-slate-2 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold text-lamp">{SLOT_LABEL[x.slot]}</span>
                  <span className="mt-2 text-[2.5rem] font-extrabold leading-tight">{x.item.title}</span>
                  {x.item.subtitle && <span className="text-muted">{x.item.subtitle}</span>}
                  <span className="mt-auto" data-testid="pick-reason">
                    {x.reason}
                  </span>
                </div>
              </Focusable>
            ))}
          </div>
        )}
        <div className="mt-10 flex gap-6">
          {result.picks.length > 0 && (
            <Focusable fkey="btn:reroll" className="btn rounded-xl bg-slate-2 px-9 py-4 font-semibold">
              Show three more
            </Focusable>
          )}
          <Focusable fkey="btn:restart" className="btn rounded-xl bg-slate-2 px-9 py-4 font-semibold">
            Start over
          </Focusable>
        </div>
      </div>
    );

  return <FocusProvider focusedKey={focusedKey}>{body}</FocusProvider>;
}
