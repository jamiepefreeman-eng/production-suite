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
  // Editing the slide that's on screen updates the screen (like ProPresenter).
  if (patch.show && state.live) {
    const p = state.show?.presentations.find((x) => x.id === state.live!.presentation);
    const sl = p?.slides.find((x) => x.id === state.live!.slide);
    if (p && sl && (sl.text !== state.live.text || sl.label !== state.live.label || p.title !== state.live.title))
      state = { ...state, live: { ...state.live, text: sl.text, label: sl.label, title: p.title } };
  }
  listeners.forEach((l) => l());
};
const log = (level: LogEntry["level"], message: string) =>
  set({ log: [{ t: Date.now(), level, message }, ...state.log].slice(0, 200) });

// While someone is typing (slide text, fixture names…) this window's copy of the
// show is the truth. Each keystroke sends the whole show to the engine, and the
// engine answers "show changed"; re-reading the show at that moment can return
// a copy from a keystroke or two ago and wipe out letters just typed. So: skip
// re-reads that overlap a local edit, and re-sync once typing pauses.
const QUIET_MS = 600;
let lastLocalEdit = 0;
let resyncTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshShow() {
  const started = Date.now();
  try {
    const show = await api.getShow();
    if (lastLocalEdit >= started) return; // edited meanwhile: this copy is stale
    set({ show, error: null });
  } catch (e) {
    set({ error: String(e) });
  }
}

function handle(ev: EngineEvent) {
  switch (ev.type) {
    case "show_changed":
      // Our own edits echo back here; other windows' edits are picked up once we're idle.
      if (Date.now() - lastLocalEdit > QUIET_MS) void refreshShow();
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
      // Fader moves and EQ tweaks are too chatty for the status line; only show cue-like actions.
      if (ev.command.type === "recall_scene") log("info", `Mixer: recall scene ${ev.command.scene}`);
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
  lastLocalEdit = Date.now();
  set({ show: draft });
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => void refreshShow(), QUIET_MS + 50);
  try {
    await api.send({ type: "replace_show", show: draft });
  } catch (e) {
    log("warn", `Change not saved: ${e}`);
  }
}

export const send = (c: Parameters<typeof api.send>[0]) =>
  api.send(c).catch((e) => log("warn", String(e)));

export { log as pushLog };
