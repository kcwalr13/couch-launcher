import type { Profile, UiState, UnifiedItem } from "@couch/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.ts";
import { Backdrop, Header, HintBar } from "./components/Chrome.tsx";
import { Launching, type LaunchState } from "./components/Launching.tsx";
import { type Message, MessageToast } from "./components/Message.tsx";
import { OptionsMenu } from "./components/Options.tsx";
import type { FocusState } from "./focus/engine.ts";
import { dispatchToScopes } from "./focus/scope.tsx";
import type { Action } from "./input/actions.ts";
import { InputController } from "./input/controller.ts";
import { type Entry, type NavApi, NavContext, ROOT_TABS, type ScreenName } from "./nav.tsx";
import { Detail } from "./screens/Detail.tsx";
import { Home } from "./screens/Home.tsx";
import { Play } from "./screens/Play.tsx";
import { Profiles } from "./screens/Profiles.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Tonight } from "./screens/Tonight.tsx";
import { Watch } from "./screens/Watch.tsx";
import { clearApiCache } from "./useApi.ts";

let nextEntryId = 1;
const entry = (
  screen: ScreenName,
  params: Record<string, string> = {},
  focusKey: string | null = null,
): Entry => ({
  id: nextEntryId++,
  screen,
  params,
  focus: { key: focusKey, col: focusKey ? -1 : 0 },
});

const SCREENS: ScreenName[] = ["home", "play", "watch", "detail", "tonight", "profiles", "settings"];

/** Rebuild the navigation stack from the state saved by the service (screen, focus, params). */
export function stackFromUiState(s: UiState | null): Entry[] {
  if (!s || !SCREENS.includes(s.screen as ScreenName)) return [entry("home")];
  const screen = s.screen as ScreenName;
  const top = entry(screen, s.params ?? {}, s.focusedKey);
  if (ROOT_TABS.includes(screen)) return [top];
  if (screen === "detail" && !s.params?.key) return [entry("home")];
  return [entry("home"), top];
}

const TITLES: Partial<Record<ScreenName, string>> = {
  tonight: "Tonight",
  profiles: "Who's on the couch?",
  settings: "Settings",
};

export interface AppProps {
  initial?: Entry[];
  serverNow?: string;
}

