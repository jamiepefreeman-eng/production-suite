// Shared, read-mostly view of the engine for every module (and every window —
// each window has its own copy, kept in sync by engine events).

import { useEffect, useSyncExternalStore } from "react";
import { api, on } from "./bridge";
import type { EngineEvent, Look, Show } from "./types";

export interface LiveSlide { presentation: number; slide: number; title: string; label: string; text: string }
export interface LogEntry { t: number; level: "info" | "warn"; message: string }

export interface EngineView {
  show: Show | null;
  live: LiveSlide | null;
  activeCue: number | null;
  programmer: Look;
  blackout: boolean;
  lastScene: { applied: string[]; issues: string[]; unknown: string[] } | null;
  log: LogEntry[];
  error: string | null;
}

let state: EngineView = {
  show: null,
  live: null,
  activeCue: null,
  programmer: { fixtures: {} },
  blackout: false,
  lastScene: null,
  log: [],
  error: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<EngineView>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const log = (level: LogEntry["level"], message: string) =>
  set({ log: [{ t: Date.now(), level, message }, ...state.log].slice(0, 200) });

async function refreshShow() {
  try {
    set({ show: await api.getShow(), error: null });
  } catch (e) {
    set({ error: String(e) });
  }
}

function handle(ev: EngineEvent) {
  switch (ev.type) {
    case "show_changed":
      void refreshShow();
      break;
    case "slide_live":
      set({ live: ev });
      break;
    case "slide_cleared":
      set({ live: null });
      break;
    case "cue_fired":
      set({ activeCue: ev.cue, blackout: false });
      log("info", `Cue ${ev.cue}: ${ev.name}`);
      break;
    case "cue_released":
      set({ activeCue: null });
      break;
    case "programmer_changed":
      set({ programmer: ev.look });
      break;
    case "scene_built":
      set({ lastScene: ev });
      break;
    case "blackout_changed":
      set({ blackout: ev.on });
      break;
    case "mixer_out":
      log("info", `Mixer: ${JSON.stringify(ev.command)}`);
      break;
    case "log":
      log(ev.level, ev.message);
      break;
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  // A window opened mid-service picks up what's already live.
  Promise.all([refreshShow(), api.status()])
    .then(([, s]) => {
      let live: LiveSlide | null = null;
      if (s.live_slide && state.show) {
        const [pid, sid] = s.live_slide;
        const p = state.show.presentations.find((x) => x.id === pid);
        const sl = p?.slides.find((x) => x.id === sid);
        if (p && sl) live = { presentation: pid, slide: sid, title: p.title, label: sl.label, text: sl.text };
      }
      set({ activeCue: s.active_cue, programmer: s.programmer, live });
    })
    .catch(() => {});
  on("engine-event", handle);
  on("mixer-error", (m) => log("warn", m));
}

export function useEngine(): EngineView {
  useEffect(start, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Edit the show locally, then hand the whole thing back to the engine. */
export async function updateShow(mutate: (draft: Show) => void) {
  if (!state.show) return;
  const draft: Show = structuredClone(state.show);
  mutate(draft);
  set({ show: draft });
  await api.send({ type: "replace_show", show: draft });
}

export const send = (c: Parameters<typeof api.send>[0]) =>
  api.send(c).catch((e) => log("warn", String(e)));

export { log as pushLog };
