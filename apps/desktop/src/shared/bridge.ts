// The only file that talks to Tauri. Modules import `api` and `on` from here,
// never `@tauri-apps/api` directly — keeps them portable (e.g. a future web
// remote that speaks the same commands over WebSocket).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as T from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  if (!inTauri) return Promise.reject(new Error(`'${cmd}' needs the desktop app — run "npm run tauri dev"`));
  return invoke<R>(cmd, args);
}

// Tauri converts snake_case Rust argument names to camelCase on the JS side.
export const api = {
  getShow: () => call<T.Show>("get_show"),
  send: (command: T.Command) => call<T.EngineEvent[]>("engine_command", { command }),
  status: () => call<T.EngineStatus>("engine_status"),
  openShow: (path: string) => call<T.Show>("open_show", { path }),
  saveShow: (path?: string) => call<string>("save_show", { path: path ?? null }),
  newDemoShow: () => call<T.Show>("new_demo_show"),
  parseLyrics: (title: string, text: string, maxLines = 4) =>
    call<T.Presentation>("parse_lyrics", { title, text, maxLines }),
  patchWarnings: () => call<string[]>("patch_warnings"),
  serialPorts: () => call<T.SerialPortInfo[]>("list_serial_ports"),
  dmxOutputStatus: () => call<[{ name: string; show_universe: number; error: string | null }[], string[]]>("dmx_output_status"),
  audioDevices: () => call<T.AudioDevice[]>("list_audio_devices"),
  mixerConnect: (config: T.MixerConfig) => call<T.MixerStatus>("mixer_connect", { config }),
  mixerDisconnect: () => call<T.MixerStatus>("mixer_disconnect"),
  mixerStatus: () => call<T.MixerStatus>("mixer_status"),
  aiBuildScene: (text: string, forceLlm = false) => call<T.SceneResult>("ai_build_scene", { text, forceLlm }),
  aiStatus: () => call<T.AiStatus>("ai_status"),
  setApiKey: (key: string, model?: string) => call<void>("set_api_key", { key, model: model ?? null }),
  setVisualizerSource: (source: T.VizSource) => call<void>("set_visualizer_source", { source }),
  monitors: () => call<T.MonitorInfo[]>("list_monitors"),
  openOutput: (kind: "audience" | "stage" | "stream", monitor?: number) =>
    call<void>("open_output_window", { kind, monitor: monitor ?? null }),
  openModule: (module: ModuleId) => call<void>("open_module_window", { module }),
};

export type ModuleId = "presenter" | "lighting" | "audio" | "visualizer";

type Events = {
  "engine-event": T.EngineEvent;
  "visualizer-frame": T.VizFrame;
  "mixer-feedback": T.MixerFeedback[];
  "mixer-error": string;
};

export function on<K extends keyof Events>(name: K, cb: (payload: Events[K]) => void): () => void {
  if (!inTauri) return () => {};
  let un: UnlistenFn | null = null;
  let cancelled = false;
  listen<Events[K]>(name, (e) => cb(e.payload)).then((f) => {
    if (cancelled) f();
    else un = f;
  });
  return () => {
    cancelled = true;
    un?.();
  };
}