export function App({ initial }: AppProps) {
  const [stack, setStack] = useState<Entry[]>(() => initial ?? [entry("home")]);
  const tabMemory = useRef(new Map<ScreenName, Entry>());
  const [refreshToken, setRefreshToken] = useState(0);
  const [backdrop, setBackdropState] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [toast, setToast] = useState<Message | null>(null);
  const [options, setOptions] = useState<UnifiedItem | null>(null);
  const [launching, setLaunching] = useState<LaunchState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const top = stack[stack.length - 1] as Entry;

  // Save the screen and focus to the service (debounced) so a reload or a browser restart
  // after a game comes back to the same place.
  const saveKey = JSON.stringify([top.screen, top.params, top.focus.key]);
  const latestTop = useRef(top);
  latestTop.current = top;
  // Flush at once when the page is hidden or unloaded (a game starting, a reload).
  useEffect(() => {
    const flush = () => {
      const e = latestTop.current;
      if (e.focus.key === null) return;
      fetch("/api/ui-state", {
        method: "PUT",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screen: e.screen, focusedKey: e.focus.key, params: e.params }),
      }).catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: saveKey captures what matters
  useEffect(() => {
    if (top.focus.key === null) return;
    const t = setTimeout(() => {
      api.putUiState({ screen: top.screen, focusedKey: top.focus.key, params: top.params }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [saveKey]);

  // Clock and serverside "now" (mock mode pins the server clock; the UI follows it).
  useEffect(() => {
    let offset = 0;
    api
      .status()
      .then((s) => {
        offset = Date.parse(s.now) - Date.now();
        setNow(new Date(Date.now() + offset));
        document.documentElement.style.setProperty("--ui-scale", String(s.uiScale));
      })
      .catch(() => {});
    const t = setInterval(() => setNow(new Date(Date.now() + offset)), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadProfile = useCallback(() => {
    api
      .profiles()
      .then((p) => setProfile(p.active))
      .catch(() => {});
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the profile when data is refreshed
  useEffect(loadProfile, [loadProfile, refreshToken]);

  const refresh = useCallback(() => {
    clearApiCache();
    setRefreshToken((n) => n + 1);
  }, []);

  // Coming back from a game or Jellyfin: refresh data, clear the Launching state.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setLaunching(null);
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const message = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind, id: Date.now() });
  }, []);

  const push = useCallback((screen: ScreenName, params: Record<string, string> = {}, focusKey?: string) => {
    setBackdropState(null);
    setStack((s) => {
      // Tabs are roots: opening one from Home replaces the stack, remembering its focus.
      if (ROOT_TABS.includes(screen)) {
        const remembered = tabMemory.current.get(screen);
        return [remembered ?? entry(screen, params, focusKey ?? null)];
      }
      return [...s, entry(screen, params, focusKey ?? null)];
    });
  }, []);

  const pop = useCallback(() => {
    setStack((s) => {
      if (s.length > 1) return s.slice(0, -1);
      const root = s[0] as Entry;
      if (root.screen !== "home") return [tabMemory.current.get("home") ?? entry("home")];
      return s;
    });
  }, []);

  const updateTop = useCallback((f: (e: Entry) => Entry) => {
    setStack((s) => {
      const last = s[s.length - 1] as Entry;
      const next = f(last);
      if (s.length === 1 && ROOT_TABS.includes(next.screen)) tabMemory.current.set(next.screen, next);
      return [...s.slice(0, -1), next];
    });
  }, []);

  const setFocus = useCallback((focus: FocusState) => updateTop((e) => ({ ...e, focus })), [updateTop]);
  const setParams = useCallback(
    (params: Record<string, string>) => updateTop((e) => ({ ...e, params })),
    [updateTop],
  );
  const setBackdrop = useCallback((url: string | null) => setBackdropState(url), []);

  const launch = useCallback(
    (item: UnifiedItem, fromStart = false) => {
      setLaunching({ item, phase: "starting" });
      api
        .launch(item.key, fromStart)
        .then((r) => {
          if (!r.ok) {
            setLaunching(null);
            message(r.message, "error");
            return;
          }
          if (r.openUrl) {
            window.location.assign(r.openUrl);
            return;
          }
          setLaunching({ item, phase: "started", message: r.message });
        })
        .catch((e: Error) => {
          setLaunching(null);
          message(e.message, "error");
        });
    },
    [message],
  );

  const switchTab = useCallback(
    (dir: 1 | -1) => {
      const root = (stack[0] as Entry).screen;
      const i = ROOT_TABS.indexOf(root);
      const next = ROOT_TABS[(Math.max(0, i) + dir + ROOT_TABS.length) % ROOT_TABS.length] as ScreenName;
      push(next);
    },
    [stack, push],
  );

  // Global actions, after the focused scope had its chance.
  const onAction = useCallback(
    (a: Action) => {
      if (launching) {
        // While launching, B dismisses the overlay; nothing else does anything.
        if (a === "back" || a === "select") setLaunching(null);
        return;
      }
      if (dispatchToScopes(a)) return;
      if (a === "back") pop();
      else if (a === "tonight" && top.screen !== "tonight") push("tonight");
      else if (a === "settings" && top.screen !== "settings") push("settings");
      else if (a === "prevTab") switchTab(-1);
      else if (a === "nextTab") switchTab(1);
    },
    [launching, pop, push, switchTab, top.screen],
  );
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  useEffect(() => new InputController((a) => actionRef.current(a)).start(), []);

  const nav: NavApi = useMemo(
    () => ({
      entry: top,
      depth: stack.length,
      push,
      pop,
      setFocus,
      setParams,
      refreshToken,
      refresh,
      now,
      profile,
      setBackdrop,
      message,
      launch,
      openOptions: setOptions,
    }),
    [
      top,
      stack.length,
      push,
      pop,
      setFocus,
      setParams,
      refreshToken,
      refresh,
      now,
      profile,
      setBackdrop,
      message,
      launch,
    ],
  );

  const rootTab = (stack[0] as Entry).screen;
  const title = TITLES[top.screen];
  return (
    <NavContext.Provider value={nav}>
      <div className="relative h-full w-full overflow-hidden" data-screen={top.screen}>
        <Backdrop url={backdrop} />
        <div className="safe flex flex-col">
          {title ? (
            <header className="flex h-[4.5rem] items-center gap-6">
              <h1 className="text-[2.75rem] font-bold">{title}</h1>
              <span className="ml-auto text-muted">{profile?.name}</span>
            </header>
          ) : (
            <Header tab={rootTab} profile={profile} now={now} />
          )}
          <main className="relative min-h-0 flex-1" key={top.id}>
            {top.screen === "home" && <Home />}
            {top.screen === "play" && <Play />}
            {top.screen === "watch" && <Watch />}
            {top.screen === "detail" && <Detail />}
            {top.screen === "tonight" && <Tonight />}
            {top.screen === "profiles" && <Profiles onChanged={loadProfile} />}
            {top.screen === "settings" && <Settings />}
          </main>
          <div className="relative h-[3.5rem] shrink-0">
            <HintBar />
          </div>
        </div>
        {options && (
          <OptionsMenu
            item={options}
            onClose={() => setOptions(null)}
            onChanged={() => {
              refresh();
            }}
          />
        )}
        {launching && <Launching state={launching} />}
        <MessageToast message={toast} onDone={() => setToast(null)} />
      </div>
    </NavContext.Provider>
  );
}
