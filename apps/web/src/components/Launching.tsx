import type { UnifiedItem } from "@couch/core";

export interface LaunchState {
  item: UnifiedItem;
  phase: "starting" | "started";
  message?: string;
}

/** Shown after a launch until the launcher becomes visible again (or B is pressed). */
export function Launching({ state }: { state: LaunchState }) {
  const verb = state.item.kind === "game" ? "Starting" : "Opening";
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink/95"
      role="status"
      data-testid="launching"
    >
      <div className="flex max-w-[80rem] items-center gap-12 px-12">
        <img
          src={state.item.art.poster}
          alt=""
          className="h-[27rem] w-[18rem] rounded-2xl object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <div>
          <div className="text-muted">{state.phase === "starting" ? `${verb}…` : "Started"}</div>
          <div className="text-[4rem] font-extrabold leading-tight">{state.item.title}</div>
          <div className="mt-4 text-muted">{state.message ?? "Hold on, this takes a moment."}</div>
          <div className="mt-8 text-muted">Press B to return to the launcher.</div>
        </div>
      </div>
    </div>
  );
}
