/** Navigation state shared by every screen. */
import type { Profile, UnifiedItem } from "@couch/core";
import { createContext, useContext } from "react";
import type { FocusState } from "./focus/engine.ts";

export type ScreenName = "home" | "play" | "watch" | "detail" | "tonight" | "profiles" | "settings";
export const ROOT_TABS: ScreenName[] = ["home", "play", "watch"];

export interface Entry {
  id: number;
  screen: ScreenName;
  params: Record<string, string>;
  focus: FocusState;
}

export interface NavApi {
  entry: Entry;
  depth: number;
  push(screen: ScreenName, params?: Record<string, string>, focusKey?: string): void;
  pop(): void;
  setFocus(f: FocusState): void;
  setParams(p: Record<string, string>): void;
  /** Increments when data should be refetched (page became visible again, rescan, prefs). */
  refreshToken: number;
  refresh(): void;
  now: Date;
  profile: Profile | null;
  setBackdrop(url: string | null): void;
  message(text: string, kind?: "info" | "error"): void;
  launch(item: UnifiedItem, fromStart?: boolean): void;
  openOptions(item: UnifiedItem): void;
}

export const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const n = useContext(NavContext);
  if (!n) throw new Error("NavContext missing");
  return n;
}
