import { useMemo, useState } from "react";
import type { FocusState } from "../focus/engine.ts";
import { Focusable, FocusProvider, useFocusScope } from "../focus/scope.tsx";
import { useNav } from "../nav.tsx";
import { EmptyState } from "./Chrome.tsx";

/** A screen that is not built yet: one focusable Back button so focus is never lost. */
export function Placeholder({ title }: { title: string }) {
  const nav = useNav();
  const [state, setState] = useState<FocusState>({ key: "btn:back", col: 0 });
  const rows = useMemo(() => [{ id: "back", keys: ["btn:back"] }], []);
  const { focusedKey } = useFocusScope({
    rows,
    defaultKey: "btn:back",
    state,
    setState,
    onSelect: () => nav.pop(),
  });
  return (
    <FocusProvider focusedKey={focusedKey}>
      <div className="mt-8 flex flex-col items-start gap-6">
        <EmptyState title={title} detail="Not built yet." />
        <Focusable fkey="btn:back" className="btn rounded-xl bg-slate-2 px-8 py-4">
          Back
        </Focusable>
      </div>
    </FocusProvider>
  );
}
