// The only file that talks to Tauri. Modules import `api` and `on` from here,
// never `@tauri-apps/api` directly — keeps them portable (e.g. a future web
// remote that speaks the same commands over WebSocket).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
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
  followStart: (input: T.FollowInput) => call<T.FollowStatus>("follow_start", { input }),
  followStop: () => call<T.FollowStatus>("follow_stop"),
  followStatus: () => call<T.FollowStatus>("follow_status"),
  followSetGate: (gateDb: number) => call<void>("follow_set_gate", { gateDb }),
  followTake: () => call<void>("follow_take"),
  followModels: () => call<T.SpeechModel[]>("follow_models"),
  followDownloadModel: (name: string) => call<string>("follow_download_model", { name }),
  midiStatus: () => call<T.MidiStatus>("midi_status"),
  /** null = listen to every MIDI input */
  midiConnect: (inputs: string[] | null) => call<T.MidiStatus>("midi_connect", { inputs }),
  aiBuildScene: (text: string, forceLlm = false) => call<T.SceneResult>("ai_build_scene", { text, forceLlm }),
  aiRankMedia: (prompt: string, songs: string[], media: T.MediaSummary[]) => call<T.MediaRanking>("ai_rank_media", { prompt, songs, media }),
  aiStatus: () => call<T.AiStatus>("ai_status"),
  setApiKey: (key: string, model?: string) => call<void>("set_api_key", { key, model: model ?? null }),
  setVisualizerSource: (source: T.VizSource) => call<void>("set_visualizer_source", { source }),
  monitors: () => call<T.MonitorInfo[]>("list_monitors"),
  openOutput: (kind: "audience" | "stage" | "stream", monitor?: number) =>
    call<void>("open_output_window", { kind, monitor: monitor ?? null }),
  openModule: (module: ModuleId) => call<void>("open_module_window", { module }),
};

/** Native yes/no dialog. window.confirm() is unreliable inside desktop webviews. */
export async function confirmDialog(message: string): Promise<boolean> {
  if (!inTauri) return window.confirm(message);
  return ask(message, { kind: "warning" });
}

/** URL a webview can load for a local media file (Tauri asset protocol). */
export function mediaUrl(path: string): string {
  return inTauri ? convertFileSrc(path) : path;
}

/** Pick media files for the bin. Returns absolute paths. */
export async function pickMediaFiles(): Promise<string[]> {
  const r = await openDialog({
    multiple: true,
    filters: [
      { name: "Media", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "mov", "m4v", "webm", "mp3", "wav", "m4a", "aac", "ogg", "flac"] },
    ],
  });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

/** Pick a 3D model exported from SketchUp / Blender etc. Returns the absolute path or null. */
export async function pickModelFile(): Promise<string | null> {
  const r = await openDialog({ filters: [{ name: "3D model", extensions: ["stl", "obj", "dae", "glb", "gltf"] }] });
  return typeof r === "string" ? r : null;
}

/** Native open/save pickers for show files (".json"; macOS rejects dotted extensions like "show.json"). */
export const showFiles = {
  open: async () => {
    const p = await openDialog({ filters: [{ name: "Show", extensions: ["json"] }] });
    return typeof p === "string" ? p : null;
  },
  save: (defaultName: string) => saveDialog({ defaultPath: defaultName, filters: [{ name: "Show", extensions: ["json"] }] }),
};

export type ModuleId = "presenter" | "lighting" | "audio" | "visualizer";

type Events = {
  "engine-event": T.EngineEvent;
  "follow-status": T.FollowStatus;
  "follow-model-progress": T.ModelProgress;
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
