/**
 * Connects the pure focus engine to React.
 *
 * A *scope* (a screen, or a modal on top of it) declares its rows and handlers with
 * `useFocusScope`. Scopes register on a stack; actions go to the top-most enabled scope, which
 * handles directions itself and passes the rest to its handlers. Unhandled actions fall through
 * to the app's global handler (tabs, Tonight, Settings, Back).
 *
 * `<Focusable>` renders a focusable element. The focused one gets `data-focused="true"`, DOM focus
 * (so `document.activeElement` always names the focused tile) and is scrolled into view.
 */
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { Action } from "../input/actions.ts";
import { type FocusRow, type FocusState, move, resolve } from "./engine.ts";
import { revealFocused } from "./scroll.ts";

export type ScopeHandler = (a: Action) => boolean;

const scopeStack: { id: number; handler: { current: ScopeHandler } }[] = [];
let nextScopeId = 1;

/** Dispatch to the top-most scope. Returns true when handled. */
export function dispatchToScopes(a: Action): boolean {
  const top = scopeStack[scopeStack.length - 1];
  return top ? top.handler.current(a) : false;
}

export interface ScopeOptions {
  rows: FocusRow[];
  defaultKey: string | null;
  state: FocusState;
  setState: (s: FocusState) => void;
  onSelect?: (key: string) => void;
  onOptions?: (key: string) => void;
  /** Return true to consume Back (otherwise the app pops the screen). */
  onBack?: () => boolean;
  /** Any other action; return true when handled. */
  onAction?: (a: Action, key: string | null) => boolean;
  /** False while the screen's data is loading: focus is not resolved or stored until it is. */
  ready?: boolean;
  /** Modal scopes swallow every action they do not handle. */
  modal?: boolean;
  enabled?: boolean;
}

export function useFocusScope(o: ScopeOptions): { focusedKey: string | null } {
  const resolved = useMemo(() => resolve(o.rows, o.state, o.defaultKey), [o.rows, o.state, o.defaultKey]);
  const latest = useRef({ o, resolved });
  latest.current = { o, resolved };

  // Keep the stored state valid (focus is never lost when data changes).
  const ready = o.ready ?? true;
  useEffect(() => {
    if (ready && (resolved.key !== o.state.key || resolved.col !== o.state.col)) o.setState(resolved);
  }, [ready, resolved, o.state, o.setState]);

  const handler = useRef<ScopeHandler>(() => false);
  handler.current = (a: Action) => {
    const { o: opts, resolved: cur } = latest.current;
    if (a === "up" || a === "down" || a === "left" || a === "right") {
      const next = move(opts.rows, cur, a);
      if (next.key !== cur.key || next.col !== cur.col) opts.setState(next);
      return true;
    }
    if (a === "select" && cur.key) {
      opts.onSelect?.(cur.key);
      return true;
    }
    if (a === "options" && cur.key && opts.onOptions) {
      opts.onOptions(cur.key);
      return true;
    }
    if (a === "back" && opts.onBack?.()) return true;
    if (opts.onAction?.(a, cur.key)) return true;
    return Boolean(opts.modal && a !== "back");
  };

  const enabled = o.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const entry = { id: nextScopeId++, handler };
    scopeStack.push(entry);
    return () => {
      const i = scopeStack.indexOf(entry);
      if (i >= 0) scopeStack.splice(i, 1);
      // A modal closed: give DOM focus back to the focused element of the scope underneath.
      requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.isConnected && active.dataset.focused === "true") return;
        const candidates = document.querySelectorAll<HTMLElement>("[data-focused='true']");
        candidates[candidates.length - 1]?.focus({ preventScroll: true });
      });
    };
  }, [enabled]);

  return { focusedKey: enabled ? resolved.key : null };
}

export const FocusContext = createContext<string | null>(null);

export function FocusProvider({ focusedKey, children }: { focusedKey: string | null; children: ReactNode }) {
  return <FocusContext.Provider value={focusedKey}>{children}</FocusContext.Provider>;
}

export function useIsFocused(key: string): boolean {
  return useContext(FocusContext) === key;
}

interface FocusableProps {
  fkey: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  label?: string;
  testId?: string;
}

export function Focusable({ fkey, className, style, children, label, testId }: FocusableProps) {
  const focused = useIsFocused(fkey);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.focus({ preventScroll: true });
    revealFocused(ref.current);
  }, [focused]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: tiles hold block content; a div with role=button is intended
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-label={label}
      aria-current={focused ? "true" : undefined}
      data-focus-key={fkey}
      data-focused={focused ? "true" : "false"}
      data-testid={testId}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}
